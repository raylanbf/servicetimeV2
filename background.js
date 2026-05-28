'use strict';

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
        if (BLOCK.has(tag)) {
          const p = document.createElement('p');
          p.setAttribute('style', `color:${COLOR}`);
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
      const INLINE_NAMES = new Set(['BR', 'STRONG', 'B', 'EM', 'I']);

      function flushBuf() {
        if (!buf.length) return;
        const hasText = buf.some(n => n.nodeType === 3 && n.textContent.trim());
        if (hasText) {
          const p = document.createElement('p');
          p.setAttribute('style', `color:${COLOR}`);
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

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  refreshIcon();
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
});
chrome.runtime.onStartup.addListener(refreshIcon);

// Pausa automaticamente quando todas as janelas do Chrome são fechadas
chrome.windows.onRemoved.addListener(async () => {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal', 'popup'] });
  if (windows.length > 0) return;

  const data = await chrome.storage.local.get(['running', 'paused', 'accMs', 'startTs', 'currentRecord']);
  if (!data.running || data.paused) return;

  const newAcc   = (data.accMs || 0) + (Date.now() - (data.startTs || Date.now()));
  const pausaHMS = new Date().toTimeString().slice(0, 8);
  const pausas   = [...(data.currentRecord?.pausas || []), { pausa: pausaHMS }];

  await chrome.storage.local.set({
    paused:        true,
    accMs:         newAcc,
    startTs:       null,
    currentRecord: { ...data.currentRecord, pausas },
  });
});

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
      func: () => {
        document.getElementById('__svc-fr__')?.remove();

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
          width: '340px', boxShadow: '0 4px 24px rgba(0,0,0,.7)',
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

        function mkInput() {
          const el = document.createElement('input');
          Object.assign(el.style, {
            display: 'block', width: '100%', padding: '6px 8px',
            borderRadius: '4px', border: '1px solid #3a3a5e',
            background: '#2a2a3e', color: '#e2e8f0', fontSize: '13px',
            marginBottom: '10px', boxSizing: 'border-box', outline: 'none',
          });
          return el;
        }

        const title = document.createElement('p');
        title.textContent = '🔍 Localizar e substituir';
        Object.assign(title.style, { fontWeight: 'bold', fontSize: '14px', marginBottom: '14px' });

        const inputFind    = mkInput();
        const inputReplace = mkInput();
        inputReplace.style.marginBottom = '10px';

        const modeRow = document.createElement('div');
        Object.assign(modeRow.style, {
          display: 'flex', gap: '16px', marginBottom: '14px',
          fontSize: '12px', color: '#cbd5e1', alignItems: 'center',
        });

        function mkRadio(labelText, val, checked) {
          const wrap = document.createElement('label');
          Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' });
          const r = document.createElement('input');
          r.type = 'radio'; r.name = '__svc-mode__'; r.value = val; r.checked = checked;
          Object.assign(r.style, { accentColor: '#4ade80', cursor: 'pointer' });
          wrap.appendChild(r);
          wrap.appendChild(document.createTextNode(labelText));
          return { wrap, radio: r };
        }

        const { wrap: wAll,   radio: rAll }  = mkRadio('Substituir todos',   'all',   true);
        const { wrap: wFirst, radio: rFirst } = mkRadio('Apenas o primeiro', 'first', false);
        modeRow.appendChild(wAll);
        modeRow.appendChild(wFirst);

        const result = document.createElement('p');
        Object.assign(result.style, {
          fontSize: '11px', minHeight: '15px', marginBottom: '12px', color: '#94a3b8',
        });

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

        btnCancel.onclick = () => overlay.remove();
        overlay.onclick   = (e) => { if (e.target === overlay) overlay.remove(); };

        btnDo.onclick = () => {
          const find    = inputFind.value;
          const replace = inputReplace.value;
          if (!find) {
            result.textContent = 'Informe o texto a localizar.';
            result.style.color = '#f87171';
            return;
          }
          const replaceAll = rAll.checked;
          let totalReplaced = 0;

          document.querySelectorAll('textarea').forEach(ta => {
            if (!ta.value.includes(find)) return;
            let updated;
            if (replaceAll) {
              let count = 0, pos = 0;
              while ((pos = ta.value.indexOf(find, pos)) !== -1) { count++; pos += find.length; }
              totalReplaced += count;
              updated = ta.value.split(find).join(replace);
            } else {
              const idx = ta.value.indexOf(find);
              if (idx === -1) return;
              totalReplaced += 1;
              updated = ta.value.slice(0, idx) + replace + ta.value.slice(idx + find.length);
            }
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, updated);
            ta.dispatchEvent(new Event('input',  { bubbles: true }));
            ta.dispatchEvent(new Event('change', { bubbles: true }));
          });

          if (totalReplaced > 0) {
            result.style.color = '#4ade80';
            result.textContent = `✓ ${totalReplaced} substituição(ões) feita(s).`;
          } else {
            result.style.color = '#f87171';
            result.textContent = 'Texto não encontrado em nenhuma textarea.';
          }
        };

        [inputFind, inputReplace].forEach(el => {
          el.addEventListener('keydown', e => { if (e.key === 'Enter') btnDo.click(); });
        });

        btnRow.appendChild(btnCancel);
        btnRow.appendChild(btnDo);
        box.appendChild(title);
        box.appendChild(mkLabel('Localizar'));
        box.appendChild(inputFind);
        box.appendChild(mkLabel('Substituir por'));
        box.appendChild(inputReplace);
        box.appendChild(modeRow);
        box.appendChild(result);
        box.appendChild(btnRow);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        inputFind.focus();
      },
    });
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
  if ('running' in changes || 'paused' in changes) refreshIcon();
});

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
    if (!openrouter_key) throw new Error('Configure a chave API OpenRouter em ⚙ Configurações');

    const { base64, mimeType } = await fetchImageAsBase64(info.srcUrl);

    const isOpenRouter = openrouter_key.startsWith('sk-or-');
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

    if (!res.ok) throw new Error(`OpenRouter: erro ${res.status}`);
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
