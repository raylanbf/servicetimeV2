'use strict';

// Gravador de Ações — roda no mundo MAIN do site escolhido no popup, desde o
// início da página (o popup registra este arquivo só para aquele site).
//
// Grava o que a tela faz enquanto alguém usa o site: pedidos fetch/XHR (com
// corpo e resposta), envios de formulário, cliques, menus e janelas que se
// abrem, trocas de página (inclusive as de app de página única) e o HTML da
// página. Guarda no sessionStorage, que sobrevive à troca de página na mesma
// aba, e baixa tudo num .json pelo quadro no canto da tela.
//
// Privacidade: cookies não são lidos. Dos cabeçalhos, só os nomes (e o valor
// dos que não são segredo). E-mails, JWT, tokens longos e campos com
// token/password/secret/auth/session/cookie no nome saem trocados por
// [email]/[jwt]/[token]/[oculto]. Senhas e arquivos nunca são lidos.
(() => {
  if (window.__gravadorAcoes || window !== window.top) return;
  window.__gravadorAcoes = true;

  const KEY = '__gravadorAcoes';
  const BOX_ID = 'gravador-acoes-box';
  const MAX_TEXT = 30000, MAX_HTML = 250000, MAX_ENTRIES = 500, MAX_POPUPS = 80;
  const SECRET_KEY = /token|password|passwd|secret|auth|session|cookie/i;
  const SAFE_HEADERS = /^(content-type|accept|x-requested-with)$/i;

  // Tudo no texto, sem JSON.parse: IDs grandes (ex.: 19 dígitos no H5P.com)
  // seriam arredondados por um parse/stringify.
  const SECRET = '[\\w-]*(?:token|password|passwd|secret|auth|session|cookie)[\\w-]*';
  const redact = s => String(s == null ? '' : s)
    .replace(new RegExp(`("${SECRET}"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|[^,}\\]\\s]+)`, 'gi'), '$1"[oculto]"')
    .replace(new RegExp(`(<input\\b[^>]*\\bname=["']${SECRET}["'][^>]*\\bvalue=["'])[^"']*`, 'gi'), '$1[oculto]')
    .replace(new RegExp(`(<input\\b[^>]*\\bvalue=["'])[^"']*(["'][^>]*\\bname=["']${SECRET}["'])`, 'gi'), '$1[oculto]$2')
    .replace(/(<meta\b[^>]*\bname=["'][\w-]*(?:token|csrf)[\w-]*["'][^>]*\bcontent=["'])[^"']*/gi, '$1[oculto]')
    .replace(new RegExp(`([?&]${SECRET}=)[^&\\s"'#]*`, 'gi'), '$1[oculto]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]')
    .replace(/\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{32,}\b/g, '[token]');
  const cut = (s, n) => (s.length > n ? s.slice(0, n) + `…[+${s.length - n}]` : s);
  const clean = (s, n = MAX_TEXT) => cut(redact(s), n);
  const hideIfSecret = (k, v) => (SECRET_KEY.test(k) ? '[oculto]' : clean(v, 2000));

  // ── armazenamento ───────────────────────────────────────────────────────
  const empty = () => ({ entries: [], pages: [] });
  function load() { try { return JSON.parse(sessionStorage.getItem(KEY)) || empty(); } catch { return empty(); } }
  const state = load();
  function save() {
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); }
    catch {
      // Cheio: fica só a última foto de página.
      state.pages = state.pages.slice(-1);
      try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch { /* segue só em memória */ }
    }
    updateBox();
  }
  function add(type, data) {
    if (state.entries.length >= MAX_ENTRIES) return;
    state.entries.push({ t: new Date().toISOString(), page: location.pathname + location.search, type, ...data });
    save();
  }

  // ── corpo e cabeçalhos ──────────────────────────────────────────────────
  function bodyInfo(body) {
    if (body == null) return null;
    try {
      if (typeof body === 'string') {
        if (/^\s*[[{]/.test(body)) return { json: clean(body, 8000) };
        if (/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(body)) {
          const f = {};
          for (const [k, v] of new URLSearchParams(body)) f[k] = hideIfSecret(k, v);
          return { form: f };
        }
        return { text: clean(body, 4000) };
      }
      if (body instanceof URLSearchParams || body instanceof FormData) {
        const f = {};
        for (const [k, v] of body.entries()) f[k] = typeof v === 'string' ? hideIfSecret(k, v) : `[arquivo ${v.name} ${v.size}B]`;
        return { [body instanceof FormData ? 'formData' : 'form']: f };
      }
      if (body instanceof Blob) return { blob: `${body.type || '?'} ${body.size}B` };
      return { kind: Object.prototype.toString.call(body) };
    } catch (e) { return { erro: String(e) }; }
  }
  function headerInfo(h) {
    const out = {};
    const put = (k, v) => { out[k] = SAFE_HEADERS.test(k) ? String(v) : '[presente]'; };
    try {
      if (!h) return out;
      if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => put(k, v));
      else if (Array.isArray(h)) h.forEach(([k, v]) => put(k, v));
      else Object.entries(h).forEach(([k, v]) => put(k, v));
    } catch { /* formato inesperado */ }
    return out;
  }
  const wantBody = ct => /json|text|html|xml|javascript/i.test(ct || '');

  // ── fetch ───────────────────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const method = (init && init.method) || (input && input.method) || 'GET';
    const req = { via: 'fetch', method, url: redact(url),
      headers: headerInfo((init && init.headers) || (input && input.headers)), body: bodyInfo(init && init.body) };
    try {
      const res = await origFetch.apply(this, arguments);
      try {
        const ct = res.headers.get('content-type') || '';
        const text = wantBody(ct) ? await res.clone().text() : '';
        add('request', { ...req, status: res.status, redirected: res.redirected, finalUrl: redact(res.url),
          contentType: ct, response: text ? clean(text) : null });
      } catch (e) { add('request', { ...req, status: res.status, erro: String(e) }); }
      return res;
    } catch (e) { add('request', { ...req, erro: String(e) }); throw e; }
  };

  // ── XHR ─────────────────────────────────────────────────────────────────
  const XP = XMLHttpRequest.prototype;
  const oOpen = XP.open, oSend = XP.send, oSet = XP.setRequestHeader;
  XP.open = function (method, url) { this.__grav = { method, url: String(url), headers: {} }; return oOpen.apply(this, arguments); };
  XP.setRequestHeader = function (k, v) { if (this.__grav) this.__grav.headers[k] = v; return oSet.apply(this, arguments); };
  XP.send = function (body) {
    const m = this.__grav;
    if (m) {
      this.addEventListener('loadend', () => {
        let ct = '', text = null;
        try { ct = this.getResponseHeader('content-type') || ''; } catch { /* sem cabeçalho */ }
        try { if (wantBody(ct) && (this.responseType === '' || this.responseType === 'text')) text = clean(this.responseText); } catch { /* binário */ }
        add('request', { via: 'xhr', method: m.method, url: redact(m.url), headers: headerInfo(m.headers), body: bodyInfo(body),
          status: this.status, finalUrl: redact(this.responseURL), contentType: ct, response: text });
      });
    }
    return oSend.apply(this, arguments);
  };

  // ── trocas de página sem recarregar (apps de página única) ───────────────
  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn];
    history[fn] = function () {
      const r = orig.apply(this, arguments);
      add('navegou-spa', { via: fn, url: redact(location.href) });
      return r;
    };
  }
  window.addEventListener('popstate', () => add('navegou-spa', { via: 'popstate', url: redact(location.href) }));

  // ── formulários, cliques, menus e janelas ───────────────────────────────
  const inBox = el => el && el.closest && el.closest('#' + BOX_ID);
  function describe(el) {
    if (!el || el.nodeType !== 1) return null;
    const attrs = {};
    for (const a of el.attributes) if (!/^on/i.test(a.name) && a.name !== 'style') attrs[a.name] = clean(a.value, 300);
    return { tag: el.tagName.toLowerCase(), text: clean((el.innerText || el.value || '').trim().replace(/\s+/g, ' '), 120), attrs };
  }
  function fieldValues(root) {
    const out = [];
    if (!root || !root.querySelectorAll) return out;
    for (const i of root.querySelectorAll('input, select, textarea')) {
      if (i.type === 'password' || i.type === 'file') continue;
      const name = i.name || i.id || i.getAttribute('aria-label') || i.placeholder || '';
      const value = i.type === 'checkbox' || i.type === 'radio' ? String(i.checked) : i.value;
      out.push({ name, type: i.type || i.tagName.toLowerCase(), value: hideIfSecret(name, value), hidden: i.type === 'hidden' });
    }
    return out;
  }
  const CONTAINER_SEL = 'form, [role=dialog], dialog, .modal, [class*="modal"], [class*="dialog"], [class*="popup"]';

  document.addEventListener('submit', ev => {
    const f = ev.target;
    if (inBox(f)) return;
    add('submit', { action: redact(f.action), method: f.method, enctype: f.enctype, form: describe(f), fields: fieldValues(f) });
  }, true);

  document.addEventListener('click', ev => {
    if (inBox(ev.target)) return;
    const el = ev.target.closest('button, a, [role=button], [role=menuitem], [role=option], [role=tab], input[type=submit], input[type=button], li, label') || ev.target;
    const box = el.closest(CONTAINER_SEL);
    add('click', { el: describe(el), parents: [el.parentElement, el.parentElement && el.parentElement.parentElement].map(describe),
      container: box ? { el: describe(box), fields: fieldValues(box) } : null });
  }, true);

  // Menus e janelas: grava quando ficam VISÍVEIS. Muitos sites (Bootstrap,
  // Laravel) já trazem as janelas no HTML, escondidas, e só trocam a classe.
  const POPUP_SEL = '[role=dialog], dialog, .modal, [class*="modal"], [class*="dialog"], [role=menu], [role=listbox], [class*="dropdown-menu"], [class*="popover"], [class*="popup"]';
  const shownBefore = new WeakSet();
  let popups = 0;
  const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  function checkPopup(el) {
    if (popups >= MAX_POPUPS || inBox(el) || !el.matches(POPUP_SEL)) return;
    if (!visible(el)) { shownBefore.delete(el); return; }
    if (shownBefore.has(el)) return;
    shownBefore.add(el); popups++;
    add('popup', { el: describe(el), html: clean(el.outerHTML, 20000), fields: fieldValues(el) });
  }
  let pending = new Set(), scheduled = false;
  function queue(el) {
    pending.add(el);
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {   // espera a animação de abrir
      scheduled = false;
      const list = [...pending]; pending = new Set();
      for (const n of list) {
        if (!n.isConnected) continue;
        checkPopup(n);
        if (n.querySelectorAll) for (const c of n.querySelectorAll(POPUP_SEL)) checkPopup(c);
      }
    }, 350);
  }

  // ── fotos da página ─────────────────────────────────────────────────────
  function snapshotPage(when) {
    let extraGlobals = [];
    try {
      const f = document.createElement('iframe'); f.style.display = 'none'; document.documentElement.appendChild(f);
      const std = new Set(Object.getOwnPropertyNames(f.contentWindow)); f.remove();
      extraGlobals = Object.getOwnPropertyNames(window).filter(k => !std.has(k) && !k.startsWith('__grav') && !k.startsWith('webkit'))
        .slice(0, 150).map(k => { let t; try { t = typeof window[k]; } catch { t = '?'; } return k + ':' + t; });
    } catch { /* sem iframe */ }
    const page = { when, t: new Date().toISOString(), url: redact(location.href), title: document.title,
      meta: [...document.querySelectorAll('meta[name]')].map(m => m.name + (SECRET_KEY.test(m.name) || /csrf/i.test(m.name) ? '=[oculto]' : '=' + clean(m.content, 200))),
      scripts: [...document.scripts].map(s => (s.src ? redact(s.src) : `[inline ${s.textContent.length}B]`)),
      forms: [...document.forms].map(f => ({ id: f.id, action: redact(f.action), method: f.method, enctype: f.enctype, fields: fieldValues(f) })),
      extraGlobals, html: clean(document.documentElement.outerHTML, MAX_HTML) };
    state.pages = state.pages.filter(p => p.url !== page.url || p.when !== when).slice(-2);
    state.pages.push(page);
    save();
  }

  // ── quadro ──────────────────────────────────────────────────────────────
  let box;
  function updateBox() {
    if (!box) return;
    const n = state.entries.length, r = state.entries.filter(e => e.type === 'request').length;
    box.querySelector('[data-n]').textContent = `${n} registro(s) · ${r} pedido(s) · ${state.pages.length} foto(s)`;
  }
  function download() {
    const data = { ferramenta: 'Gravador de Ações', versao: 1, site: location.hostname, gerado: new Date().toISOString(),
      userAgent: navigator.userAgent, ...state };
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = `gravacao-${location.hostname}-${stamp}.json`;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function button(label, bg, onclick) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.onclick = onclick;
    b.style.cssText = `background:${bg};color:#fff;border:0;border-radius:5px;padding:5px 9px;cursor:pointer;margin:0 6px 0 0;font:12px system-ui,sans-serif`;
    return b;
  }
  function mountBox() {
    if (document.getElementById(BOX_ID)) return;
    box = document.createElement('div');
    box.id = BOX_ID;
    box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;background:#0f172a;color:#e2e8f0;font:12px/1.4 system-ui,sans-serif;padding:10px 12px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.35);max-width:300px';
    box.innerHTML = '<div style="font-weight:600;margin-bottom:4px">🔴 Gravador de Ações</div><div data-n style="color:#94a3b8;margin-bottom:8px"></div>';
    box.append(
      button('Salvar arquivo', '#2563eb', download),
      button('Foto da página', '#475569', () => snapshotPage('foto ' + new Date().toLocaleTimeString('pt-BR'))),
      button('Limpar', '#334155', () => { state.entries = []; state.pages = []; popups = 0; save(); }),
    );
    document.body.appendChild(box);
    updateBox();
  }

  add('navegou', { url: redact(location.href), referrer: redact(document.referrer) });
  document.addEventListener('DOMContentLoaded', () => {
    mountBox();
    new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'attributes') { if (m.target.nodeType === 1) queue(m.target); continue; }
        for (const n of m.addedNodes) if (n.nodeType === 1) queue(n);
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'open', 'aria-hidden', 'hidden'] });
  });
  window.addEventListener('load', () => setTimeout(() => snapshotPage('load'), 1500));
})();
