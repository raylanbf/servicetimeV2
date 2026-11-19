# Canvas Studio

## Sumário
1. O Studio visto pela extensão
2. A fronteira de acesso
3. A coleção do curso e a lista `tiles`
4. Ler a coleção inteira pelos cabeçalhos da SPA
5. Ligar a coleção ao curso do Canvas (`lti_params`)
6. O embed de um vídeo
7. Inserir vídeos nas páginas a partir de uma planilha
8. Redimensionar vídeos
9. Transcrições e legendas
10. Dados sensíveis
11. Becos sem saída e diagnóstico

---

## 1. O Studio visto pela extensão

- O Studio é uma **SPA num iframe** de `https://<instituicao>.instructuremedia.com`, aberta pelo Canvas por LTI (no menu do curso ou no botão "Studio" do editor).
- O HTML estático do frame é só a casca (`<div id="App">` + `app.js`); os dados chegam depois, por `fetch`/XHR.
- **A API do Studio autentica por cabeçalho, não por cookie.** Um pedido "limpo", só com o cookie, volta **401**. Os cabeçalhos certos existem só na memória da SPA, dentro do frame.
- A SPA troca de rota sem recarregar: monitore `history.pushState`/`popstate` se precisar reagir à navegação.

Consequência de projeto: **quem fala com a API do Studio é um script dentro do frame do Studio**, no mundo MAIN, desde o início da página (`run_at: 'document_start'`, `all_frames: true`). O painel pede; o frame executa; os cabeçalhos nunca saem dele.

---

## 2. A fronteira de acesso

| Caminho | Funciona? | Observação |
|---|---|---|
| Interceptar a SPA dentro do frame e repetir a chamada com os mesmos cabeçalhos | **sim**, sem chave | o caminho usado nos projetos (§3–4) |
| Studio Public API (`/api/public/v1/...`) | só com chave | exige token emitido pelo administrador da instituição |
| `GET /api/v1/courses/:id/media_objects` (Canvas) | **não serve** | lista a mídia do Canvas/Kaltura, outro sistema; os vídeos do Studio não estão lá |
| API do Studio do painel ou de um content script comum, só com cookie | **não** | 401 |

---

## 3. A coleção do curso e a lista `tiles`

O id da coleção está na URL do frame:

```
https://<instituicao>.instructuremedia.com/lti-app/media-picker/collections/courses/123456?lti_params=<JWT>
                                                                                   ^^^^^^ collection_id
```

Ao abrir a coleção, a SPA chama a listagem **`tiles`** (20 por página):

```
GET …/tiles?page=1&per_page=20&sort_by=created_at&order=desc&filter[]=perspectives
→ { tiles: [ { item_type, data: { … } } ], meta: { current_page, per_page, last_page, total_count } }
```

Campos de cada vídeo (`tiles[i].data`), confirmados numa resposta real:

| Para quê | Campo |
|---|---|
| **`media_id` do embed** (`custom_arc_media_id`) | `data.media.lti_launch_id` (formato `<uuid>-<media.id>`) |
| Título | `data.title` (= `data.media.title`) |
| Id numérico da mídia | `data.media.id` |
| Miniatura | `data.media.thumbnail_url` |
| Duração (s) | `data.media.duration` |
| Tem legenda? | `data.has_captions` / `data.media.has_captions` |
| Coleção | `data.collection.{ id, name, type }` (a do curso é `course_wide`) |
| Quando entrou no Studio × na coleção | campos de data em `data.media` × em `data` (os nomes variam: procure entre `created_at`, `published_at`, `added_at`… e aceite só datas plausíveis) |

Itens sem `data.media.lti_launch_id` são pastas ou outros tipos: pule.

---

## 4. Ler a coleção inteira pelos cabeçalhos da SPA

A SPA só baixa a página que está na tela. Para ter a coleção toda, o script do frame:

1. **Intercepta** `fetch` e `XMLHttpRequest` (guardando o `fetch` original antes do patch);
2. quando uma resposta é da `tiles`, **lê uma cópia** (`res.clone()`) e guarda método, cabeçalhos e `credentials` do pedido original, sem os que o navegador define sozinho (`cookie`, `origin`, `referer`, `host`, `user-agent`, `sec-fetch-*`, `content-length`, `connection`);
3. pede as páginas seguintes (`page = 1 … meta.last_page`, pulando a atual) **com o `fetch` original**, `GET`, os **mesmos cabeçalhos**, uma por vez;
4. deduplica por `lti_launch_id` e para se uma página não trouxer nada novo (o servidor ignorou `page`) ou se passar do teto (50 páginas = 1000 vídeos).

```js
const origFetch = window.fetch;
window.fetch = function (...args) {
  return origFetch.apply(this, args).then(res => {
    try { if (ehTiles(res.url)) res.clone().text().then(t => analisar(res.url, t, pedidoDe(args))).catch(() => {}); }
    catch { /* nunca atrapalha o Studio */ }
    return res;                                  // a resposta original segue intacta
  });
};
```

