---
name: extensao-chrome-canvas
description: Guia profissional para criar, revisar e manter extensões do Chrome (Manifest V3) que trabalham dentro do Canvas LMS da Instructure, incluindo o Canvas Studio e o H5P.com, usando a sessão já logada do usuário (cookies + token CSRF), sem chave de API. Cobre arquitetura (painel lateral, service worker, content scripts MAIN/ISOLATED, executeScript), segurança, regras e armadilhas do Canvas (páginas, módulos, tarefas, arquivos, editor TinyMCE, LTI, Blueprint), controle do limite de requisições (rate limit) e o protocolo de escrita segura (prévia, confirmação pelo número do curso da aba aberta, releitura e conferência depois de gravar). Use sempre que o pedido envolver extensão de navegador, userscript ou automação para o Canvas; chamadas à API do Canvas pela sessão; edição em lote de páginas, módulos ou arquivos de disciplinas; botões injetados no Canvas ou no editor; vídeos do Studio; quizzes H5P; ou revisão de código desse tipo — mesmo que a pessoa não fale em "skill", "MV3" ou "rate limit".
metadata:
  author: Raylan B. Fraga
  version: "1.0"
---

# Extensões do Chrome para o Canvas LMS

Guia para projetar, escrever, revisar e manter extensões do Chrome (Manifest V3) que trabalham **dentro** do Canvas LMS (páginas, módulos, tarefas, arquivos, o editor de conteúdo, o Canvas Studio e o H5P.com) usando a sessão de quem está logado.

O conteúdo vem de projetos reais: o Service Timer, caixa de ferramentas de uma equipe de produção de disciplinas, e as extensões irmãs Copiar Tarefas e Setor de Vídeo. O que está aqui foi visto funcionando, ou quebrando, num Canvas de produção com alunos ativos.

> **Por que tanto cuidado.** A extensão age com os poderes de quem está logado. Num curso com 300 alunos, um laço errado estraga 40 páginas em segundos, publica um módulo antes da hora ou faz o Canvas recusar os pedidos da equipe toda. Quase todas as regras desta skill existem para que um erro de código, um clique sem querer ou uma aba trocada **não cheguem ao curso**.

## Princípios

