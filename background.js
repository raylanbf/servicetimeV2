'use strict';

function makeIconData(state, size) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const colors = { inactive: '#ef4444', running: '#4ade80', paused: '#f97316' };
  const color = colors[state] || colors.inactive;
  const r = size / 2;

  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(r, r, r - 1, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.fillStyle = state === 'running' ? '#000' : '#fff';
  ctx.font = `bold ${Math.round(size * 0.55)}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('S', r, r + Math.round(size * 0.05));

  return ctx.getImageData(0, 0, size, size);
}

function applyIcon(state) {
  chrome.action.setIcon({
    imageData: {
      16:  makeIconData(state, 16),
      32:  makeIconData(state, 32),
      48:  makeIconData(state, 48),
      128: makeIconData(state, 128),
    }
  });
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
          const el = document.createElement(node.tagName.toLowerCase());
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
        // Espaço após pontuação colada diretamente antes de letra ou dígito
        text = text.replace(/([,;:.!?])([^\s])/g, '$1 $2');
        text = text.replace(/ {2,}/g, ' ');
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

chrome.runtime.onInstalled.addListener(() => {
  refreshIcon();
  chrome.contextMenus.create({
    id: 'uppercase-selection',
    title: 'Copiar em CAIXA ALTA',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'copy-clean',
    title: 'Copiar texto limpo (negrito, itálico e links)',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'copy-essential',
    title: 'Copiar texto essencial (negrito, itálico e listas)',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'resize-videos',
    title: 'Redimensionar vídeos da página',
    contexts: ['page', 'frame'],
  });
  chrome.contextMenus.create({
    id: 'download-round',
    title: 'Baixar imagem redonda',
    contexts: ['image'],
  });
});
chrome.runtime.onStartup.addListener(refreshIcon);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'uppercase-selection') {
    copyClean(tab.id, ['B', 'STRONG', 'I', 'EM', 'A'], true);
  }
  if (info.menuItemId === 'copy-clean') {
    copyClean(tab.id, ['B', 'STRONG', 'I', 'EM', 'A'], false);
  }
  if (info.menuItemId === 'copy-essential') {
    copyClean(tab.id, ['B', 'STRONG', 'I', 'EM', 'UL', 'OL', 'LI'], false);
  }
  if (info.menuItemId === 'download-round') {
    (async () => {
      try {
        const response = await fetch(info.srcUrl);
        const blob     = await response.blob();
        const bitmap   = await createImageBitmap(blob);

        // Recorta quadrado central e aplica clip circular
        const size   = Math.min(bitmap.width, bitmap.height);
        const canvas = new OffscreenCanvas(size, size);
        const ctx    = canvas.getContext('2d');

        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.clip();

        const sx = (bitmap.width  - size) / 2;
        const sy = (bitmap.height - size) / 2;
        ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, size, size);

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

  if (info.menuItemId === 'resize-videos') {
    chrome.storage.local.get({ video_width: 620, video_height: 398 }, ({ video_width, video_height }) => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (w, h) => {
          let count = 0;

          // Substitui width/height apenas em tags <iframe> com allowfullscreen e dimensões numéricas
          function patchHtml(html) {
            return html.replace(/<iframe[^>]+>/gi, tag => {
              if (!/allowfullscreen/i.test(tag))         return tag;
              if (!/\bwidth=["']?\d+["']?/i.test(tag))  return tag;
              if (!/\bheight=["']?\d+["']?/i.test(tag)) return tag;
              const patched = tag
                .replace(/\bwidth=["']?\d+["']?/i,  `width="${w}"`)
                .replace(/\bheight=["']?\d+["']?/i, `height="${h}"`);
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