Regras do interceptador: **nenhuma resposta é alterada**, erro nele nunca quebra a SPA (`try/catch` em volta de tudo) e ele só pagina pedidos `GET`.

**Uma busca dentro da coleção é outra lista** (mesmo endereço com outros filtros). Agrupe pela URL sem `page` e, na hora de usar, prefira a lista da coleção `course_wide`; entre candidatas, a maior.

**Do frame para a extensão:** o MAIN manda `postMessage({ __marca: true, type: 'tiles', videos: [{ id, title }], total, complete })`; um content script ISOLATED no mesmo frame aceita só `e.source === window` com a marca e grava em `chrome.storage.local` (ex.: `studioVideos:<curso do Canvas>`). O painel acompanha a chave por `storage.onChanged` e mostra "N de M vídeos lidos". Grave **só** o que o embed precisa (id e título).

**Para a pessoa:** a lista só existe depois que a grade da coleção carregou. Um botão "Ler vídeos do Studio" pode abrir o Studio do curso, esperar a lista completa (`complete: true`) e voltar.

---

## 5. Ligar a coleção ao curso do Canvas (`lti_params`)

O `lti_params` da URL do frame é um **JWT** de lançamento LTI (validade de ~1 h) com dados sensíveis: e-mail e ids do usuário e a chave OAuth da ferramenta. Dele, leia **só** `lti_course_id`, em memória, logo no início (antes de a SPA trocar o endereço):

```js
function cursoDoStudio() {
  try {
    const parte = new URLSearchParams(location.search).get('lti_params')?.split('.')[1];
    if (!parte) return null;
    const b64 = parte.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((parte.length + 3) % 4);
    const id = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)))).lti_course_id;
    return id != null && /^\d+$/.test(String(id)) ? String(id) : null;
  } catch { return null; }
}
```

Não grave, não registre em log e não envie o JWT. O resto do payload não é lido.

---

## 6. O embed de um vídeo

O HTML que o editor grava ao inserir um vídeo do Studio, decodificado:

```
/courses/{CURSO}/external_tools/retrieve?display=borderless&url=<LAUNCH codificado>

LAUNCH = https://{DOMINIO_STUDIO}/lti/launch
           ?custom_arc_launch_type=bare_embed
           &custom_arc_media_id={lti_launch_id}
           &custom_arc_show_rolling_transcript=true
           &custom_arc_start_at=0
```

Não há token nem nada que expire: o Canvas assina o lançamento na hora em que a página abre. Por isso o embed é montado como texto, idêntico ao manual (conferido string a string):

```js
function studioEmbed({ courseId, studioDomain, mediaId, title = '', w = 700, h = 442 }) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const launch = `https://${studioDomain}/lti/launch?custom_arc_launch_type=bare_embed&custom_arc_media_id=${mediaId}` +
                 '&custom_arc_show_rolling_transcript=true&custom_arc_start_at=0';
  const src = `/courses/${courseId}/external_tools/retrieve?display=borderless&url=${encodeURIComponent(launch)}`;
  return `<iframe class="lti-embed" style="width: ${w}px; height: ${h}px; display: inline-block;" ` +
    `title="${esc(title)}" src="${esc(src)}" width="${w}" height="${h}" ` +
    'allowfullscreen="allowfullscreen" webkitallowfullscreen="webkitallowfullscreen" mozallowfullscreen="mozallowfullscreen" ' +
    'allow="geolocation *; microphone *; camera *; midi *; encrypted-media *; autoplay *; clipboard-write *; display-capture *; fullscreen *" ' +
    'data-studio-resizable="true" data-studio-tray-enabled="true" data-studio-convertible-to-link="true"></iframe>';
}
```

- `esc(src)` transforma os `&` em `&amp;`, como o Canvas guarda.
- O `title` é o nome do vídeo (leitor de tela).
- **A confirmar na sua instância:** se um `media_id` de fora da coleção do curso toca para o aluno, e se todo vídeo aceita `bare_embed` (vídeos com quiz podem usar outro tipo de lançamento). Teste uma página antes do lote.

---

## 7. Inserir vídeos nas páginas a partir de uma planilha

Fluxo usado na produção de pós-graduação (páginas já diagramadas, vídeos entrando depois):

- **Na página, cada vídeo tem um espaço:** um parágrafo só com texto entre colchetes (`<p style="text-align: center;"><strong>[videoaula]</strong></p>`) e, logo acima, um título (`h1`–`h6`) com texto genérico, só com parágrafos vazios no meio.
- **A planilha** (`.xlsx`, `.csv` ou linhas coladas do Excel/Google Sheets): `Página | Título acima do vídeo | Nome do vídeo no Studio`, uma linha por vídeo, na ordem da página. Página vazia = a da linha de cima (célula mesclada). Linha sem vídeo **continua na lista** com o problema marcado: pulá-la faria os vídeos de baixo subirem um espaço.
- **Casamento:** página por título igual (sem acento e pontuação) ou, se não houver igual, a **única** que contém o nome inteiro; vídeo por nome **igual** (sem extensão; sem "contém"). Ambíguo ou ausente → a página fica de fora, com os candidatos ou um "parecido:" na mensagem.
- **A página só é gravada se tudo bater:** se sobrar linha sem espaço, se um vídeo não estiver na coleção ou se uma linha tiver título e o espaço não tiver título acima, nada muda nela. Espaço sobrando só gera aviso.
- **Gravação por fatia:** o vídeo entra no lugar do texto entre colchetes, mantendo o `<p …>` e o alinhamento; o título troca só o texto e mantém negrito, fonte e cor. O resto da página fica byte a byte igual.
- Escolha dos módulos começa **desmarcada**; prévia, número do curso e releitura seguem o protocolo (`escrita-segura.md`).

---

## 8. Redimensionar vídeos

Pedido comum: todos os vídeos de uma página (ou dos módulos marcados) num tamanho padrão.

- **Reconheça vídeo pelo player no `src`** (YouTube, Vimeo, `instructuremedia.com`, `/media_attachments_iframe`, `/media_objects_iframe`, Panopto, Kaltura…) ou por `data-studio-resizable`/`data-media-type="video"`. `allowfullscreen` não serve: Genially, H5P e formulários também têm.
- **Pule o áudio do Canvas** (`data-media-type="audio"` ou `type=audio` no `src`), que usa o mesmo player da mídia.
- **Vídeo responsivo** (largura ou altura em `%`) fica como está.
- **Mude só as medidas:** atributos `width`/`height` e as declarações `width`/`height` do `style` (sem tocar em `max-width`, `min-width` ou `line-height`). Leia os atributos um a um, para não confundir `width` com `data-width` nem pegar texto de dentro do `title` ou do `src`.
- A prévia mostra o tamanho de antes (o do `style`, que é o que aparece): "Studio 620×398 → 700×442".

---

## 9. Transcrições e legendas

"Baixar histórico" no menu ⋮ do player é tradução de **"Download Transcript"**. Ao procurar no código ou na rede, busque `transcript` e `caption`, nunca `history`.

São duas chamadas:

```
1) GET https://<studio>/api/media_management/media/{media.id}/caption_files   ← exige os cabeçalhos da SPA
   → { caption_files: [ { id, url, srclang, label, status, … } ] }
