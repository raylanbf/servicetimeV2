# H5P.com

## Sumário
1. O que é e como entra no Canvas
2. Sem API: a sessão e os formulários da própria tela
3. Ler listas (pastas e conteúdos)
4. Criar pasta: teste × produção
5. Criar quiz pelo formulário de criação
6. O arquivo `.h5p`
7. O iframe do quiz na página do Canvas
8. A caixa do quiz e a largura 100%
9. Inserir pelo editor: o popup "Interactive Content – H5P"
10. Inserir pela API, em lote
11. Ritmo, erros e conferência

---

## 1. O que é e como entra no Canvas

- O **H5P.com é do H5P Group**, não da Instructure. A instituição tem um endereço próprio (`https://<instituicao>.h5p.com`) e o liga ao Canvas por **LTI**, como o app "Interactive Content – H5P" do editor.
- Cada quiz é um conteúdo com id de **19 dígitos** (ex.: `1292991947646133608`). **Guarde sempre como texto**: como número, perde os últimos dígitos.
- A conta de autor é limitada pelo plano da instituição. "There are no accounts left in your H5P.com plan" é bloqueio de acesso, não de código.
- Nas disciplinas, cada página de tópico tem um quiz de fixação **não pontuado** com o **mesmo nome da página**. Esse nome é a chave que liga página e quiz.

---

## 2. Sem API: a sessão e os formulários da própria tela

O H5P.com não tem API pública para isso. O que funcionou, e é o padrão a seguir:

- **Pedidos pelo service worker**, com `host_permissions` para `https://<instituicao>.h5p.com/*`: sem CORS, com os cookies da sessão já aberta naquele Chrome e **sem abrir aba ou janela**. A pessoa não vê nada piscando; vê o progresso no painel.
- **Os mesmos formulários que a tela envia** (aplicação Laravel): o token vem da `<meta name="csrf-token">` ou do `<input name="_token">` da página lida antes. Os campos padrão de um formulário são lidos no **documento offscreen** (`DOMParser` + `new FormData(form)`), para o envio ir com os mesmos valores que a tela mandaria (`arquitetura-mv3.md` §6).
- **Sessão vencida ou ausente:** a resposta redireciona para `login.h5p.com` (ou `/login`), ou a página volta sem token. Pare com "Não há sessão aberta no H5P.com neste Chrome. Entre no H5P.com e tente de novo", com o link.
- **419** = token vencido (Laravel). Pare: "A sessão do H5P.com expirou. Recarregue o H5P.com e tente de novo."
- **Só no clique, um passo por vez, com pausa** (1,5 s entre criações). Nada de polling.
- **Honestidade:** o pedido sai com `Origin: chrome-extension://…`. Não falsifique cabeçalhos nem desligue proteções do site (X-Frame-Options, CSP) para "parecer" a tela.

Como os pedidos foram descobertos: gravando a tela real com uma ferramenta de captura de rede (`testes-e-processo.md` §2), não por suposição.

---

## 3. Ler listas (pastas e conteúdos)

- **Raiz do "My Content":** `GET /content`. **Dentro de uma pasta:** `GET /content/<id da pasta>`. Páginas seguintes: `?page=N` (50 itens por página; o maior `page=` dos links da paginação diz quantas são; ponha um teto).
- Cada item é uma linha `<tr class="browser-row fable-row [folder]">` com:
  - o checkbox `value="<id>" data-parent="<pasta-mãe; vazio na raiz>"`;
  - o link `<a href=".../content/<id>" class="fable-title …">nome</a>` (o nome pode vir cortado; no popup, o nome completo está no `aria-label` do `input.fable-toggle-row`).
- Fique só com os itens cujo `data-parent` é a pasta lida (a página pode mostrar outros) e deduplique por id.
- Decodifique entidades do nome e compare com a normalização do projeto (sem diferença de maiúsculas, espaços e tipo de traço).

---

## 4. Criar pasta: teste × produção

**Destino de teste separado do de produção**, numa chave das configurações, com o **teste como padrão**:

