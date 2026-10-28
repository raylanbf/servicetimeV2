# Plano — Inserir o quiz H5P do tópico automaticamente

> **Status:** Fase 2 concluída em 27/10/2026: o botão funciona no Canvas real. A Fase 3 (em lote) é opcional e só entra se o usuário quiser.
> **Para retomar:** no Claude Code, digite `/h5p-quiz` (ou diga "vamos implementar o plano do H5P").

## Andamento

- [x] Redimensionar H5P (largura 100%) — menu de contexto, `h5pResizeMain` em `background.js` (out/2026)
- [x] Pré-requisitos — conta de autor ok; curso de teste "Ambiente teste - Raylan" (282082) com o Tópico 5; quiz de teste criado (27/10/2026)
- [x] Fase 1 — investigação da tela do H5P.com, pelo botão provisório "🔬 Diagnóstico H5P" (27/10/2026). Ver seção 2.1. O teste 4.6 (iframe montado à mão) fica para a Fase 3.
- [x] Fase 2 — botão página por página (redesenhada em 27/10/2026, ver seção 5). Implementada em 27/10/2026 (`canvas-h5p.js`, `canvas-h5p-bridge.js`, `h5p-search.js`, `h5p-width.js`), aprovada na simulação (`test-quiz.js`, `test-h5p.js`) e **no Canvas real** (curso 282082, Tópico 5). Ajuste do teste real: a busca vai pelo endereço com `content_scope=mine` (seção 2.1). Diagnóstico provisório removido.
- [ ] Fase 3 — em lote (opcional)

---

## 1. Objetivo

Um botão 🧩 na barra do editor do Canvas, ao lado do "Justificar texto": com a página de um tópico aberta em edição, **um clique**:

1. lê o título da página (campo "Título da página", ex.: "Tópico 5 – Razões, proporções e percentuais em cenários financeiros elementares");
2. acha a caixa logo abaixo da faixa azul "Atividade de Fixação Não Pontuada - Ao concluir este tópico, responda à questão:";
3. abre o "Interactive Content – H5P", busca o quiz com o mesmo nome e o insere nessa caixa, no lugar do H5P que houver ali;
4. deixa o iframe com 100% de largura.

A página **não é salva sozinha** — quem usa confere e clica em Salvar. Um Ctrl+Z desfaz.

## 2. O que já sabemos

- **H5P não é da Instructure.** É do H5P Group; a PUC usa o H5P.com (hospedado por eles), ligado ao Canvas por **LTI** como "Interactive Content – H5P", na lista "Todos os aplicativos" do editor.
- **Fluxo manual de hoje:** criar o quiz no H5P.com → abrir a página no Canvas → clicar no app → no popup (que é do H5P.com) buscar pelo nome → inserir. O Canvas grava um iframe `class="lti-embed"` **no ponto do cursor**, com largura fixa (~700px).
- **Bloqueio atual:** o popup mostra "Unable to access H5P.com — There are no accounts left in your H5P.com plan" (o plano da PUC está sem contas de autor livres).
- **Padrão de nome:** cada quiz é cadastrado com o título da página do tópico. O usuário chamou de "nome do módulo" — no Canvas o título do item no módulo e o da página costumam ser iguais; usar o da página aberta e, se divergirem, confirmar qual vale.
- **Lugar do quiz:** no modelo de tópico da UDA (AVA, `C:\Users\Casa\ava\AVA\src\htmlGeneratorPosUdas.ts`, ~linha 186), depois da Conclusão:

  ```html
  <div style="background: linear-gradient(...); padding: 20px 1%; text-align: center;"><span ...>&nbsp;Atividade de Fixa&ccedil;&atilde;o N&atilde;o Pontuada - Ao concluir este t&oacute;pico, responda &agrave; quest&atilde;o:&nbsp;</span></div>
  <div style="margin-top: 1px; margin-bottom: 10px; background-color: #ffffff; padding: 1.5% 2.5%;">
      <p style="text-align: center;">[iframe - Atividade de Fixa&ccedil;&atilde;o H5P]</p>
  </div>
  ```

  A atividade é **não pontuada** — não há nota envolvida.
