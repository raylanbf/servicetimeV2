'use strict';

const HEARTBEAT_PERIOD_MIN = 0.5;        // 30s — prova de vida do timer em andamento
const STALE_GAP_MS         = 150 * 1000; // >150s sem prova de vida = navegador fechado / PC desligado ou dormindo

async function applyIcon(state) {
  const colors = { inactive: '#ef4444', running: '#4ade80', paused: '#f97316' };
  const color  = colors[state] || colors.inactive;
  const sizes  = [16, 32, 48, 128];
  const imageData = {};

  for (const size of sizes) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx    = canvas.getContext('2d');

    // Desenha o logo GAV como base
    const url    = chrome.runtime.getURL(`icons/icon${size}.png`);
    const blob   = await fetch(url).then(r => r.blob());
    const bitmap = await createImageBitmap(blob);
    ctx.drawImage(bitmap, 0, 0, size, size);

    // Indicador de estado: círculo colorido no canto inferior direito
    const r = Math.max(2, Math.round(size * 0.14));
    const x = size - r - 1;
    const y = size - r - 1;

    // Borda branca para destacar sobre o logo
    ctx.beginPath();
    ctx.arc(x, y, r + 1, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Círculo colorido
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    imageData[size] = ctx.getImageData(0, 0, size, size);
  }

  chrome.action.setIcon({ imageData });
}

function refreshIcon() {
  chrome.storage.local.get(['running', 'paused'], (data) => {
    if (data.running && data.paused) applyIcon('paused');
    else if (data.running)           applyIcon('running');
    else                             applyIcon('inactive');
  });
}

// Injeta script na página que limpa o HTML da seleção e copia para a área de transferência.
// allowed: tags HTML permitidas (ex: ['B', 'STRONG', 'I', 'EM', 'A'])
// uppercase: converte o texto para maiúsculas
function copyClean(tabId, allowed, uppercase) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: (allowed, uppercase) => {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || sel.isCollapsed) return;

      // Elementos de bloco que geram quebra de parágrafo ao serem limpos
      const BLOCK = new Set(['P','DIV','H1','H2','H3','H4','H5','H6',
        'LI','BLOCKQUOTE','PRE','SECTION','ARTICLE','HEADER','FOOTER','MAIN','TR']);

      function clean(node) {
        if (node.nodeType === 3) {
          const t = node.cloneNode();
          t.textContent = t.textContent
            .replace(/ /g, ' ')
            .replace(/ {2,}/g, ' ');
          if (uppercase) t.textContent = t.textContent.toUpperCase();
          return t;
        }
        if (node.nodeType !== 1) return document.createDocumentFragment();

        // <br> preservado sempre para manter quebras simples de linha
        if (node.tagName === 'BR') return document.createElement('br');

        const frag = document.createDocumentFragment();
        node.childNodes.forEach(child => frag.appendChild(clean(child)));

        if (allowed.includes(node.tagName)) {
          const el = document.createElement(node.tagName === 'OL' ? 'ul' : node.tagName.toLowerCase());
          if (node.tagName === 'A') {
            const href = node.getAttribute('href');
            if (href) el.setAttribute('href', href);
          }
          el.appendChild(frag);
          return el;
        }

        // Elementos de bloco viram <p> para preservar as quebras de linha
        if (BLOCK.has(node.tagName)) {
          const p = document.createElement('p');
          p.appendChild(frag);
          return p;
        }

        return frag;
      }

      const fragment = sel.getRangeAt(0).cloneContents();
      const wrapper = document.createElement('div');
      fragment.childNodes.forEach(child => wrapper.appendChild(clean(child)));

      // Correções aplicadas APENAS no texto entre tags — nunca dentro de atributos
      let cleanHtml = wrapper.innerHTML.replace(/>([^<]+)</g, (_, text) => {
        text = text.replace(/ /g, ' ');
        // Espaço após vírgula, ponto-e-vírgula, !, ?
        text = text.replace(/([,;!?])([^\s])/g, "$1 $2");
        // Dois-pontos: só adiciona espaço se NÃO for :// (URL)
        text = text.replace(/:(?!\/\/)([^\s])/g, ": $1");
        // Ponto: só antes de maiúscula (início de frase, não domínio)
        text = text.replace(/\.([A-ZÁÉÍÓÚÀÂÊÔÃÕÜ])/g, ". $1");
        text = text.replace(/ {2,}/g, " ");
        return `>${text}<`;
      });

      const plainText = uppercase ? sel.toString().toUpperCase() : sel.toString();

      const el = document.createElement('textarea');
      el.value = plainText;
      el.style.cssText = 'position:fixed;top:-9999px;opacity:0';
      document.body.appendChild(el);
      el.select();

      document.addEventListener('copy', function handler(e) {
        e.preventDefault();
        e.clipboardData.setData('text/html', cleanHtml);
        e.clipboardData.setData('text/plain', plainText);
        document.removeEventListener('copy', handler, true);
      }, true);

      document.execCommand('copy');
      el.remove();
    },
    args: [allowed, uppercase],
  });
}

