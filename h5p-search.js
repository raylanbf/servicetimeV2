'use strict';

// Dentro do popup "Interactive Content – H5P" (pucminasvirtual.h5p.com): se o
// botão do quiz (canvas-h5p.js) deixou um pedido no storage, busca o título da
// página só nos conteúdos de quem está usando ("My Content") e clica no Insert
// do quiz de nome idêntico. A busca vai direto pelo endereço
// (?search=…&content_scope=mine): o formulário da tela leva um content_scope
// escondido que volta sempre para "All Content". A página recarrega, então o
// andamento fica no próprio pedido e este script retoma de onde parou. Com 0
// ou 2+ quizzes de mesmo nome não clica em nada: avisa e deixa o popup aberto
// para a pessoa escolher. Ver PLANO-H5P.md, seções 2.1 e 5.
(async () => {
  // Só o frame do popup, filho direto da página do Canvas. Os quizzes já
  // inseridos na página também são do h5p.com, mas ficam dentro do editor.
  if (window === window.top || window.parent !== window.top) return;

  const TTL_MS = 2 * 60 * 1000;
  const sleep  = ms => new Promise(r => setTimeout(r, ms));
  const norm   = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
  // A busca do H5P diferencia hífen de travessão: busca só o que vem depois do
  // traço ("Tópico 5 – Razões…" → "Razões…"); o título inteiro é comparado aqui.
  const queryOf = title => (title.match(/\s[-‐-―]\s+(.+)$/)?.[1] || title).trim();

  const getPending = async () => {
    const { h5pPending: p } = await chrome.storage.local.get('h5pPending');
    return p && Date.now() - p.ts < TTL_MS ? p : null;
  };
  async function finish(p, result) {
    await chrome.storage.local.remove('h5pPending');
    await chrome.storage.local.set({ h5pResult: { id: p.id, ts: Date.now(), ...result } });
  }

  const resultsShown = () =>
    /search results/i.test(document.title + ' ' + (document.querySelector('#content-page-title')?.textContent || '')) ||
    /showing results|no results/i.test(document.querySelector('.list-title')?.textContent || '');

  // Um passo. true = abriu a busca e espera a página nova; false = acabou.
  async function step(p) {
    const input = document.querySelector('input[name="search"]');
    if (!input) return false;

    // 1) Busca em "My Content", pelo endereço. O resultado só vale se o
    // endereço confirmar os dois: o escopo e o texto buscado.
    const query  = queryOf(p.title);
    const params = new URLSearchParams(location.search);
    if (params.get('content_scope') !== 'mine' || norm(params.get('search')) !== norm(query) || !resultsShown()) {
      if ((p.tries || 0) >= 2) { await finish(p, { status: 'error', detail: 'a busca em "My Content" do H5P não abriu.' }); return false; }
      await chrome.storage.local.set({ h5pPending: { ...p, tries: (p.tries || 0) + 1 } });
      const url = new URL(input.form?.getAttribute('action') || location.pathname, location.href);
      url.search = new URLSearchParams({ search: query, content_scope: 'mine' }).toString();
      location.assign(url.href);
      return true;
    }

    // 2) Resultado: compara o título completo (aria-label da caixinha da linha;
    // o link do título pode vir cortado). Pastas não têm Insert.
    const rows = [...document.querySelectorAll('tr.content-item, tr.browser-row')].map(tr => ({
      tr,
      title:  tr.querySelector('input.fable-toggle-row')?.getAttribute('aria-label') || tr.querySelector('a.fable-title')?.textContent || '',
      insert: [...tr.querySelectorAll('button')].find(b => /^insert$/i.test(b.textContent.trim())),
    })).filter(r => r.insert);
    const hits = rows.filter(r => norm(r.title) === norm(p.title));

    if (hits.length === 1) {
      await finish(p, { status: 'insert', title: hits[0].title.trim() });
      hits[0].insert.click();
      return false;
    }
    hits.forEach(r => { r.tr.style.outline = '3px solid #f59e0b'; r.tr.style.outlineOffset = '-3px'; });
    await finish(p, {
      status: hits.length ? 'many' : 'none',
      count:  hits.length,
      near:   rows.slice(0, 3).map(r => r.title.trim()),
    });
    return false;
  }

  // Espera a lista desenhar e segue passo a passo. Se a página recarregar no
  // meio, este script morre e o da página nova continua pelo pedido salvo.
  for (let i = 0; i < 40 && !document.querySelector('input[name="search"]'); i++) await sleep(150);
  for (let round = 0; round < 8; round++) {
    const p = await getPending();
    if (!p || !(await step(p))) return;
    await sleep(2500);
  }
})();