- **Módulo típico:** "UNIDADE DIGITAL: …" com Motivação, Apresentação, cabeçalho "Tópicos de Aprendizagem", Tópico 1…6, Aplicação Prática, Aplicação Prática [Resolução], Saiba Mais.
- **Já pronto no servicetime:** "📐 Redimensionar H5P (largura 100%)" — reconhece o H5P pelo `src` contendo "h5p" (ainda **não conferido com um iframe real**); age no editor HTML (CodeMirror 6/5 ou textarea) ou no visual (TinyMCE, via `getContent`/`setContent` num `transact`). Testado em TinyMCE 5, 6 e 7.

### 2.1 Visto na Fase 1 (27/10/2026, Canvas real)

**Página de tópico (template da UDA):** o lugar do quiz é fixo, mas o que vem antes varia de página para página (às vezes não há Referências). Fim da página:

```html
<div id="conteudo" class="content-box" …> … Videoaula … Referências </div>
<div id="questao-fixacao-banner" …><span>&nbsp;Atividade de Fixa&ccedil;&atilde;o N&atilde;o Pontuada - Ao concluir este t&oacute;pico, responda &agrave; quest&atilde;o:&nbsp;</span></div>
<div id="questao-fixacao-atividade" … background-color: #ffffff; padding: 1.5% 2.5%;">
    <p style="text-align: center;"><iframe class="lti-embed" …></iframe></p>   ← o quiz
</div>
<p style="text-align: right; …">&gt;&gt; Quando se sentir pronto(a), avance…</p>
```

- Em tese a página chega diagramada **sem** H5P. Se houver um, ele sai e o novo entra (substitui).
- Nas páginas da UDA **não existe** o marcador `[iframe - Atividade de Fixação H5P]`: ele só aparece nas páginas geradas pela AVA (`htmlGeneratorPosUdas.ts`), que têm a mesma faixa, mas sem ids.
- O template repete ids (`#faixa` aparece duas vezes) → buscar com `querySelectorAll('[id="…"]')`.

**Iframe do H5P gravado pelo Canvas:**

```html
<iframe class="lti-embed" style="width: 100%; height: 600px;" title=""
  src="https://pucminas.instructure.com/courses/<curso>/external_tools/retrieve?display=borderless&amp;url=https%3A%2F%2Fpucminasvirtual.h5p.com%2Fcontent%2F<ID>"
  width="100%" height="600" loading="lazy" allowfullscreen … allow="…"></iframe>
```

- **Sem `resource_link_lookup_uuid`**: o iframe só leva o id do conteúdo. Isso torna a Fase 3 provável (trocar o id no `src`), mas ainda depende do teste 4.6.
- O `src` contém "h5p", então a detecção do `h5pResizeMain` vale. `title=""` vazio: dá para preencher com o nome do quiz (acessibilidade).
- **No editor visual**, o TinyMCE embrulha o iframe num `<span contenteditable="false" data-mce-object="iframe" class="mce-preview-object mce-object-iframe" data-mce-p-src="…h5p.com…" data-mce-p-class="lti-embed">…<span class="mce-shim"></span></span>`. Para remover um quiz, sai o span inteiro.
- Cada quiz inserido na página também é um frame do h5p.com (`/lti/4282629/content/<ID>`, nível 2, dentro do iframe do editor). O `title` do iframe interno `h5p-iframe-<ID>` é o nome do quiz.

**Editor:**

- Título da página: `input#wikipage-title-input` (`name="title"`, `data-testid="wikipage-title-input"`, rótulo "Título da página *"). É dele que sai o texto da busca, exatamente como está.
- Botão de apps (tomadinha): `aria-label="apps-temp"`. O menu tem "Interactive Content – H5P", "Studio" e "Visualizar todos". Existe o botão "Mais..." (overflow): em janela estreita a tomadinha pode ir para dentro dele.
- O Insert do H5P entra **onde estiver o cursor**: nos testes, as cópias caíram fora da caixa.

**Popup "Interactive Content – H5P":**

