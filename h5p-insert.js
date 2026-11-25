'use strict';

// Regra para pôr o quiz H5P na página do tópico pelo HTML (API do Canvas),
// usada pelo "📁 Pasta H5P" (canvas-h5p-folder.js) para inserir os quizzes
// criados em todas as páginas de uma vez. O lugar é o mesmo do botão H5P do
// editor (canvas-h5p.js), o quizBox do h5p-width.js: a caixa logo depois da
// faixa "Atividade de Fixação" ou, no Microfundamento, o parágrafo logo
// depois do banner de Atividades de Fixação (sem ele, entra um parágrafo
// novo logo depois do banner). O lugar só pode ter H5P, o marcador da AVA,
// parágrafos vazios e o enunciado marcado (abaixo) — outra coisa deixa a
// página de fora. O H5P que estiver lá sai e o novo entra no lugar; o resto
// da página fica byte a byte igual.
//
// Enunciado com imagem (Extrator de Questões, enunciados-canvas.json): o
// quiz dessas questões leva só "Assinale a alternativa correta." e as
// alternativas; o enunciado (texto e imagens) vai na página, logo acima do
// quiz, num <div class="svc-enunciado" data-svc-enunciado="Tópico N">. Na
// comum, dentro da caixa da faixa, antes do parágrafo do quiz; no
// Microfundamento, entre o banner e o parágrafo do quiz (um <div> não cabe
// num <p>). Numa segunda vez, o bloco marcado é reconhecido e trocado, nunca
// duplicado. O HTML do enunciado é limpo antes (cleanStatement): só <p>,
// <pre>, <code>, <sup>, <sub>, <br> e <img> com as imagens do .zip.
// Fica em window.__svcH5pInsert.
// Regressão: .claude/skills/h5p-quiz/scripts/test-h5p-folder.js
window.__svcH5pInsert = (() => {
  const H5P_ORIGIN = 'https://pucminasvirtual.h5p.com';
  const MARKER     = /\[\s*iframe\s*-\s*atividade\s+de\s+fixacao\s+h5p\s*\]/;
  const MARKER_RAW = /\[\s*iframe\s*-\s*atividade\s+de\s+fixa(?:ç|c|&ccedil;)(?:ã|a|&atilde;)o\s+h5p\s*\]/gi;
  const TAG        = tag => new RegExp(`<!--[\\s\\S]*?-->|<(\\/?)(${tag})\\b(?:[^>"']|"[^"]*"|'[^']*')*>`, 'gi');
  const IFRAME     = /<iframe\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/iframe\s*>/gi;
  const STMT_CLASS = 'svc-enunciado';
  const STMT_ATTR  = 'data-svc-enunciado';
  // O aviso que o Extrator (e esta limpeza) põe no lugar da figura sem arquivo.
  const FIGURE_TODO = /\[figura(?:\s+\d+)?\s+do enunciado:\s*copie do documento original\]/gi;
  // Imagem do enunciado centralizada (só ela, não o parágrafo), como o editor
  // do Canvas grava a imagem centralizada; no máximo a largura da página.
  const IMG_STYLE = 'display: block; margin-left: auto; margin-right: auto; max-width: 100%;';

  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
  const esc  = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const isH5pSrc = src => /h5p/i.test(src || '');
  const W = () => window.__svcH5pWidth;

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

  // ── Enunciado ─────────────────────────────────────────────────────────
  const KEEP = new Set(['P', 'PRE', 'CODE', 'SUP', 'SUB', 'BR']);
  // Saem com o conteúdo; as outras tags desconhecidas saem e o texto fica.
  const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH',
    'FORM', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'LINK', 'META', 'TITLE', 'HEAD', 'AUDIO', 'VIDEO', 'SOURCE', 'TRACK', 'CANVAS', 'PICTURE']);

  // enunciadoHtml do .zip → HTML só com as tags permitidas, sem atributos
  // (a não ser src/alt/style das imagens) e só com as imagens do .zip
  // (paths: os caminhos lidos). <img> com outro src vira o aviso
  // "[figura N do enunciado: copie do documento original]".
  // → { html, images: [path, na ordem], todo: nº de figuras para copiar à mão, removed: nº de tags tiradas }
  function cleanStatement(raw, paths = []) {
    const valid = new Set(paths);
    const src = new DOMParser().parseFromString(`<!doctype html><body>${String(raw || '')}`, 'text/html').body;
    const out = document.implementation.createHTMLDocument('');
    const root = out.createElement('div');
    const res = { images: [], removed: 0 };
    let figure = 0;
    (function copy(from, to) {
      for (const n of from.childNodes) {
        if (n.nodeType === 3) { to.appendChild(out.createTextNode(n.nodeValue)); continue; }
        if (n.nodeType !== 1) continue;   // comentários
        const tag = n.tagName;
        if (DROP.has(tag)) { res.removed++; continue; }
        if (tag === 'IMG') {
          figure++;
          const path = n.getAttribute('src') || '';
          if (valid.has(path)) {
            const img = out.createElement('img');
            img.setAttribute('src', path);
            img.setAttribute('alt', (n.getAttribute('alt') || '').slice(0, 300));
            img.setAttribute('style', IMG_STYLE);
            to.appendChild(img);
            res.images.push(path);
          } else {
            to.appendChild(out.createTextNode(`[figura ${figure} do enunciado: copie do documento original]`));
          }
          continue;
        }
        if (KEEP.has(tag)) {
          const el = out.createElement(tag.toLowerCase());
          copy(n, el);
          to.appendChild(el);
        } else {
          res.removed++;
          copy(n, to);
        }
      }
    })(src, root);
    // Parágrafos vazios no começo e no fim não servem para nada.
    const blank = el => el?.tagName === 'P' && !el.textContent.trim() && !el.querySelector('img');
    while (blank(root.firstElementChild)) root.firstElementChild.remove();
    while (blank(root.lastElementChild)) root.lastElementChild.remove();
    const html = root.innerHTML.trim();
    const todo = (root.textContent.match(FIGURE_TODO) || []).length;
    return { html, images: res.images, todo, removed: res.removed, empty: !root.textContent.trim() && !res.images.length };
  }

  // O bloco que vai na página: o HTML limpo, com cada imagem apontando para o
  // arquivo do curso (url(path) → endereço ou null), no formato que o editor
  // do Canvas usa (…/files/ID/preview com data-api-endpoint). Imagem sem
  // endereço fica com o caminho do .zip (só na prévia: nunca é gravada assim).
  function statementBlock({ title, html, fileId, origin, courseId }) {
    const doc = new DOMParser().parseFromString('<!doctype html><body><div></div>', 'text/html');
    const div = doc.body.firstElementChild;
    div.innerHTML = html;   // vem do cleanStatement
    for (const img of div.querySelectorAll('img')) {
      const id = fileId(img.getAttribute('src'));
      if (!id) continue;
      img.setAttribute('src', `${origin}/courses/${courseId}/files/${id}/preview`);
      img.setAttribute('data-api-endpoint', `${origin}/api/v1/courses/${courseId}/files/${id}`);
      img.setAttribute('data-api-returntype', 'File');
    }
    return `<div class="${STMT_CLASS}" ${STMT_ATTR}="${esc(title || '')}">${div.innerHTML}</div>`;
  }

  // Assinatura de um enunciado: o texto, o arquivo de cada imagem e se ela
  // está centralizada (o enunciado gravado antes, à esquerda, é trocado). O
  // Canvas pode reescrever entidades, aspas e atributos ao salvar; isso não conta.
  const fileOf = src => String(src || '').match(/\/files\/(\d+)(?:[/?#]|$)/)?.[1] || String(src || '');
  const centered = i => i.style.display === 'block' && i.style.marginLeft === 'auto' && i.style.marginRight === 'auto';
  const signature = el => `${norm(el.textContent)}|${[...el.querySelectorAll('img')].map(i => `${fileOf(i.getAttribute('src'))}${centered(i) ? ':c' : ''}`).join(',')}`;
  const parseBlock = html => new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html').body.firstElementChild;

  // ── Lugar no texto ────────────────────────────────────────────────────
  const attrsOf = (tag, name) => new DOMParser().parseFromString(`<div>${tag}</${name}></div>`, 'text/html').body.firstElementChild.firstElementChild;
  const srcOfIframe = tag => new DOMParser().parseFromString(tag, 'text/html').querySelector('iframe')?.getAttribute('src') || '';
  const sameAttrs = (a, b) => !!a && ['id', 'class', 'style', STMT_ATTR].every(k => (a.getAttribute(k) || '') === (b.getAttribute(k) || ''));

  // Onde um <div> ou <p> do DOMParser está no texto: a k-ésima tag de
  // abertura do texto é o k-ésimo elemento (conferindo id, class e style); o
  // fim é a tag que fecha. Parágrafo não tem outro dentro: a tag seguinte tem
  // que ser o </p> (senão o navegador fechou sozinho e o texto não bate).
  function elementRange(html, doc, el) {
    const name = el.tagName.toLowerCase();
    if (name !== 'div' && name !== 'p') return null;
    const els = [...doc.body.querySelectorAll(name)];
    const k = els.indexOf(el);
    const tags = [...html.matchAll(TAG(name))].filter(m => m[2]);
    const opens = tags.filter(m => !m[1]);
    if (k < 0 || opens.length !== els.length || !sameAttrs(attrsOf(opens[k][0], name), el)) return null;
    const open = opens[k], from = tags.indexOf(open);
    const range = close => ({ outerFrom: open.index, innerFrom: open.index + open[0].length, innerTo: close.index, outerTo: close.index + close[0].length });
    if (name === 'p') return tags[from + 1]?.[1] ? range(tags[from + 1]) : null;
    let depth = 0;
    for (const m of tags.slice(from)) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) return range(m);
    }
    return null;
  }

  const textless = s => !s.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/[\s ]+/g, '');
  const imgCount = s => (s.match(/<img\b/gi) || []).length;

  // Conteúdo novo da caixa: sem os H5P antigos e sem o marcador; o quiz entra
  // no primeiro parágrafo (que fica só com ele) ou num parágrafo centralizado
  // novo. at: onde começa o parágrafo do quiz (o enunciado entra ali).
  function newInner(inner, embed) {
    const s = inner.replace(IFRAME, m => (isH5pSrc(srcOfIframe(m)) ? '' : m)).replace(MARKER_RAW, '');
    const p = s.match(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/i);
    if (p && textless(p[1])) {
      const open = p[0].match(/^<p\b[^>]*>/i)[0];
      return { content: s.slice(0, p.index) + open + embed + '</p>' + s.slice(p.index + p[0].length), at: p.index };
    }
    return { content: `<p style="text-align: center;">${embed}</p>` + s, at: 0 };
  }

  // Onde começa o parágrafo do H5P que já está na caixa (quiz que não muda).
  function quizAt(inner) {
    const f = [...inner.matchAll(IFRAME)].find(m => isH5pSrc(srcOfIframe(m[0])));
    if (!f) return 0;
    const before = inner.slice(0, f.index);
    const p = [...before.matchAll(/<p\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)].pop();
    return p && !/<\/p\s*>/i.test(before.slice(p.index)) ? p.index : f.index;
  }

  const applyEdits = (text, edits) => [...edits].sort((a, b) => b.from - a.from)
    .reduce((s, e) => s.slice(0, e.from) + e.insert + s.slice(e.to), text);

  // statement: o bloco do enunciado (statementBlock) ou null (sem enunciado:
  // o que houver na página fica como está).
  // → { status: 'insert' | 'replace' | 'statement' | 'same' | 'error', error?, oldIds, body?, layout?, stmt? }
  //   status: o que acontece com o quiz ('statement': o quiz fica e só o
  //   enunciado muda); stmt: 'insert' | 'replace' | 'same' (com enunciado),
  //   'keep' (sem enunciado, e a página já tem um) ou null.
  // layout: 'uda' (caixa depois da faixa) ou 'micro' (Microfundamento, depois do banner).
  function plan(html, { contentId, embed, statement = null }) {
    const doc   = new DOMParser().parseFromString(html || '', 'text/html');
    const where = W().quizBox(doc.body);
    if (where.error) return { status: 'error', error: where.error, oldIds: [] };
    const layout = where.layout;
    const unsure = { status: 'error', error: 'Não consegui localizar o lugar do quiz no HTML com segurança — nada muda nesta página.', oldIds: [], layout };
    const box = where.box;

    // O enunciado inserido antes: filho direto da caixa (comum) ou o bloco
    // entre o banner e o quiz (Microfundamento). Um só, e sem H5P dentro.
    const olds = layout === 'micro' ? (where.stmt ? [where.stmt] : []) : [...box.children].filter(W().isStatement);
    if (olds.length > 1) return { status: 'error', layout, oldIds: [], error: `A caixa abaixo da faixa "Atividade de Fixação" tem ${olds.length} enunciados inseridos — confira à mão.` };
    const old = olds[0] || null;
    if (old?.querySelector('iframe, video, audio, object, embed')) return { status: 'error', layout, oldIds: [], error: 'O enunciado inserido antes tem um vídeo ou iframe dentro — confira à mão.' };
    const newSig = statement ? signature(parseBlock(statement)) : null;
    const stmt = statement ? (old ? (signature(old) === newSig ? 'same' : 'replace') : 'insert') : (old ? 'keep' : null);
    const stmtSame = stmt === null || stmt === 'same' || stmt === 'keep';
    const oldRange = old && elementRange(html, doc, old);
    if (old && (!oldRange || imgCount(html.slice(oldRange.innerFrom, oldRange.innerTo)) !== old.querySelectorAll('img').length)) return unsure;

    // Microfundamento sem o lugar do quiz: parágrafo novo logo depois do
    // banner (ou do enunciado que já está lá), com o enunciado novo antes.
    if (!box) {
      const r = elementRange(html, doc, where.banner);
      if (!r || imgCount(html.slice(r.innerFrom, r.innerTo)) !== where.banner.querySelectorAll('img').length) return unsure;
      const quizP = `<p style="text-align: center;">${embed}</p>`;
      const edits = old
        ? (statement && stmt !== 'same'
          ? [{ from: oldRange.outerFrom, to: oldRange.outerTo, insert: statement + quizP }]
          : [{ from: oldRange.outerTo, to: oldRange.outerTo, insert: quizP }])
        : [{ from: r.outerTo, to: r.outerTo, insert: (statement || '') + quizP }];
      return { status: 'insert', stmt, oldIds: [], layout, body: applyEdits(html, edits) };
    }

    const h5ps = [...box.querySelectorAll('iframe')].filter(f => isH5pSrc(f.getAttribute('src')) && !old?.contains(f));
    const oldIds = h5ps.map(f => contentIdOf(f.getAttribute('src')));

    const probe = box.cloneNode(true);
    [...probe.children].filter(W().isStatement).forEach(n => n.remove());
    probe.querySelectorAll('iframe').forEach(f => { if (isH5pSrc(f.getAttribute('src'))) f.remove(); });
    if (norm(probe.textContent).replace(MARKER, '').trim() || probe.querySelector('img, iframe, video, audio, object, embed, table, a')) {
      return { status: 'error', layout, oldIds, error: layout === 'micro'
        ? 'O bloco abaixo do banner de Atividades de Fixação tem outro conteúdo além do H5P — confira à mão.'
        : 'A caixa abaixo da faixa "Atividade de Fixação" tem outro conteúdo além do H5P — confira à mão.' };
    }
    const quizSame = h5ps.length === 1 && oldIds[0] === String(contentId);
    if (quizSame && stmtSame) return { status: 'same', stmt, oldIds, layout };
    const status = quizSame ? 'statement' : h5ps.length ? 'replace' : 'insert';

    const range = elementRange(html, doc, box);
    const inner = range && html.slice(range.innerFrom, range.innerTo);
    // Confere a conta: o trecho do texto tem os mesmos iframes da caixa.
    if (!range || (inner.match(/<iframe\b/gi) || []).length !== box.querySelectorAll('iframe').length) return { ...unsure, oldIds };

    // Microfundamento: o lugar é um parágrafo, que fica só com o quiz; o
    // enunciado é o bloco irmão logo antes dele.
    if (box.tagName === 'P') {
      const edits = [];
      if (!quizSame) edits.push({ from: range.innerFrom, to: range.innerTo, insert: embed });
      if (statement && stmt !== 'same') {
        edits.push(old ? { from: oldRange.outerFrom, to: oldRange.outerTo, insert: statement } : { from: range.outerFrom, to: range.outerFrom, insert: statement });
      }
      return { status, stmt, oldIds, layout, body: applyEdits(html, edits) };
    }

    // Caixa da faixa: tira o enunciado antigo, ajeita o quiz e põe o
    // enunciado (o novo, ou o antigo como estava) logo antes do parágrafo do quiz.
    let rest = inner, kept = '';
    if (old) {
      if (oldRange.outerFrom < range.innerFrom || oldRange.outerTo > range.innerTo) return { ...unsure, oldIds };
      kept = html.slice(oldRange.outerFrom, oldRange.outerTo);
      rest = inner.slice(0, oldRange.outerFrom - range.innerFrom) + inner.slice(oldRange.outerTo - range.innerFrom);
    }
    const { content, at } = quizSame ? { content: rest, at: quizAt(rest) } : newInner(rest, embed);
    const put = statement && stmt !== 'same' ? statement : kept;
    const body = html.slice(0, range.innerFrom) + content.slice(0, at) + put + content.slice(at) + html.slice(range.innerTo);
    return { status, stmt, oldIds, layout, body };
  }

  // O que há no lugar do quiz de uma página (HTML da API): o H5P que está lá
  // ({ title, id } ou null) e se ainda há o marcador da AVA. Usado pelo selo
  // "H5P" dos módulos (canvas-h5p-marks.js) e pela Pasta H5P, que já deixa
  // marcadas as páginas com quiz ou marcador.
  function slotState(html) {
    const none = { quiz: null, marker: false };
    if (!html || !/iframe/i.test(html)) return none;   // nem iframe nem marcador
    const box = W().quizBox(new DOMParser().parseFromString(html, 'text/html').body).box;
    if (!box) return none;
    const frame = [...box.querySelectorAll('iframe')].find(f => isH5pSrc(f.getAttribute('src')));
    return {
      quiz: frame ? { title: (frame.getAttribute('title') || '').trim(), id: contentIdOf(frame.getAttribute('src')) } : null,
      marker: MARKER.test(norm(box.textContent)),
    };
  }

  return { plan, embedHtml, contentIdOf, slotState, cleanStatement, statementBlock, FIGURE_TODO, IMG_STYLE };
})();
