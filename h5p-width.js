'use strict';

// Regra da largura do H5P (100%), compartilhada pelo menu "Redimensionar H5P"
// (o background.js injeta este arquivo antes do h5pResizeMain) e pelo botão do
// quiz (canvas-h5p.js, que o carrega como content script). Roda no mundo MAIN
// da página e fica em window.__svcH5pWidth. Só muda o quiz da caixa logo
// depois da faixa "Atividade de Fixação Não Pontuada"; os outros H5P da página
// (imagens, carrosséis no corpo do tópico) ficam como estão. Só os atributos
// width e style desse iframe são reescritos; o resto do texto fica byte a byte
// igual. Regressão: .claude/skills/h5p-quiz/scripts/test-h5p.js
window.__svcH5pWidth = (() => {
  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();

  // A caixa do quiz: a div logo depois da faixa — a div mais interna cujo
  // texto começa com "Atividade de Fixação". Tem que haver uma faixa só.
  // Serve tanto para o body do TinyMCE quanto para o HTML lido no DOMParser.
  function quizBox(root) {
    const isBand = d => norm(d.textContent).startsWith('atividade de fixacao');
    const bands  = [...root.querySelectorAll('div')].filter(d => isBand(d) && ![...d.querySelectorAll('div')].some(isBand));
    if (bands.length !== 1) {
      return { error: bands.length
        ? `Achei ${bands.length} faixas "Atividade de Fixação" nesta página — deve haver só uma.`
        : 'Não achei a faixa "Atividade de Fixação Não Pontuada" nesta página.' };
    }
    const box = bands[0].nextElementSibling;
    if (!box || box.tagName !== 'DIV') return { error: 'Não achei a caixa logo abaixo da faixa "Atividade de Fixação".' };
    return { box };
  }

  // Põe width: 100% no style, no lugar da largura que houver (max-width e
  // min-width ficam). Devolve o mesmo texto se já estiver em 100%.
  function fullWidthStyle(style) {
    let found = false;
    const out = style.replace(/(^|;)(\s*)width\s*:([^;]*)/gi, (m, sep, ws, val) => {
      found = true;
      return val.trim() === '100%' ? m : `${sep}${ws}width: 100%`;
    });
    if (found) return out;
    const base = style.trim();
    return base ? base.replace(/;?\s*$/, '; ') + 'width: 100%;' : 'width: 100%;';
  }

  // Ajusta uma tag <iframe ...>; devolve null se o iframe não é do H5P.
  function patchTag(tag) {
    const attrs  = {};
    const attrRe = /([^\s=\/>"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>"']+))?/g;
    attrRe.lastIndex = '<iframe'.length;
    let a;
    while ((a = attrRe.exec(tag))) {
      const name = a[1].toLowerCase();
      if (name in attrs) continue;
      const raw = a[2] || '';
      const q   = raw[0] === '"' || raw[0] === "'" ? raw[0] : '';
      attrs[name] = { from: a.index, to: a.index + a[0].length, q, value: q ? raw.slice(1, -1) : raw };
    }
    if (!/h5p/i.test(attrs.src?.value || '')) return null;

    const edits = [];
    if (attrs.width && attrs.width.value.trim() !== '100%') {
      edits.push({ from: attrs.width.from, to: attrs.width.to, insert: 'width="100%"' });
    }
    if (attrs.style) {
      const style = fullWidthStyle(attrs.style.value);
      if (style !== attrs.style.value) {
        const q = attrs.style.q || '"';
        edits.push({ from: attrs.style.from, to: attrs.style.to, insert: `style=${q}${style}${q}` });
      }
    } else {
      const at = tag.length - (tag.endsWith('/>') ? 2 : 1);
      edits.push({ from: at, to: at, insert: ' style="width: 100%;"' });
    }
    let out = tag;
    for (const e of edits.sort((x, y) => y.from - x.from)) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
    return out;
  }

  // Edições { from, to, insert } que põem em 100% o H5P da caixa do quiz.
  // found = H5P na caixa; others = H5P fora dela, que não mudam. Para saber
  // onde cada tag do texto fica, as tags são casadas, na ordem, com os iframes
  // do DOMParser (conferindo o src); se não baterem, nada muda.
  function h5pEdits(html) {
    const res  = { found: 0, others: 0, edits: [] };
    const doc  = new DOMParser().parseFromString(html, 'text/html');
    const tags = [...html.matchAll(/<!--[\s\S]*?-->|<iframe\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)]
      .filter(m => !m[0].startsWith('<!--'));
    const frames = [...doc.querySelectorAll('iframe')];
    const where  = quizBox(doc.body);
    const srcOf  = tag => new DOMParser().parseFromString(tag, 'text/html').querySelector('iframe')?.getAttribute('src');

    for (let i = 0; i < tags.length; i++) {
      const m   = tags[i];
      const out = patchTag(m[0]);
      if (out === null) continue;
      if (tags.length !== frames.length || frames[i].getAttribute('src') !== srcOf(m[0])) {
        return { found: 0, others: 0, edits: [], error: 'Não consegui localizar os iframes da página com segurança.' };
      }
      if (where.error || !where.box.contains(frames[i])) { res.others++; continue; }
      res.found++;
      if (out !== m[0]) res.edits.push({ from: m.index, to: m.index + m[0].length, insert: out });
    }
    // Sem faixa só é erro se houver H5P — senão a página só não tem H5P.
    if (where.error && res.others) res.error = where.error;
    return res;
  }

  function applyEdits(text, edits) {
    let out = text;
    for (const e of [...edits].reverse()) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
    return out;
  }

  return { h5pEdits, applyEdits, quizBox };
})();
