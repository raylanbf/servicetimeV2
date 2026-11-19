# Arquitetura de uma extensão MV3 para o Canvas

## Sumário
1. As peças e o que cada uma pode
2. `executeScript`: a regra da função serializada
3. Mundo MAIN × ISOLATED e as pontes
4. Content scripts nas páginas do Canvas
5. Service worker
6. Documento offscreen
7. Painel lateral
8. Manifest de referência
9. Estilo de código que funcionou

---

## 1. As peças e o que cada uma pode

| Peça | Onde roda | `chrome.*` | Sessão do Canvas | Use para |
|---|---|---|---|---|
| Painel lateral (`side_panel`) | página da extensão | todas as APIs | não (fala com a aba) | interface, prévia, confirmação, estado da ferramenta |
| Função injetada (`executeScript`) | aba do Canvas, ISOLATED por padrão | só `storage` e `runtime` | sim, mesma origem | chamadas à API do Canvas |
| Content script ISOLATED | páginas do Canvas | só `storage` e `runtime` | sim | botões na página, ponte com o MAIN |
| Content script MAIN | páginas do Canvas | nenhuma | sim | `tinymce`, CodeMirror, interceptar `fetch`/XHR de uma SPA |
| Service worker | fundo | todas | só por `fetch` com `host_permissions` | sites externos, menus de contexto, atalhos |
| Documento offscreen | página oculta | `runtime` | não | `DOMParser`, área de transferência |

**Por que as chamadas ao Canvas saem da aba:** o pedido é de mesma origem, leva os cookies sozinho, o CSRF está em `document.cookie`, o `Origin` é o do Canvas e o servidor vê o mesmo que veria da própria interface. Do painel ou do service worker também funciona (com `host_permissions`, mais a permissão `cookies` para ler o CSRF), mas o pedido sai com `Origin: chrome-extension://…`, e o CSRF fica mais trabalhoso. Prefira a aba.

---

## 2. `executeScript`: a regra da função serializada

`chrome.scripting.executeScript({ target: { tabId }, func, args })` transforma `func` em texto e a executa na aba. Consequências:

- **Sem closures.** A função não enxerga constantes, helpers nem variáveis do arquivo onde foi escrita. Um helper usado lá dentro tem de ser declarado lá dentro.
- **Entrada só por `args`, saída só JSON.** Funções, `Map`, `Set`, `File`, `Blob` e instâncias de classe não atravessam. O valor de uma Promise é aguardado.
- **Exceções não atravessam de forma útil.** Capture tudo e devolva `{ __error: mensagem }`. O lado do painel transforma isso em exceção.
- **Uma função, várias operações.** Em vez de repetir CSRF, paginação e ritmo em cada função injetada, use uma só `canvasMain(op, p)` com um `if (op === …)` por operação (modelo em `assets/canvas-api.js`).
- **A aba pode recarregar no meio.** A injeção falha ou volta sem resultado. Repita (2 tentativas, 1,5 s entre elas) **só** se a operação for idempotente.
- **Arquivo grande não passa por `args`.** No upload, a aba pede ao Canvas a URL de envio (com sessão e CSRF) e o **painel** envia o binário direto para ela.

```js
// ✗ helper de fora: na aba vira "ReferenceError: norm is not defined"
const norm = s => s.trim().toLowerCase();
chrome.scripting.executeScript({ target: { tabId }, func: t => norm(t), args: ['X'] });

// ✓ autocontida
chrome.scripting.executeScript({ target: { tabId }, func: t => {
  const norm = s => s.trim().toLowerCase();
  return norm(t);
}, args: ['X'] });
```

Para testar se uma função é mesmo autocontida: `eval('(' + fn.toString() + ')')` num contexto limpo, como faz o teste em `scripts/testar-canvas-api.js`.

---

## 3. Mundo MAIN × ISOLATED e as pontes

O mundo **ISOLATED** (padrão de content scripts e de `executeScript`) vê o mesmo DOM da página, mas **não** os objetos JavaScript dela. `window.tinymce`, o CodeMirror e as funções da SPA só existem no mundo **MAIN**.

Armadilha real: uma função injetada sem `world: 'MAIN'` testava `if (window.tinymce)` e caía sempre no plano B, porque no ISOLATED essa variável não existe. O código "funcionava", mas pelo caminho errado.

**Quando usar MAIN:** mexer no editor (`tinymce.activeEditor`, `undoManager`), no CodeMirror do editor HTML, ou interceptar `fetch`/XHR de uma SPA (Studio). Lá não há `chrome.*`.

**Pontes:**

- **MAIN → ISOLATED:** `window.postMessage({ __minhaMarca: 'acao', ... }, '*')`. No ISOLATED, aceite só `e.source === window` com a marca. **Qualquer script da página pode postar a mesma mensagem**, então trate o conteúdo como entrada não confiável. A ponte só pode fazer coisas inofensivas ou que ainda passem por confirmação na interface da extensão.
- **ISOLATED → service worker / painel:** `chrome.runtime.sendMessage`. Quem recebe confere `sender.id === chrome.runtime.id` e, se a mensagem vem de content script, a origem de `sender.tab.url`/`sender.url`.
- **Fluxo que atravessa frames ou navegações** (ex.: um popup LTI de outro domínio que recarrega a cada busca): guarde o pedido em `chrome.storage.local` com id e horário (`{ id, title, ts }`), deixe o script do outro frame agir só se o pedido for recente (ex.: menos de 2 minutos) e devolva o resultado por `storage.onChanged` → `postMessage` para o MAIN.
- **Extensão recarregada com a página aberta:** `chrome.runtime.*` passa a lançar "Extension context invalidated". Capture e peça à pessoa para recarregar a página (F5).