1. **A sessão do usuário, nunca uma chave.** A extensão chama as mesmas rotas `/api/v1/...` que a interface do Canvas usa, com os cookies de quem está logado e o token CSRF da página. Não usa token de API, OAuth, chave de desenvolvedor nem segredo guardado. Pode exatamente o que a pessoa pode, nem mais, nem menos.
2. **Ler é livre; gravar passa pelo protocolo.** Toda escrita no Canvas segue o [protocolo de escrita segura](#protocolo-de-escrita-segura): prévia, confirmação pelo número do curso da aba, releitura, gravação mínima e conferência.
3. **Um pedido por vez, olhando o limite.** O Canvas cobra cada pedido de um "balde" do usuário. Pedidos em paralelo esvaziam o balde e travam a pessoa (e quem divide a conta com ela). Toda chamada passa pelo mesmo `request()`, que controla o ritmo.
4. **Mexer só no que foi pedido.** O resto do HTML da página fica byte a byte igual. Os templates institucionais dependem de ids, classes e estilos que uma reserialização estraga.
5. **Investigar antes de automatizar.** Seletor, endpoint ou campo de formulário só entram no código depois de vistos na tela real. Inventados, passam na simulação e falham no Canvas.
6. **Dizer a verdade a quem usa.** Toda ação termina dizendo o que foi feito, o que ficou de fora e por quê. Quando nada mudou, a mensagem diz "nada foi alterado".

## Mapa das referências

Leia só o que a tarefa pede:

| Arquivo | Quando ler |
|---|---|
| `references/arquitetura-mv3.md` | Desenhar a extensão: painel lateral, service worker, content scripts (MAIN × ISOLATED), `executeScript`, pontes, offscreen, manifest |
| `references/sessao-csrf-api.md` | Qualquer chamada à API do Canvas: sessão, CSRF, paginação, erros, upload de arquivos, endpoints |
| `references/rate-limit.md` | Laços, lotes, vários cursos, leituras grandes, e sempre que o Canvas responder 403/429 |
| `references/escrita-segura.md` | Qualquer funcionalidade que grava no Canvas (ou em outro sistema) |
| `references/regras-do-canvas.md` | Páginas, módulos, tarefas, arquivos, importação, Blueprint, equações, LTI, templates |
| `references/editor-rce.md` | Botões e ações dentro do editor de páginas (TinyMCE, editor HTML) |
| `references/studio.md` | Vídeos do Canvas Studio: ler a coleção, montar o embed, inserir nas páginas |
| `references/h5p.md` | Quizzes do H5P.com: buscar, criar, gerar `.h5p`, inserir nas páginas |
| `references/seguranca.md` | Desenho e revisão de segurança: segredos, mensagens, permissões, dados de alunos (LGPD) |
| `references/testes-e-processo.md` | Investigação, plano, simulação com Canvas falso, teste real e entrega |

Modelos prontos (testados) em `assets/`:

- `assets/canvas-api.js`: `canvasMain(op, p)`, a função injetada na aba com sessão, CSRF, ritmo, paginação e a porta única de escrita `write()`. Também traz `abaDoCurso()` e `execCanvas()`, que rodam no painel.
- `assets/confirmar-curso.js`: `confirmarCurso({...})`, a janela que pede o número do curso, para o painel lateral ou para a página.

Comece por eles em vez de reescrever, porque já trazem as travas descritas aqui. Os testes deles ficam em `scripts/` (ver `scripts/LEIA-ME.md`). Se mexer num modelo, rode o teste de novo.

## Como conduzir uma funcionalidade nova

1. **Classifique o risco** antes de escrever código:

   | Nível | O que faz | Travas mínimas |
   |---|---|---|
   | 0 · Leitura | Só GET (diagnóstico, relatório, checklist) | ritmo + paginação completa |
   | 1 · Editor | Muda o conteúdo **no editor aberto**, sem salvar | um passo de Ctrl+Z; quem usa confere e salva |
   | 2 · Gravação | PUT/POST na API (página, módulo, arquivo) | protocolo de escrita segura completo |
   | 3 · Em escala | Grava em muitas páginas ou em vários cursos | nível 2 + seleção explícita, teste num item só, relatório por item |
   | 4 · Fora do Canvas | Cria ou altera em outro sistema (H5P.com, Studio, planilhas) | nível 2 + destino de teste separado do de produção |

   Na dúvida, suba de nível. Prefira a forma de menor nível que resolva: se a pessoa pode conferir no editor e salvar, não grave pela API.

2. **Investigue** o que vai ser tocado (tela, HTML, pedidos de rede) e anote. Ver `references/testes-e-processo.md`.
3. **Escreva um plano curto** (`PLANO-<nome>.md`) com objetivo, o que já se sabe, decisões, fases e "Andamento". Ele é a memória entre uma sessão de trabalho e outra.
4. **Implemente a partir dos modelos** de `assets/`, no estilo do projeto (em geral JS puro, sem build).
5. **Teste em simulação** (Canvas falso), depois num curso de teste, depois em **um item só** do curso real.
6. **Entregue** dizendo o que mudou, como foi testado (simulação ou Canvas real) e o que ainda depende de quem pediu.

## Arquitetura recomendada

```
 Painel lateral (side panel)                       Aba do Canvas (mesma origem)
 ┌────────────────────────┐  executeScript(func,  ┌────────────────────────────────┐
 │ UI, prévia, confirmação│ ───── args) ────────▶ │ canvasMain(op, p)              │
 │ chrome.storage         │ ◀──── resultado ───── │  fetch /api/v1 + cookies + CSRF│
 └────────────────────────┘      (JSON)           └────────────────────────────────┘
          │ runtime.sendMessage                       ▲ content scripts na página:
          ▼                                           │ ISOLATED (chrome.*) ⇄ MAIN (tinymce)
 Service worker ── fetch com host_permissions ──▶ H5P.com / outros sites (sessão deles)
          └── documento offscreen (DOMParser, área de transferência)
```

- **As chamadas ao Canvas rodam na aba do Canvas**, por `chrome.scripting.executeScript`. O pedido sai da mesma origem e leva os cookies sozinho. O CSRF vem de `document.cookie`, e o Canvas vê o mesmo que veria da própria interface. Não é preciso a permissão `cookies`.
- **A função injetada é serializada**: não enxerga variáveis nem funções de fora. Tudo entra por `args` e tudo sai como JSON. Exceções não atravessam, então devolva `{ __error }`. `File`/`Blob` também não passam: o binário de um upload sobe do painel.
- **Use o mundo MAIN só quando precisar do JavaScript da página** (`tinymce`, CodeMirror, interceptar `fetch`). Lá não existe `chrome.*`. A ponte com o mundo ISOLATED é `window.postMessage` com uma marca própria e `e.source === window`. O que chega por ela é entrada não confiável.
- **Sistemas externos (H5P.com) vão pelo service worker**, com `host_permissions`: sem CORS, com a sessão daquele site e sem abrir abas.

Detalhes, armadilhas e um manifest de referência em `references/arquitetura-mv3.md`.

## Sessão e CSRF

```js
const raw  = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('_csrf_token='));
const csrf = decodeURIComponent(raw ? raw.slice(12) : document.querySelector('meta[name="csrf-token"]')?.content || '');
await fetch(`/api/v1/courses/${curso}/pages/${encodeURIComponent(url)}`, {
  method: 'PUT', credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
  body: JSON.stringify({ wiki_page: { body } }),
});
```

- Leitura (GET) não precisa de CSRF; escrita sempre precisa. Sem ele o Canvas recusa (em geral com 422, "Can't verify CSRF token authenticity").
- A resposta pode vir com o prefixo `while(1);`. Tire-o antes do `JSON.parse`.
- Listagens são paginadas pelo cabeçalho `Link` (`rel="next"`). Use `per_page=100` e siga até o fim, ou pare com erro. Nunca decida com uma lista cortada.
- IDs ficam sempre como texto: os do H5P.com têm 19 dígitos e perdem precisão como número.

Mais em `references/sessao-csrf-api.md`.

## Limite de requisições (política obrigatória)

O Canvas controla o uso com um balde por usuário. Cada pedido custa unidades, e o balde se recompõe devagar. Quem esvazia o balde recebe **403 "Rate Limit Exceeded"** (às vezes 429) até ele encher de novo. Pedidos em paralelo custam mais, porque cada um em andamento paga um adiantamento. Por isso:

| Situação | O que fazer |
|---|---|
| Sempre | um pedido por vez (`await` em sequência; nunca `Promise.all` sobre uma lista de itens) |
| `X-Rate-Limit-Remaining` ≥ 300 | segue |
| 150 a 300 | pausa de 0,6 s |
| 50 a 150 | pausa de 2 s |
| menos de 50 | pausa de 5 s |
| Entre uma escrita e outra | pausa mínima de 0,4 s, mesmo com o balde cheio |
| 403 "Rate Limit Exceeded" ou 429 | esperar 2, 4, 8 e 16 s (ou o `Retry-After`) e repetir; depois disso, parar e relatar o que foi e o que não foi feito |
| Erro de rede numa escrita | não repetir às cegas: reler e conferir se entrou |

Leia uma vez e reaproveite (os módulos de um curso, por exemplo, são lidos uma vez por execução). Mostre o progresso ("Gravando 3 de 12… mantenha o painel aberto"). Razões e números em `references/rate-limit.md`; implementação em `assets/canvas-api.js`.

## Protocolo de escrita segura

Pedido típico da equipe: "mudar o item X só se a pessoa digitar o número da disciplina e ele bater com o da aba aberta". Esse é um dos passos. O protocolo completo para os níveis 2 a 4:

1. **Prévia sem gravar nada.** Leia tudo e mostre, item por item, o que vai mudar, o que já está certo e o que fica de fora (com o motivo). Escreva "Nada foi gravado ainda."
2. **Escolha explícita.** Quem usa marca o que entra (módulos, páginas, cursos). Em operações de alto risco a lista começa desmarcada. Sempre deve dar para testar num item só.
3. **Confirmação pelo número do curso.** A pessoa digita o número do curso. A gravação só acontece se ele for igual (a) ao curso da aba ativa **naquele momento** e (b) ao curso em que a prévia foi feita. Se não bater, aparece um aviso claro e nada é gravado. Use janela própria (`assets/confirmar-curso.js`): o `confirm()` nativo não aparece direito no painel lateral e é aceito sem ler.
4. **Trava contra clique duplo**, ligada logo depois da confirmação, antes do primeiro `await`.
5. **Prévia vencida não grava.** Se a seleção, as configurações ou a aba mudaram depois da prévia, ela é descartada (contador de geração) e a pessoa refaz.
6. **Releitura na hora de gravar.** Cada item é lido de novo logo antes do PUT, e a mudança é recalculada sobre o conteúdo atual. Se o que se esperava não está mais lá, o item fica de fora.
7. **Aviso de edição recente.** Página editada há menos de 30 minutos (`updated_at`, `last_edited_by`) ganha um aviso: se alguém estiver com ela aberta no editor e salvar depois, a mudança some.
8. **Gravação mínima.** Só o campo necessário (`wiki_page[body]`, sem título nem publicação) e, dentro do HTML, só o trecho alvo, por fatia de texto, sem reserializar o documento.
9. **Conferência depois de gravar.** Compare o que o Canvas devolveu (ou uma nova leitura) com o esperado. O Canvas sanitiza o HTML e pode descartar parte do que foi enviado.
10. **Idempotência.** Repetir a operação não pode duplicar nada. Confira se já existe antes de criar; "já estava assim" é um resultado válido.
11. **Porta única de escrita.** Toda escrita passa por um `write()` que recusa curso não confirmado, curso somente leitura (a origem de uma cópia), aba que saiu do curso e `DELETE` não autorizado.
12. **Relatório por item:** ✅ gravado · — já estava · ⚠ gravado com ressalva · ✗ não gravado (motivo).

Não faça sem pedido explícito: apagar; publicar ou despublicar; mexer em notas, matrículas, datas ou configurações do curso; importar conteúdo (content migration) em curso com alunos; PUT em módulo existente; criar requisito de conclusão em módulo existente. Os motivos estão em `references/regras-do-canvas.md`; o protocolo comentado, com código, em `references/escrita-segura.md`.

No **nível 1** (editor), o botão não salva a página: mexe no editor num passo só de Ctrl+Z e, quando vai substituir algo, pergunta antes com o foco no "Não".

## Regras do Canvas que mais causam erro

- `PUT /modules/:id` com `published: true` publica **todos os itens** do módulo. Módulo criado por POST nasce despublicado.
- Requisito de conclusão novo num módulo existente muda o progresso de quem já tinha concluído.
- Importação (content migration / course copy) casa itens por `migration_id` e por nome e **sobrescreve**: pesos de grupos de tarefas, cópias anteriores. Para copiar um item, crie-o campo a campo.
- `?include[]=items` não traz os itens de módulos grandes: busque `/modules/:id/items`.
- O Canvas sanitiza o HTML ao salvar. Confira o que voltou.
- Templates repetem ids: use `querySelectorAll('[id="x"]')`, nunca `getElementById`.
- O texto é gravado com entidades (`&ccedil;`, `&nbsp;`, `&#39;`): uma busca precisa casar as duas formas.
- Embeds LTI (Studio, H5P) são `iframe.lti-embed` apontando para `/courses/:id/external_tools/retrieve?display=borderless&url=…`, sem token. O Canvas assina na hora em que a página abre, então o HTML pode ser montado como texto.
- Curso associado a um Blueprint: itens bloqueados recusam edição, e editar um item desbloqueado faz ele deixar de receber as atualizações do Blueprint. Conteúdo que vem do Blueprint se muda no Blueprint.
- `post_to_sis` vai num PUT separado, depois de criar a tarefa.
- Upload de arquivo tem 3 etapas. `on_duplicate: 'overwrite'` com o mesmo nome faz o Canvas redirecionar o arquivo antigo para o novo, e as páginas passam a mostrar o novo sem edição.

Lista completa em `references/regras-do-canvas.md`.

## Canvas Studio e H5P em resumo

**Studio:** é uma SPA num iframe de `*.instructuremedia.com` que se autentica por cabeçalho. A lista de vídeos da coleção vem do endpoint `tiles` (20 por página): capture a chamada da própria SPA e repita para as outras páginas com os **mesmos cabeçalhos** (sem eles, 401). O `media_id` do embed é `data.media.lti_launch_id`. O `lti_params` da URL é um JWT com dados sensíveis: leia só `lti_course_id`, em memória. A API pública do Studio exige chave de administrador, e `/media_objects` é outro sistema. Detalhes em `references/studio.md`.

**H5P:** o H5P.com é do H5P Group (não da Instructure) e entra no Canvas por LTI. Não há API: use os formulários da própria tela (Laravel, `_token`; 419 = sessão vencida), pelo service worker, um passo por vez, conferindo na lista depois de criar. No popup do editor, a seção vem do parâmetro `content_scope` (mine/shared/all). Um `.h5p` mínimo (`h5p.json` + `content/content.json`) é aceito no upload. Onde não se pode apagar (pasta da equipe), confira antes de enviar e mantenha um destino de teste separado. Detalhes em `references/h5p.md`.

## Segurança: o essencial

- Nenhum segredo guardado. Tokens, JWTs e e-mails que aparecem nas respostas não são lidos, registrados em log nem gravados.
- Em `runtime.onMessage`, confira `sender.id === chrome.runtime.id` e a origem da aba. Mensagem vinda da página (`postMessage`) é entrada não confiável e nunca dispara escrita sem a confirmação da própria extensão.
- Texto do usuário entra como texto (`textContent`, ou escape de `& < > "`), nunca como marcação.
- Numa versão distribuída, `host_permissions` só para os domínios do Canvas, do Studio e do H5P da instituição. `<all_urls>` só em ferramenta interna, por decisão consciente.
- Dados de alunos (notas, nomes, e-mails) não saem da máquina sem necessidade e sem aprovação (LGPD). Serviços externos e de IA dependem de aprovação institucional.
- Não desligue proteções dos sites (CSP, X-Frame-Options) nem falsifique cabeçalhos. Seja honesto: o pedido do service worker sai com `Origin: chrome-extension://…`.
- Automação só no clique, em ritmo humano, sem abrir abas ou janelas que a pessoa não pediu.

Modelo de ameaça e checklist em `references/seguranca.md`.

## Checklist de revisão

Use ao entregar uma funcionalidade ou ao revisar código de outra pessoa:

- [ ] Toda chamada ao Canvas passa por um `request()` com ritmo, tratamento de 403/429 e paginação completa.
- [ ] Nenhum `Promise.all` ou laço paralelo sobre itens do Canvas.
- [ ] Escritas só por `write()`; DELETE e publicação só quando pedidos.
- [ ] Prévia antes de gravar; confirmação pelo número do curso batendo com a aba e com a prévia.
- [ ] Releitura antes de cada gravação; conferência depois.
- [ ] HTML alterado por fatia; o resto byte a byte igual, e um teste prova isso.
- [ ] Operações idempotentes: executar de novo não duplica.
- [ ] A mensagem final diz o que foi feito e o que não foi; "nada foi alterado" quando for o caso.
- [ ] Nenhum token, JWT, e-mail ou dado de aluno em log, storage ou mensagem.
- [ ] Mensagens entre as partes validadas; texto do usuário escapado.
- [ ] Seletores e endpoints vieram de investigação real, não de suposição.
- [ ] Funções injetadas autocontidas (sem closures), com resultado em JSON.
- [ ] Recurso arriscado nasce com a chave desligada nas configurações.
- [ ] Testado em simulação e num curso de teste, e a entrega diz como foi testado.

## Como falar com quem usa

Quem usa é a equipe de produção, não programadores. As mensagens são curtas, em português, e dizem o que aconteceu e qual é o próximo passo. Exemplo: "O número digitado (282083) não é o do curso da aba aberta. Confira a aba e o número — nada foi alterado." Avise antes de tudo o que não tem volta. Em operações longas, mostre o progresso e peça para manter o painel aberto.

---

## Créditos

Skill elaborada por **Raylan B. Fraga**, a partir do desenvolvimento do Service Timer e das extensões irmãs para o Canvas LMS, com o Canvas, o Canvas Studio e o H5P.com em uso real.