- Árvore: página do Canvas → `span[role=dialog].css-…-modal` (aria-label "Incorporar conteúdo da ferramenta externa", cabeçalho "Interactive Content – H5P") → `iframe#external_tool_button_frame.tool_launch` (`name="external_tool_launch"`) → **direto** `https://pucminasvirtual.h5p.com/lti/<contexto>/content` (nível 1; não há frame intermediário do Canvas). O `<contexto>` (ex.: `cim-b6wnb-…`) muda: não fixar.
- Busca: `form.append-filters[role=search]` › `input[name="search"][type="search"][placeholder="Search content"]` + `button[type=submit][title="Search"]`. **A busca é um envio de formulário:** o frame navega para a página "Search results - H5P.com". A automação tem que sobreviver à navegação (estado fora do frame).
- Resultado: `div.list-title` "Showing results (N)"; linhas `table.fable tbody tr.browser-row.content-item`. Em cada linha:
  - `input.fable-toggle-row#content-<ID>` com `aria-label` = **título completo** do quiz (o link `a.fable-title` pode vir cortado);
  - `button.btn-green` "Insert" (`title="Select this content"`), que insere direto;
  - `button.more-options` "…" (Edit/Clone/Move/Delete/Share…), que não é usado.
- Escopo: "My Content" / "All Content" (`#dropdown-content-section-mobile` mostra a seção atual; links em `ul.secondary-menu`). O último escolhido fica salvo (estava em All Content). Em "All Content" a busca também traz quizzes de outras pessoas.
- A busca acha conteúdo **dentro de pastas**. O "Tópico 5 - …" com hífen (`1292991947646133608`, o que está na caixa da página) **não aparece em nenhuma busca**, nem buscando só "Razões, proporções…" (teste real de 27/10/2026). Então não é questão de traço: esse quiz não está visível para este usuário. Mesmo assim a busca usa só o texto depois do traço, porque isso não custa nada e evita depender do tipo de traço.
- **Teste real do botão (27/10/2026):** tomadinha, popup, busca e lupa funcionaram. Falhou a troca para My Content: depois da busca a tela mostra "All Content › Search results" de novo, ou seja, a busca parece procurar sempre em All Content. O botão desistiu com o aviso "Não consegui pôr o popup em My Content".
- **Causa (diagnóstico ampliado, 27/10/2026):** as seções são o parâmetro `content_scope` do endereço: My Content = `?content_scope=mine`, Shared with me = `shared`, All Content = `all`. O formulário de busca (GET para `/lti/<contexto>/content`) leva, no painel de filtros escondido, os rádios `content_scope` (`#content_all`, marcado, e `#content_shared`) e os campos ocultos `scope`, `pageLimit` e `parent`. **Enviar o formulário sempre manda `content_scope=all`.** Solução: navegar direto para `?search=<assunto>&content_scope=mine` e só aceitar o resultado se o endereço confirmar os dois parâmetros.
- Usuário logado: `a.btn-square[role=button]` com o nome ("Raylan Bruno Fraga"). Nos quizzes do próprio usuário, o menu "…" da linha traz Edit, Clone, Move, Delete, Share with organization, Publish, Assign Owner e Confusion feedback. Isso não serve como prova de dono, porque um administrador também veria essas ações.

### Código que vai ser reaproveitado

| O quê | Onde |
|---|---|
| Abrir o popup de um app do editor (Studio): botão da barra, menu de apps, item do menu | `popup.js` › `blockMapMain` › `findIn`, `findStudioMenuItem`, `tryOpenStudio` (~linhas 1893–1924) |
| Pôr o cursor num nó / depois de um elemento | `placeCursorInside`, `placeCursorAfter` (~1809–1828) |
| Esperar o iframe novo entrar no editor | `watchForStudioVideo` (~1879) |
| Largura 100% só no H5P (regra testada) | `background.js` › `h5pResizeMain` |
| Achar o editor visível (CodeMirror 6/5, textarea) | `background.js` › `h5pResizeMain` e localizar e substituir (`cm6ViewOf`) |
| Hook de rede num frame de outro domínio (MAIN + ponte ISOLATED) | AVA `extension/src/studio/net-hook.ts` + `studio.ts`; no servicetime, a ponte `blockSaveBridge` |
| Casar por título + prévia + trocar placeholder via API | AVA `extension/src/videoInsert/VideoImportPanel.tsx` + `insertVideos.ts` |
| Gravar página sem reserializar (fatia de string + conferência com DOMParser) | `popup.js` › `bulkReplaceMain`, `matCanvasMain` (op `notas`) |

