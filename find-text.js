'use strict';

// "🔎 Procurar texto em outra aba ou arquivo (Word/HTML)" (menu do botão direito) — parte
// do service worker. Abre o painel (find-text-panel.js) na aba onde o texto
// foi selecionado e faz por ele o que uma página não pode:
//   • listar as abas abertas (de todas as janelas: a referência costuma estar
//     no outro monitor);
//   • ler o texto de outra aba, de todos os quadros (o H5P dentro do Canvas é
//     um iframe de outro site);
//   • mostrar onde o trecho está: ativa a aba, rola até ele e o destaca
//     (CSS Custom Highlight: não mexe no HTML da página);
//   • injetar o leitor de arquivos do Extrator (extrator.js: .docx e .html)
//     só quando é preciso.
// Só leitura: nada é alterado nas abas lidas. Páginas do Chrome e de outras
// extensões (ex.: o Extrator de Questões) não podem ser lidas por extensão.
// Liga e desliga nas configurações (findTextEnabled, padrão desligado): o
// item do menu só aparece com a chave ligada, e vale na hora.
// Regressão: .claude/skills/h5p-quiz/scripts/test-find-text.js
const FIND_TEXT = (() => {
  const UNREADABLE = [
    [/^chrome-extension:/, 'página de extensão (ex.: o Extrator): o Chrome não deixa ler'],
    [/^(?:chrome|edge|about|devtools|view-source|chrome-search|chrome-untrusted):/, 'página do navegador: não dá para ler'],
    [/^https:\/\/(?:chromewebstore\.google\.com|chrome\.google\.com\/webstore)/, 'loja do Chrome: não dá para ler'],
  ];
  const whyUnreadable = url => (UNREADABLE.find(([re]) => re.test(url || '')) || [])[1] || '';

  const MENU_ID = 'find-text';
  const enabled = async () => {
    try { return (await chrome.storage.local.get({ findTextEnabled: false })).findTextEnabled === true; }
    catch { return false; }
  };
  // Mostra ou esconde o item do menu conforme a chave. O item pode ainda não
  // existir (é criado no onInstalled): o erro é ignorado, e o onInstalled
  // chama de novo depois de criar.
  async function syncMenu() {
    const visible = await enabled();
    chrome.contextMenus.update(MENU_ID, { visible }, () => void chrome.runtime.lastError);
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'findTextEnabled' in changes) syncMenu();
  });
  syncMenu();

  async function open(info, tab) {
    if (!tab?.id || !(await enabled())) return;
    // O trecho inteiro e com as quebras de linha, do quadro onde foi selecionado
    // (info.selectionText vem sem quebras).
    let query = info.selectionText || '';
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [info.frameId || 0] },
        func: () => String(getSelection() || ''),
      });
      if (r?.result?.trim()) query = r.result;
    } catch { /* fica o selectionText */ }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['text-compare.js', 'find-text-panel.js'] });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: q => globalThis.__svcFindPanel.open(q),
      args: [query],
    });
  }

  async function listTabs(sender) {
    const me = sender.tab;
    const tabs = await chrome.tabs.query({});
    return tabs
      .filter(t => t.id !== me?.id)
      .map(t => ({
        id: t.id, title: t.title || t.url || 'Aba sem título', url: t.url || '', windowId: t.windowId,
        active: !!t.active, otherWindow: t.windowId !== me?.windowId, lastAccessed: t.lastAccessed || 0,
        unreadable: whyUnreadable(t.url),
      }))
      // primeiro a aba aberta na outra janela (o outro monitor), depois as mais recentes
      .sort((a, b) => (b.active && b.otherWindow) - (a.active && a.otherWindow) || b.lastAccessed - a.lastAccessed);
  }

  // ── Funções injetadas na aba lida ────────────────────────────────────
  // Texto visível do quadro e as seções (títulos e linhas "Questão N", "Tópico N"…).
  function readFrame() {
    if (!document.body) return null;
    const text = document.body.innerText || '';
    const clean = s => s.replace(/\s+/g, ' ').trim();
    const heads = new Set([...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(h => clean(h.innerText || '')).filter(Boolean));
    const START = /^(?:quest[ãa]o|t[óo]pico|unidade|tema|atividade|exerc[íi]cio)\s*\d+/i;
    const sections = [];
    let cur = null;
    for (const line of text.split('\n')) {
      const l = clean(line);
      if (l && l.length <= 120 && (START.test(l) || heads.has(l))) { cur = [l, line + '\n']; sections.push(cur); continue; }
      if (cur) cur[1] += line + '\n';
    }
    return { url: location.href, title: document.title, top: window === window.top, text, sections };
  }

  // Em todos os quadros: quando um iframe filho avisa onde ficou o destaque,
  // rola este quadro até lá e repassa para o de cima (o H5P fica dentro de
  // iframes que crescem com o conteúdo, então quem rola é a página de fora).
  function relayScroll() {
    if (globalThis.__svcFindRelay) return;
    globalThis.__svcFindRelay = true;
    addEventListener('message', e => {
      const d = e.data;
      if (!d || d.__svcFind !== 'scroll' || typeof d.y !== 'number') return;
      const frame = [...document.querySelectorAll('iframe, frame')].find(f => f.contentWindow === e.source);
      if (!frame) return;
      const y = () => frame.getBoundingClientRect().top + frame.clientTop + d.y;
      scrollBy({ top: y() - innerHeight / 2, behavior: 'instant' });
      if (window !== window.top) parent.postMessage({ __svcFind: 'scroll', y: y() }, '*');
    });
  }

  // Destaca o trecho (texto já normalizado) e rola até ele. Compara só letras e
  // números, sem acento nem maiúscula, porque o texto lido passou por
  // normalização (aspas, espaços…). Se o trecho inteiro não bater (texto
  // escondido no meio), marca do começo ao fim dele. → true se achou.
  function highlight(needle) {
    const LETTER = /[\p{L}\p{N}]/u;
    const NOISE = /^\s*(?:Links\s+para\s+um\s+site\s+externo\.?|Links\s+to\s+an\s+external\s+site\.?|\(abre\s+em\s+uma\s+nova\s+janela\))\s*$/i;
    const keyOf = s => { let k = ''; for (const ch of s) for (const c of ch.normalize('NFD')) if (LETTER.test(c)) k += c.toLowerCase()[0]; return k; };
    let key = '';
    const map = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      if (n.parentElement?.closest('script, style, noscript, template, textarea, #__svc-find__')) continue;
      if (NOISE.test(n.data)) continue;
      const s = n.data;
      for (let i = 0; i < s.length; i++) {
        for (const c of s[i].normalize('NFD')) if (LETTER.test(c)) { key += c.toLowerCase()[0]; map.push([n, i]); }
      }
    }
    const rangeOf = (from, to) => {
      const r = document.createRange();
      r.setStart(map[from][0], map[from][1]);
      r.setEnd(map[to][0], map[to][1] + 1);
      return r;
    };
    const visible = r => r.getClientRects().length > 0;
    const nk = keyOf(needle);
    if (!nk) return false;
    let range = null;
    for (let at = key.indexOf(nk); at !== -1 && !range; at = key.indexOf(nk, at + 1)) {
      const r = rangeOf(at, at + nk.length - 1);
      if (visible(r)) range = r;
    }
    if (!range) {
      // começo e fim do trecho, em ordem e perto um do outro
      const head = nk.slice(0, 40), tail = nk.slice(-40);
      for (let at = key.indexOf(head); at !== -1 && !range; at = key.indexOf(head, at + 1)) {
        const end = key.indexOf(tail, at);
        if (end === -1 || end - at > nk.length * 2 + 200) continue;
        const r = rangeOf(at, end + tail.length - 1);
        if (visible(r)) range = r;
      }
    }
    if (!range) return false;
    if (globalThis.CSS?.highlights && globalThis.Highlight) {
      if (!document.getElementById('__svc-find-style__')) {
        const st = document.createElement('style');
        st.id = '__svc-find-style__';
        st.textContent = '::highlight(svc-find){background-color:#facc15;color:#111827}';
        (document.head || document.documentElement).appendChild(st);
      }
      CSS.highlights.set('svc-find', new Highlight(range));
      addEventListener('pointerdown', () => CSS.highlights.delete('svc-find'), { once: true, capture: true });
    } else {
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    }
    (range.startContainer.parentElement || document.body).scrollIntoView({ block: 'center', behavior: 'instant' });
    if (window !== window.top) {
      const r = range.getBoundingClientRect();
      parent.postMessage({ __svcFind: 'scroll', y: r.top + r.height / 2 }, '*');
    }
    return true;
  }

  // ── Pedidos do painel ────────────────────────────────────────────────
  const friendly = (e, url = '') => {
    const m = e?.message || String(e);
    if (/discarded/i.test(m)) return 'O Chrome suspendeu essa aba para poupar memória. Clique nela uma vez e tente de novo.';
    if (/^file:/i.test(url) || /Cannot access contents of url "file:/i.test(m)) return 'Arquivo aberto numa aba do Chrome: escolha ele pelo botão "📄 Escolher arquivo…" (ou ative "Permitir acesso aos URLs de arquivo" nos detalhes da extensão).';
    if (/Cannot access|cannot be scripted|No tab with id/i.test(m)) return 'Não consegui ler essa aba (o Chrome bloqueou ou ela foi fechada).';
    return m;
  };

  async function readTab(tabId) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return { status: 'error', message: 'Essa aba foi fechada.' };
    const why = whyUnreadable(tab.url);
    if (why) return { status: 'error', message: `Não dá para ler "${tab.title}": ${why}.` };
    try {
      const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: readFrame });
      const frames = results.filter(r => r.result?.text?.trim()).map(r => ({ frameId: r.frameId, ...r.result }));
      if (!frames.length) return { status: 'error', message: `Não achei texto em "${tab.title}". (PDF aberto no Chrome não dá para ler.)` };
      return { status: 'ok', title: tab.title, url: tab.url, frames };
    } catch (e) {
      return { status: 'error', message: friendly(e, tab.url) };
    }
  }

  async function show(tabId, frameId, needle) {
    try {
      const tab = await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: relayScroll }).catch(() => {});
      const [r] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: highlight, args: [needle] });
      return r?.result ? { status: 'ok' } : { status: 'error', message: 'A página mudou desde a busca: procure de novo.' };
    } catch (e) {
      return { status: 'error', message: friendly(e) };
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const a = msg?.action;
    if (typeof a !== 'string' || !a.startsWith('find-')) return;
    let job;
    if (a === 'find-tabs') job = listTabs(sender).then(tabs => ({ status: 'ok', tabs }));
    else if (a === 'find-read') job = readTab(Number(msg.tabId));
    else if (a === 'find-show') job = show(Number(msg.tabId), Number(msg.frameId), String(msg.needle || ''));
    else if (a === 'find-extrator' && sender.tab?.id) {
      job = chrome.scripting.executeScript({ target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] }, files: ['extrator.js'] })
        .then(() => ({ status: 'ok' }));
    }
    else return;
    job.then(sendResponse, e => sendResponse({ status: 'error', message: friendly(e) }));
    return true;   // resposta assíncrona
  });

  return { MENU_ID, open, syncMenu, enabled, readFrame, highlight, relayScroll, whyUnreadable };
})();
