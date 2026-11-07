'use strict';

// Editor da capa de vídeo: abre pelo menu de contexto "Criar capa de vídeo
// com o texto" (o background.js passa o texto selecionado em ?text=) ou pelo
// painel. Desenha o template escolhido (thumb-templates.js) num canvas
// 1920×1080 com o texto centralizado na moldura — quebrando em linhas e
// diminuindo a letra até caber — e baixa ou copia o PNG.
(() => {
  const $ = id => document.getElementById(id);
  const TEMPLATES = window.THUMB_TEMPLATES || [];
  const canvas = $('thumb-canvas');
  const ctx    = canvas.getContext('2d');
  const images = {};          // id → Image carregada
  let current  = TEMPLATES[0];

  const status = (msg, color) => { $('thumb-status').textContent = msg || ''; $('thumb-status').style.color = color || '#94a3b8'; };

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload  = () => resolve(im);
      im.onerror = () => reject(new Error('Não consegui abrir a imagem ' + src));
      im.src = src;
    });
  }

  // Linhas digitadas, sem espaços repetidos nem linhas vazias.
  const textLines = () => $('thumb-text').value.split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

  // Quebra cada linha digitada em linhas que cabem em maxW (quebra simples,
  // como nos editores de imagem: vai enchendo a linha até a próxima palavra
  // não caber).
  function wrap(lines, maxW) {
    const out = [];
    for (const line of lines) {
      const words = line.split(' ');
      let cur = words[0];
      for (const w of words.slice(1)) {
        const test = cur + ' ' + w;
        if (ctx.measureText(test).width <= maxW) cur = test;
        else { out.push(cur); cur = w; }
      }
      out.push(cur);
    }
    return out;
  }

  // Maior letra (até o máximo do template) em que o texto cabe na caixa. A
  // altura vai do topo das maiúsculas da 1ª linha até as pernas (g, p, j) da
  // última — é o que precisa caber.
  function layout(lines, t) {
    const fontAt = s => `${t.weight} ${s}px "${t.font}"`;
    const measure = size => {
      ctx.font = fontAt(size);
      const wrapped = wrap(lines, t.box.w);
      const capH    = ctx.measureText('H').actualBoundingBoxAscent;
      const desc    = ctx.measureText('gjpq').actualBoundingBoxDescent;
      const lh      = size * t.lineHeight;
      const widest  = Math.max(0, ...wrapped.map(l => ctx.measureText(l).width));
      const height  = capH + (wrapped.length - 1) * lh + desc;
      return { size, lines: wrapped, capH, lh, fits: widest <= t.box.w && height <= t.box.h };
    };
    for (let size = t.maxSize; size > t.minSize; size--) {
      const m = measure(size);
      if (m.fits) return m;
    }
    return measure(t.minSize);
  }

  function draw() {
    const t  = current;
    const im = images[t.id];
    if (!im) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(im, 0, 0, canvas.width, canvas.height);

    const lines = textLines();
    const has   = lines.length > 0;
    $('btn-thumb-download').disabled = !has;
    $('btn-thumb-copy').disabled     = !has;
    if (!has) {
      window.__thumbState = { template: t.id, lines: [], size: 0, fits: true };
      $('thumb-size').textContent = '';
      $('thumb-warn').style.display = 'none';
      return;
    }

    const L = layout(lines, t);
    ctx.font         = `${t.weight} ${L.size}px "${t.font}"`;
    ctx.fillStyle    = t.color;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';
    // Centraliza o bloco pela altura das letras (maiúsculas até a última
    // linha de base), que é o que o olho vê como texto.
    const blockH = L.capH + (L.lines.length - 1) * L.lh;
    const top    = t.box.y + (t.box.h - blockH) / 2;
    const cx     = t.box.x + t.box.w / 2;
    L.lines.forEach((line, i) => ctx.fillText(line, cx, top + L.capH + i * L.lh));

    window.__thumbState = { template: t.id, lines: L.lines, size: L.size, fits: L.fits };
    $('thumb-size').textContent = `Letra: ${L.size} px · ${L.lines.length} linha(s)`;
    const warn = $('thumb-warn');
    warn.textContent = '⚠ O texto é longo demais para a moldura, mesmo com a menor letra — encurte o texto.';
    warn.style.display = L.fits ? 'none' : 'block';
  }

  function buildTemplates() {
    const box = $('thumb-templates');
    box.innerHTML = '';
    for (const t of TEMPLATES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'th-tpl' + (t.id === current.id ? ' selected' : '');
      b.dataset.id = t.id;
      const img = document.createElement('img');
      img.src = t.image;
      img.alt = '';
      const name = document.createElement('span');
      name.textContent = t.name;
      b.append(img, name);
      b.addEventListener('click', () => {
        current = t;
        chrome.storage.local.set({ thumbTemplate: t.id });
        buildTemplates();
        draw();
      });
      box.appendChild(b);
    }
  }

  // Nome do arquivo: o próprio texto, sem caracteres que o Windows recusa.
  function fileName() {
    const base = textLines().join(' ').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90).trim();
    return (base || 'capa') + '.png';
  }

  const toBlob = () => new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

  async function download() {
    const blob = await toBlob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    status('✓ Capa baixada: ' + a.download, '#4ade80');
  }

  async function copy() {
    try {
      const blob = await toBlob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      status('✓ Imagem copiada — é só colar.', '#4ade80');
    } catch (err) {
      status('✗ Não consegui copiar: ' + err.message, '#f87171');
    }
  }

  async function init() {
    if (!TEMPLATES.length) { status('✗ Nenhum template cadastrado.', '#f87171'); return; }
    // Texto selecionado na página: as quebras vêm do layout da página, não
    // são de propósito — vira uma linha só.
    const params = new URLSearchParams(location.search);
    $('thumb-text').value = (params.get('text') || '').replace(/\s+/g, ' ').trim();

    const saved = await chrome.storage.local.get('thumbTemplate');
    current = TEMPLATES.find(t => t.id === saved.thumbTemplate) || TEMPLATES[0];
    buildTemplates();

    try {
      const loaded = await Promise.all(TEMPLATES.map(t => loadImage(t.image)));
      TEMPLATES.forEach((t, i) => { images[t.id] = loaded[i]; });
      // O canvas só usa a fonte depois de carregada.
      await Promise.all([...new Set(TEMPLATES.map(t => `${t.weight} 100px "${t.font}"`))].map(f => document.fonts.load(f)));
    } catch (err) {
      status('✗ ' + err.message, '#f87171');
      return;
    }

    $('thumb-text').addEventListener('input', draw);
    $('btn-thumb-clear').addEventListener('click', () => { $('thumb-text').value = ''; draw(); $('thumb-text').focus(); });
    $('btn-thumb-download').addEventListener('click', download);
    $('btn-thumb-copy').addEventListener('click', copy);
    draw();
    $('thumb-text').focus();
    window.__thumbReady = true;
  }

  init();
})();
