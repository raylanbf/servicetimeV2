'use strict';

// Frame do Canvas Studio (*.instructuremedia.com), mundo MAIN, desde o início
// da página. Escuta a lista "tiles" que o próprio Studio baixa ao abrir a
// coleção do curso (20 vídeos por página) e pede as páginas seguintes com o
// MESMO método e os MESMOS cabeçalhos da chamada original: o Studio autentica
// por cabeçalho, e um pedido "limpo" volta 401. Nenhuma resposta é alterada.
//
// Passa para o studio-capture.js (mundo ISOLATED), por postMessage, só o que o
// embed precisa: o código de cada vídeo (data.media.lti_launch_id, que é o
// custom_arc_media_id do embed) e o título, mais a coleção e o total. Tokens e
// e-mails que vêm na resposta não são lidos.
//
// Portado do setordevideo (src/net-hook.js), que lê coleções inteiras assim.
(() => {
  if (window.__svcStudioHook) return;
  window.__svcStudioHook = true;

  const HOST_RE   = /instructuremedia\.com/i;
  const TILES_RE  = /tiles/i;
  const MAX_PAGES = 50;   // teto: 50 × 20 = 1000 vídeos
  // Cabeçalhos que o navegador define sozinho: não se repassam.
  const SKIP_HEADERS = new Set(['host', 'connection', 'content-length', 'cookie', 'origin', 'referer',
    'user-agent', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest']);
  // Guardada antes do patch: a paginação usa esta, para não reentrar no interceptador.
  const origFetch = window.fetch;

  const absUrl = u => { try { return new URL(u, location.href).href; } catch { return String(u || ''); } };
  const isTiles = url => HOST_RE.test(url) && TILES_RE.test(url);

  function headersToObject(h) {
    const out = {};
    if (!h) return out;
    const put = (k, v) => { if (k && !SKIP_HEADERS.has(String(k).toLowerCase())) out[k] = v; };
    try {
      if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => put(k, v));
      else if (Array.isArray(h)) { for (const p of h) if (p && p.length === 2) put(p[0], p[1]); }
      else for (const k of Object.keys(h)) put(k, h[k]);
    } catch { /* formato inesperado: segue sem cabeçalhos */ }
    return out;
  }

  // { tiles: [{ data: { title, collection: { id, name, type }, media: { lti_launch_id, title } } }], meta }
  function readTiles(json) {
    if (!json || !Array.isArray(json.tiles)) return null;
    const meta = json.meta || {};
    const num  = v => (typeof v === 'number' ? v : null);
    let collection = null;
    const videos = [];
    for (const tile of json.tiles) {
      const data  = tile && tile.data;
      const media = data && data.media;
      if (!media || !media.lti_launch_id) continue;   // pasta ou item que não é vídeo
      if (!collection && data.collection && data.collection.id != null) {
        collection = { id: String(data.collection.id), name: data.collection.name || '', type: data.collection.type || '' };
      }
      videos.push({ id: String(media.lti_launch_id), title: String(data.title || media.title || '') });
    }
    return { collection, videos, total: num(meta.total_count), currentPage: num(meta.current_page),
      lastPage: num(meta.last_page), perPage: num(meta.per_page) };
  }

  // Uma lista por endereço sem "page" (uma busca dentro da coleção é outra lista).
  const lists = new Map();
  function signatureOf(url) {
    try { const u = new URL(url, location.href); u.searchParams.delete('page'); return u.href; } catch { return String(url); }
  }

  function accumulate(sig, parsed) {
    let l = lists.get(sig);
    if (!l) { l = { collection: null, videos: new Map(), total: null, paging: false }; lists.set(sig, l); }
    if (parsed.collection) l.collection = parsed.collection;
    if (parsed.total != null) l.total = parsed.total;
    const before = l.videos.size;
    for (const v of parsed.videos) if (!l.videos.has(v.id)) l.videos.set(v.id, v);
    return l.videos.size - before;
  }

  function emit(sig) {
    const l = lists.get(sig);
    window.postMessage({
      __svcStudio: true, type: 'tiles', signature: sig,
      collection: l.collection, total: l.total,
      videos: [...l.videos.values()],
      complete: l.total != null && l.videos.size >= l.total,
    }, '*');
  }

  async function completePages(url, parsed, req) {
    const sig = signatureOf(url);
    const l   = lists.get(sig);
    const pages = parsed.lastPage ?? (parsed.total != null && parsed.perPage ? Math.ceil(parsed.total / parsed.perPage) : null);
    if (l.paging || !pages || pages <= 1 || typeof origFetch !== 'function') return;
    if (req && req.method && req.method.toUpperCase() !== 'GET') return;
    l.paging = true;
    for (let page = 1; page <= Math.min(pages, MAX_PAGES); page++) {
      if (page === parsed.currentPage) continue;
      try {
        const u = new URL(url, location.href);
        u.searchParams.set('page', String(page));
        const res = await origFetch.call(window, u.href, {
          method: 'GET',
          headers: Object.assign({ Accept: 'application/json' }, (req && req.headers) || {}),
          credentials: (req && req.credentials) || 'same-origin',
        });
        if (!res.ok) { console.warn('[Service Timer] Studio: página', page, 'respondeu', res.status); break; }
        const next = readTiles(await res.json());
        if (!next) break;
        if (!accumulate(sig, next)) break;   // o servidor ignorou "page": não adianta seguir
        emit(sig);
      } catch (err) {
        console.warn('[Service Timer] Studio: falha na página', page, err);
        break;
      }
    }
  }

  function analyze(url, text, req) {
    let parsed;
    try { parsed = readTiles(JSON.parse(text)); } catch { return; }
    if (!parsed || !parsed.videos.length) return;
    const sig = signatureOf(url);
    accumulate(sig, parsed);
    emit(sig);
    completePages(url, parsed, req);
  }

  if (typeof origFetch === 'function') {
    window.fetch = function (...args) {
      const [input, init] = args;
      return origFetch.apply(this, args).then(res => {
        try {
          const url = absUrl((res && res.url) || (typeof input === 'string' ? input : input && input.url) || '');
          if (isTiles(url)) {
            const fromReq = input && typeof input === 'object' ? input : null;
            const req = {
              method: (init && init.method) || (fromReq && fromReq.method) || 'GET',
              headers: headersToObject((init && init.headers) || (fromReq && fromReq.headers)),
              credentials: (init && init.credentials) || (fromReq && fromReq.credentials) || undefined,
            };
            res.clone().text().then(t => analyze(url, t, req)).catch(() => {});
          }
        } catch { /* nunca atrapalha o Studio */ }
        return res;
      });
    };
  }

  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open, origSend = XHR.send, origSetHeader = XHR.setRequestHeader;
  XHR.open = function (method, url, ...rest) {
    this.__svcUrl = absUrl(url);
    this.__svcMethod = method;
    this.__svcHeaders = {};
    return origOpen.call(this, method, url, ...rest);
  };
  XHR.setRequestHeader = function (name, value) {
    try { if (name && !SKIP_HEADERS.has(String(name).toLowerCase())) (this.__svcHeaders = this.__svcHeaders || {})[name] = value; } catch {}
    return origSetHeader.call(this, name, value);
  };
  XHR.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        const url = this.responseURL || this.__svcUrl || '';
        if (isTiles(url) && typeof this.responseText === 'string') {
          analyze(url, this.responseText, {
            method: this.__svcMethod || 'GET', headers: this.__svcHeaders || {},
            credentials: this.withCredentials ? 'include' : 'same-origin',
          });
        }
      } catch {}
    });
    return origSend.apply(this, args);
  };
})();