| Destino | Onde | Pode apagar? |
|---|---|---|
| Teste (padrão) | raiz do "My Content", pasta privada | sim, a própria pessoa |
| Produção | pasta da equipe (ex.: "PRODUÇÕES › UDA") | **não** |

**Pasta no My Content:** `POST /content` (multipart) com `_token`, `title`, `parent` (vazio = raiz) e `type=1` (pasta privada).

**Na pasta da equipe, nada é enviado sem conferir três coisas:**

1. a página aberta é mesmo a pasta da equipe (pelo `<title>` da página, sem o sufixo " - H5P.com");
2. a lista dela foi lida (não está vazia);
3. o formulário que o botão **"New Folder"** daquela tela abre (`data-target` do botão → `<form>` do modal) aponta para o próprio H5P.com, em `/content` ou `/organization-folders`, e o campo `parent` dele é a pasta da equipe.

O formulário vai **como a tela o tem**, só com o nome preenchido. Se algo não bater: "Não sei criar pasta na pasta da equipe: <motivo>. Nada foi criado."

**Idempotência e nomes parecidos:**

- Nome igual (normalizado) a uma pasta que já existe → usa a existente ("já existia").
- Mesmo nome com outro prefixo ("UDA - Cálculo" × "Cálculo", "MF - …") → segure o "Criar" até a pessoa escolher "Usar esta" ou "Criar outra mesmo assim". **Não ponha nem tire prefixo sozinho**: os prefixos variam por tipo de disciplina.
- Depois de criar, leia a lista de novo: a pasta nova é a que tem esse nome **e não existia antes**. Se não aparecer: "o H5P.com recebeu o pedido, mas a pasta não apareceu na lista — confira antes de tentar de novo".

---

## 5. Criar quiz pelo formulário de criação

1. Confira se já existe um conteúdo (não pasta) com o mesmo nome na pasta. Se existir, **não mude** ("já existia").
2. Leia `GET /content/create?parent=<pasta>` e extraia os campos do `#laravel-h5p-form` no offscreen.
3. Preencha o que o editor do H5P põe ao salvar:
   - `title` = título da página do tópico, exatamente;
   - `library` = `H5P.MultiChoice 1.16` (a versão instalada na instituição; confira);
   - `parameters` = `JSON.stringify({ params, metadata: { title, license: 'U', defaultLanguage: 'pt-br' } })`;
   - `parent` = id da pasta; `timezone_offset`; e, por último, `submitter=Save` (o editor põe esse campo oculto com o botão clicado).
4. **Tire `frame`** ("Toolbar Below Content"): ele vem marcado e a equipe sempre desmarca; checkbox desmarcado não vai no envio.
5. `POST /content`. Sucesso = redirecionamento para `/content/<id novo>`. Se a resposta voltar ao formulário, leia as mensagens (`.help-block`, `.alert-danger`) e diga: `O H5P.com não aceitou o quiz "<nome>": <motivo>`.

**Questão provisória:** sem arquivo, o quiz nasce com "Pergunta" e "Alternativa A–D" (nenhuma correta), textos da interface em pt-BR, "Tentar novamente" e "Verificar" ligados, "Mostrar solução" e pontuação (`showScorePoints`) desligados (fixação, sem nota) e alternativas embaralhadas, igual a um quiz criado à mão. A equipe troca o texto no editor do H5P.com.

---

## 6. O arquivo `.h5p`

O `.h5p` é um ZIP. O mínimo aceito pelo "Add Content › Upload" do H5P.com (validado):

```
h5p.json                 { title, language: "pt-br", defaultLanguage: "pt-br", mainLibrary: "H5P.MultiChoice",
                           embedTypes: ["iframe"], license: "U", preloadedDependencies: [
                             { machineName: "H5P.MultiChoice", majorVersion: 1, minorVersion: 16 },
                             { machineName: "FontAwesome", majorVersion: 4, minorVersion: 5 },
                             { machineName: "H5P.JoubelUI", majorVersion: 1, minorVersion: 3 },
                             { machineName: "H5P.Question", majorVersion: 1, minorVersion: 5 } ] }
content/content.json     os params da questão (question, answers[], behaviour, UI…)
```

