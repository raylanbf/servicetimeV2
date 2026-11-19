# O editor de páginas do Canvas (RCE)

## Sumário
1. As três faces do editor
2. Onde o código do botão roda
3. Achar o editor certo
4. Botão na barra do editor
5. Mudar o conteúdo num passo de Ctrl+Z
6. Iframes no editor visual
7. Cursor, seleção e título da página
8. Abrir os apps do editor (Studio, H5P) e o editor de equação
9. Campos do React
10. Confirmação e avisos dentro da página
11. Armadilhas
12. Como testar

---

## 1. As três faces do editor

O Rich Content Editor (RCE) do Canvas aparece em páginas, tarefas, fóruns, anúncios e testes. Por baixo, há três coisas:

| Face | O que é | Como se mexe |
|---|---|---|
| Editor visual | TinyMCE (versões 5, 6 e 7 já apareceram) num iframe | `window.tinymce`, só no mundo MAIN |
| Editor HTML (botão `</>`) | CodeMirror 6 (`.cm-editor`); em telas antigas, CodeMirror 5 (`.CodeMirror`) ou uma `textarea` simples | a instância do CodeMirror, também só no MAIN |
| `textarea` escondida | onde o Canvas guarda o HTML atrás do editor visual | **nunca mexa**: o Canvas a ignora e a mudança se perde |

**Com o editor HTML aberto, o visual fica escondido e desatualizado.** Mude só o HTML, ou peça para voltar ao visual se a ação precisar dele ("Volte ao editor visual (o </> está ativo) e clique de novo.").

**Ação no editor é nível 1:** ela não salva a página. Quem usa confere e clica em Salvar (`escrita-segura.md` §4).

---

## 2. Onde o código do botão roda

- **Content script com `world: 'MAIN'`**, em `https://*.instructure.com/courses/*` (e no domínio próprio da instituição), `run_at: 'document_idle'`. Só no MAIN existem `tinymce` e o CodeMirror (`arquitetura-mv3.md` §3).
- **Guarda contra injeção dupla:** `if (window.__meuBotao) return; window.__meuBotao = true;`.
- **Se precisar de `chrome.*`** (storage, mensagens), ponha uma ponte num content script ISOLATED na mesma página, falando por `window.postMessage` com uma marca própria e `e.source === window`.
- **Ação pelo menu de contexto ou pelo painel:** `executeScript({ world: 'MAIN', files: ['regra.js', 'acesso-editor.js'] })` e depois a função que usa as duas. Regras compartilhadas ficam em `window.__prefixoNome`.
- **Restrinja ao tipo de tela.** Um botão que depende do modelo de página de tópico só aparece em `/^\/courses\/\d+\/pages\/[^/]+\/edit/`. O "Justificar" serve em qualquer RCE.

---

## 3. Achar o editor certo

Pode haver mais de um editor na página (modais sobrepostos, tarefa com várias caixas). Ache o editor **do container onde o botão está**, e não só o `activeEditor`:

```js
function editorDo(container) {
  const tm = window.tinymce;
  if (!tm) return null;
  const todos = [].concat((typeof tm.get === 'function' ? tm.get() : tm.editors) || []);   // TinyMCE 6+ × 5
  return todos.find(ed => ed.getContainer && ed.getContainer() === container) || tm.activeEditor || null;
}
const visivel = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
```

**Acesso ao CodeMirror 6.** A instância não fica numa propriedade documentada. O que funcionou foi procurar a `view` nas propriedades internas do `.cm-content`:

```js
function cm6ViewOf(editorEl) {
  const content = editorEl.querySelector('.cm-content');
  const isView = v => v && v.state && v.state.doc && typeof v.dispatch === 'function';
  for (const key of Object.keys(content || {})) {
    const n = content[key];
    const view = [n?.root?.view, n?.rootView?.view, n?.view].find(isView);
    if (view) return view;
  }
  return null;
}
```