2) GET https://<studio>{url devolvida em (1)}                                  ← funciona só com o cookie
   → { caption_file: { sequences: [ { text, start_time, end_time } ] } }
```

- **Use o campo `url`, nunca o `id`**, na segunda chamada (com o `id`, 404).
- O id do arquivo de legenda é `<uuid>-<media.id>`. **Parece um `lti_launch_id` e não é**: o uuid é outro e não pode ser derivado do vídeo. Só a chamada (1) o entrega.
- Apesar de `subtitle_format: "srt"`, a resposta é **JSON**. Para obter o texto que o player entrega: normalize os espaços de cada `text`, descarte repetições consecutivas, junte com espaço e quebre linha depois de `.`, `!` e `?` (conferido caractere a caractere com o arquivo do player).
- A chamada (1) roda no frame (depois que a grade carregou e os cabeçalhos foram capturados); sem isso, 401.

---

## 10. Dados sensíveis

Não leia, não registre e não grave:

- o `lti_params` (JWT) inteiro, exceto `lti_course_id` em memória;
- `data.media.author.email`;
- `data.pandata_tokens.*` e `data.media.pandata_tokens.*` (tokens de sessão);
- os cabeçalhos de autenticação da SPA, que vivem só na memória do frame.

Guarde o mínimo: id e título do vídeo, coleção e curso. Para listas que só servem durante o trabalho, prefira `chrome.storage.session` (memória, descartada ao fechar o Chrome).

---

## 11. Becos sem saída e diagnóstico

| Tentativa | Resultado |
|---|---|
| Chamar a API do Studio só com cookie | 401 sempre |
| Derivar o id da legenda do `lti_launch_id` | 404 (uuid diferente) |
| Usar o `id` numérico de `caption_files` no download | 404 |
| Procurar o id da legenda na `tiles` | não está lá (só `has_captions`) |
| Usar `/media_objects` do Canvas para vídeos do Studio | outro sistema |

**401 × 404 diz muito:** 401 é rota que existe e recusou o pedido sem autenticação; 404 é rota que não existe.

**Diagnóstico:** o painel e o frame do Studio são contextos separados, e os erros moram na fronteira. Um botão "Salvar diagnóstico (.txt)" que junta, numa linha do tempo só, as tentativas do painel e o que aconteceu dentro do frame (endereço, código, trecho do corpo, sem cabeçalhos nem tokens) resolveu a investigação das transcrições. Para log detalhado no frame, use uma chave de `localStorage` de depuração, desligada por padrão.

**Se parar de funcionar:** 401 → os cabeçalhos não foram capturados (carregue a grade da coleção); 404 na listagem → a rota mudou (aba Network do frame, filtrando por `media_management` ou `tiles`); 200 sem dados → o formato mudou (o diagnóstico traz um trecho do corpo).