Sem as pastas das bibliotecas: o H5P.com já as tem. Confira as versões das dependências num `.h5p` exportado da sua instância.

**Ler `.h5p` de questões para criar os quizzes** (arquivos gerados a partir do Word da disciplina):

- aceite um `.h5p` por questão, um `.zip` com vários ou um **Question Set** (cada questão com título "Tópico N");
- leia o ZIP no navegador pelo diretório central e descompacte com `DecompressionStream('deflate-raw')`; limite de tamanho (ex.: 10 MB);
- **só entra Múltipla escolha na versão da instituição e sem mídia** (qualquer arquivo em `content/` além do `content.json` = imagem, áudio ou vídeo, que o formulário não leva → "suba este pelo H5P.com");
- valide: enunciado, pelo menos 2 alternativas, todas com texto, pelo menos uma correta;
- ligue cada questão à página "Tópico N" pelo número (do título ou do nome do arquivo). Duas questões para o mesmo tópico, tópico sem página ou duas páginas com o mesmo número → fica de fora, com o motivo;
- o conteúdo vai pelo **mesmo formulário de criação** do §5 (`params` do arquivo), com as configurações que vieram nele.

**Limites do tipo:** o Multiple Choice **não aceita tabela** no enunciado (a lista de tags é regra do tipo, aplicada ao salvar). Para tabela, o caminho oficial é um H5P.Column com H5P.Table + MultiChoice (não testado).

---

## 7. O iframe do quiz na página do Canvas

O que o Canvas grava ao inserir um quiz pelo editor:

```html
<iframe class="lti-embed" style="width: 100%; height: 600px;" title="<nome do quiz>"
  src="https://<canvas>/courses/<curso>/external_tools/retrieve?display=borderless&amp;url=https%3A%2F%2F<instituicao>.h5p.com%2Fcontent%2F<ID>"
  width="100%" height="600" loading="lazy" allowfullscreen="allowfullscreen"
  webkitallowfullscreen="webkitallowfullscreen" mozallowfullscreen="mozallowfullscreen"
  allow="geolocation *; microphone *; camera *; midi *; encrypted-media *; autoplay *; clipboard-write *; display-capture *"></iframe>
```

- **Sem `resource_link_lookup_uuid`**: só o id do conteúdo. Montado como texto e gravado pela API, o quiz abre para o aluno (conferido em "Ver como aluno").
- O `title` vem vazio do Canvas; preencha com o nome do quiz (acessibilidade).
- Id do conteúdo a partir de um `src`: decodifique e procure `h5p.com/(lti/<ctx>/)?content/(\d+)`.

---

## 8. A caixa do quiz e a largura 100%

O lugar do quiz é **a caixa logo abaixo da faixa "Atividade de Fixação Não Pontuada"** (regra de localização em `regras-do-canvas.md` §3). A mesma regra serve ao botão do editor, à inserção em lote e ao "Redimensionar H5P".

- **Sem faixa, ou com duas, nada muda.** Não insira em lugar arbitrário.
- **A caixa só pode ter:** H5P, o marcador `[iframe - Atividade de Fixação H5P]` e parágrafos vazios. Qualquer outra coisa (texto, imagem, tabela, link, vídeo) → a página fica de fora: "A caixa abaixo da faixa tem outro conteúdo além do H5P — confira à mão."
- **O H5P antigo da caixa sai e o novo entra** no primeiro parágrafo vazio da caixa (ou num `<p style="text-align: center;">` novo). Mesmo id já na caixa → "já estava".
- **Os outros H5P da página não mudam.** O corpo do tópico pode ter H5P de imagem ou carrossel acima da faixa: só o quiz da caixa vai para 100%, e só os atributos `width` e `style` dele mudam (altura intacta).
- **Localização no texto bruto:** as tags `<iframe>` do texto são casadas, na ordem, com os iframes do `DOMParser`, conferindo o `src`; a caixa é a k-ésima `<div>` do texto (conferindo `id`, `class` e `style`) até o `</div>` que a fecha. Se a conta não bater, nada muda.

---

## 9. Inserir pelo editor: o popup "Interactive Content – H5P"

