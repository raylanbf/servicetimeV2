'use strict';

// Regra para pôr o quiz H5P na página do tópico pelo HTML (API do Canvas),
// usada pelo "📁 Pasta H5P" (canvas-h5p-folder.js) para inserir os quizzes
// criados em todas as páginas de uma vez. O lugar é o mesmo do botão H5P do
// editor (canvas-h5p.js): a caixa logo depois da faixa "Atividade de Fixação"
// (quizBox, do h5p-width.js). A caixa só pode ter H5P, o marcador da AVA e
// parágrafos vazios — outra coisa deixa a página de fora. O H5P que estiver
// lá sai e o novo entra no primeiro parágrafo da caixa; o resto da página
// fica byte a byte igual. Fica em window.__svcH5pInsert.
// Regressão: .claude/skills/h5p-quiz/scripts/test-h5p-folder.js
window.__svcH5pInsert = (() => {
  const H5P_ORIGIN = 'https://pucminasvirtual.h5p.com';
  const MARKER     = /\[\s*iframe\s*-\s*atividade\s+de\s+fixacao\s+h5p\s*\]/;
  const MARKER_RAW = /\[\s*iframe\s*-\s*atividade\s+de\s+fixa(?:ç|c|&ccedil;)(?:ã|a|&atilde;)o\s+h5p\s*\]/gi;
  const TAG        = /<!--[\s\S]*?-->|<(\/?)(div)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  const IFRAME     = /<iframe\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/iframe\s*>/gi;

  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
  const esc  = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const isH5pSrc = src => /h5p/i.test(src || '');

  // Id do conteúdo no H5P.com a partir do src do iframe (direto ou no url= do Canvas).
  function contentIdOf(src) {
    let s = String(src || '');
    try { s = decodeURIComponent(s); } catch { /* fica como está */ }
    return s.match(/h5p\.com\/(?:lti\/[^/?#]+\/)?content\/(\d+)/i)?.[1] || null;
  }

  // O iframe que o Canvas grava ao inserir um quiz do H5P (PLANO-H5P.md §2.1):
  // lti-embed, 100% × 600, sem resource_link_lookup_uuid. O title é o nome
  // do quiz, para o leitor de tela (o botão do editor faz o mesmo).
  function embedHtml({ origin, courseId, contentId, title }) {
    const src = `${origin}/courses/${courseId}/external_tools/retrieve?display=borderless&url=${encodeURIComponent(`${H5P_ORIGIN}/content/${contentId}`)}`;
    return `<iframe class="lti-embed" style="width: 100%; height: 600px;" title="${esc(title || '')}" src="${esc(src)}" ` +
      'width="100%" height="600" loading="lazy" allowfullscreen="allowfullscreen" webkitallowfullscreen="webkitallowfullscreen" mozallowfullscreen="mozallowfullscreen" ' +
      'allow="geolocation *; microphone *; camera *; midi *; encrypted-media *; autoplay *; clipboard-write *; display-capture *"></iframe>';
  }

  const attrsOf = tag => new DOMParser().parseFromString(tag + '</div>', 'text/html').body.firstElementChild;
  const srcOfIframe = tag => new DOMParser().parseFromString(tag, 'text/html').querySelector('iframe')?.getAttribute('src') || '';
  const sameAttrs = (a, b) => ['id', 'class', 'style'].every(k => (a.getAttribute(k) || '') === (b.getAttribute(k) || ''));

  // Onde a caixa está no texto: a k-ésima <div> do texto é a k-ésima do
  // DOMParser (conferindo id, class e style); o fim é o </div> que fecha.
  function boxRange(html, doc, box) {
    const divs = [...doc.body.querySelectorAll('div')];
    const k = divs.indexOf(box);
    const tags = [...html.matchAll(TAG)].filter(m => m[2]);
    const opens = tags.filter(m => !m[1] && m[2].toLowerCase() === 'div');
    if (k < 0 || opens.length !== divs.length || !sameAttrs(attrsOf(opens[k][0]), box)) return null;
    const open = opens[k];
    let depth = 0;
    for (const m of tags.slice(tags.indexOf(open))) {
      if (m[2].toLowerCase() !== 'div') continue;
      depth += m[1] ? -1 : 1;
      if (depth === 0) return { innerFrom: open.index + open[0].length, innerTo: m.index };
    }
    return null;
  }

  const textless = s => !s.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/[\s ]+/g, '');

  // Conteúdo novo da caixa: sem os H5P antigos e sem o marcador; o quiz entra
  // no primeiro parágrafo (que fica só com ele) ou num parágrafo centralizado novo.
  function newInner(inner, embed) {
    let s = inner.replace(IFRAME, m => (isH5pSrc(srcOfIframe(m)) ? '' : m)).replace(MARKER_RAW, '');
    const p = s.match(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/i);
    if (p && textless(p[1])) {
      const open = p[0].match(/^<p\b[^>]*>/i)[0];
      return s.slice(0, p.index) + open + embed + '</p>' + s.slice(p.index + p[0].length);
    }
    return `<p style="text-align: center;">${embed}</p>` + s;
  }

  // → { status: 'insert' | 'replace' | 'same' | 'error', error?, oldIds, body? }
  function plan(html, { contentId, embed }) {
    const doc   = new DOMParser().parseFromString(html || '', 'text/html');
    const where = window.__svcH5pWidth.quizBox(doc.body);
    if (where.error) return { status: 'error', error: where.error, oldIds: [] };
    const box  = where.box;
    const h5ps = [...box.querySelectorAll('iframe')].filter(f => isH5pSrc(f.getAttribute('src')));
    const oldIds = h5ps.map(f => contentIdOf(f.getAttribute('src')));

    const probe = box.cloneNode(true);
    probe.querySelectorAll('iframe').forEach(f => { if (isH5pSrc(f.getAttribute('src'))) f.remove(); });
    if (norm(probe.textContent).replace(MARKER, '').trim() || probe.querySelector('img, iframe, video, audio, object, embed, table, a')) {
      return { status: 'error', error: 'A caixa abaixo da faixa "Atividade de Fixação" tem outro conteúdo além do H5P — confira à mão.', oldIds };
    }
    if (h5ps.length === 1 && oldIds[0] === String(contentId)) return { status: 'same', oldIds };

    const range = boxRange(html, doc, box);
    const inner = range && html.slice(range.innerFrom, range.innerTo);
    // Confere a conta: o trecho do texto tem os mesmos iframes da caixa.
    if (!range || (inner.match(/<iframe\b/gi) || []).length !== box.querySelectorAll('iframe').length) {
      return { status: 'error', error: 'Não consegui localizar a caixa do quiz no HTML com segurança — nada muda nesta página.', oldIds };
    }
    const body = html.slice(0, range.innerFrom) + newInner(inner, embed) + html.slice(range.innerTo);
    return { status: h5ps.length ? 'replace' : 'insert', oldIds, body };
  }

  return { plan, embedHtml, contentIdOf };
})();
