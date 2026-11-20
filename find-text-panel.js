'use strict';

// Painel "🔎 Procurar texto" — injetado pelo find-text.js na aba onde o texto
// foi selecionado (quadro de cima, mundo isolado, junto com text-compare.js).
// Procura o trecho em outra aba ou num arquivo (Word .docx ou .html) e mostra:
//   • IGUAL (100%), PARCIAL (a partir de 85%) ou DIFERENTE / NÃO ENCONTRADO;
//   • onde está ("📄 arquivo.docx › Questão 11", "🗂 aba › H5P › Questão 3",
//     "📄 relatório da FIC.html › Questão 2 (sessão)");
//   • as diferenças palavra a palavra, com as cores do Comparador de Questões
//     (vermelho riscado = só no trecho procurado; verde = falta nele).
// O arquivo é lido pelo leitor do Extrator de Questões (extrator.js): procura
// no texto inteiro, e as questões que ele reconhece (no relatório da FIC, as
// células "Questão de Fixação", com o nome da sessão) dizem onde achou. O
// texto fica guardado (chrome.storage.local, findFile) para as próximas buscas.
// A última escolha de onde procurar também (findTarget): com ela, selecionar
// e clicar no menu já mostra o resultado, como o F8 do programa em Python.
// Nada é alterado: nem a aba lida, nem o arquivo.
// O arquivo é injetado de novo a cada uso: o painel da vez anterior sai antes.
try { globalThis.__svcFindPanel?.close(); } catch { /* de uma versão anterior */ }
globalThis.__svcFindPanel = (() => {
  const C = globalThis.__svcCompare;
  const HOST_ID = '__svc-find__';

  const send = msg => new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(msg, r => resolve(chrome.runtime.lastError
        ? { status: 'error', message: 'A extensão foi recarregada: feche este painel e use o menu de novo.' }
        : r || { status: 'error', message: 'Sem resposta da extensão.' }));
    } catch {
      resolve({ status: 'error', message: 'A extensão foi recarregada: feche este painel e use o menu de novo.' });
    }
  });
  const load = async key => { try { return (await chrome.storage.local.get(key))[key]; } catch { return undefined; } };
  const save = async (key, value) => { try { await chrome.storage.local.set({ [key]: value }); } catch { /* sem memória: segue */ } };

  const CSS_TEXT = `
    :host { all: initial; }
    .box { position: fixed; top: 16px; right: 16px; z-index: 2147483647; width: 460px;
      max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); display: flex; flex-direction: column;
      background: #1e1e2e; color: #e2e8f0; border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,.7);
      font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; }
    header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; cursor: move; user-select: none;
      font-weight: bold; font-size: 14px; border-bottom: 1px solid #2a2a3e; }
    header button { margin-left: auto; background: none; border: none; color: #94a3b8; font-size: 16px; cursor: pointer; padding: 0 4px; }
    header button:hover { color: #e2e8f0; }
    .body { padding: 12px 14px 14px; overflow: auto; }
    label { display: block; font-size: 11px; font-weight: bold; color: #94a3b8; margin: 0 0 4px; }
    label span { font-weight: normal; }
    textarea, select { width: 100%; box-sizing: border-box; background: #2a2a3e; color: #e2e8f0;
      border: 1px solid #3a3a5e; border-radius: 4px; font: 12px/1.4 system-ui, 'Segoe UI', sans-serif; outline: none; }
    textarea { min-height: 64px; max-height: 180px; resize: vertical; padding: 6px 8px; margin-bottom: 10px; }
    select { padding: 6px; }
    textarea:focus, select:focus { border-color: #4ade80; }
    .row { display: flex; gap: 8px; margin: 10px 0 4px; }
    button.btn { flex: 1; padding: 7px; border-radius: 4px; border: none; background: #2a2a3e; color: #e2e8f0; cursor: pointer; font-size: 13px; }
    button.btn:hover { background: #33334d; }
    button.primary { background: #4ade80; color: #0f172a; font-weight: bold; }
    button.primary:hover { background: #22c55e; }
    button:disabled { opacity: .5; cursor: default; }
    .status { min-height: 16px; font-size: 11.5px; color: #94a3b8; margin: 6px 0 0; }
    .status.err { color: #fca5a5; }
    .verdict { font-weight: bold; font-size: 14px; padding: 8px 10px; border-radius: 6px; margin: 10px 0 8px; }
    .ok { background: #064e3b; color: #a7f3d0; }
    .partial { background: #78350f; color: #fde68a; }
    .err { background: #7f1d1d; color: #fecaca; }
    .where { display: flex; align-items: center; gap: 8px; color: #cbd5e1; font-size: 12px; margin-bottom: 8px; }
    .where span { flex: 1; overflow-wrap: anywhere; }
    .where button { flex: none; padding: 4px 8px; font-size: 12px; }
    .legend { font-size: 11px; color: #94a3b8; margin: 4px 0 6px; }
    .diff { background: #0f172a; border-radius: 6px; padding: 8px 10px; white-space: pre-wrap; overflow-wrap: anywhere;
      font-size: 12.5px; line-height: 1.6; max-height: 260px; overflow: auto; }
    .act { background: #7f1d1d; color: #fecaca; text-decoration: line-through; border-radius: 2px; }
    .exp { background: #14532d; color: #bbf7d0; font-weight: bold; border-radius: 2px; }
    details { margin-top: 8px; font-size: 12px; }
    summary { cursor: pointer; color: #94a3b8; font-size: 11px; }
    .pair { margin: 6px 0 0; color: #cbd5e1; white-space: pre-wrap; overflow-wrap: anywhere; }
    .pair b { color: #94a3b8; }
    .muted { color: #94a3b8; font-size: 11px; }
  `;

  let ui = null;          // elementos do painel aberto
  let tabs = [];          // abas listadas pelo service worker

  function el(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) e.append(k);
    return e;
  }

  function close() {
    document.getElementById(HOST_ID)?.remove();
    document.removeEventListener('keydown', onKey, true);
    ui = null;
  }
  function onKey(e) {
    if (e.key === 'Escape' && ui) { e.stopPropagation(); close(); }
  }

  function build() {
    document.getElementById(HOST_ID)?.remove();
    const host = el('div', { id: HOST_ID });
    const root = host.attachShadow({ mode: 'open' });
    root.append(el('style', { text: CSS_TEXT }));
    const query = el('textarea', { spellcheck: 'false', placeholder: 'Selecione um texto na página antes de abrir, ou cole aqui.' });
    const count = el('span');
    const target = el('select');
    const file = el('input', { type: 'file', accept: '.docx,.html,.htm', style: 'display:none' });
    const pick = el('button', { class: 'btn', text: '📄 Escolher arquivo…' });
    const go = el('button', { class: 'btn primary', text: 'Procurar ▶' });
    const status = el('div', { class: 'status' });
    const result = el('div');
    const closeBtn = el('button', { title: 'Fechar (Esc)', text: '✕' });
    const header = el('header', {}, '🔎 Procurar texto', closeBtn);
    const box = el('div', { class: 'box' }, header, el('div', { class: 'body' },
      el('label', {}, 'Trecho a procurar ', count), query,
      el('label', { text: 'Procurar em' }), target,
      el('div', { class: 'row' }, pick, go), file, status, result));
    root.append(box);
    document.documentElement.append(host);

    closeBtn.addEventListener('click', close);
    query.addEventListener('input', () => { count.textContent = `(${query.value.trim().length} caracteres)`; });
    query.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } });
    target.addEventListener('change', async () => {
      if (target.value === 'pick') { target.value = ui.chosen || ''; file.click(); return; }
      ui.chosen = target.value;
      await save('findTarget', targetInfo(target.value));
      run();
    });
    pick.addEventListener('click', () => file.click());
    file.addEventListener('change', () => { const f = file.files?.[0]; file.value = ''; if (f) loadFile(f); });
    go.addEventListener('click', run);
    document.addEventListener('keydown', onKey, true);

    // arrastar pelo título
    header.addEventListener('pointerdown', e => {
      if (e.target === closeBtn) return;
      const r = box.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      header.setPointerCapture(e.pointerId);
      const move = ev => {
        box.style.left = `${Math.max(0, Math.min(innerWidth - 80, ev.clientX - dx))}px`;
        box.style.top = `${Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy))}px`;
        box.style.right = 'auto';
      };
      header.addEventListener('pointermove', move);
      header.addEventListener('pointerup', () => header.removeEventListener('pointermove', move), { once: true });
    });

    return { host, query, count, target, go, pick, status, result, chosen: '' };
  }

  function setStatus(text, err = false) {
    if (!ui) return;
    ui.status.textContent = text;
    ui.status.className = err ? 'status err' : 'status';
  }

  const hostOf = url => { try { return new URL(url).hostname; } catch { return ''; } };
  function targetInfo(value) {
    if (value === 'file') return { kind: 'file' };
    const t = tabs.find(x => `tab:${x.id}` === value);
    return t ? { kind: 'tab', tabId: t.id, url: t.url, title: t.title } : null;
  }

  async function fillTargets() {
    const [r, doc, last] = await Promise.all([send({ action: 'find-tabs' }), load('findFile'), load('findTarget')]);
    tabs = r?.status === 'ok' ? r.tabs : [];
    const sel = ui.target;
    sel.textContent = '';
    sel.append(el('option', { value: '', text: '— escolha onde procurar —' }));
    const files = el('optgroup', { label: 'Arquivo (Word ou HTML)' });
    if (doc?.texto) {
      const when = new Date(doc.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const n = doc.questoes.length;
      files.append(el('option', { value: 'file', text: `📄 ${doc.name} (lido em ${when}${n ? `, ${n} ${n === 1 ? 'questão' : 'questões'}` : ''})` }));
    }
    files.append(el('option', { value: 'pick', text: '📄 Escolher um arquivo (.docx ou .html)…' }));
    sel.append(files);
    const open = el('optgroup', { label: 'Abas abertas' });
    for (const t of tabs) {
      const where = t.otherWindow ? (t.active ? ' — outra janela, aberta agora' : ' — outra janela') : '';
      const o = el('option', { value: `tab:${t.id}`, text: `🗂 ${t.title.slice(0, 70)} (${hostOf(t.url) || t.url.slice(0, 30)})${t.unreadable ? ` — ${t.unreadable}` : where}` });
      if (t.unreadable) o.disabled = true;
      open.append(o);
    }
    if (!tabs.length) open.append(el('option', { value: '', disabled: '', text: r?.status === 'ok' ? 'Nenhuma outra aba aberta.' : (r?.message || 'Não consegui listar as abas.') }));
    sel.append(open);

    // A última escolha, se ainda existe; senão, a aba aberta na outra janela.
    let value = '';
    if (last?.kind === 'file' && doc?.texto) value = 'file';
    else if (last?.kind === 'tab') {
      const same = tabs.find(t => !t.unreadable && t.id === last.tabId) || tabs.find(t => !t.unreadable && t.url === last.url);
      if (same) value = `tab:${same.id}`;
    }
    if (!value) { const other = tabs.find(t => !t.unreadable && t.active && t.otherWindow); if (other) value = `tab:${other.id}`; }
    sel.value = value;
    ui.chosen = value;
  }

  async function loadFile(f) {
    if (!/\.(docx|html?)$/i.test(f.name)) return setStatus('Escolha um arquivo .docx ou .html (o .doc antigo: no Word, Salvar como → Documento do Word).', true);
    if (f.size > 30 * 1024 * 1024) return setStatus('Arquivo grande demais (mais de 30 MB).', true);
    setStatus(`Lendo ${f.name}…`);
    if (!globalThis.__svcExtrator) {
      const r = await send({ action: 'find-extrator' });
      if (r?.status !== 'ok' || !globalThis.__svcExtrator) return setStatus(`Não consegui carregar o leitor de arquivos: ${r?.message || 'erro desconhecido'}`, true);
    }
    let res;
    try {
      res = globalThis.__svcExtrator.lerDocumento(f.name, new Uint8Array(await f.arrayBuffer()));
    } catch (e) {
      return setStatus(`Não consegui ler o arquivo: ${e.message}`, true);
    }
    // No relatório da FIC, cada questão vem depois do separador da sua sessão.
    const sessionOf = first => {
      for (let i = first; i >= 0; i--) if (res.paragrafos[i]?.secao !== undefined) return res.paragrafos[i].secao;
      return '';
    };
    const doc = {
      name: f.name, at: Date.now(), texto: res.texto,
      paragrafos: res.paragrafos.map(p => p.texto),
      questoes: res.questoes.map(q => ({ numero: q.numero, paragrafos: q.paragrafos, sessao: sessionOf(q.paragrafos[0] ?? -1) })),
    };
    if (!doc.texto.trim()) return setStatus('Esse arquivo não tem texto.', true);
    await save('findFile', doc);
    await save('findTarget', { kind: 'file' });
    if (!ui) return;
    await fillTargets();
    ui.target.value = 'file';
    ui.chosen = 'file';
    run();
  }

  // Arquivo → texto inteiro e as questões que o Extrator reconheceu, como seções.
  function docTarget(doc) {
    const seen = new Map();
    const sections = doc.questoes.map(q => {
      let label = `Questão ${q.numero}`;
      const n = (seen.get(label) || 0) + 1;
      seen.set(label, n);
      if (n > 1) label += ` (${n}ª com esse número)`;
      if (q.sessao) label += ` (${q.sessao})`;
      return [label, q.paragrafos.map(i => doc.paragrafos[i] || '').join('\n')];
    });
    return { text: doc.texto, sections };
  }

  async function run() {
    if (!ui) return;
    const query = C.stripPageNoise(ui.query.value);
    const value = ui.target.value;
    ui.result.textContent = '';
    if (!query.trim()) return setStatus('Selecione um texto na página (ou cole aqui) para procurar.', true);
    if (!value) return setStatus('Escolha onde procurar: um arquivo (Word ou HTML) ou uma aba aberta.', true);
    ui.go.disabled = true;
    try {
      if (value === 'file') {
        const doc = await load('findFile');
        if (!doc?.texto) return setStatus('Escolha o arquivo de novo.', true);
        setStatus(`Procurando em ${doc.name}…`);
        const { text, sections } = docTarget(doc);
        const res = C.findBestMatch(query, text, { sections });
        render(res, `📄 ${doc.name}${res.location ? ` › ${res.location}` : ''}`, null);
      } else {
        const t = targetInfo(value);
        if (!t) return setStatus('Essa aba foi fechada. Escolha outra.', true);
        setStatus(`Lendo "${t.title.slice(0, 60)}"…`);
        const r = await send({ action: 'find-read', tabId: t.tabId });
        if (r?.status !== 'ok') return setStatus(r?.message || 'Não consegui ler a aba.', true);
        let best = null;
        for (const f of r.frames) {
          const res = C.findBestMatch(query, C.stripPageNoise(f.text), {
            sections: f.sections.map(([label, s]) => [label, C.stripPageNoise(s)]),
          });
          const score = (res.found ? 1000 : 0) + res.comparison.similarity;
          if (!best || score > best.score) best = { score, res, frame: f };
        }
        const { res, frame } = best;
        const inner = !frame.top ? (/h5p/i.test(frame.url) ? 'H5P' : hostOf(frame.url)) : '';
        const where = [`🗂 ${r.title}`, inner, res.location].filter(Boolean).join(' › ');
        render(res, where, res.found ? { tabId: t.tabId, frameId: frame.frameId } : null);
      }
      setStatus('');
    } finally {
      if (ui) ui.go.disabled = false;
    }
  }

  const pct = x => `${x.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

  function render(res, where, showIn) {
    if (!ui) return;   // fechado enquanto procurava
    const c = res.comparison;
    const v = res.found ? res.verdict : 'err';
    const label = !res.found ? `✘ NÃO ENCONTRADO — o mais parecido tem ${pct(c.similarity)}`
      : v === 'ok' ? `✔ IGUAL — ${pct(c.similarity)}`
      : v === 'partial' ? `≈ PARCIAL — ${pct(c.similarity)} parecido`
      : `✘ DIFERENTE — só ${pct(c.similarity)} parecido`;
    const out = [el('div', { class: `verdict ${v}`, text: label })];
    const whereRow = el('div', { class: 'where' }, el('span', { text: res.found ? where : where.split(' › ')[0] }));
    if (showIn) {
      whereRow.append(el('button', {
        class: 'btn', text: '👁 Mostrar na aba',
        onclick: async () => {
          const r = await send({ action: 'find-show', tabId: showIn.tabId, frameId: showIn.frameId, needle: c.expected });
          if (r?.status !== 'ok') setStatus(r?.message || 'Não consegui mostrar.', true);
        },
      }));
    }
    out.push(whereRow);
    if (!c.equal && (c.expectedNorm || c.actualNorm)) {
      out.push(el('div', { class: 'legend' },
        el('span', { class: 'act', text: 'vermelho riscado' }), ' = só no trecho procurado (sobrando ou diferente) · ',
        el('span', { class: 'exp', text: 'verde' }), ' = está lá e falta no trecho procurado'));
      const diff = el('div', { class: 'diff' });
      for (const t of c.tokens) diff.append(t.kind === 'equal' ? document.createTextNode(t.text) : el('span', { class: t.kind === 'actual' ? 'act' : 'exp', text: t.text }));
      out.push(diff);
      // A seção inteira ajuda quando o achado é um recorte (ex.: a frase de lá tem um trecho a mais).
      const whole = res.context && res.context !== c.expected
        ? el('div', { class: 'pair' }, el('b', { text: `${res.location}, inteira: ` }), res.context) : null;
      out.push(el('details', {}, el('summary', { text: whole ? 'Ver os textos inteiros (e a questão de lá)' : 'Ver os dois textos inteiros' }),
        el('div', { class: 'pair' }, el('b', { text: 'Procurado: ' }), c.actualNorm),
        el('div', { class: 'pair' }, el('b', { text: res.found ? 'Achado: ' : 'Mais parecido: ' }), c.expectedNorm),
        whole));
    } else if (c.equal) {
      out.push(el('div', { class: 'muted', text: 'Sem diferenças (aspas, travessões, espaços, ponto final e maiúscula inicial não contam).' }));
    }
    ui.result.textContent = '';
    ui.result.append(...out);
  }

  async function open(query) {
    if (!C) return;
    ui = build();
    ui.query.value = String(query || '').trim();
    ui.query.dispatchEvent(new Event('input'));
    setStatus('Carregando…');
    await fillTargets();
    setStatus('');
    if (ui.query.value && ui.target.value) run();
    else (ui.query.value ? ui.target : ui.query).focus();
  }

  return { open, close, docTarget };
})();