// ── Copia Inteligente ─────────────────────────────────────────────────
function copySmartClean(tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || sel.isCollapsed) return;

      // Corrige mojibake (UTF-8 interpretado como Latin-1): JoÃ£o → João
      function fixMojibake(str) {
        if (!/[\xC0-\xFF]/.test(str)) return str;
        if ([...str].some(c => c.charCodeAt(0) > 0xFF)) return str;
        try {
          const bytes = new Uint8Array([...str].map(c => c.charCodeAt(0)));
          return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch { return str; }
      }

      const INLINE = new Set(['STRONG', 'B', 'EM', 'I']);
      const BLOCK  = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
                              'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE',
                              'HEADER', 'FOOTER', 'MAIN', 'TD', 'TH', 'TR']);
      const STRIP  = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG',
                              'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT',
                              'BUTTON', 'SELECT', 'TEXTAREA', 'NAV', 'ASIDE']);
      const COLOR  = '#333333';

      function cleanNode(node) {
        if (node.nodeType === 3) {
          let text = node.textContent
            .replace(/ /g, ' ')
            .replace(/[​‌‍﻿]/g, '')
            .replace(/ {2,}/g, ' ');
          text = fixMojibake(text);
          return text ? document.createTextNode(text) : null;
        }
        if (node.nodeType !== 1) return null;

        const tag = node.tagName;
        if (STRIP.has(tag)) return null;

        try {
          const cs = window.getComputedStyle(node);
          if (cs.display === 'none' || cs.visibility === 'hidden') return null;
        } catch {}

        const frag = document.createDocumentFragment();
        node.childNodes.forEach(child => {
          const c = cleanNode(child);
          if (c) frag.appendChild(c);
        });

        if (tag === 'BR') return document.createElement('br');

        if (tag === 'OL' || tag === 'UL') {
          const ul = document.createElement('ul');
          ul.setAttribute('style', `color:${COLOR}`);
          ul.appendChild(frag);
          return ul;
        }
        if (tag === 'LI') {
          const li = document.createElement('li');
          li.appendChild(frag);
          return li;
        }
        if (INLINE.has(tag)) {
          const el = document.createElement(tag.toLowerCase());
          el.appendChild(frag);
          return el;
        }
        if (tag === 'A') {
          const href = node.getAttribute('href');
          if (!href) return frag;
          const a = document.createElement('a');
          a.setAttribute('href', href);
          a.appendChild(frag);
          return a;
        }
        if (BLOCK.has(tag)) {
          const p = document.createElement('p');
          p.setAttribute('style', `color:${COLOR};text-align:justify`);
          p.appendChild(frag);
          return p;
        }
        return frag;
      }

      const cloned  = sel.getRangeAt(0).cloneContents();
      const wrapper = document.createElement('div');
      cloned.childNodes.forEach(child => {
        const c = cleanNode(child);
        if (c) wrapper.appendChild(c);
      });

      // Envolve nós inline e texto do topo em <p>
      const out = document.createElement('div');
      let buf   = [];
      const INLINE_NAMES = new Set(['BR', 'STRONG', 'B', 'EM', 'I', 'A']);

      function flushBuf() {
        if (!buf.length) return;
        const hasText = buf.some(n => n.textContent && n.textContent.trim());
        if (hasText) {
          const p = document.createElement('p');
          p.setAttribute('style', `color:${COLOR};text-align:justify`);
          buf.forEach(n => p.appendChild(n));
          out.appendChild(p);
        }
        buf = [];
      }

      wrapper.childNodes.forEach(child => {
        if (child.nodeType === 3 || INLINE_NAMES.has(child.nodeName)) {
          buf.push(child.cloneNode(true));
        } else {
          flushBuf();
          out.appendChild(child.cloneNode(true));
        }
      });
      flushBuf();

      // Remove <p> vazios
      out.querySelectorAll('p').forEach(p => {
        if (!p.textContent.trim() && !p.querySelector('br')) p.remove();
      });

      const cleanHtml = out.innerHTML
        .replace(/<\/p>/g, '</p>\n')
        .replace(/<ul/g, '\n<ul')
        .replace(/<\/ul>/g, '</ul>\n')
        .replace(/<li>/g, '\n<li>')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      const plainText = out.textContent
        .replace(/ {2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (!cleanHtml && !plainText) return;

      const ta = document.createElement('textarea');
      ta.value = plainText;
      ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();

      document.addEventListener('copy', function h(e) {
        e.preventDefault();
        e.clipboardData.setData('text/html',  cleanHtml);
        e.clipboardData.setData('text/plain', plainText);
        document.removeEventListener('copy', h, true);
      }, true);

      document.execCommand('copy');
      ta.remove();

      document.getElementById('__svc-toast__')?.remove();
      const toast = document.createElement('div');
      toast.id    = '__svc-toast__';
      toast.textContent = '✨ Cópia inteligente realizada!';
      Object.assign(toast.style, {
        position: 'fixed', bottom: '24px', right: '24px',
        background: '#1d4ed8', color: '#fff',
        padding: '10px 16px', borderRadius: '6px',
        fontFamily: 'system-ui', fontSize: '13px',
        zIndex: '2147483647', boxShadow: '0 2px 8px rgba(0,0,0,.4)',
      });
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    },
  });
}

