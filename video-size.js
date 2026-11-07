'use strict';

// Regra do "Redimensionar vídeos da página": os vídeos ficam com a largura e a
// altura das Configurações (padrão 620×398). O background.js injeta este
// arquivo (com o editor-access.js) antes do videoResizeMain; roda no mundo
// MAIN e fica em window.__svcVideoSize. Só os atributos width/height e o
// width/height do style dos vídeos são reescritos; o resto do texto fica byte
// a byte igual. Regressão: .claude/skills/h5p-quiz/scripts/test-video.js
window.__svcVideoSize = (() => {
  // Vídeo é reconhecido pelo player no src — não basta ter tela cheia
  // (allowfullscreen): Genially, H5P, apresentações e formulários também têm.
  // O Studio vem como LTI (class="lti-embed"), com data-studio-resizable e o
  // endereço do instructuremedia no src.
  const VIDEO_SRC = new RegExp([
    String.raw`\byoutube(?:-nocookie)?\.com\b`, String.raw`\byoutu\.be\b`, String.raw`\bvimeo\.com\b`,
    String.raw`\binstructuremedia\.com\b`, String.raw`/media_(?:attachments|objects)_iframe\b`,
    String.raw`\bpanopto\.(?:com|eu)\b`, String.raw`\bkaltura\.com\b`, String.raw`\bdailymotion\.com\b`,
    String.raw`\bwistia\.(?:com|net)\b`, String.raw`\bloom\.com\b`, String.raw`\bvidyard\.com\b`,
    String.raw`\bted\.com\b`, String.raw`\bmicrosoftstream\.com\b`, String.raw`\bfacebook\.com/plugins/video`,
  ].join('|'), 'i');

  // Atributos de uma tag <iframe ...>: nome → { from, to, q, value }. Lidos
  // um a um para não confundir width com data-width nem pegar texto de dentro
  // do title ou do src.
  function parseAttrs(tag) {
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
    return attrs;
  }

  // Número em pixels ("720" ou "720px").
  const PX = /^\s*\d+(?:\.\d+)?(?:px)?\s*$/i;
  // Valor de width/height no style — sem pegar min-width, max-width nem
  // line-height.
  const declRe   = prop => new RegExp(`(^|;)(\\s*)${prop}\\s*:([^;]*)`, 'i');
  const declOf   = (style, prop) => style.match(declRe(prop))?.[3].trim();
  const setDecl  = (style, prop, v) => style.replace(declRe(prop), `$1$2${prop}: ${v}`);

  // Ajusta uma tag <iframe ...>; devolve null se não é vídeo com tamanho fixo.
  function patchTag(tag, w, h) {
    const attrs = parseAttrs(tag);
    const video = 'data-studio-resizable' in attrs || /^video$/i.test(attrs['data-media-type']?.value || '') ||
      VIDEO_SRC.test(attrs.src?.value || '');
    if (!video) return null;

    // Largura ou altura em % (vídeo responsivo), no style ou no atributo:
    // o vídeo fica como está.
    const style = attrs.style?.value || '';
    const sw = declOf(style, 'width'), sh = declOf(style, 'height');
    const isPx = v => v === undefined || /^\d+(?:\.\d+)?px$/i.test(v);
    const isPxAttr = a => a === undefined || PX.test(a.value);
    if (!isPx(sw) || !isPx(sh) || !isPxAttr(attrs.width) || !isPxAttr(attrs.height)) return null;

    // Cada medida que houver (atributo ou style) vai para w×h.
    const aw = PX.test(attrs.width?.value ?? ''), ah = PX.test(attrs.height?.value ?? '');
    if (!aw && !ah && sw === undefined && sh === undefined) return null;

    const edits = [];
    if (aw && attrs.width.value  !== String(w)) edits.push({ ...attrs.width,  insert: `width="${w}"` });
    if (ah && attrs.height.value !== String(h)) edits.push({ ...attrs.height, insert: `height="${h}"` });
    let s = style;
    if (sw !== undefined && sw !== `${w}px`) s = setDecl(s, 'width',  `${w}px`);
    if (sh !== undefined && sh !== `${h}px`) s = setDecl(s, 'height', `${h}px`);
    if (s !== style) {
      const q = attrs.style.q || '"';
      edits.push({ ...attrs.style, insert: `style=${q}${s}${q}` });
    }
    let out = tag;
    for (const e of edits.sort((x, y) => y.from - x.from)) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
    return out;
  }

  // Edições { from, to, insert } que põem os vídeos do texto em w×h.
  // found = vídeos com tamanho fixo encontrados (mudando ou não).
  function videoEdits(html, w, h) {
    const edits = [];
    let found = 0;
    for (const m of html.matchAll(/<!--[\s\S]*?-->|<iframe\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
      if (m[0].startsWith('<!--')) continue;
      const out = patchTag(m[0], w, h);
      if (out === null) continue;
      found++;
      if (out !== m[0]) edits.push({ from: m.index, to: m.index + m[0].length, insert: out });
    }
    return { found, edits };
  }

  return { videoEdits };
})();