## 3. O que você precisa trazer

Quando o acesso sair:

- [ ] **Conta de autor funcionando:** o popup "Interactive Content – H5P" abre sem o erro de contas.
- [ ] **Curso de teste (sandbox)** com 2 páginas de tópico no modelo da UDA (com o marcador). Nunca testar em curso em produção.
- [ ] **2 quizzes** criados no H5P.com com o nome exato dessas páginas.
- [ ] **Um quiz inserido à mão** numa dessas páginas e o `<iframe …>` que ficou gravado (editor `</>` → copiar a tag inteira).
- [ ] **Prints do popup do H5P:** tela inicial, depois de digitar na busca, e o botão de inserir/selecionar.
- [ ] **Respostas:**
  - A busca do popup mostra só os seus quizzes ou os de toda a PUC?
  - Pode existir mais de um quiz com o mesmo nome (outra disciplina ou oferta)?
  - O marcador `[iframe - Atividade de Fixação H5P]` está em todas as páginas de tópico atuais?
  - Página por página basta, ou querem também "todos os tópicos do módulo de uma vez"?
- [ ] *(Opcional, ajuda muito)* Pedir ao admin do Canvas para marcar o H5P como **favorito do editor** (aparece direto na barra, sem passar por "Todos os aplicativos").

Não precisa abrir DevTools: o diagnóstico técnico da Fase 1 é feito pela própria extensão.

## 4. Fase 1 — Investigação (com o acesso)

1. **Iframe real:** confirmar o formato do `src` (esperado: `/courses/<id>/external_tools/retrieve?display=borderless&url=<…h5p.com/content/<id>…>&resource_link_lookup_uuid=…`) e a largura/altura de origem. Se o `src` não tiver "h5p" (ex.: só `resource_link_lookup_uuid`), ajustar a detecção do `h5pResizeMain` (alternativas: `title`, `data-*`) e rodar de novo os testes da regra (ver seção 7).
2. **Diagnóstico provisório** (botão "🔬 Diagnóstico H5P" no painel, removido ao fim da Fase 2). O usuário abre o popup, faz uma busca e clica no botão; o painel mostra um texto para copiar com:
   - a árvore de frames (Canvas → `resource_selection` → `*.h5p.com`);
   - o campo de busca, os itens da lista e o botão de inserir (tag, id, classes, `aria-label`, `placeholder`, texto) — via `chrome.scripting.executeScript({ target: { tabId, allFrames: true } })`, filtrando `location.hostname` por `h5p.com` (o `<all_urls>` do manifest já permite);
   - as URLs e o formato das respostas JSON que a tela usa para listar/buscar — hook em `fetch`/XHR no mundo MAIN, registrado com `chrome.scripting.registerContentScripts` (`matches: ["https://*.h5p.com/*"]`, `allFrames`, `runAt: "document_start"`, `world: "MAIN"`) só enquanto o diagnóstico estiver ligado, com uma ponte no mundo ISOLATED gravando no storage. **Descartar tokens, cookies, JWT e e-mails** — guardar só metadados dos quizzes.
3. **Abrir o app pelo editor:** ver se o H5P está na barra, no menu de apps (ícone de plug) ou só no diálogo "Todos os aplicativos" (que tem campo "Pesquisar"). O `tryOpenStudio` cobre barra e menu; falta o diálogo.
4. **Seleção x popup:** confirmar se, com o texto do marcador selecionado, o quiz entra **no lugar** da seleção (o Canvas usa `insertContent`, que troca a seleção) e se a seleção sobrevive à abertura do popup.
5. **Título da página:** achar o seletor do campo de título na tela de edição (fallback: API `GET /api/v1/courses/:id/pages/:slug`).
6. **Teste do caminho em lote:** colar numa página de teste um iframe montado à mão (outro content id, sem `resource_link_lookup_uuid`) e ver se o quiz abre. Se abrir, a Fase 3 é viável.

