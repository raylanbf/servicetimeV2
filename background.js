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

chrome.runtime.onInstalled.addListener(() => {
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
    id: 'resize-videos',
    title: '📐 Redimensionar vídeos da página',
    contexts: ['page', 'frame'],
  });
  chrome.contextMenus.create({
    id: 'download-round',
    title: '⭕ Baixar imagem redonda',
    contexts: ['image'],
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
  if (info.menuItemId === 'uppercase-selection') {
    copyClean(tab.id, ['B', 'STRONG', 'I', 'EM', 'A'], true);
  }
  if (info.menuItemId === 'copy-clean') {
    copyClean(tab.id, ['B', 'STRONG', 'I', 'EM', 'A', 'UL', 'OL', 'LI'], false);
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

// ── Upload delegado pelo popup ────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'upload') {
    handleUpload(msg).catch(console.error);
  }
});

async function handleUpload({ webhookUrl, usuario, registros }) {
  try {
    const res  = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify({ usuario, registros }),
    });
    let json = {};
    try { json = await res.json(); } catch (_) {}

    const saved = await chrome.storage.local.get(['registros']);
    let updatedRegistros;

    if (Array.isArray(json.escritos)) {
      // Script novo: marca apenas os que foram gravados (por _id)
      const escritos = new Set(json.escritos);
      updatedRegistros = (saved.registros || []).map(r =>
        r._id && escritos.has(r._id) ? { ...r, enviado: true } : r
      );
    } else {
      // Script antigo ou sem retorno estruturado: marca todos os enviados
      const sentIds = new Set(registros.map(r => r._id).filter(Boolean));
      updatedRegistros = (saved.registros || []).map(r =>
        r._id && sentIds.has(r._id) ? { ...r, enviado: true } : r
      );
    }

    await chrome.storage.local.set({
      uploading:    false,
      uploadResult: { ok: true, editados: json.editados || registros.length, naoEncontrados: json.nao_encontrados || 0 },
      registros:    updatedRegistros,
    });
  } catch (err) {
    await chrome.storage.local.set({
      uploading:    false,
      uploadResult: { ok: false, erro: err.message },
    });
  }
}