// Justifica o parágrafo atual no editor rico do Canvas (TinyMCE).
// Não exige seleção — como os botões nativos de alinhamento, age sobre
// o bloco onde o cursor está.
function justifyText(tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      function showToast(text, bg) {
        document.getElementById('__svc-toast__')?.remove();
        const el = document.createElement('div');
        el.id = '__svc-toast__';
        el.textContent = text;
        Object.assign(el.style, {
          position: 'fixed', bottom: '24px', right: '24px',
          background: bg, color: '#fff',
          padding: '10px 16px', borderRadius: '6px',
          fontFamily: 'system-ui', fontSize: '13px',
          zIndex: '2147483647', boxShadow: '0 2px 8px rgba(0,0,0,.4)',
        });
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3500);
      }

      // Remove qualquer alinhamento (esquerda/centro/direita) herdado —
      // inline style, atributo align legado ou classes de alinhamento comuns
      // (Word, Quill etc.) — para que só reste o justificado.
      function clearAlignment(el) {
        el.style.removeProperty('text-align');
        if (!el.style.length) el.removeAttribute('style');
        el.removeAttribute('align');
        el.classList.remove(
          'text-left', 'text-center', 'text-right', 'text-justify',
          'ql-align-left', 'ql-align-center', 'ql-align-right', 'ql-align-justify'
        );
        if (!el.classList.length) el.removeAttribute('class');
      }

      function forceJustify(root, boundary) {
        clearAlignment(root);
        root.querySelectorAll('[style*="text-align"], [align]').forEach(clearAlignment);

        // Sobe por wrappers (ex: <div><div><p>) que envolvem SÓ este bloco
        // (sem irmãos) e limpa o alinhamento deles também — sem isso, um
        // <div style="text-align:right"> pai continua "vazando" a
        // formatação e o Canvas mostra Direita + Justificado marcados ao
        // mesmo tempo. Para no primeiro ancestral com mais de 1 filho, pra
        // não mexer em conteúdo não selecionado que divida o mesmo container.
        let ancestor = root.parentElement;
        while (ancestor && ancestor !== boundary && ancestor.children.length === 1) {
          clearAlignment(ancestor);
          ancestor = ancestor.parentElement;
        }

        root.style.textAlign = 'justify';
      }

      if (typeof tinymce !== 'undefined' && tinymce.activeEditor) {
        const editor = tinymce.activeEditor;
        const body   = editor.getBody();
        editor.execCommand('JustifyFull');
        editor.selection.getSelectedBlocks().forEach(block => forceJustify(block, body));
        showToast('✓ Texto justificado!', '#1d4ed8');
        return;
      }

      const active = document.activeElement;
      if (active && active.isContentEditable) {
        document.execCommand('justifyFull');

        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          let node = sel.getRangeAt(0).commonAncestorContainer;
          if (node.nodeType === 3) node = node.parentElement;
          const BLOCK_TAGS = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'TD', 'TH'];
          while (node && node !== active && !BLOCK_TAGS.includes(node.tagName)) node = node.parentElement;
          if (node) forceJustify(node, active);
        }

        showToast('✓ Texto justificado!', '#1d4ed8');
        return;
      }

      showToast('⚠ Clique dentro do editor antes de justificar.', '#b45309');
    },
    world: 'MAIN',
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  refreshIcon();
  syncHeartbeatAlarm();
  chrome.contextMenus.create({
    id: 'uppercase-selection',
    title: '🔠 Copiar em CAIXA ALTA',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'copy-clean',
    title: '🧹 Copiar texto limpo',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'smart-copy',
    title: '✨ Copia Inteligente (para editores)',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'resize-videos',
    title: '📐 Redimensionar vídeos da página',
    contexts: ['page', 'frame'],
  });
  chrome.contextMenus.create({
    id: 'convert-formula',
    title: '🔢 Converter fórmula para LaTeX',
    contexts: ['image'],
  });
  chrome.contextMenus.create({
    id: 'download-round',
    title: '⭕ Baixar imagem redonda',
    contexts: ['image'],
  });
  chrome.contextMenus.create({
    id: 'find-replace',
    title: '🔍 Localizar e substituir',
    contexts: ['page', 'frame', 'editable'],
  });
  chrome.contextMenus.create({
    id: 'remove-highlights',
    title: '🖊 Remover destaques da página',
    contexts: ['page', 'frame'],
  });
  chrome.contextMenus.create({
    id: 'add-periods',
    title: '🔤 Adicionar ponto final nas frases',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'justify-text',
    title: '📏 Justificar texto (Canvas)',
    contexts: ['editable'],
  });
});
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'justify-text') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) justifyText(tab.id);
});

chrome.runtime.onStartup.addListener(async () => {
  // Navegador reiniciou com um card "rodando" => foi fechado por desligamento/
  // crash (no fechamento limpo das janelas, windows.onRemoved já suspenderia).
  // Suspende com o último tempo confiável, sem contar o período desligado.
  const data = await chrome.storage.local.get(['running', 'accMs', 'lastAlive', 'startTs', 'currentRecord']);
  if (data.running && data.currentRecord) {
    const hms = new Date(data.lastAlive || data.startTs || Date.now()).toTimeString().slice(0, 8);
    await autoSuspendCurrent(data.accMs || 0, hms);
  }
  refreshIcon();
  syncHeartbeatAlarm();
});

// Suspende automaticamente o card em andamento quando todas as janelas do
// navegador (Chrome/Edge) são fechadas — congelando o tempo no instante atual.
chrome.windows.onRemoved.addListener(async () => {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal', 'popup'] });
  if (windows.length > 0) return;

  const data = await chrome.storage.local.get(['running', 'paused', 'accMs', 'startTs']);
  if (!data.running) return;

  const now = Date.now();
  const ms  = data.paused ? (data.accMs || 0) : (data.accMs || 0) + (now - (data.startTs || now));
  await autoSuspendCurrent(ms, new Date().toTimeString().slice(0, 8));
});

// ── Heartbeat: prova de vida do timer em andamento ───────────────────
// Enquanto um card roda, grava o tempo acumulado a cada HEARTBEAT_PERIOD_MIN.
// Assim, num desligamento abrupto (sem fechamento limpo), o último valor
// confiável já está salvo e o período "morto" não é contado como trabalho.
function syncHeartbeatAlarm() {
  chrome.storage.local.get(['running', 'paused'], ({ running, paused }) => {
    if (running && !paused) chrome.alarms.create('heartbeat', { periodInMinutes: HEARTBEAT_PERIOD_MIN });
    else                    chrome.alarms.clear('heartbeat');
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'heartbeat') return;
  const data = await chrome.storage.local.get(['running', 'paused', 'accMs', 'startTs', 'lastAlive', 'currentRecord']);
  if (!data.running || data.paused || !data.currentRecord) {
    chrome.alarms.clear('heartbeat');
    return;
  }

  const now   = Date.now();
  const delta = now - (data.startTs || now);

  // Buraco grande com o navegador AINDA aberto (PC dormiu/hibernou): descarta o
  // tempo morto e continua rodando. NÃO suspende — só fechar todas as janelas
  // (windows.onRemoved) ou reiniciar o navegador (onStartup) suspende o card.
  if (delta > STALE_GAP_MS) {
    await chrome.storage.local.set({ startTs: now, lastAlive: now });
    return;
  }

  // Prova de vida normal: incorpora o decorrido e avança o marco.
  await chrome.storage.local.set({
    accMs:     (data.accMs || 0) + delta,
    startTs:   now,
    lastAlive: now,
  });
});

