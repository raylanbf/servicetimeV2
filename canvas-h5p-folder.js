// Botão "📁 Pasta H5P" na página de módulos do Canvas, ao lado do "+ Módulo",
// em até três passos, escolhidos na confirmação:
//   1. cria no H5P.com uma pasta com o nome da disciplina;
//   2. dentro dela, um quiz (Multiple Choice, com pergunta e alternativas
//      provisórias) para cada página "Tópico N" dos módulos, com o título
//      exato da página — o mesmo que o botão H5P do editor procura;
//   3. põe cada quiz na sua página, na caixa depois da faixa "Atividade de
//      Fixação" (h5p-insert.js), com prévia, número do curso redigitado e
//      conferência de cada página depois de gravar.
// Por enquanto (teste) a pasta vai na raiz do My Content (pasta-mãe vazia);
// depois, a pasta da equipe (PRODUÇÕES › UDA - UNIDADE DIGITAL DE
// APRENDIZAGEM) entra em PARENT.
//
// O H5P.com é acessado pelo background.js (h5p-folder.js), com a sessão aberta
// neste Chrome; as páginas, pela API do Canvas, com a sessão desta aba. Nada é
// duplicado: pasta ou quiz com o mesmo nome fica como está; página que já tem
// o quiz não muda. Os quizzes saem um por vez, com uma pausa entre eles.
(() => {
  'use strict';

  const courseOf = () => location.pathname.match(/^\/courses\/(\d+)/)?.[1] || null;
  if (!courseOf() || window.__svcH5pFolder) return;
  window.__svcH5pFolder = true;

  const BTN_ID     = '__svc-h5p-folder__';
  const MODAL_ID   = '__svc-h5p-folder-modal__';
  const TOAST_ID   = '__svc-h5p-folder-toast__';
  const PARENT     = '';   // '' = raiz do My Content
  const WHERE      = 'My Content';
  const H5P_HOME   = 'https://pucminasvirtual.h5p.com/content';
  const PAUSE_MS   = 1500; // entre um quiz e outro
  const RECENT_MIN = 30;   // página editada há menos que isso: avisa na prévia
  const TOPIC_RE   = /^\s*t[óo]pico\s*\d+/i;

  // "+ Módulo": no Canvas clássico é o .add_module_link do cabeçalho.
  const findAddModule = () => document.querySelector('.header-bar .add_module_link, .add_module_link');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => (s || '').normalize('NFC').replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();

  // ── Canvas ────────────────────────────────────────────────────────────
  const api = () => `/api/v1/courses/${courseOf()}`;
  async function getJson(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ao ler ${url.split('?')[0]}`);
    const data = JSON.parse((await res.text()).replace(/^while\(1\);/, ''));
    const next = (res.headers.get('Link') || '').match(/<([^>]+)>;\s*rel="next"/)?.[1] || null;
    return { data, next };
  }
  async function getAll(url) {
    const out = [];
    for (let guard = 0; url && guard < 30; guard++) {
      const { data, next } = await getJson(url);
      if (Array.isArray(data)) out.push(...data);
      url = next;
    }
    return out;
  }

  async function courseName() {
    try {
      const { data } = await getJson(api());
      if (data?.name) return String(data.name).trim();
    } catch { /* cai no caminho de navegação */ }
    return document.querySelector('.ic-app-crumbs a[href$="/courses/' + courseOf() + '"] span, .ic-app-crumbs li:nth-child(2) a span')
      ?.textContent.trim() || '';
  }

  // Páginas "Tópico N…" dos módulos, na ordem dos módulos, sem repetir: [{ title, url }].
  async function topicPages() {
    const modules = await getAll(`${api()}/modules?include[]=items&per_page=50`);
    const out = [], seen = new Set();
    for (const m of modules) {
      // Módulo grande vem sem a lista de itens: busca à parte.
      const items = Array.isArray(m.items) ? m.items : await getAll(`${api()}/modules/${m.id}/items?per_page=100`);
      for (const it of items) {
        const t = String(it.title || '').replace(/\s+/g, ' ').trim();
        if (it.type !== 'Page' || !TOPIC_RE.test(t) || seen.has(norm(t))) continue;
        seen.add(norm(t));
        out.push({ title: t, url: it.page_url || '' });
      }
    }
    return out;
  }

  async function readPage(url) {
    const { data } = await getJson(`${api()}/pages/${encodeURIComponent(url)}`);
    return { body: data.body || '', updatedAt: data.updated_at || null, editor: data.last_edited_by?.display_name || '' };
  }

  // Grava o corpo da página; devolve o corpo que o Canvas guardou (ou null).
  async function writePage(url, body) {
    const raw  = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('_csrf_token='));
    const csrf = raw ? decodeURIComponent(raw.split('=').slice(1).join('='))
      : decodeURIComponent(document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '');
    const res = await fetch(`${api()}/pages/${encodeURIComponent(url)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ wiki_page: { body } }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`O Canvas respondeu ${res.status} ao gravar${text ? ' — ' + text.slice(0, 120) : ''}`);
    try { const saved = JSON.parse(text.replace(/^while\(1\);/, '')); return typeof saved?.body === 'string' ? saved.body : null; }
    catch { return null; }
  }

  // ── Aviso ─────────────────────────────────────────────────────────────
  function toast(text, kind, link) {
    document.getElementById(TOAST_ID)?.remove();
    const colors = { ok: '#15803d', info: '#1d4ed8', warn: '#b45309', err: '#b91c1c', busy: '#334155' };
    const el = document.createElement('div');
    el.id = TOAST_ID;
    el.setAttribute('role', 'status');
    Object.assign(el.style, {
      position: 'fixed', bottom: '24px', right: '24px', maxWidth: '480px', display: 'flex', gap: '12px', alignItems: 'center',
      background: colors[kind] || colors.info, color: '#fff', padding: '10px 14px', borderRadius: '6px',
      fontFamily: 'system-ui, sans-serif', fontSize: '13px', lineHeight: '1.4', whiteSpace: 'pre-line',
      zIndex: '2147483647', boxShadow: '0 2px 8px rgba(0,0,0,.4)',
    });
    const msg = document.createElement('span');
    msg.textContent = text;
    el.appendChild(msg);
    if (link) {
      const a = document.createElement('a');
      a.href = link.href; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = link.label;
      Object.assign(a.style, { color: '#fff', fontWeight: '700', whiteSpace: 'nowrap', textDecoration: 'underline' });
      el.appendChild(a);
    }
    if (kind !== 'busy') {
      const x = document.createElement('button');
      x.type = 'button'; x.textContent = '×'; x.title = 'Fechar';
      Object.assign(x.style, { background: 'none', border: 'none', color: '#fff', fontSize: '18px', cursor: 'pointer', padding: '0 0 0 4px', lineHeight: '1' });
      x.onclick = () => el.remove();
      el.appendChild(x);
    }
    document.body.appendChild(el);
    // Sucesso some sozinho; aviso e erro ficam até fechar.
    if (kind === 'ok') setTimeout(() => el.remove(), 12000);
  }

  // ── Janela (confirmação e prévia) ─────────────────────────────────────
  // Esc, Cancelar ou clique fora fecham sem fazer nada.
  function modal(build) {
    return new Promise(resolve => {
      document.getElementById(MODAL_ID)?.remove();
      const overlay = document.createElement('div');
      overlay.id = MODAL_ID;
      Object.assign(overlay.style, {
        position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.55)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: '2147483647', fontFamily: 'system-ui, sans-serif',
      });
      const box = document.createElement('div');
      Object.assign(box.style, {
        background: '#1e1e2e', color: '#e2e8f0', padding: '18px 20px', borderRadius: '8px',
        width: '560px', maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
        boxSizing: 'border-box', boxShadow: '0 4px 24px rgba(0,0,0,.7)',
      });
      function done(value) {
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
        resolve(value);
      }
      function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } }
      const ui = {
        box, done,
        line(text, style, parent = box) {
          const p = document.createElement('p');
          p.textContent = text;
          Object.assign(p.style, { margin: '0 0 10px', lineHeight: '1.4', fontSize: '12px', color: '#cbd5e1' }, style);
          parent.appendChild(p);
          return p;
        },
        input(value, label) {
          const i = document.createElement('input');
          i.type = 'text'; i.value = value; i.setAttribute('aria-label', label);
          Object.assign(i.style, {
            width: '100%', boxSizing: 'border-box', padding: '8px', borderRadius: '4px', border: '1px solid #475569',
            background: '#0f172a', color: '#e2e8f0', fontSize: '13px', margin: '0 0 12px',
          });
          box.appendChild(i);
          return i;
        },
        check(text, checked, attr) {
          const label = document.createElement('label');
          Object.assign(label.style, { display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '13px', cursor: 'pointer', margin: '0 0 6px' });
          const c = document.createElement('input');
          c.type = 'checkbox'; c.checked = checked; c.setAttribute(attr, '');
          c.style.marginTop = '2px';
          label.append(c, document.createTextNode(text));
          box.appendChild(label);
          return c;
        },
        buttons(cancelText, okText) {
          const row = document.createElement('div');
          Object.assign(row.style, { display: 'flex', gap: '8px', marginTop: '14px' });
          const mk = (text, primary) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = text;
            Object.assign(b.style, {
              flex: '1', padding: '8px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '13px',
              background: primary ? '#4ade80' : '#2a2a3e', color: primary ? '#0f172a' : '#e2e8f0', fontWeight: primary ? 'bold' : 'normal',
            });
            row.appendChild(b);
            return b;
          };
          const no = mk(cancelText, false), yes = mk(okText, true);
          yes.setAttribute('data-create', '');
          no.onclick = () => done(null);
          box.appendChild(row);
          return { no, yes, enable: on => { yes.disabled = !on; yes.style.opacity = on ? '1' : '.5'; } };
        },
      };
      const focus = build(ui);
      document.addEventListener('keydown', onKey, true);
      let downOnBackdrop = false;
      overlay.addEventListener('mousedown', e => { downOnBackdrop = e.target === overlay; });
      overlay.addEventListener('click', e => { if (downOnBackdrop && e.target === overlay) done(null); });
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      focus?.focus();
      focus?.select?.();
    });
  }

  // Confirmação: nome editável e o que fazer com os tópicos.
  // Resolve { title, quizzes: bool, insert: bool } ou null.
  function ask(name, topics) {
    return modal(ui => {
      ui.line('📁 Criar pasta no H5P.com?', { fontSize: '14px', fontWeight: 'bold', color: '#e2e8f0' });
      ui.line(`Onde: ${WHERE} (pucminasvirtual.h5p.com). Nome da pasta:`);
      const input = ui.input(name, 'Nome da pasta');
      let quizzes = null, insert = null;
      if (topics.length) {
        quizzes = ui.check(`Criar também 1 quiz por tópico (${topics.length}), dentro da pasta:`, true, 'data-quizzes');
        const ul = document.createElement('ul');
        Object.assign(ul.style, { margin: '0 0 8px', padding: '0 0 0 22px', fontSize: '12px', color: '#cbd5e1', maxHeight: '160px', overflowY: 'auto', lineHeight: '1.5' });
        for (const t of topics) { const li = document.createElement('li'); li.textContent = t.title; ul.appendChild(li); }
        ui.box.appendChild(ul);
        ui.line('Cada quiz é um Multiple Choice com o título exato da página, pergunta e alternativas provisórias para a equipe trocar.', { fontSize: '11px', color: '#94a3b8' });
        insert = ui.check('Inserir cada quiz na sua página (caixa da "Atividade de Fixação") — antes de gravar, mostra a prévia.', true, 'data-insert');
      } else {
        ui.line('Nenhuma página "Tópico N" nos módulos: só a pasta será criada.', { fontSize: '11px', color: '#94a3b8' });
      }
      ui.line('O que já existir com o mesmo nome fica como está — nada é duplicado nem apagado.', { fontSize: '11px', color: '#94a3b8' });
      const { yes, enable } = ui.buttons('Cancelar', 'Criar');
      const result = () => ({ title: input.value.trim(), quizzes: !!quizzes?.checked, insert: !!insert?.checked });
      const sync = () => enable(!!input.value.trim());
      input.addEventListener('input', sync);
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); ui.done(result()); } });
      yes.onclick = () => ui.done(result());
      sync();
      return input;
    });
  }

  // Prévia da inserção: uma linha por página; as que vão mudar vêm marcadas
  // (dá para testar numa só). Grava só com o número do curso redigitado.
  // Resolve a lista de linhas marcadas ou null.
  function askInsert(rows) {
    const LABEL = {
      insert:  ['✅', 'vai receber o quiz'],
      replace: ['⚠', 'vai TROCAR o H5P que está na caixa pelo quiz da pasta'],
      same:    ['—', 'já tem este quiz'],
      noquiz:  ['✗', 'não achei na pasta um quiz com o título desta página'],
      error:   ['✗', ''],
    };
    return modal(ui => {
      const todo = rows.filter(r => r.status === 'insert' || r.status === 'replace');
      ui.line('🧩 Inserir os quizzes nas páginas?', { fontSize: '14px', fontWeight: 'bold', color: '#e2e8f0' });
      ui.line(todo.length
        ? `Prévia — ${todo.length} página(s) para gravar. Nada foi gravado ainda. Desmarque as que não quiser (dá para testar numa só).`
        : 'Prévia — nenhuma página para gravar.');
      const checks = [];
      for (const r of rows) {
        const row = document.createElement('div');
        Object.assign(row.style, { borderTop: '1px solid #334155', padding: '6px 0', fontSize: '12px' });
        const head = document.createElement('label');
        Object.assign(head.style, { display: 'flex', gap: '8px', alignItems: 'flex-start', cursor: 'pointer' });
        const [icon, what] = LABEL[r.status];
        if (r.status === 'insert' || r.status === 'replace') {
          const c = document.createElement('input');
          c.type = 'checkbox'; c.checked = true; c.setAttribute('data-page', r.url);
          c.style.marginTop = '2px';
          checks.push([c, r]);
          head.appendChild(c);
        } else {
          const s = document.createElement('span');
          s.textContent = icon;
          s.style.width = '13px';
          head.appendChild(s);
        }
        const t = document.createElement('span');
        t.textContent = r.title;
        t.style.color = '#e2e8f0';
        head.appendChild(t);
        row.appendChild(head);
        const note = [what, r.error, r.note].filter(Boolean).join(' ');
        if (note) ui.line(note, { margin: '2px 0 0 21px', fontSize: '11px', color: r.status === 'error' || r.status === 'noquiz' ? '#f87171' : r.note || r.status === 'replace' ? '#fbbf24' : '#94a3b8' }, row);
        ui.box.appendChild(row);
      }
      let input = null;
      const { yes, enable } = ui.buttons(todo.length ? 'Cancelar' : 'Fechar', 'Gravar');
      if (todo.length) {
        ui.line(`Para gravar, digite o número deste curso (${courseOf()}):`, { margin: '14px 0 6px' });
        input = ui.input('', 'Número do curso');
        input.setAttribute('data-course', '');
        ui.box.appendChild(yes.parentElement);   // botões depois do campo
      } else {
        yes.style.display = 'none';
      }
      const marked = () => checks.filter(([c]) => c.checked).map(([, r]) => r);
      const sync = () => {
        const n = marked().length;
        yes.textContent = n ? `Gravar em ${n} página(s)` : 'Gravar';
        enable(!!input && n > 0 && input.value.trim() === courseOf());
      };
      checks.forEach(([c]) => c.addEventListener('change', sync));
      input?.addEventListener('input', sync);
      input?.addEventListener('keydown', e => { if (e.key === 'Enter' && !yes.disabled) { e.preventDefault(); ui.done(marked()); } });
      yes.onclick = () => { if (!yes.disabled) ui.done(marked()); };
      sync();
      return input;
    });
  }

  // ── Ação ──────────────────────────────────────────────────────────────
  async function send(msg) {
    try { return await chrome.runtime.sendMessage(msg); }
    catch { return { status: 'reload' }; }   // extensão recarregada com a página aberta
  }

  function problem(r, what) {
    if (r?.status === 'reload') return toast('O Service Timer foi atualizado: recarregue esta página (F5) e tente de novo.', 'warn');
    if (r?.code === 'login') return toast(`Entre no H5P.com neste Chrome e tente de novo.${what ? '\n' + what : ''}`, 'warn', { href: H5P_HOME, label: 'Abrir H5P.com' });
    toast(`${r?.message || 'Erro desconhecido.'}${what ? '\n' + what : ''}`, 'err');
  }

  async function createQuizzes(folder, titles, folderLine) {
    const made = [], existed = [];
    for (let i = 0; i < titles.length; i++) {
      toast(`${folderLine}\nCriando quizzes: ${i + 1} de ${titles.length}…`, 'busy');
      const r = await send({ action: 'h5p-create-quiz', title: titles[i], parent: folder.id });
      if (r?.status === 'created') made.push(r.item);
      else if (r?.status === 'exists') existed.push(r.item);
      else {
        problem(r, `${folderLine}\nQuizzes: ${made.length} criado(s), ${existed.length} já existia(m) — parou em "${titles[i]}".`);
        return null;
      }
      if (r.status === 'created' && i < titles.length - 1) await sleep(PAUSE_MS);
    }
    // Confere na lista da pasta: se os quizzes novos não aparecerem, a leitura
    // da lista falhou — clicar de novo poderia duplicar.
    let unseen = 0;
    if (made.length) {
      const l = await send({ action: 'h5p-list', parent: folder.id });
      const ids = new Set((l?.items || []).filter(i => !i.folder).map(i => i.id));
      unseen = made.filter(m => !ids.has(m.id)).length;
    }
    return { made, existed, unseen };
  }

  // Prévia de uma página: o que o h5p-insert.js faria com o quiz de mesmo título.
  function planPage(body, quiz) {
    if (!quiz) return { status: 'noquiz' };
    const I = window.__svcH5pInsert;
    const embed = I.embedHtml({ origin: location.origin, courseId: courseOf(), contentId: quiz.id, title: quiz.title });
    return I.plan(body, { contentId: quiz.id, embed });
  }

  async function insertQuizzes(folder, topics, intro) {
    toast(`${intro}\nLendo a pasta e as páginas…`, 'busy');
    const l = await send({ action: 'h5p-list', parent: folder.id });
    if (l?.status !== 'ok') return problem(l, intro);
    const quizOf = new Map(l.items.filter(i => !i.folder).map(i => [norm(i.title), i]));

    const rows = [];
    for (let i = 0; i < topics.length; i++) {
      toast(`${intro}\nLendo as páginas: ${i + 1} de ${topics.length}…`, 'busy');
      const t = topics[i];
      const row = { ...t, quiz: quizOf.get(norm(t.title)) || null };
      try {
        const pg = await readPage(t.url);
        Object.assign(row, planPage(pg.body, row.quiz));
        // Alguém pode estar com a página aberta no editor: se salvar depois,
        // a versão dessa pessoa sobrescreve o quiz inserido.
        const mins = pg.updatedAt ? (Date.now() - new Date(pg.updatedAt).getTime()) / 60000 : Infinity;
        if ((row.status === 'insert' || row.status === 'replace') && mins < RECENT_MIN) {
          row.note = `Editada há ${Math.max(1, Math.round(mins))} min${pg.editor ? ' por ' + pg.editor : ''}: se ainda estiver aberta no editor e for salva depois, o quiz some dela.`;
        }
      } catch (e) {
        row.status = 'error';
        row.error = e.message;
      }
      rows.push(row);
    }
    document.getElementById(TOAST_ID)?.remove();

    const chosen = await askInsert(rows);
    if (!chosen) return toast(`${intro}\nNenhuma página foi alterada.`, 'info', { href: folder.url, label: 'Abrir pasta' });

    const done = { ok: [], same: [], warn: [], error: [] };
    for (let i = 0; i < chosen.length; i++) {
      toast(`Inserindo os quizzes: ${i + 1} de ${chosen.length}…`, 'busy');
      const r = chosen[i];
      try {
        // Lê de novo: se alguém salvou depois da prévia, vale o conteúdo novo.
        const pg = await readPage(r.url);
        const p = planPage(pg.body, r.quiz);
        if (p.status === 'same') { done.same.push(r.title); continue; }
        if (p.status !== 'insert' && p.status !== 'replace') { done.error.push(`${r.title}: ${p.error || 'mudou desde a prévia'}`); continue; }
        const saved = await writePage(r.url, p.body);
        // Confere o que o Canvas gravou.
        const check = saved === null ? null : planPage(saved, r.quiz);
        if (check && check.status !== 'same') done.warn.push(r.title);
        else done.ok.push(r.title);
      } catch (e) {
        done.error.push(`${r.title}: ${e.message}`);
      }
    }
    const parts = [`✓ Quiz inserido em ${done.ok.length} página(s).`];
    if (done.same.length) parts.push(`${done.same.length} já tinha(m) o quiz.`);
    if (done.warn.length) parts.push(`⚠ Gravado, mas o quiz não ficou na caixa em: ${done.warn.join('; ')} — confira no editor.`);
    if (done.error.length) parts.push(`✗ Não gravado: ${done.error.join('; ')}`);
    toast(parts.join('\n'), done.error.length || done.warn.length ? 'warn' : 'ok');
  }

  let busy = false;
  async function onClick() {
    if (busy) return;
    busy = true;
    const btn = document.getElementById(BTN_ID);
    const label = btn?.textContent;
    const setBtn = (text, disabled) => { const b = document.getElementById(BTN_ID); if (b) { b.textContent = text; b.disabled = disabled; } };
    try {
      setBtn('📁 Lendo…', true);
      const [name, topics] = await Promise.all([courseName(), topicPages().catch(() => [])]);
      setBtn(label, false);
      const choice = await ask(name, topics);
      if (!choice) return;

      setBtn('📁 Criando…', true);
      toast(`Criando a pasta "${choice.title}"…`, 'busy');
      const r = await send({ action: 'h5p-create-folder', title: choice.title, parent: PARENT });
      if (r?.status === 'unconfirmed') {
        return toast(`O H5P.com recebeu o pedido, mas a pasta "${choice.title}" não apareceu na lista. Confira lá antes de tentar de novo.`, 'warn', { href: H5P_HOME, label: 'Abrir H5P.com' });
      }
      if (r?.status !== 'created' && r?.status !== 'exists') return problem(r);

      const open = { href: r.folder.url, label: 'Abrir pasta' };
      let line = r.status === 'created'
        ? `✓ Pasta "${r.folder.title}" criada no H5P.com (${WHERE}).`
        : `Pasta "${r.folder.title}" já existia no H5P.com (${WHERE}).`;

      if (choice.quizzes) {
        const q = await createQuizzes(r.folder, topics.map(t => t.title), line);
        if (!q) return;
        const parts = [`${q.made.length} quiz(zes) criado(s)`];
        if (q.existed.length) parts.push(`${q.existed.length} já existia(m)`);
        line += `\n${parts.join(' · ')}.`;
        if (q.unseen) {
          // Lista da pasta não confiável: inserir agora poderia apontar errado.
          return toast(`${line}\n⚠ ${q.unseen} quiz(zes) novo(s) não apareceram na lista da pasta: confira no H5P.com antes de clicar de novo.`, 'warn', open);
        }
      }
      if (choice.insert) return await insertQuizzes(r.folder, topics, line);
      toast(line + (!choice.quizzes && r.status === 'exists' ? ' Nada foi criado.' : ''), r.status === 'created' || choice.quizzes ? 'ok' : 'info', open);
    } finally {
      busy = false;
      setBtn(label, false);
    }
  }

  // ── Botão ─────────────────────────────────────────────────────────────
  function mount() {
    if (document.getElementById(BTN_ID)) return;
    const add = findAddModule();
    if (!add || !add.parentElement) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = BTN_ID;
    btn.className = 'btn';
    btn.textContent = '📁 Pasta H5P';
    btn.title = `Service Timer — cria no H5P.com (${WHERE}) uma pasta com o nome desta disciplina e um quiz por tópico, e insere cada quiz na sua página`;
    btn.style.marginInlineEnd = '6px';
    btn.addEventListener('click', onClick);
    add.before(btn);
  }

  // O Canvas monta o cabeçalho dos módulos depois do carregamento e pode
  // refazê-lo: observa e recoloca o botão.
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; mount(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  mount();
})();