Um clique num botão da barra do editor (nível 1, não salva a página):

1. **Valida antes de perguntar:** editor visual aberto, título da página lido, faixa e caixa achadas, caixa só com H5P.
2. **Confirma:** "🧩 Quer importar o H5P para a página?", com o nome e o aviso de substituição; foco no "Não".
3. **Põe o cursor** no parágrafo da caixa e guarda o conjunto dos H5P que já estão na página.
4. **Deixa o pedido no `chrome.storage.local`** (`{ id, title, ts }`), pela ponte ISOLATED. O popup é de outro domínio e **recarrega a cada busca**: o estado não pode ficar na memória do frame.
5. **Abre o app** pelo menu de apps do editor (`editor-rce.md` §8).
6. **No popup**, um content script em `https://<instituicao>.h5p.com/lti/*` com `all_frames: true`:
   - só age no frame do popup, filho direto da página (`window.parent === window.top`); os quizzes já inseridos na página também são frames do h5p.com, mas ficam dentro do editor e **não podem reagir**;
   - só age se houver pedido recente (menos de 2 minutos);
   - **busca pelo endereço, não pelo formulário:** `?search=<texto>&content_scope=mine`. O formulário da tela leva um `content_scope` escondido que volta sempre para "All Content". O resultado só vale se a URL confirmar `content_scope=mine` e o texto buscado; até 2 tentativas;
   - busca só o texto depois do traço do título ("Tópico 5 – Razões…" → "Razões…"), porque a busca do H5P diferencia hífen de travessão, e compara o **título completo** de cada linha com o da página, normalizados;
   - **exatamente 1** idêntico → clica no "Insert" da linha. **0 ou 2+** → não clica: destaca os candidatos, devolve "nenhum quiz seu com o nome …" ou "N quizzes seus com o nome …" e deixa o popup aberto para a pessoa escolher;
   - apaga o pedido em qualquer caso (reabrir o H5P à mão não dispara outra busca).
7. **Quando o quiz entra no editor** (um H5P que não estava no conjunto), num passo só de Ctrl+Z: move-o para a caixa se caiu fora, tira o antigo, põe `title` e largura 100%, `setDirty(true)`. Popup fechado sem inserir → "nada foi alterado".

**Seções do popup:** "My Content" = `content_scope=mine`, "Shared with me" = `shared`, "All Content" = `all`. Busque só em "My Content", a não ser que a equipe decida outra coisa (em "All Content" aparecem quizzes de outras pessoas com o mesmo nome).

---

## 10. Inserir pela API, em lote

Para inserir os quizzes de uma disciplina inteira de uma vez (nível 3):

- **Prévia por página**, com caixas de marcar (todas desmarcáveis; dá para testar numa página só): "insere", "substitui o H5P <id antigo>", "já estava" ou "fica de fora: <motivo>".
- **Confirmação pelo número do curso**, releitura de cada página, troca por fatia e conferência: depois de gravar, a regra roda de novo sobre o corpo devolvido e o quiz tem de estar na caixa com o id certo.
- **O resto da página fica byte a byte igual**, inclusive os outros H5P. Essa é a maior preocupação de quem usa; um teste deve provar isso.

---

## 11. Ritmo, erros e conferência

| Situação | O que fazer |
|---|---|
| Sem sessão no H5P.com | parar; "Entre no H5P.com neste Chrome e tente de novo", com o link |
| 419 | parar; "A sessão do H5P.com expirou. Recarregue o H5P.com e tente de novo." |
| Formulário não encontrado (`_token` ausente) | parar; "a tela do H5P.com pode ter mudado" |
| Erro HTTP numa criação | parar o lote; relatório do que foi e do que não foi feito |
| Criou, mas não aparece na lista | não repetir; "confira antes de tentar de novo" |
| Entre criações | 1,5 s |

Toda a lógica de leitura e criação recebe o `fetch` como parâmetro (`list(fetchFn, …)`, `createQuiz(fetchFn, parseForm, …)`), o que permite testá-la contra uma tela falsa montada a partir do HTML gravado da tela real, sem enviar nada (`testes-e-processo.md` §4).
