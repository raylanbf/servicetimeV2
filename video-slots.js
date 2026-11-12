'use strict';

// Regra do "Inserir vídeos do Studio" (painel › Canvas LMS). Fica em
// window.__svcVideoSlots; o popup.html carrega este arquivo antes do popup.js.
//
// Página de pós "virgem": cada vídeo tem um espaço — um parágrafo só com um
// texto entre colchetes, como <p style="text-align: center;"><strong>[videoaula]</strong></p>
// — e, logo acima dele, um título (h1–h6) com um texto genérico ("Tema"). A
// planilha diz, na ordem, que vídeo do Studio vai em cada espaço e que texto vai
// no título. O vídeo entra no lugar do texto entre colchetes (o parágrafo e o
// alinhamento ficam); o título troca só o texto e mantém negrito, fonte e cor.
// O resto da página fica byte a byte igual: as mudanças são trechos do texto.
// Regressão: .claude/skills/h5p-quiz/scripts/test-video-slots.js
window.__svcVideoSlots = (() => {
  // ── Texto ─────────────────────────────────────────────────────────────
  const ENTITIES = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—',
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', atilde: 'ã', otilde: 'õ',
    acirc: 'â', ecirc: 'ê', ocirc: 'ô', agrave: 'à', ccedil: 'ç', uuml: 'ü',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Atilde: 'Ã', Otilde: 'Õ',
    Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô', Agrave: 'À', Ccedil: 'Ç',
  };
  function decode(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n === 160 ? ' ' : String.fromCodePoint(n);
      }
      return ENTITIES[e] ?? m;
    });
  }
  const textOf = html => decode(html.replace(/<[^>]*>/g, '')).replace(/[\s ]+/g, ' ').trim();
  const esc    = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Para comparar nomes: sem acento, minúsculo, pontuação vira espaço.
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
  // Nome de vídeo: também sem a extensão (o Studio costuma guardar o nome do arquivo).
  const videoKey = s => norm(String(s || '').trim().replace(/\.(mp4|m4v|mov|avi|mkv|webm|wmv|mpe?g)$/i, ''));

  // ── Espaços de vídeo ──────────────────────────────────────────────────
  // Parágrafo cujo texto inteiro está entre colchetes. O marcador do quiz
  // ([iframe - Atividade de Fixação H5P]) é do botão do H5P e fica de fora.
  const SLOT_TEXT = /^\[[^\[\]]+\]$/;

  // [{ from, to, open, text, heading: { from, to, tag, text } | null }], na ordem.
  // heading = o título logo acima, com só parágrafos vazios no meio; se houver
  // qualquer outro conteúdo entre os dois, não há título para esse espaço.
  function findSlots(html) {
    const slots = [];
    const skip  = [];   // trechos de comentário: nada dentro deles conta
    for (const c of html.matchAll(/<!--[\s\S]*?-->/g)) skip.push([c.index, c.index + c[0].length]);
    const inComment = i => skip.some(([a, b]) => i >= a && i < b);

    for (const m of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
      if (inComment(m.index)) continue;
      const text = textOf(m[1]);
      if (!SLOT_TEXT.test(text) || /h5p/i.test(text)) continue;

      const before = html.slice(0, m.index);
      let heading = null;
      for (const h of before.matchAll(/<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>/gi)) {
        if (!inComment(h.index)) heading = { from: h.index, to: h.index + h[0].length, tag: h[0] };
      }
      if (heading) {
        const gap = before.slice(heading.to).replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (x, inner) => textOf(inner) ? '#' : '');
        if (gap.trim() !== '') heading = null;
        else heading.text = textOf(heading.tag);
      }
      slots.push({ from: m.index, to: m.index + m[0].length, open: m[0].match(/^<p\b[^>]*>/i)[0], text, heading });
    }
    return slots;
  }

  // Troca o texto do título: o primeiro trecho de texto recebe o título novo,
  // os outros trechos com texto somem; as tags (negrito, span com fonte e cor) ficam.
  function setHeadingText(tag, title) {
    let done = false;
    return tag.replace(/>([^<]*)</g, (x, t) => {
      if (!textOf(t)) return x;
      if (done) return '><';
      done = true;
      return '>' + esc(title) + '<';
    });
  }

  // ── Embed do Studio ───────────────────────────────────────────────────
  // Igual ao que o editor do Canvas grava ao inserir um vídeo do Studio (ver
  // setordevideo/docs/automacao-embed-studio-em-paginas.md §2–3). Não há token
  // nele: o Canvas assina a abertura do Studio na hora em que a página é aberta.
  function studioEmbed({ courseId, studioDomain, mediaId, title, w, h }) {
    const launch = `https://${studioDomain}/lti/launch` +
      `?custom_arc_launch_type=bare_embed&custom_arc_media_id=${mediaId}` +
      '&custom_arc_show_rolling_transcript=true&custom_arc_start_at=0';
    const src = `/courses/${courseId}/external_tools/retrieve?display=borderless&url=${encodeURIComponent(launch)}`;
    return `<iframe class="lti-embed" style="width: ${w}px; height: ${h}px; display: inline-block;" ` +
      `title="${esc(title || '')}" src="${esc(src)}" width="${w}" height="${h}" ` +
      'allowfullscreen="allowfullscreen" webkitallowfullscreen="webkitallowfullscreen" mozallowfullscreen="mozallowfullscreen" ' +
      'allow="geolocation *; microphone *; camera *; midi *; encrypted-media *; autoplay *; clipboard-write *; display-capture *; fullscreen *" ' +
      'data-studio-resizable="true" data-studio-tray-enabled="true" data-studio-convertible-to-link="true"></iframe>';
  }

  // ── Planilha ──────────────────────────────────────────────────────────
  // Texto colado do Excel/Google Sheets (separado por tab) ou .csv (; ou ,).
  // Aceita célula entre aspas, com aspas dobradas e quebra de linha dentro.
  function parseTable(text) {
    text = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const first = text.split('\n').find(l => l.trim()) || '';
    const count = ch => first.split(ch).length - 1;
    const sep = count('\t') ? '\t' : count(';') >= count(',') && count(';') ? ';' : count(',') ? ',' : '\t';

    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"' && cell === '') q = true;
      else if (c === sep) { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  // Tabela → [{ line, page, title, video, problem }]. Colunas: Página | Título
  // acima do vídeo | Nome do vídeo no Studio. Pula linhas vazias e a de
  // cabeçalho. Página vazia = a da linha de cima (célula mesclada), até uma
  // linha em branco. Linha sem vídeo continua na lista, com problem: pulá-la
  // faria os vídeos de baixo subirem um espaço. problems = linhas sem página.
  function sheetRows(table) {
    const rows = [], problems = [];
    let last = '';
    table.forEach((cells, i) => {
      const [page0 = '', title = '', video = ''] = cells.map(c => String(c ?? '').replace(/\s+/g, ' ').trim());
      if (!page0 && !title && !video) { last = ''; return; }
      if (i === 0 && /^pagina/.test(norm(page0)) && /video/.test(norm(video))) return;  // cabeçalho
      const line = i + 1;
      const page = page0 || last;
      if (!page) { problems.push({ line, msg: 'falta o nome da página' }); return; }
      last = page;
      rows.push({ line, page, title, video, problem: video ? null : 'falta o nome do vídeo na planilha' });
    });
    return { rows, problems };
  }

  // Linhas agrupadas por página, na ordem em que a página aparece primeiro.
  function groupByPage(rows) {
    const groups = new Map();
    for (const r of rows) {
      const k = norm(r.page);
      if (!groups.has(k)) groups.set(k, { name: r.page, rows: [] });
      groups.get(k).rows.push(r);
    }
    return [...groups.values()];
  }

  // ── Casamento por nome ────────────────────────────────────────────────
  // Página: título igual (sem acento/pontuação) ou, se nenhuma for igual, a
  // única cujo título contém o nome inteiro ("Associações contábeis" acha
  // "Unidade 1 - 2. Associações contábeis"). Duas candidatas = ambíguo.
  function matchPage(name, pages) {
    const k = norm(name);
    if (!k) return { error: 'nome da página vazio' };
    const uniq = list => [...new Map(list.map(p => [p.url, p])).values()];
    const exact = uniq(pages.filter(p => norm(p.title) === k));
    if (exact.length === 1) return { page: exact[0] };
    const found = exact.length ? exact : uniq(pages.filter(p => ` ${norm(p.title)} `.includes(` ${k} `)));
    if (found.length === 1) return { page: found[0] };
    if (found.length > 1) {
      return { error: `${found.length} páginas com esse nome: ${found.slice(0, 3).map(p => `"${p.title}"`).join(', ')}${found.length > 3 ? '…' : ''}. Escreva o título completo na planilha.` };
    }
    return { error: 'página não encontrada nos módulos marcados', notFound: true };
  }

  // Vídeo: nome igual ao do Studio (sem acento, pontuação e extensão). Sem
  // "contém": "Vídeo 1" não pode cair no "Vídeo 10". Os parecidos viram dica.
  function matchVideo(name, videos) {
    const k = videoKey(name);
    const hits = [...new Map(videos.filter(v => videoKey(v.title) === k).map(v => [v.id, v])).values()];
    if (hits.length === 1) return { video: hits[0] };
    if (hits.length > 1) return { error: `${hits.length} vídeos com esse nome no Studio` };
    const near = k.length >= 3 ? videos.filter(v => { const t = videoKey(v.title); return t.includes(k) || k.includes(t); }) : [];
    return {
      error: 'não está na coleção do Studio' +
        (near.length ? ` (parecido: ${near.slice(0, 2).map(v => `"${v.title}"`).join(', ')})` : ''),
    };
  }

  // ── Plano de uma página ───────────────────────────────────────────────
  // A i-ésima linha da página vai no i-ésimo espaço. Bloqueia a página (html =
  // null) se sobrar linha sem espaço, se um vídeo não for achado ou se uma
  // linha tiver título e o espaço não tiver título acima. Espaço sobrando só avisa.
  // items = [{ line, title, video, slotText, headingText, studio, problem }]
  function planPage({ body, rows, videos, courseId, studioDomain, w, h }) {
    const slots = findSlots(body);
    const items = rows.map((r, i) => {
      const slot = slots[i] || null;
      const m    = matchVideo(r.video, videos);
      const it   = {
        line: r.line, title: r.title, video: r.video,
        slotText: slot?.text ?? null, headingText: slot?.heading?.text ?? null,
        studio: m.video || null, problem: null,
      };
      if (r.problem) it.problem = r.problem;
      else if (!slot) it.problem = slots.length ? `a página só tem ${slots.length} espaço(s) de vídeo` : 'a página não tem nenhum texto entre colchetes para o vídeo';
      else if (m.error) it.problem = m.error;
      else if (r.title && !slot.heading) it.problem = `não há título logo acima de ${slot.text}`;
      return it;
    });

    const left = Math.max(0, slots.length - rows.length);
    if (items.some(i => i.problem)) return { slotCount: slots.length, left, items, html: null };

    const edits = [];
    items.forEach((it, i) => {
      const s = slots[i];
      const embed = studioEmbed({ courseId, studioDomain, mediaId: it.studio.id, title: it.title || it.studio.title, w, h });
      edits.push({ from: s.from, to: s.to, insert: s.open + embed + '</p>' });
      if (it.title) edits.push({ from: s.heading.from, to: s.heading.to, insert: setHeadingText(s.heading.tag, it.title) });
    });
    edits.sort((a, b) => b.from - a.from);
    let html = body;
    for (const e of edits) html = html.slice(0, e.from) + e.insert + html.slice(e.to);
    return { slotCount: slots.length, left, items, html };
  }

  return { findSlots, setHeadingText, studioEmbed, parseTable, sheetRows, groupByPage, matchPage, matchVideo, planPage, norm, textOf };
})();
