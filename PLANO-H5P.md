# Plano — Inserir o quiz H5P do tópico automaticamente

> **Status:** aguardando acesso ao H5P.com (out/2026).
> **Para retomar:** no Claude Code, digite `/h5p-quiz` (ou diga "vamos implementar o plano do H5P").

## Andamento

- [x] Redimensionar H5P (largura 100%) — menu de contexto, `h5pResizeMain` em `background.js` (out/2026)
- [ ] Pré-requisitos — seção 3
- [ ] Fase 1 — investigação da tela do H5P.com
- [ ] Fase 2 — botão página por página
- [ ] Fase 3 — em lote (opcional)

---

## 1. Objetivo

Um botão no painel (🎓 Canvas › Edição de páginas): com a página de um tópico aberta em edição, **um clique**:

1. lê o título da página (ex.: "Tópico 1 – Conjuntos numéricos naturais, inteiros, racionais e decimais");
2. acha o marcador `[iframe - Atividade de Fixação H5P]`;
3. abre o popup do H5P, busca o quiz com o mesmo nome e o insere no lugar do marcador;
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

**Interface:** botão "🧩 Inserir quiz H5P do tópico" na tela Canvas, seção "Edição de páginas" (`popup.html`, junto de Duplicar/Reorganizar/Mapa) + linha de status. Atualizar a dica "Duplicar, reorganizar e mapa exigem uma página aberta no editor" para incluir o H5P.

**Orquestração** (`doInsertH5pQuiz` em `popup.js`; funções injetadas autocontidas, tudo por `args`):

1. **Validar a aba:** URL `/courses/:id/pages/:slug/edit` com o editor **visual** aberto. Com o `</>` aberto → pedir para voltar ao visual.
2. **Ler o título** da página.
3. **Achar o marcador** no `ed.getBody()`: `<p>` cujo texto casa com `/\[\s*iframe\s*-\s*atividade\s+de\s+fixa[çc][ãa]o\s*h5p\s*\]/i` (normalizar travessões antes).
   - Sem marcador e já existe iframe H5P → "Esta página já tem um H5P" (não duplica).
   - Sem marcador e sem H5P → parar: "Marcador não encontrado".
4. **Selecionar o texto do marcador** — o quiz entra no lugar dele; se o popup for cancelado, o marcador continua lá. Plano B (se a seleção se perder ao abrir o popup): esvaziar o `<p>` num `transact` e pôr o cursor dentro (`placeCursorInside`).
5. **Abrir o app H5P:** adaptar `tryOpenStudio`/`findIn` com `/h5p|interactive content/i` e incluir o diálogo "Todos os aplicativos".
6. **Buscar e escolher no popup** (injeção `allFrames`, só nos frames `*.h5p.com`): digitar o título na busca (setter nativo do `value` + evento `input`), esperar os resultados, normalizar e decidir:
   - **1 quiz idêntico** → clicar em inserir;
   - **0 ou 2+** → não clicar; mostrar no painel os nomes encontrados e deixar o popup aberto para a escolha manual.

   Normalização: NFD sem acentos, minúsculas, travessões (‐ ‑ ‒ – — ―) → `-`, espaços colapsados, sem espaço nas pontas.
7. **Depois da inserção:** em paralelo ao passo 6, uma função no mundo MAIN espera o iframe novo entrar no editor (como `watchForStudioVideo`, com timeout de ~3 min = popup cancelado). Quando entrar, o painel roda `h5pResizeMain` (largura 100%) e confere que o marcador sumiu.
8. **Status:** "✓ Quiz 'Tópico 1 – …' inserido. Confira e salve a página."

Cada espera tem timeout e a mensagem diz em que passo parou ("não achei o app H5P no editor", "o popup do H5P não carregou", "nenhum quiz com o nome …").

**Refatoração junto:** mover `h5pResizeMain` para um `h5p.js` compartilhado — `background.js` com `importScripts('h5p.js')` e `popup.html` com `<script src="h5p.js">` — para o botão e o menu de contexto usarem a mesma regra de largura.

## 6. Fase 3 — Em lote (opcional; só se o teste 4.6 passar e o usuário quiser)

Modelo: "Vídeos nas páginas" da AVA.

1. Capturar a lista de quizzes (título → URL do conteúdo) pelo hook do popup e guardar no storage por curso.
2. No painel: ler o módulo da UDA, listar as páginas "Tópico N – …", casar pelo nome (mesma normalização) e mostrar a **prévia** (página → quiz; sem par em destaque).
3. Aplicar: trocar o marcador pelo iframe (já com 100%) no HTML bruto, **por fatia de string** — sem reserializar a página, como a edição em escala —, conferir com DOMParser e gravar via API (`PUT /api/v1/courses/:id/pages/:slug`, CSRF do cookie `_csrf_token`).

## 7. Testes

- **Regra da largura (regressão):** `.claude/skills/h5p-quiz/scripts/test-h5p.js` — injeta o `h5pResizeMain` real em textarea, CodeMirror 6/5 e TinyMCE 5/6/7, com 8 variantes de iframe. Rodar depois de qualquer mudança na regra (ver o `SKILL.md`).
- **Botão (Fase 2):** mesmo esquema — `playwright-core` + Chrome do sistema; página com TinyMCE do cdnjs (precisa de `<!DOCTYPE html>`); a tela do H5P simulada a partir do diagnóstico da Fase 1 e servida num endereço `https://<x>.h5p.com/...` com `page.route` (assim o filtro por hostname funciona). Casos: 1 quiz, 0, 2+, página já com H5P, sem marcador, `</>` aberto, popup cancelado, Ctrl+Z.
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

- `popup.html` — botão e status na tela Canvas.
- `popup.js` — `doInsertH5pQuiz` + funções injetadas.
- `h5p.js` (novo) + `background.js` — regra da largura compartilhada.
- `manifest.json` — só se a Fase 3 precisar de content script fixo em `*.h5p.com` (o `<all_urls>` já permite injetar sob demanda).
- Commits no padrão do repo: um da funcionalidade e outro "Sobe versao para X".

## 11. Decisões do plano (mudar só se o usuário pedir)

- **Página por página primeiro.** O popup oficial cria o vínculo LTI como se fosse à mão, e as páginas são editadas por várias pessoas em paralelo — o mesmo motivo de o importador de UDA importar um tópico por vez.
- **Nunca salvar sozinho.**
- **Na dúvida, não escolher:** 0 ou 2+ quizzes com o nome → a pessoa escolhe.
- **O marcador é o lugar;** sem marcador, parar em vez de inserir em lugar arbitrário.
- **Largura 100%, altura intacta;** só o iframe do H5P muda.