// Move o card em andamento para a lista de suspensos, congelando `ms`.
// auto:true => suspensão técnica (desligamento), não marca "CARD SUSPENSO".
async function autoSuspendCurrent(ms, closeHMS) {
  const data = await chrome.storage.local.get(['running', 'currentRecord', 'suspended']);
  if (!data.running || !data.currentRecord) return false;   // idempotente

  const pausas = (data.currentRecord.pausas || []).map((p, i, arr) =>
    i === arr.length - 1 && !p.retorno ? { ...p, retorno: closeHMS } : p
  );
  const entry     = { record: { ...data.currentRecord, pausas }, accMs: ms, auto: true };
  const suspended = [...(data.suspended || []), entry];

  await chrome.storage.local.set({
    running: false, paused: false, startTs: null, accMs: 0,
    currentRecord: null, suspended,
  });
  chrome.alarms.clear('heartbeat');
  return true;
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'convert-formula') {
    convertFormulaToLatex(info, tab).catch(console.error);
  }
  if (info.menuItemId === 'remove-highlights') {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const marks = document.querySelectorAll('.__svc-hl__');
        marks.forEach(mark => {
          const parent = mark.parentNode;
          if (!parent) return;
          while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
          parent.removeChild(mark);
          parent.normalize();
        });
      },
    });
  }
  if (info.menuItemId === 'uppercase-selection') {
    copyClean(tab.id, ['B', 'STRONG', 'I', 'EM', 'A'], true);
  }
  if (info.menuItemId === 'copy-clean') {
    copyClean(tab.id, ['B', 'STRONG', 'I', 'EM', 'A', 'UL', 'OL', 'LI'], false);
  }
  if (info.menuItemId === 'smart-copy') {
    copySmartClean(tab.id);
  }
  if (info.menuItemId === 'justify-text') {
    justifyText(tab.id);
  }
  if (info.menuItemId === 'download-round') {
    (async () => {
      try {
        const response = await fetch(info.srcUrl);
        const blob     = await response.blob();
        const bitmap   = await createImageBitmap(blob);

        // Recorta quadrado central e aplica clip circular em 200x200
        const srcSize = Math.min(bitmap.width, bitmap.height);
        const outSize = 200;
        const canvas  = new OffscreenCanvas(outSize, outSize);
        const ctx     = canvas.getContext('2d');

        ctx.beginPath();
        ctx.arc(outSize / 2, outSize / 2, outSize / 2, 0, Math.PI * 2);
        ctx.clip();

        const sx = (bitmap.width  - srcSize) / 2;
        const sy = (bitmap.height - srcSize) / 2;
        ctx.drawImage(bitmap, sx, sy, srcSize, srcSize, 0, 0, outSize, outSize);

        const png    = await canvas.convertToBlob({ type: 'image/png' });
        const buffer = await png.arrayBuffer();
        const bytes  = new Uint8Array(buffer);

        // Converte para base64 em chunks para evitar estouro de pilha
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }

        // Extrai nome do arquivo da URL original
        const srcName = (info.srcUrl.split('/').pop().split('?')[0] || 'imagem').replace(/\.[^.]+$/, '');

        chrome.downloads.download({
          url:      `data:image/png;base64,${btoa(binary)}`,
          filename: `${srcName}-redondo.png`,
        });
      } catch (err) {
        console.error('Erro ao gerar imagem redonda:', err);
      }
    })();
  }

  if (info.menuItemId === 'find-replace') {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      // MAIN: o editor HTML do Canvas (com numeração de linhas) é um
      // CodeMirror, e a instância dele só existe para o JS da própria página.
      world: 'MAIN',
      func: () => {
        document.getElementById('__svc-fr__')?.remove();

        // ── Onde substituir ──────────────────────────────────────────
        // Só editores VISÍVEIS: o TinyMCE mantém uma <textarea> oculta por
        // trás do modo visual, e mexer nela não aparece nem é salvo.
        function isVisible(el) {
          return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
        }

        // CodeMirror 6 pendura um objeto interno no .cm-content (cmTile nas
        // versões novas, cmView nas antigas) que leva até a EditorView — é o
        // caminho do EditorView.findFromDOM. Varre as propriedades em vez de
        // fixar o nome, que já mudou uma vez.
        function cm6ViewOf(editorEl) {
          const content = editorEl.querySelector('.cm-content');
          const isView  = v => v && v.state && v.state.doc && typeof v.dispatch === 'function';
          for (const key of Object.keys(content || {})) {
            const node = content[key];
            const view = [node?.root?.view, node?.rootView?.view, node?.view].find(isView);
            if (view) return view;
          }
          return null;
        }

        // Cada alvo devolve o texto atual e aplica uma lista de edições
        // { from, to, insert } feitas sobre esse mesmo texto.
        function findTargets() {
          const targets = [];
          let unreachable = false;

          document.querySelectorAll('.cm-editor').forEach(el => {
            if (!isVisible(el)) return;
            const view = cm6ViewOf(el);
            if (!view) { unreachable = true; return; }
            targets.push({
              get:   () => view.state.doc.toString(),
              apply: edits => view.dispatch({ changes: edits }),   // 1 passo de Ctrl+Z
            });
          });

          document.querySelectorAll('.CodeMirror').forEach(el => {
            const cm = el.CodeMirror;
            if (!cm || !isVisible(el)) return;
            targets.push({
              get:   () => cm.getValue(),
              apply: edits => cm.operation(() => {
                for (const e of [...edits].reverse()) {
                  cm.replaceRange(e.insert, cm.posFromIndex(e.from), cm.posFromIndex(e.to));
                }
              }),
            });
          });

          document.querySelectorAll('textarea').forEach(ta => {
            if (!isVisible(ta) || ta.closest('.cm-editor, .CodeMirror, #__svc-fr__')) return;
            targets.push({
              get:   () => ta.value,
              apply: edits => {
                let out = ta.value;
                for (const e of [...edits].reverse()) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
                Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, out);
                ta.dispatchEvent(new Event('input',  { bubbles: true }));
                ta.dispatchEvent(new Event('change', { bubbles: true }));
              },
            });
          });

          return { targets, unreachable };
        }

        // ── Modo texto: busca literal ────────────────────────────────
        function textEdits(src, find, repl, firstOnly) {
          const edits = [];
          let pos = 0, at;
          while ((at = src.indexOf(find, pos)) !== -1) {
            edits.push({ from: at, to: at + find.length, insert: repl });
            if (firstOnly) break;
            pos = at + find.length;
          }
          return { edits };
        }

        // ── Modo intervalo: do início até o primeiro fim seguinte ────
        function escRe(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

        // Letras acentuadas podem estar gravadas como caractere (ó) ou como
        // entidade (&oacute;, &#243;) — conteúdo importado costuma vir assim.
        const ACCENT_NAMES = {
          'á': 'aacute', 'à': 'agrave', 'â': 'acirc', 'ã': 'atilde', 'ä': 'auml',
          'é': 'eacute', 'è': 'egrave', 'ê': 'ecirc', 'ë': 'euml',
          'í': 'iacute', 'ì': 'igrave', 'î': 'icirc', 'ï': 'iuml',
          'ó': 'oacute', 'ò': 'ograve', 'ô': 'ocirc', 'õ': 'otilde', 'ö': 'ouml',
          'ú': 'uacute', 'ù': 'ugrave', 'û': 'ucirc', 'ü': 'uuml',
          'ç': 'ccedil', 'ñ': 'ntilde',
        };
        function accentAlt(ch) {
          const cp = ch.codePointAt(0);
          if (cp < 128) return null;
          const lower = ch.toLowerCase();
          const name  = ACCENT_NAMES[lower];
          const alts  = [ch, `&#${cp};`, `&#x${cp.toString(16)};`];
          if (name) alts.push('&' + (ch === lower ? name : name[0].toUpperCase() + name.slice(1)) + ';');
          return '(?:' + alts.join('|') + ')';
        }

        // "&oacute;" no marcador vira "ó", que depois casa as duas formas.
        // Entidades de ASCII (&lt; &amp; …) ficam: no marcador são código.
        function decodeAccents(str) {
          const ta = document.createElement('textarea');
          return str.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, ent => {
            ta.innerHTML = ent;
            const ch = ta.value;
            return ch.length === 1 && ch.charCodeAt(0) > 127 ? ch : ent;
          });
        }

        // O editor HTML reindenta o código: espaços viram "qualquer espaço"
        // e, colados a uma tag, podem até faltar — "</span></p>" casa
        // "</span>\n  </p>".
        const WS_RE = '(?:\\s|&nbsp;|&#160;|&#xA0;|\\u00a0)+';
        function markerToRe(marker) {
          const chars = Array.from(decodeAccents(marker.trim()));
          let out = '';
          for (let i = 0; i < chars.length; i++) {
            const ch = chars[i];
            if (/\s/.test(ch)) {
              let j = i;
              while (j + 1 < chars.length && /\s/.test(chars[j + 1])) j++;
              out += (chars[i - 1] === '>' || chars[j + 1] === '<') ? '\\s*' : WS_RE;
              i = j;
              continue;
            }
            out += accentAlt(ch) || escRe(ch);
            if (ch === '>' && chars[i + 1] === '<') out += '\\s*';
          }
          return out;
        }

        // Tags abertas sem fechar (ou fechadas sem abrir) dentro do trecho.
        const VOID_TAGS = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/;
        function unpairedTags(fragment) {
          const stack = [];
          let stray = 0;
          for (const m of fragment.matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)) {
            const name = m[2].toLowerCase();
            if (VOID_TAGS.test(name) || m[3]) continue;
            if (!m[1]) { stack.push(name); continue; }
            const at = stack.lastIndexOf(name);
            if (at === -1) stray++;
            else stack.length = at;
          }
          return stray + stack.length;
        }

        function rangeEdits(src, startTerm, endTerm, repl, inclusive, firstOnly) {
          const reStart = new RegExp(markerToRe(startTerm), 'gi');
          const reEnd   = new RegExp(markerToRe(endTerm), 'gi');
          const edits   = [];
          let unpaired = 0, orphan = false, s;
          while ((s = reStart.exec(src)) !== null) {
            reEnd.lastIndex = s.index + s[0].length;
            const e = reEnd.exec(src);
            if (!e) { orphan = true; break; }
            const from = inclusive ? s.index : s.index + s[0].length;
            const to   = inclusive ? e.index + e[0].length : e.index;
            edits.push({ from, to, insert: repl });
            if (unpairedTags(src.slice(from, to))) unpaired++;
            if (firstOnly) break;
            reStart.lastIndex = e.index + e[0].length;
          }
          return { edits, unpaired, orphan };
        }

        // ── Painel ───────────────────────────────────────────────────
        const overlay = document.createElement('div');
        overlay.id = '__svc-fr__';
        Object.assign(overlay.style, {
          position: 'fixed', inset: '0',
          background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: '2147483647', fontFamily: 'system-ui, sans-serif',
        });

        const box = document.createElement('div');
        Object.assign(box.style, {
          background: '#1e1e2e', color: '#e2e8f0',
          padding: '18px 20px', borderRadius: '8px',
          width: '420px', maxWidth: 'calc(100vw - 32px)',
          boxShadow: '0 4px 24px rgba(0,0,0,.7)',
        });

        function mkLabel(text) {
          const el = document.createElement('label');
          el.textContent = text;
          Object.assign(el.style, {
            display: 'block', fontSize: '11px', fontWeight: 'bold',
            color: '#94a3b8', marginBottom: '4px',
          });
          return el;
        }

        // <textarea> em vez de <input>: trechos de HTML colados costumam ter
        // várias linhas, e o <input> descartaria as quebras.
        function mkField() {
          const el = document.createElement('textarea');
          el.rows = 2;
          Object.assign(el.style, {
            display: 'block', width: '100%', padding: '6px 8px',
            borderRadius: '4px', border: '1px solid #3a3a5e',
            background: '#2a2a3e', color: '#e2e8f0', fontSize: '12px',
            fontFamily: "'Courier New', monospace", resize: 'vertical',
            marginBottom: '10px', boxSizing: 'border-box', outline: 'none',
          });
          return el;
        }

        function mkRow() {
          const row = document.createElement('div');
          Object.assign(row.style, {
            display: 'flex', gap: '16px', marginBottom: '12px',
            fontSize: '12px', color: '#cbd5e1', alignItems: 'center',
          });
          return row;
        }

        function mkRadio(labelText, group, checked) {
          const wrap = document.createElement('label');
          Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' });
          const r = document.createElement('input');
          r.type = 'radio'; r.name = group; r.checked = checked;
          Object.assign(r.style, { accentColor: '#4ade80', cursor: 'pointer' });
          wrap.appendChild(r);
          wrap.appendChild(document.createTextNode(labelText));
          return { wrap, radio: r };
        }

        const title = document.createElement('p');
        title.textContent = '🔍 Localizar e substituir';
        Object.assign(title.style, { fontWeight: 'bold', fontSize: '14px', marginBottom: '12px' });

        const kindRow = mkRow();
        const { wrap: wText,  radio: rText }  = mkRadio('Texto',                    '__svc-kind__', true);
        const { wrap: wRange, radio: rRange } = mkRadio('Intervalo (início → fim)', '__svc-kind__', false);
        kindRow.appendChild(wText);
        kindRow.appendChild(wRange);

        const labelFind    = mkLabel('Localizar');
        const inputFind    = mkField();
        const endWrap      = document.createElement('div');
        const inputEnd     = mkField();
        endWrap.appendChild(mkLabel('Fim do trecho'));
        endWrap.appendChild(inputEnd);
        const inputReplace = mkField();

        const modeRow = mkRow();
        const { wrap: wAll,   radio: rAll }   = mkRadio('Substituir todos',  '__svc-mode__', true);
        const { wrap: wFirst, radio: rFirst } = mkRadio('Apenas o primeiro', '__svc-mode__', false);
        modeRow.appendChild(wAll);
        modeRow.appendChild(wFirst);

        const inclusiveRow = mkRow();
        const wInclusive   = document.createElement('label');
        Object.assign(wInclusive.style, { display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' });
        const cbInclusive = document.createElement('input');
        cbInclusive.type = 'checkbox'; cbInclusive.checked = true;
        Object.assign(cbInclusive.style, { accentColor: '#4ade80', cursor: 'pointer' });
        wInclusive.appendChild(cbInclusive);
        wInclusive.appendChild(document.createTextNode('Incluir o início e o fim no trecho'));
        inclusiveRow.appendChild(wInclusive);

        const hint = document.createElement('p');
        hint.textContent = 'Procura no código HTML, do início até o primeiro fim depois dele. Espaços e quebras de linha não precisam bater. "Substituir por" vazio apaga o trecho.';
        Object.assign(hint.style, { fontSize: '11px', color: '#64748b', marginBottom: '10px', lineHeight: '1.4' });

        const result = document.createElement('p');
        Object.assign(result.style, {
          fontSize: '11px', minHeight: '15px', marginBottom: '12px', color: '#94a3b8',
        });
        function showResult(msg, color) {
          result.textContent = msg;
          result.style.color = color;
        }

        function syncKind() {
          const isRange = rRange.checked;
          labelFind.textContent      = isRange ? 'Início do trecho' : 'Localizar';
          inputFind.placeholder      = isRange ? 'ex.: <div class="col-xs-12' : '';
          inputEnd.placeholder       = 'ex.: </span></p>';
          inputReplace.placeholder   = isRange ? 'HTML novo (vazio = apagar o trecho)' : '';
          endWrap.style.display      = isRange ? 'block' : 'none';
          inclusiveRow.style.display = isRange ? 'flex' : 'none';
          hint.style.display         = isRange ? 'block' : 'none';
          showResult('', '#94a3b8');
        }
        rText.onchange  = syncKind;
        rRange.onchange = syncKind;

        const btnRow = document.createElement('div');
        Object.assign(btnRow.style, { display: 'flex', gap: '8px' });

        const btnCancel = document.createElement('button');
        btnCancel.textContent = 'Cancelar';
        Object.assign(btnCancel.style, {
          flex: '1', padding: '7px', borderRadius: '4px', border: 'none',
          background: '#2a2a3e', color: '#e2e8f0', cursor: 'pointer', fontSize: '13px',
        });

        const btnDo = document.createElement('button');
        btnDo.textContent = 'Substituir';
        Object.assign(btnDo.style, {
          flex: '1', padding: '7px', borderRadius: '4px', border: 'none',
          background: '#4ade80', color: '#0f172a', cursor: 'pointer',
          fontSize: '13px', fontWeight: 'bold',
        });

        function close() {
          overlay.remove();
          document.removeEventListener('keydown', onEsc, true);
        }
        function onEsc(e) { if (e.key === 'Escape') close(); }
        document.addEventListener('keydown', onEsc, true);
        btnCancel.onclick = close;

        // Só fecha se o clique COMEÇOU no fundo: selecionar texto num campo
        // e soltar o mouse fora da caixa não pode fechar o painel.
        let downOnBackdrop = false;
        overlay.addEventListener('mousedown', e => { downOnBackdrop = e.target === overlay; });
        overlay.addEventListener('click', e => { if (downOnBackdrop && e.target === overlay) close(); });

        btnDo.onclick = () => {
          const isRange   = rRange.checked;
          const find      = inputFind.value;
          const end       = inputEnd.value;
          const replace   = inputReplace.value;
          const firstOnly = rFirst.checked;
          if (isRange ? (!find.trim() || !end.trim()) : !find) {
            showResult(isRange ? 'Informe o início e o fim do trecho.' : 'Informe o texto a localizar.', '#f87171');
            return;
          }

          const { targets, unreachable } = findTargets();
          if (!targets.length) {
            showResult(unreachable
              ? 'Não consegui acessar o editor HTML. Use "Alternar para o editor HTML bruto" e tente de novo.'
              : 'Nenhum campo de texto visível. No Canvas, abra o editor HTML (</>) e tente de novo.', '#f87171');
            return;
          }

          // "Apenas o primeiro" vale para a página toda, não para cada campo.
          let total = 0, unpaired = 0, orphan = false;
          for (const t of targets) {
            const r = isRange
              ? rangeEdits(t.get(), find, end, replace, cbInclusive.checked, firstOnly)
              : textEdits(t.get(), find, replace, firstOnly);
            if (r.orphan) orphan = true;
            if (!r.edits.length) continue;
            t.apply(r.edits);
            total    += r.edits.length;
            unpaired += r.unpaired || 0;
            if (firstOnly) break;
          }

          if (!total) {
            showResult(isRange
              ? (orphan ? 'Início encontrado, mas o fim não aparece depois dele.' : 'Início do trecho não encontrado.')
              : 'Texto não encontrado.', '#f87171');
            return;
          }
          let msg = isRange ? `✓ ${total} trecho(s) substituído(s).` : `✓ ${total} substituição(ões) feita(s).`;
          if (unpaired) msg += ` ⚠ ${unpaired} com tags sem par (ex.: um <div> que abre e não fecha) — confira o layout.`;
          showResult(msg, unpaired ? '#fbbf24' : '#4ade80');
        };

        // Enter executa; Shift+Enter quebra a linha dentro do campo.
        [inputFind, inputEnd, inputReplace].forEach(el => {
          el.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); btnDo.click(); }
          });
        });

        btnRow.appendChild(btnCancel);
        btnRow.appendChild(btnDo);
        box.appendChild(title);
        box.appendChild(kindRow);
        box.appendChild(labelFind);
        box.appendChild(inputFind);
        box.appendChild(endWrap);
        box.appendChild(mkLabel('Substituir por'));
        box.appendChild(inputReplace);
        box.appendChild(modeRow);
        box.appendChild(inclusiveRow);
        box.appendChild(hint);
        box.appendChild(result);
        box.appendChild(btnRow);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        syncKind();
        inputFind.focus();
      },
    });
  }

  if (info.menuItemId === 'add-periods') {
    addPeriods(tab.id, info.frameId ?? 0, info.selectionText || '');
  }

  if (info.menuItemId === 'resize-videos') {
    chrome.storage.local.get({ video_width: 620, video_height: 398 }, ({ video_width, video_height }) => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (w, h) => {
          let count = 0;

          // Substitui dimensões em <iframe> com allowfullscreen (atributos e/ou style inline)
          function patchHtml(html) {
            return html.replace(/<iframe[^>]+>/gi, tag => {
              if (!/allowfullscreen/i.test(tag)) return tag;
              if (/class=["'][^"']*lti-embed/i.test(tag)) return tag;
              const hasAttr  = /\bwidth=["']?\d+["']?/i.test(tag) && /\bheight=["']?\d+["']?/i.test(tag);
              const hasStyle = /width\s*:\s*\d+px/i.test(tag) && /height\s*:\s*\d+px/i.test(tag);
              if (!hasAttr && !hasStyle) return tag;
              let patched = tag;
              if (hasAttr) {
                patched = patched
                  .replace(/\bwidth=["']?\d+["']?/i,  `width="${w}"`)
                  .replace(/\bheight=["']?\d+["']?/i, `height="${h}"`);
              }
              if (hasStyle) {
                patched = patched
                  .replace(/width\s*:\s*\d+px/i,  `width: ${w}px`)
                  .replace(/height\s*:\s*\d+px/i, `height: ${h}px`);
              }
              count++;
              return patched;
            });
          }

          // Editor HTML bruto do Canvas (textarea visível na tela)
          document.querySelectorAll('textarea').forEach(textarea => {
            if (!/<iframe/i.test(textarea.value)) return;
            const updated = patchHtml(textarea.value);
            if (updated === textarea.value) return;
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
              .set.call(textarea, updated);
            textarea.dispatchEvent(new Event('input',  { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
          });

          alert(count
            ? `${count} vídeo(s) redimensionado(s) para ${w}×${h}.`
            : 'Nenhum iframe de vídeo encontrado no editor.'
          );
        },
        args: [video_width, video_height],
      });
    });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('running' in changes || 'paused' in changes) {
    refreshIcon();
    syncHeartbeatAlarm();
  }
});

// ── Adicionar ponto final nas frases ─────────────────────────────────
function addPeriods(tabId, frameId, selectionText) {
  const normalized = selectionText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const processed  = normalized.split('\n').map(line => {
    const trimmed = line.trimEnd();
    if (!trimmed) return line;
    if (/[.!?;:…]$/.test(trimmed)) return line;
    return trimmed + '.' + line.slice(trimmed.length);
  }).join('\n');

  chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    func: (original, processed) => {
      function showToast(text, bg) {
        document.getElementById('__svc-toast__')?.remove();
        const el = document.createElement('div');
        el.id = '__svc-toast__';
        el.textContent = text;
        Object.assign(el.style, {
          position: 'fixed', bottom: '24px', right: '24px',
          background: bg, color: '#fff',
          padding: '10px 16px', borderRadius: '6px',
          fontFamily: 'system-ui', fontSize: '13px',
          zIndex: '2147483647', boxShadow: '0 2px 8px rgba(0,0,0,.4)',
        });
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3500);
      }

      // Encontra o último nó de texto com conteúdo dentro de um elemento
      function lastTextNode(el) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let last = null, node;
        while ((node = walker.nextNode())) {
          if (node.textContent.trim()) last = node;
        }
        return last;
      }

      // Adiciona ponto ao final de um bloco se não tiver pontuação
      function processBlocoHtml(block) {
        const texto = block.textContent.trimEnd();
        if (!texto || /[.!?;:…]$/.test(texto)) return false;
        const node = lastTextNode(block);
        if (!node) return false;
        node.textContent = node.textContent.trimEnd() + '.';
        return true;
      }

      // ── TinyMCE (editor rico do Canvas) ──────────────────────────
      if (typeof tinymce !== 'undefined' && tinymce.activeEditor) {
        const editor = tinymce.activeEditor;
        const html   = editor.selection.getContent({ format: 'html' });
        if (!html.trim()) { showToast('⚠ Nenhum texto selecionado.', '#b45309'); return; }

        const tmp    = document.createElement('div');
        tmp.innerHTML = html;

        const blocos = [...tmp.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, td, th')];
        let modified = false;

        if (blocos.length) {
          blocos.forEach(b => { if (processBlocoHtml(b)) modified = true; });
        } else {
          if (processBlocoHtml(tmp)) modified = true;
        }

        if (!modified) { showToast('✓ Todas as frases já têm pontuação!', '#166534'); return; }
        editor.selection.setContent(tmp.innerHTML);
        showToast('✓ Pontuação adicionada!', '#1d4ed8');
        return;
      }

      // ── Textarea / Input ──────────────────────────────────────────
      if (processed === original) { showToast('✓ Todas as frases já têm pontuação!', '#166534'); return; }

      let replaced = false;
      const fields = [...document.querySelectorAll('textarea, input[type="text"], input:not([type])')];
      for (const field of fields) {
        const start = field.selectionStart;
        const end   = field.selectionEnd;
        if (start === null || end === null || start === end) continue;
        const selected = field.value.slice(start, end).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (selected !== original) continue;
        const proto  = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, field.value.slice(0, start) + processed + field.value.slice(end));
        field.setSelectionRange(start, start + processed.length);
        field.dispatchEvent(new Event('input',  { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        field.focus();
        replaced = true;
        break;
      }

      // ── Contenteditable genérico ──────────────────────────────────
      if (!replaced) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount && !sel.isCollapsed) {
          let editable = sel.anchorNode;
          while (editable && !editable.isContentEditable) editable = editable.parentElement;
          if (editable) {
            const range = sel.getRangeAt(0);
            const frag  = range.cloneContents();
            const tmp   = document.createElement('div');
            tmp.appendChild(frag);
            const blocos = [...tmp.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li')];
            let modified = false;
            if (blocos.length) {
              blocos.forEach(b => { if (processBlocoHtml(b)) modified = true; });
            } else {
              if (processBlocoHtml(tmp)) modified = true;
            }
            if (modified) {
              range.deleteContents();
              range.insertNode(tmp);
              replaced = true;
            }
          }
        }
      }

      showToast(
        replaced ? '✓ Pontuação adicionada!' : '⚠ Selecione o texto dentro de um campo editável.',
        replaced ? '#1d4ed8' : '#b45309'
      );
    },
    args: [normalized, processed],
  });
}

// ── Upload delegado pelo popup ────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'upload') {
    handleUpload(msg).catch(console.error);
  }
});

async function handleUpload({ webhookUrl, usuario, registros }) {
  try {
    const res     = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify({ usuario, registros }),
    });
    const resData = await res.json().catch(() => ({}));

    const saved   = await chrome.storage.local.get(['registros']);
    const sentIds = new Set(registros.map(r => r._id).filter(Boolean));
    const updated = (saved.registros || []).map(r =>
      (r._id && sentIds.has(r._id)) ? { ...r, enviado: true } : r
    );

    await chrome.storage.local.set({
      uploading:    false,
      uploadResult: { ok: true, adicionados: resData.adicionados ?? registros.length },
      registros:    updated,
    });
  } catch (err) {
    await chrome.storage.local.set({ uploading: false, uploadResult: { ok: false, erro: err.message } });
  }
}

