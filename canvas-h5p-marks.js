// Selo "H5P" na página de Módulos do Canvas, logo antes do ícone de
// publicado, nas páginas que já têm o quiz H5P da Atividade de Fixação: o
// iframe do H5P no lugar do quiz — a caixa logo depois da faixa "Atividade
// de Fixação" (UDA) ou o parágrafo logo abaixo do banner de Atividades de
// Fixação (Microfundamento). A regra é a mesma do botão H5P do editor e do
// "📁 Pasta H5P" (h5p-width.js › quizBox): os outros H5P da página (imagens,
// carrosséis no corpo do tópico) não contam. Com o mouse em cima, o selo
// mostra o título e o número do quiz no H5P.com. Página que não deu para
// ler ganha um selo cinza "H5P ?", para não parecer que não tem o quiz.
//
// Só lê, pela API do Canvas, com a sessão desta aba, um pedido por vez e no
// ritmo do limite de requisições: os módulos (para ligar cada item à sua
// página) e as páginas com o corpo, de 100 em 100. Lê ao abrir a página de
// módulos; window.__svcH5pMarks.refresh() lê de novo (o "📁 Pasta H5P"
// chama depois de inserir os quizzes). A leitura leva alguns segundos (o
// Canvas demora a montar a lista com os corpos): os selos da última leitura
// do curso ficam guardados (h5pMarksCache, os 30 cursos mais recentes) e
// aparecem na hora, até a leitura nova chegar; sem eles, um aviso discreto
// diz que está lendo.
//
// Liga e desliga em ⚙ Configurações › Canvas LMS (h5pMarksEnabled) — nasce
// ligado; vale na hora, sem recarregar a página.
(() => {
  'use strict';

  const courseOf = () => location.pathname.match(/^\/courses\/(\d+)/)?.[1] || null;
  if (!courseOf() || window.__svcH5pMarks) return;
  // Página de módulos (ou a inicial do curso mostrando os módulos).
  const onModules = () => !!document.getElementById('context_modules');

  const MARK     = '__svc-h5p-mark';
  const TOAST_ID = '__svc-h5p-mark-toast__';
  const CACHE    = 'h5pMarksCache';
  const CACHE_COURSES = 30;
  const api      = () => `/api/v1/courses/${courseOf()}`;
  const sleep    = ms => new Promise(r => setTimeout(r, ms));

  // ── Canvas (só GET) ───────────────────────────────────────────────────
  // Pausa pelo que sobra no balde do Canvas (X-Rate-Limit-Remaining), antes
  // do pedido seguinte: depois do último, ninguém espera.
  const pauseFor = left => (!(left >= 0) || left >= 300 ? 0 : left >= 150 ? 600 : left >= 50 ? 2000 : 5000);
  let readyAt = 0;
  async function getJson(url) {
    for (let i = 0; ; i++) {
      const wait = readyAt - Date.now();
      if (wait > 0) await sleep(wait);
      let res = null, text = '';
      try {
        res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        text = await res.text();
      } catch { res = null; }
      // Limite de requisições (403 "Rate Limit Exceeded" ou 429): espera e
      // repete — a página de módulos abre fazendo muitos pedidos.
      const limited = !!res && (res.status === 429 || (res.status === 403 && /rate limit/i.test(text)));
      if (limited && i < 4) {
        const asked = Number(res.headers.get('Retry-After')) * 1000;
        await sleep(Math.min(asked > 0 ? asked : 2000 * 2 ** i, 60000));
        continue;
      }
      if ((!res || res.status >= 500) && i < 2) { await sleep(1500 * (i + 1)); continue; }
      if (!res) throw new Error('sem resposta do Canvas');
      if (limited) throw new Error('o Canvas está recusando por limite de requisições');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      readyAt = Date.now() + pauseFor(parseFloat(res.headers.get('X-Rate-Limit-Remaining')));
      const next = (res.headers.get('Link') || '').match(/<([^>]+)>;\s*rel="next"/)?.[1] || null;
      return { data: JSON.parse(text.replace(/^while\(1\);/, '')), next };
    }
  }
  // Lista inteira ou erro: nunca decide com uma lista cortada.
  async function getAll(url) {
    const out = [];
    for (let guard = 0; url; guard++) {
      if (guard >= 50) throw new Error('lista grande demais');
      const { data, next } = await getJson(url);
      if (Array.isArray(data)) out.push(...data);
      url = next;
    }
    return out;
  }

  // Itens de página dos módulos: [{ id, url }]. Uma página pode estar em
  // mais de um módulo: cada item ganha o seu selo.
  async function moduleItems() {
    const out = [];
    for (const m of await getAll(`${api()}/modules?include[]=items&per_page=50`)) {
      // Módulo grande vem sem a lista de itens: busca à parte.
      const items = Array.isArray(m.items) ? m.items : await getAll(`${api()}/modules/${m.id}/items?per_page=100`);
      for (const it of items) if (it.type === 'Page' && it.page_url) out.push({ id: String(it.id), url: it.page_url });
    }
    return out;
  }

  // Corpo de cada página: pela lista, com os corpos, de 100 em 100; a que
  // ficar faltando (Canvas que não manda o corpo na lista), uma por uma.
  // → Map(url → corpo | { error })
  async function bodies(urls) {
    const out = new Map();
    try {
      for (const p of await getAll(`${api()}/pages?include[]=body&per_page=100`)) {
        if (p && typeof p.url === 'string' && 'body' in p) out.set(p.url, p.body || '');
      }
    } catch { /* lê uma por uma, abaixo */ }
    for (const url of urls) {
      if (out.has(url)) continue;
      try { out.set(url, (await getJson(`${api()}/pages/${encodeURIComponent(url)}`)).data?.body || ''); }
      catch (e) { out.set(url, { error: e.message }); }
    }
    return out;
  }

  // ── Selos ─────────────────────────────────────────────────────────────
  let enabled = false;   // chave das configurações
  let marks = null;      // Map(id do item → { title, id } | { error } | null)
  let byUrl = null;      // da leitura nova (não do cache): Map(url → { quiz, marker } | { error })
  let loading = null;
  let generation = 0;    // só a leitura mais recente vale

  function tipOf(q) {
    if (q.error) return `Não consegui ler esta página (${q.error}): não sei se ela tem o quiz H5P da Atividade de Fixação.`;
    return `Tem o quiz H5P da Atividade de Fixação${q.title ? `: ${q.title}` : ''}${q.id ? ` (nº ${q.id} no H5P.com)` : ''}`;
  }

  function badge(q) {
    const b = document.createElement('span');
    b.className = MARK;
    b.textContent = q.error ? 'H5P ?' : 'H5P';
    b.title = tipOf(q);
    b.setAttribute('role', 'img');
    b.setAttribute('aria-label', b.title);
    b.setAttribute('data-state', q.error ? 'error' : 'quiz');
    Object.assign(b.style, {
      display: 'inline-flex', alignItems: 'center', flex: 'none', boxSizing: 'border-box', height: '18px',
      padding: '0 7px', marginInlineEnd: '10px', borderRadius: '9px', verticalAlign: 'middle',
      font: '700 11px/1 system-ui, sans-serif', letterSpacing: '.3px', whiteSpace: 'nowrap', cursor: 'default',
      ...(q.error
        ? { background: '#f1f3f4', color: '#4a5568', border: '1px dashed #a0aec0' }
        : { background: '#1d6fb8', color: '#fff', border: '1px solid #1d6fb8' }),
    });
    return b;
  }

  // Antes do ícone de publicado (.ig-admin); sem ele (quem só vê o curso),
  // logo depois do título. Selo de item que saiu da leitura (a do cache
  // corrigida pela nova) sai também.
  function paint() {
    if (!enabled || !marks) return;
    for (const [itemId, q] of marks) {
      const li = document.getElementById(`context_module_item_${itemId}`);
      if (!li) continue;
      const old = li.querySelector(`.${MARK}`);
      if (old && q && old.title === tipOf(q)) continue;
      old?.remove();
      if (!q) continue;
      const admin = li.querySelector('.ig-admin');
      if (admin) admin.prepend(badge(q));
      else li.querySelector('.ig-title')?.after(badge(q));
    }
    document.querySelectorAll(`.${MARK}`).forEach(b => {
      if (!marks.get(b.closest('li')?.id.replace('context_module_item_', ''))) b.remove();
    });
  }
  const clear = () => document.querySelectorAll(`.${MARK}`).forEach(b => b.remove());

  // Selos da última leitura do curso: Map(id do item → { title, id }) ou null.
  async function readCache() {
    try {
      const c = (await chrome.storage.local.get({ [CACHE]: {} }))[CACHE]?.[courseOf()];
      return c?.items ? new Map(Object.entries(c.items)) : null;
    } catch { return null; }
  }
  // Guarda só os selos azuis (o "H5P ?" é de uma falha que pode passar).
  async function writeCache() {
    try {
      const all = (await chrome.storage.local.get({ [CACHE]: {} }))[CACHE] || {};
      const items = {};
      for (const [id, q] of marks) if (q && !q.error) items[id] = q;
      all[courseOf()] = { at: Date.now(), items };
      const keep = Object.entries(all).sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0)).slice(0, CACHE_COURSES);
      await chrome.storage.local.set({ [CACHE]: Object.fromEntries(keep) });
    } catch { /* sem cache, a próxima abertura só demora mais */ }
  }

  // kind: 'busy' (lendo, some sozinho) ou 'warn' (fica até fechar).
  function notice(text, kind = 'warn') {
    document.getElementById(TOAST_ID)?.remove();
    const el = document.createElement('div');
    el.id = TOAST_ID;
    el.setAttribute('role', 'status');
    el.setAttribute('data-kind', kind);
    Object.assign(el.style, {
      position: 'fixed', bottom: '24px', left: '24px', maxWidth: '420px', display: 'flex', gap: '10px', alignItems: 'center',
      background: kind === 'busy' ? '#334155' : '#b45309', color: '#fff', padding: '8px 12px', borderRadius: '6px',
      fontFamily: 'system-ui, sans-serif', fontSize: '12px', lineHeight: '1.4', zIndex: '2147483646', boxShadow: '0 2px 8px rgba(0,0,0,.35)',
      opacity: kind === 'busy' ? '.85' : '1',
    });
    const msg = document.createElement('span');
    msg.textContent = text;
    el.appendChild(msg);
    if (kind !== 'busy') {
      const x = document.createElement('button');
      x.type = 'button'; x.textContent = '×'; x.title = 'Fechar';
      Object.assign(x.style, { background: 'none', border: 'none', color: '#fff', fontSize: '16px', cursor: 'pointer', padding: '0', lineHeight: '1' });
      x.onclick = () => el.remove();
      el.appendChild(x);
    }
    document.body.appendChild(el);
  }

  async function load() {
    const gen = ++generation;
    // Sem selos na tela (nem do cache), avisa que está lendo.
    if (!marks) notice('Selo H5P: lendo os módulos e as páginas…', 'busy');
    try {
      const items = await moduleItems();
      const urls = [...new Set(items.map(i => i.url))];
      const got = urls.length ? await bodies(urls) : new Map();
      // O que há no lugar do quiz de cada página (h5p-insert.js › slotState).
      const states = new Map(urls.map(u => {
        const b = got.get(u);
        return [u, typeof b === 'string' ? window.__svcH5pInsert.slotState(b) : { error: b?.error || 'página não lida' }];
      }));
      if (gen !== generation) return;
      byUrl = states;
      marks = new Map(items.map(i => { const s = states.get(i.url); return [i.id, s.error ? s : s.quiz]; }));
      document.getElementById(TOAST_ID)?.remove();
      paint();
      writeCache();
    } catch (e) {
      if (gen !== generation) return;
      if (!enabled) { document.getElementById(TOAST_ID)?.remove(); return; }
      notice(`Selo H5P nos módulos: não consegui ler os módulos e as páginas (${e.message}).${marks ? ' Os selos na tela são da leitura anterior.' : ''} Recarregue a página para tentar de novo.`);
    }
  }
  function refresh() {
    if (!enabled || !onModules()) return Promise.resolve();
    loading = load().finally(() => { loading = null; });
    return loading;
  }

  // O Canvas monta e refaz os itens (módulo aberto depois, item publicado,
  // recuado…): observa e recoloca os selos.
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; paint(); });
  });

  function apply(on) {
    enabled = on !== false;
    if (enabled && onModules()) {
      observer.observe(document.body, { childList: true, subtree: true });
      if (!marks && !loading) {
        // Os selos guardados aparecem já; a leitura nova corrige.
        readCache().then(c => { if (c && !marks) { marks = c; document.getElementById(TOAST_ID)?.remove(); paint(); } });
        refresh();
      }
      paint();
    } else {
      observer.disconnect();
      clear();
      document.getElementById(TOAST_ID)?.remove();
    }
  }

  // Para a Pasta H5P: o lugar do quiz de cada página, da última leitura
  // (espera a que estiver em andamento); null se o selo não leu.
  async function pageStates() {
    if (loading) await loading.catch(() => {});
    return byUrl;
  }

  window.__svcH5pMarks = { refresh, pages: pageStates };

  chrome.storage.local.get({ h5pMarksEnabled: true })
    .then(cfg => apply(cfg.h5pMarksEnabled))
    .catch(() => {});   // extensão recarregada com a página aberta
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'h5pMarksEnabled' in changes) apply(changes.h5pMarksEnabled.newValue);
  });
})();