Ao terminar, atualizar a seção 2 deste plano com o que foi visto.

## 5. Fase 2 — Botão página por página (caminho principal)

> Redesenhada em 27/10/2026 com o usuário, a partir da Fase 1 (seção 2.1).

**Interface:** botão 🧩 **na barra do editor, ao lado do "Justificar texto"** (o mesmo esquema do `canvas-justify.js`). Ele só aparece na edição de páginas do Canvas (`/courses/:id/pages/:slug/edit`). Os avisos saem como toast na página.

**Peças** (o popup é de outro domínio e navega a cada busca, então o pedido fica guardado no `chrome.storage`, e não na memória do frame):

| Peça | Mundo | Onde roda | Faz |
|---|---|---|---|
| Botão + editor | MAIN | página do Canvas | lê o título, acha a caixa, posiciona o cursor, abre o app e, depois, troca o quiz (precisa do `tinymce`) |
| Ponte | ISOLATED | página do Canvas | recebe o pedido por `postMessage` e grava `h5pPending: { title, ts }` no storage; devolve ao MAIN o resultado da busca |
| Busca | ISOLATED | `https://*.h5p.com/lti/*`, `all_frames` | só age se houver `h5pPending` recente (< 2 min) e se for o frame do popup (`window.parent === top`, com `input[name=search]`) |

`manifest.json` ganha os content scripts: o da página do Canvas (MAIN + ISOLATED) e o do `*.h5p.com` (`all_frames: true`). O `<all_urls>` já dá a permissão.

**Um clique:**

0. **Confirmar** (pedido do usuário, 27/10/2026, contra clique sem querer): "🧩 Quer importar o H5P para a página?" com **Sim** / **Não**, o nome do quiz e, se a caixa já tiver H5P, o aviso de que ele será substituído. O foco começa no "Não", e Esc ou um clique fora também cancelam. Nada muda antes do Sim. Os passos 1–4 rodam antes, para não perguntar quando não há o que fazer.
1. **Validar:** editor **visual** aberto (com o `</>` aberto, pedir para voltar ao visual).
2. **Título:** `input#wikipage-title-input`, exatamente como está.
3. **Caixa:** a faixa é achada pelo texto. É a `div` mais interna cujo texto normalizado começa com "atividade de fixacao nao pontuada", e tem que haver **exatamente 1**. A caixa é a **próxima `div` irmã**. Os ids `questao-fixacao-banner`/`-atividade` só confirmam. Se faltar a faixa ou a caixa, o botão para e avisa. Nas páginas da AVA, aceitar também o marcador `[iframe - …]` dentro da caixa.
4. **Conferir a caixa:** pode conter só H5P (`span.mce-preview-object` com `data-mce-p-src*="h5p"`), o marcador, `<p>` vazio/`&nbsp;`. Se houver outra coisa (texto, vídeo, imagem), o botão para e mostra o que encontrou: nunca apaga o que não é H5P.
5. **Cursor:** dentro do `<p style="text-align: center;">` da caixa (criar se não existir), depois do quiz antigo. Guardar o conjunto de H5P que já existem na página.
6. **Pedido:** `postMessage` → ponte → `h5pPending`.
7. **Abrir o app:** `apps-temp` (`/\bapps?\b|aplicativ/i`; se não estiver na barra, abrir "Mais...") → item `/interactive content|h5p/i`. Base: `tryOpenStudio`/`findStudioMenuItem`.
8. **No popup** (content script do h5p.com):
   - **busca só em "My Content", pelo endereço:** `location.assign(<action do formulário>?search=<texto>&content_scope=mine)`. **Não** enviar o formulário, que força `content_scope=all` (seção 2.1). O resultado só vale se `location.search` tiver `content_scope=mine` e o `search` certo; até 2 tentativas, depois avisa. O texto buscado é a parte do título **depois do traço** ("Razões, proporções…"); sem traço, o título inteiro;
   - página de resultados → comparar o título completo de cada linha (`aria-label` do `input.fable-toggle-row`) com o título da página, os dois normalizados (NFD sem acentos, minúsculas, ‐ ‑ ‒ – — ― → `-`, espaços colapsados, sem espaço nas pontas);
   - **exatamente 1 idêntico** → clicar no `Insert` da linha;
   - **0 ou 2+** → não clicar: destacar os candidatos na lista, avisar no Canvas ("nenhum quiz seu com o nome …" / "N quizzes seus com o nome …") e deixar o popup aberto;
   - limpar o `h5pPending` em qualquer caso (não buscar de novo ao reabrir o H5P à mão).
