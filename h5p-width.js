'use strict';

// Regra da largura do H5P (100%), compartilhada pelo menu "Redimensionar H5P"
// (o background.js injeta este arquivo antes do h5pResizeMain) e pelo botão do
// quiz (canvas-h5p.js, que o carrega como content script). Roda no mundo MAIN
// da página e fica em window.__svcH5pWidth. Só os atributos width e style dos
// iframes do H5P — reconhecidos pelo src — são reescritos; o resto do texto
// fica byte a byte igual. Regressão: .claude/skills/h5p-quiz/scripts/test-h5p.js
window.__svcH5pWidth = (() => {
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

  // Edições { from, to, insert } que põem os iframes do H5P do texto em 100%.
  function h5pEdits(html) {
    const edits = [];
    let found = 0;
    for (const m of html.matchAll(/<iframe\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
      const out = patchTag(m[0]);
      if (out === null) continue;
      found++;
      if (out !== m[0]) edits.push({ from: m.index, to: m.index + m[0].length, insert: out });
    }
    return { found, edits };
  }

  function applyEdits(text, edits) {
    let out = text;
    for (const e of [...edits].reverse()) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
    return out;
  }

  return { h5pEdits, applyEdits };
})();