Se há um `.cm-editor` visível e a `view` não foi achada, **pare com aviso**. Não caia para o TinyMCE, que está desatualizado.

O CodeMirror 5 fica em `el.CodeMirror`, no próprio `.CodeMirror`.

---

## 4. Botão na barra do editor

```js
function botao(container) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tox-tbtn __meu-botao__';            // a classe do TinyMCE dá o visual nativo
  b.title = 'Justificar texto';
  b.setAttribute('aria-label', 'Justificar texto');
  b.addEventListener('mousedown', e => e.preventDefault());   // não tira o foco do editor
  b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); agir(container); });
  return b;
}
function injetar(toolbar) {
  if (toolbar.querySelector('.__meu-botao__')) return;
  const container = toolbar.closest('.tox-tinymce');
  if (!container) return;
  const grupo = document.createElement('div');
  grupo.className = 'tox-toolbar__group';
  grupo.appendChild(botao(container));
  toolbar.appendChild(grupo);
}
const scan = () => document.querySelectorAll('.tox-toolbar__primary').forEach(injetar);
scan();
let pend = false;   // o Canvas monta o editor depois e refaz a barra quando a janela muda de largura
new MutationObserver(() => { if (pend) return; pend = true; setTimeout(() => { pend = false; scan(); }, 300); })
  .observe(document.body, { childList: true, subtree: true });
```

- **`mousedown` com `preventDefault`**: sem isso, o clique tira o foco do editor e a seleção se perde antes da ação.
- **Ícone legível:** texto de verdade (`<span>` com borda em `currentColor`) lê melhor no tamanho da barra do que texto miúdo dentro de SVG.
- **Botões irmãos** (dois botões da mesma extensão) entram no mesmo grupo: procure o primeiro e acrescente ao lado.
- **Atalho de teclado** pelo `commands` do manifest chega ao service worker, que injeta a ação na aba ativa. O Chrome não deixa desligar um atalho pelo código: se a função estiver desligada nas configurações, o atalho só avisa onde ligar.

---

## 5. Mudar o conteúdo num passo de Ctrl+Z

**No editor visual**, a mudança inteira cabe num passo de desfazer:

```js
const win = ed.getWin(), y = win.scrollY;
ed.undoManager.add();                         // garante o estado ATUAL na pilha (não duplica se já estiver)
ed.undoManager.transact(() => {
  /* mexa no DOM do editor (ed.dom, ed.getBody()) ou: */
  ed.setContent(aplicarEdits(ed.getContent(), edits));
});
ed.setDirty(true);                            // o Canvas passa a avisar "alterações não salvas"
ed.nodeChanged();                             // atualiza a barra (negrito, alinhamento…)
win.scrollTo(0, y);                           // setContent joga a rolagem para o topo
```

Sem o `undoManager.add()` antes, o `transact` registra só o estado novo e o Ctrl+Z não volta ao anterior.

**`getContent`/`setContent` reserializa**, o que no editor é aceitável porque o próprio TinyMCE serializa tudo ao salvar. Mesmo assim: calcule as edições sobre o texto de `getContent()`, aplique por fatia e chame `setContent` **uma vez**. Quando der para mexer só no nó alvo (`ed.dom`, `ed.selection`), prefira.

**No editor HTML**, cada face tem seu jeito de aplicar `edits = [{ from, to, insert }]` num passo só:

| Face | Aplicar |
|---|---|
| CodeMirror 6 | `view.dispatch({ changes: edits })` (posições do texto original; o CM6 ajusta) |
| CodeMirror 5 | `cm.operation(() => edits.slice().reverse().forEach(e => cm.replaceRange(e.insert, cm.posFromIndex(e.from), cm.posFromIndex(e.to))))` |
| `textarea` | setter nativo de `value` + eventos `input` e `change` (ver §9) |