9. **Depois do Insert** (MutationObserver no editor, timeout ~3 min = popup cancelado): quando entrar um H5P que não estava no conjunto do passo 5,
   - se ele caiu fora da caixa, movê-lo para dentro;
   - remover o(s) H5P antigo(s) da caixa (o `span.mce-preview-object` inteiro);
   - largura 100% (regra do `h5pResizeMain`) e `title` = nome do quiz;
   - tudo num `undoManager.transact` + `setDirty`. Um Ctrl+Z desfaz a troca; o segundo desfaz a inserção, que é um passo do próprio Canvas.

   Se o popup for cancelado, nada muda: o quiz antigo só sai quando o novo entra.
10. **Toast:** "✓ Quiz 'Tópico 5 – …' inserido (substituí o H5P que estava). Confira e salve a página."

Cada espera tem timeout, e a mensagem diz em que passo parou ("não achei a faixa", "não achei o app H5P no editor", "o popup do H5P não carregou", "nenhum quiz com o nome …").

**Refatoração junto:** a regra de largura do `h5pResizeMain` passa a ser compartilhada (o menu de contexto e o botão usam a mesma). O jeito exato depende de onde o botão rodar: content script MAIN não usa `importScripts`.

**Fim da fase:** o botão provisório "🔬 Diagnóstico H5P" foi removido em 27/10/2026, depois do teste real. Se a tela do H5P.com mudar, ele pode ser recuperado do histórico do git (não foi commitado: refazer a partir da seção 2.1).

## 6. Fase 3 — Em lote (opcional; só se o teste 4.6 passar e o usuário quiser)

Modelo: "Vídeos nas páginas" da AVA.

1. Capturar a lista de quizzes (título → URL do conteúdo) pelo hook do popup e guardar no storage por curso.
2. No painel: ler o módulo da UDA, listar as páginas "Tópico N – …", casar pelo nome (mesma normalização) e mostrar a **prévia** (página → quiz; sem par em destaque).
3. Aplicar: trocar o marcador pelo iframe (já com 100%) no HTML bruto, **por fatia de string** — sem reserializar a página, como a edição em escala —, conferir com DOMParser e gravar via API (`PUT /api/v1/courses/:id/pages/:slug`, CSRF do cookie `_csrf_token`).

## 7. Testes