// ── Conversor de fórmula para LaTeX ──────────────────────────────────
async function convertFormulaToLatex(info, tab) {
  showFormulaToast(tab.id, 'info', '⏳ Processando fórmula...');
  try {
    const { openrouter_key } = await chrome.storage.local.get(['openrouter_key']);
    if (!openrouter_key) throw new Error('Configure a chave API OpenRouter ou OpenAI em ⚙ Configurações');

    const { base64, mimeType } = await fetchImageAsBase64(info.srcUrl);

    const isOpenRouter = openrouter_key.startsWith('sk-or-');
    const provider = isOpenRouter ? 'OpenRouter' : 'OpenAI';
    const endpoint = isOpenRouter
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';
    const model = isOpenRouter ? 'openai/gpt-4o' : 'gpt-4o';

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${openrouter_key}`,
      },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Analise esta imagem de fórmula matemática e retorne APENAS o código LaTeX, sem explicações, sem marcação de código, sem delimitadores.' },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        }],
      }),
    });

    if (!res.ok) throw new Error(`${provider}: erro ${res.status}`);
    const data  = await res.json();
    const latex = data.choices[0].message.content.trim().replace(/\\large\b/g, '\\Large');

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func:   (text) => navigator.clipboard.writeText(text),
      args:   [latex],
    });

    showFormulaToast(tab.id, 'success', '✓ LaTeX copiado!');
  } catch (err) {
    showFormulaToast(tab.id, 'error', '✗ ' + err.message);
  }
}

function showFormulaToast(tabId, type, message) {
  const bg = { info: '#1e1e2e', success: '#166534', error: '#7f1d1d' };
  chrome.scripting.executeScript({
    target: { tabId },
    func: (msg, color) => {
      document.getElementById('__svc-toast__')?.remove();
      const el = document.createElement('div');
      el.id = '__svc-toast__';
      el.textContent = msg;
      Object.assign(el.style, {
        position: 'fixed', bottom: '24px', right: '24px',
        background: color, color: '#e2e8f0',
        padding: '10px 16px', borderRadius: '6px',
        fontFamily: 'system-ui', fontSize: '13px',
        zIndex: '2147483647', boxShadow: '0 2px 8px rgba(0,0,0,.4)',
      });
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 4000);
    },
    args: [message, bg[type] || bg.info],
  });
}

async function fetchImageAsBase64(url) {
  const response = await fetch(url);
  const blob     = await response.blob();
  const mimeType = blob.type || 'image/png';
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve({ base64: reader.result.split(',')[1], mimeType });
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