Um módulo único que devolve `{ get(), apply(edits, texto) }` para a face visível (o `editor-access.js` do Service Timer) evita repetir isso em cada ação.

**Ajuste de alinhamento** (o botão Justificar): `ed.execCommand('JustifyFull')` e, em seguida, limpe o que conflita nos blocos selecionados: `text-align` inline, atributo `align` e classes de alinhamento (`text-center`, `ql-align-right`…), inclusive em ancestrais que embrulham **só** aquele bloco. Senão o Canvas mostra "Direita" e "Justificado" marcados ao mesmo tempo.

---

## 6. Iframes no editor visual

O TinyMCE não mostra o iframe direto. Ele o embrulha numa prévia:

```html
<span contenteditable="false" data-mce-object="iframe" class="mce-preview-object mce-object-iframe"
      data-mce-p-src="…h5p.com…" data-mce-p-class="lti-embed">
  <iframe …></iframe><span class="mce-shim"></span>
</span>
```

- **Para reconhecer:** `span.mce-preview-object` com `data-mce-p-src` (ou o `src` do iframe de dentro).
- **Para remover:** tire o `span` inteiro.
- **Para mudar um atributo:** mude o `data-mce-p-<atributo>` do span **e** o do iframe de dentro (ex.: `data-mce-p-title` e `title`).
- **No HTML que `getContent()` devolve**, o iframe aparece normal, sem o span.
- Cada embed inserido também é um frame do site da ferramenta (Studio, H5P) **dentro** do iframe do editor. Content scripts da ferramenta com `all_frames` rodam neles também: filtre pelo nível do frame (§8).

---

## 7. Cursor, seleção e título da página

**Pôr o cursor no fim de um nó:**

```js
ed.focus();
const rng = ed.dom.createRng();
rng.selectNodeContents(paragrafo);
rng.collapse(false);
ed.selection.setRng(rng);
```

O `focus()` também restaura a última seleção: sem ele, algo inserido cai no início do texto.

**Título da página** (edição de página): `#wikipage-title-input`, `input[data-testid="wikipage-title-input"]` ou `input[name="title"]`. Use o valor **exatamente** como está (só `trim`). Se não achar, a API tem o título (`GET /pages/:url`).

**Valide de novo depois de qualquer espera.** A página pode mudar enquanto a confirmação está aberta: depois do "Sim", ache o alvo outra vez antes de agir.

---

## 8. Abrir os apps do editor (Studio, H5P) e o editor de equação

**Apps LTI** (o botão da "tomadinha"):

1. Ache o botão de apps pelo rótulo, não pela classe: `aria-label`/`title` casando `/\bapps?\b|aplicativ/i`. Em janela estreita ele vai para o "Mais…" (`/^(mais|more)\b/i`): clique nele primeiro e espere o botão aparecer.
2. Clique e espere o item do menu: `.tox-collection__item, [role="menuitem"]` com o nome da ferramenta (`/interactive content|h5p/i`, `/studio/i`).
3. O popup é um `[role="dialog"]` com `iframe#external_tool_button_frame` apontando **direto** para o site da ferramenta. O que acontece lá dentro é com o content script da ferramenta (`h5p.md` §9).
4. O conteúdo escolhido entra **onde estiver o cursor**, pelo próprio Canvas. Para saber quando entrou: guarde o conjunto dos embeds que já existiam e observe o corpo do editor (`MutationObserver`) até aparecer um que não estava lá. Dê ~150 ms para o TinyMCE terminar de montar a prévia antes de mexer.
5. **Popup fechado sem inserir, ou abandonado** (ex.: 3 minutos): pare de observar e diga "nada foi alterado". Detecte abrir e fechar por observador, não por checagem periódica, que perde um popup que abre e fecha entre duas checagens.

**Editor de equação:** o plugin do Canvas registra o comando `instructureEquation`, o mesmo que o botão √x executa:

```js
if (!ed.hasFocus()) ed.focus();
let aberto = false;
try { aberto = ed.execCommand('instructureEquation'); } catch (_) {}
if (!aberto) {   // plano B, se o comando mudar de nome
  [...ed.getContainer().querySelectorAll('.tox-tbtn')]
    .find(b => /equa[çc][ãa]o|equation/i.test(b.getAttribute('aria-label') || b.title || ''))?.click();
}
```

O modal é React e pode demorar na primeira vez (o Canvas baixa o código dele): espere cada elemento com timeout. Para escrever o LaTeX, ligue o "Editar diretamente LaTeX" (o checkbox do modal) e use a `textarea` visível (largura > 50 px; os editores visuais de fórmula escondem textareas de 1 px para capturar o teclado). Com o cursor sobre uma equação existente, o Canvas a abre para edição: não troque o conteúdo dela.

---

## 9. Campos do React

Atribuir `.value` direto num campo controlado pelo React não chega ao estado dele: o valor aparece na tela e some no envio. O que funciona:

```js
const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;   // ou HTMLInputElement
set.call(campo, valor);
campo.dispatchEvent(new Event('input', { bubbles: true }));
campo.dispatchEvent(new Event('change', { bubbles: true }));
```

---

## 10. Confirmação e avisos dentro da página

- **Confirme antes de substituir:** "🧩 Quer importar o H5P para a página?", com o nome do que entra e, se for o caso, "o H5P que já está na caixa será substituído". **Foco no "Não"**, para um Enter sem querer não confirmar; Esc e clique fora cancelam. Clique fora só conta se o `mousedown` **e** o `click` foram no fundo (soltar o mouse fora depois de selecionar texto não cancela).
- **Valide tudo antes de perguntar**: não pergunte quando não há o que fazer (sem faixa, caixa com outro conteúdo, editor HTML aberto).
- **Avisos como toast:** um só por vez (id fixo), `position: fixed`, `z-index` máximo, texto por `textContent`. Sucesso some em ~4 s; aviso e erro ficam 7 a 10 s.
- **Mensagem diz o passo:** "não achei a faixa", "não achei o app H5P no editor", "o popup do H5P não carregou", "nenhum quiz seu com o nome …". E termina com o próximo passo: "Confira e salve a página."
- **Extensão recarregada com a página aberta:** a ponte ISOLATED recebe "Extension context invalidated". Devolva um status próprio e mostre "A extensão foi atualizada. Recarregue a página (F5) e tente de novo."

---

## 11. Armadilhas

- **Mundo errado:** `window.tinymce` não existe no ISOLATED. O código "funciona" pelo plano B e ninguém percebe.
- **Classes com hash** (`css-1x2y3z`) mudam a cada versão do Canvas. Use `role`, `aria-label`, `data-testid` e texto.
- **A `textarea` escondida** atrás do editor visual parece o lugar certo e não é (§1).
- **Inserção por app cai no cursor**, e o cursor nem sempre está onde se espera: confira onde o embed entrou e mova-o para o lugar certo dentro do mesmo passo de desfazer.
- **Parágrafo vazio** que o Canvas cria só para o embed fica sobrando depois de mover o embed: remova se ele não existia antes e ficou sem texto nem mídia.
- **Rolagem:** `setContent` volta para o topo; guarde e restaure `scrollY`.
- **Seleção perdida** ao clicar num botão da página: `mousedown` + `preventDefault`.

---

## 12. Como testar

Página local com `<!DOCTYPE html>` (sem ele, o TinyMCE entra em modo quirks e se comporta diferente), o TinyMCE do cdnjs nas versões 5, 6 e 7, CodeMirror 6 e 5 e uma `textarea`, abertas com `playwright-core` no Chrome do sistema. Para cada face: a ação muda só o alvo, o resto do texto fica igual, **um** Ctrl+Z desfaz tudo e o `isDirty()` fica verdadeiro. Detalhes em `testes-e-processo.md` §5.