- **Regra da largura (regressão):** `.claude/skills/h5p-quiz/scripts/test-h5p.js` — carrega o `h5p-width.js`, injeta o `h5pResizeMain` real em textarea, CodeMirror 6/5 e TinyMCE 5/6/7, com 8 variantes de iframe. Rodar depois de qualquer mudança na regra (ver o `SKILL.md`).
- **Botão (simulação):** `.claude/skills/h5p-quiz/scripts/test-quiz.js` — TinyMCE 6 real com o plugin media, menu da tomadinha (`apps-temp`), popup do H5P.com falso que navega a cada busca, com My/All Content e quizzes seus e de outra pessoa, e `chrome.storage` simulado entre os frames. Cobre: confirmação (Sim, Não, Esc, Enter), troca do H5P antigo com mudança para My Content e hífen x travessão, 0 e 2+ quizzes (com escolha manual depois), caixa com outro conteúdo, página sem faixa, Insert caindo fora da caixa, página da AVA com o marcador, e o quiz já inserido na página que não pode reagir.
- **Botão (Fase 2):** mesmo esquema — `playwright-core` + Chrome do sistema; página com TinyMCE do cdnjs (precisa de `<!DOCTYPE html>`); a tela do H5P simulada a partir do diagnóstico da Fase 1 e servida num endereço `https://<x>.h5p.com/...` com `page.route` (assim o filtro por hostname funciona). Casos: 1 quiz, 0, 2+, hífen x travessão, caixa vazia, caixa já com H5P (substitui), caixa com outro conteúdo (para), sem faixa, 2 faixas, Insert caindo fora da caixa (move), `</>` aberto, popup cancelado (nada muda), Ctrl+Z, quiz já inserido na página (frame do h5p.com que NÃO é o popup, não pode reagir). A tela simulada do H5P segue a seção 2.1, inclusive a navegação a cada busca.
- **Manual** no curso de teste: os tópicos, salvar, visão do aluno, tela estreita.

## 8. Critérios de aceite

- Um clique insere o quiz certo no lugar do marcador, com 100% de largura, sem salvar sozinho.
- Nome ambíguo ou inexistente → nada é inserido; mensagem clara; popup aberto para escolha manual.
- Nenhum outro iframe (vídeo, Studio) muda; o resto do HTML fica igual; Ctrl+Z desfaz.

## 9. Riscos e como lidar

| Risco | Como lidar |
|---|---|
| A tela do H5P.com mudar | Seletores num lugar só + diagnóstico para reajustar rápido |
| O menu de apps do Canvas mudar | Mesma abordagem do Studio; se não achar o app, a mensagem pede para abrir o H5P à mão e a busca continua automática |
| A seleção do marcador se perder ao abrir o popup | Plano B do passo 4 |
| Contas de autor esgotadas de novo | Bloqueio de acesso, não de código |
| Lote: iframe montado à mão não abrir (LTI 1.3 cria um vínculo a cada inserção) | Só fazer a Fase 3 depois do teste 4.6 |

## 10. Arquivos que vão mudar

- Content script novo da página do Canvas (botão + editor no mundo MAIN, ponte no ISOLATED), junto do `canvas-justify.js`.
- Content script novo do `*.h5p.com` (busca e Insert).
- `manifest.json` — os dois content scripts acima.
- `background.js` — regra da largura compartilhada.
- `popup.html` / `popup.js` — remover o diagnóstico provisório no fim da Fase 2.
- Commits no padrão do repo: um da funcionalidade e outro "Sobe versao para X".

## 11. Decisões do plano (mudar só se o usuário pedir)

- **Página por página primeiro.** O popup oficial cria o vínculo LTI como se fosse à mão, e as páginas são editadas por várias pessoas em paralelo — o mesmo motivo de o importador de UDA importar um tópico por vez.
- **Nunca salvar sozinho.**
- **Na dúvida, não escolher:** 0 ou 2+ quizzes com o nome → a pessoa escolhe.
- **O lugar é a caixa logo depois da faixa "Atividade de Fixação Não Pontuada"** (decisão de 27/10/2026, no lugar do marcador). Sem faixa ou sem caixa, parar em vez de inserir em lugar arbitrário.
- **Já tem H5P na caixa → substitui** (decisão de 27/10/2026). Só sai o que é H5P; outro conteúdo na caixa faz o botão parar.
- **O texto da busca é o título da página** (campo "Título da página"), exatamente como está.
- **Só os quizzes de quem está usando ("My Content")** (decisão de 27/10/2026). Os compartilhados por outras pessoas não entram, mesmo que a busca em "All Content" os encontre.
- **Botão na barra do editor, ao lado do Justificar** (decisão de 27/10/2026), e não no painel.
- **Confirmação antes de importar** ("Quer importar o H5P para a página?" Sim/Não), porque o botão pode ser apertado sem querer (decisão de 27/10/2026).
- **Largura 100%, altura intacta;** só o iframe do H5P muda.