---

## 4. Content scripts nas páginas do Canvas

- **`matches` restrito:** `https://*.instructure.com/courses/*` e o domínio próprio da instituição, se houver (ex.: `https://canvas.minhainstituicao.br/courses/*`).
- **Guarda contra injeção dupla:** `if (window.__meuBotao) return; window.__meuBotao = true;`.
- **O Canvas monta e refaz o cabeçalho e as barras depois do carregamento** (React). Botões injetados precisam de um `MutationObserver` que os recoloque, com `requestAnimationFrame` para não rodar a cada mutação.
- **Chaves nas configurações valem na hora:** leia com `chrome.storage.local.get({ chave: false })` e acompanhe `chrome.storage.onChanged`, montando ou removendo o botão sem recarregar.
- **Frames LTI** (Studio, H5P): `all_frames: true` no domínio da ferramenta. Para interceptar a rede de uma SPA, use `world: 'MAIN'` e `run_at: 'document_start'`, antes de ela fazer as primeiras chamadas.
- **UI injetada:** ids próprios com prefixo, estilos inline, `z-index` alto e `textContent` para todo texto. Não dependa do CSS do Canvas, que muda.

---

## 5. Service worker

- **Módulos compartilhados com `importScripts('arquivo.js')`** (scripts clássicos), cada um publicando um objeto (`globalThis.H5P_FOLDER = …`).
- **Morre quando fica ocioso** (cerca de 30 s). Trabalho longo fica no painel ou na aba, com o progresso visível. Peça para manter o painel aberto.
- **`onMessage` assíncrono** devolve `true` e chama `sendResponse` depois. Erros voltam como `{ status: 'error', code, message }`.
- **`fetch` com `host_permissions`** não sofre CORS e leva os cookies do site de destino (os `SameSite=None`). É assim que o H5P.com é acessado sem abrir aba.

---

## 6. Documento offscreen

O service worker não tem DOM nem área de transferência. Crie um documento offscreen uma vez só (`chrome.offscreen.hasDocument()`), com os motivos `DOM_PARSER`/`CLIPBOARD`, e converse com ele por mensagens.

Uso real: montar os campos que um formulário de outro site enviaria. O HTML entra num `DOMParser`; `script`, `iframe`, `img` etc. saem antes; o formulário é importado, `new FormData(form)` produz os pares e ele é removido. Assim o envio vai com os mesmos valores padrão que a tela mandaria.

---

## 7. Painel lateral

- O **side panel** fica aberto enquanto a pessoa trabalha nas abas, por isso combina com ferramentas de produção melhor do que o popup da ação, que fecha a cada clique fora.
- **`alert`/`confirm`/`prompt` não servem no painel.** Use uma janela própria (`assets/confirmar-curso.js`).
- O curso vem da URL da aba ativa (`/courses/(\d+)`), conferindo o domínio (`abaDoCurso()` no modelo). **Leia de novo antes de agir**: a pessoa pode ter trocado de aba.
- Estado persistente fica em `chrome.storage.local`. Com duas janelas, podem existir dois painéis: releia o storage antes de gravar e reaja a `storage.onChanged`, ou eles se sobrescrevem.
- Ao trocar de curso, descarte a lista de módulos e a prévia do curso anterior.

---

## 8. Manifest de referência

Para uma extensão distribuída a outras pessoas, peça o mínimo:

```json
{
  "manifest_version": 3,
  "name": "Ferramentas Canvas",
  "version": "1.0.0",
  "side_panel": { "default_path": "panel.html" },
  "background": { "service_worker": "background.js" },
  "permissions": ["storage", "scripting", "tabs", "sidePanel"],
  "host_permissions": [
    "https://*.instructure.com/*",
    "https://*.instructuremedia.com/*"
  ],
  "content_scripts": [
    {
      "matches": ["https://*.instructure.com/courses/*"],
      "js": ["canvas-botao.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://*.instructure.com/courses/*"],
      "js": ["canvas-editor.js"],
      "run_at": "document_idle",
      "world": "MAIN"
    }
  ]
}
```

- Acrescente o domínio próprio do Canvas da instituição, se houver, e o do H5P (`https://<instituicao>.h5p.com/*`) só se a extensão falar com ele.
- `offscreen`, `downloads`, `contextMenus`, `clipboardRead` e `alarms` entram só quando forem usadas.
- `<all_urls>` facilita uma ferramenta interna que também age fora do Canvas, mas amplia o estrago de um bug ou de uma página maliciosa. Numa versão distribuída, troque pelos domínios exatos (ou por `optional_host_permissions`, pedidas na hora).
- Ferramentas de desenvolvimento (gravadores de rede, botões de diagnóstico) ficam **fora** da pasta da extensão, para não irem junto no pacote.
- Suba `version` a cada entrega: é como a equipe sabe se está com a versão nova.

---

## 9. Estilo de código que funcionou

- **JS puro, sem build**, carregado "sem compactação": fácil de revisar, de depurar e de passar para outra pessoa. Projetos com React + TypeScript + Vite também funcionam, mas trocar código entre os dois estilos é reescrever.
- **Regra pura separada da interface.** A regra (ex.: "que vídeos mudam de tamanho nesta página", "onde entra o quiz") fica num arquivo próprio, sem DOM da tela, que se testa em Node ou com `DOMParser`. A interface só chama.
- **Módulos compartilhados por `window.__prefixoNome`** nos content scripts e por `globalThis` no service worker.
- **Comentários curtos que explicam o porquê** ("lê de novo: se alguém salvou depois da prévia, vale o conteúdo novo"), em português, como o resto do projeto.
