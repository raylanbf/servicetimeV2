'use strict';

// Regra da largura do H5P (100%), compartilhada pelo menu "Redimensionar H5P"
// (o background.js injeta este arquivo antes do h5pResizeMain), pelo botão do
// quiz (canvas-h5p.js, mundo MAIN) e pela inserção do "📁 Pasta H5P"
// (h5p-insert.js, mundo isolado). Fica em window.__svcH5pWidth. Só muda o
// quiz da Atividade de Fixação (quizBox); os outros H5P da página (imagens,
// carrosséis no corpo do tópico) ficam como estão. Só os atributos width e
// style desse iframe são reescritos; o resto do texto fica byte a byte
// igual. Regressão: .claude/skills/h5p-quiz/scripts/test-h5p.js
window.__svcH5pWidth = (() => {
  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
  const MARKER = /\[\s*iframe\s*-\s*atividade\s+de\s+fixacao\s+h5p\s*\]/;
  const BANNER = /atividades?[\s_-]*(?:de[\s_-]*)?fixacao/;
  // Enunciado da questão com imagem, que o "📁 Pasta H5P" (h5p-insert.js) põe
  // logo acima do quiz: um <div> marcado. É o único bloco além do H5P que o
  // lugar do quiz aceita — na caixa da faixa (filho direto dela) ou, no
  // Microfundamento, entre o banner e o parágrafo do quiz.
  const STMT_SEL = 'div[data-svc-enunciado], div.svc-enunciado';
  const isStatement = el => !!el && el.nodeType === 1 && el.matches(STMT_SEL);

  // H5P no HTML ou no editor visual (o TinyMCE embrulha o iframe num span de prévia).
  const isH5p = el => (el.matches('span.mce-preview-object')
    ? /h5p/i.test(el.getAttribute('data-mce-p-src') || el.querySelector('iframe')?.getAttribute('src') || '')
    : el.tagName === 'IFRAME' && /h5p/i.test(el.getAttribute('src') || '') && !el.closest('span.mce-preview-object'));
  const h5pIn = el => [...el.querySelectorAll('span.mce-preview-object, iframe')].filter(isH5p);
  // Sem nada além de H5P, o marcador da AVA e espaços.
  function onlyH5p(el) {
    const probe = el.cloneNode(true);
    h5pIn(probe).forEach(n => n.remove());
    return !norm(probe.textContent.replace(/ /g, ' ')).replace(MARKER, '').trim()
      && !probe.querySelector('img, iframe, video, audio, object, embed, table, a, span.mce-preview-object');
  }

  // Onde fica o quiz da Atividade de Fixação. Serve tanto para o body do
  // TinyMCE quanto para o HTML lido no DOMParser. Dois modelos de página:
  //  • UDA/AVA: a div logo depois da faixa — a div mais interna cujo texto
  //    começa com "Atividade de Fixação". Tem que haver uma faixa só.
  //    → { layout: 'uda', box }
  //  • Microfundamento (modelo antigo, sem a faixa): a imagem
  //    "banner-atividades-fixacao" num bloco só dela; o quiz fica no
  //    parágrafo logo depois desse bloco. Se o que vem depois não é o lugar
  //    do quiz (ex.: "Voltar ao topo"), ele ainda não existe e o quiz entra
  //    num parágrafo novo logo depois do banner.
  //    → { layout: 'micro', box, banner, stmt } ou { layout: 'micro', box: null, after, banner, stmt }
  //    (stmt: o enunciado marcado entre o banner e o quiz, ou null; after:
  //    o enunciado ou, sem ele, o bloco do banner)
  // A faixa vem primeiro: página da AVA nunca muda de regra.
  function quizBox(root) {
    // O enunciado (e a caixa que o tem) nunca é a faixa, mesmo que o texto
    // dele comece com "Atividade de fixação".
    const isBand = d => !d.matches(STMT_SEL) && !d.closest(STMT_SEL) && !d.querySelector(STMT_SEL)
      && norm(d.textContent).startsWith('atividade de fixacao');
    const bands  = [...root.querySelectorAll('div')].filter(d => isBand(d) && ![...d.querySelectorAll('div')].some(isBand));
    if (bands.length > 1) return { error: `Achei ${bands.length} faixas "Atividade de Fixação" nesta página — deve haver só uma.` };
    if (bands.length === 1) {
      const box = bands[0].nextElementSibling;
      if (!box || box.tagName !== 'DIV') return { error: 'Não achei a caixa logo abaixo da faixa "Atividade de Fixação".' };
      return { layout: 'uda', box };
    }
    return bannerSlot(root);
  }

  function bannerSlot(root) {
    const imgs = [...root.querySelectorAll('img')].filter(i => !i.closest(STMT_SEL) && BANNER.test(norm(`${i.getAttribute('alt') || ''} ${i.getAttribute('title') || ''} ${i.getAttribute('src') || ''}`)));
    if (!imgs.length) return { error: 'Não achei a faixa "Atividade de Fixação Não Pontuada" nem o banner de Atividades de Fixação (Microfundamento) nesta página.' };
    if (imgs.length > 1) return { error: `Achei ${imgs.length} banners de Atividades de Fixação nesta página — deve haver só um.` };
    // O bloco do banner: a div ou o parágrafo que só tem a imagem.
    let block = imgs[0];
    while (block.parentElement && block.parentElement !== root && /^(SPAN|A|STRONG|EM|B|I|U)$/.test(block.parentElement.tagName)) block = block.parentElement;
    block = block.parentElement;
    if (!block || block === root || !/^(DIV|P)$/.test(block.tagName) || norm(block.textContent.replace(/ /g, ' ')) ||
        block.querySelectorAll('img, iframe, video, audio, object, embed, table').length !== 1) {
      return { error: 'O banner de Atividades de Fixação não está num bloco só dele — confira a página.' };
    }
    // O enunciado inserido antes fica entre o banner e o parágrafo do quiz.
    let next = block.nextElementSibling;
    const stmt = isStatement(next) ? next : null;
    if (stmt) {
      if (h5pIn(stmt).length) return { error: 'O enunciado logo abaixo do banner de Atividades de Fixação tem um H5P dentro — confira.' };
      next = stmt.nextElementSibling;
    }
    if (next && h5pIn(next).length && !onlyH5p(next)) return { error: 'O bloco logo abaixo do banner de Atividades de Fixação tem outro conteúdo além do H5P — confira.' };
    const slot = next && /^(DIV|P)$/.test(next.tagName) && !isStatement(next) && onlyH5p(next) ? next : null;
    // Lugar vazio ou nenhum: só vale se não houver H5P mais abaixo (senão ficariam dois).
    if (!slot || !h5pIn(slot).length) {
      for (let s = slot ? slot.nextElementSibling : next; s; s = s.nextElementSibling) {
        if (h5pIn(s).length || isH5p(s)) return { error: 'Há um H5P abaixo do banner de Atividades de Fixação, mas não logo abaixo dele — confira.' };
      }
    }
    // after: depois de onde entra o parágrafo novo do quiz (o enunciado, se houver).
    return slot ? { layout: 'micro', box: slot, banner: block, stmt } : { layout: 'micro', box: null, after: stmt || block, banner: block, stmt };
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
      if (where.error || !where.box?.contains(frames[i])) { res.others++; continue; }
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

  return { h5pEdits, applyEdits, quizBox, isStatement, STMT_SEL };
})();
