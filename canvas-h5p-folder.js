// Botão "📁 Pasta H5P" na página de módulos do Canvas, ao lado do "+ Módulo",
// em até três passos, escolhidos na confirmação:
//   1. cria no H5P.com uma pasta com o nome da disciplina;
//   2. dentro dela, um quiz (Multiple Choice) para cada página de tópico dos
//      módulos — "Tópico N" ou, no Microfundamento, "UNIDADE N - Tema N" —,
//      com o título exato da página — o mesmo que o botão H5P do editor
//      procura. A questão vem do .h5p escolhido na confirmação (Extrator de
//      Questões; h5p-package.js) ou vai provisória;
//   3. põe cada quiz na sua página, na caixa depois da faixa "Atividade de
//      Fixação" ou, no Microfundamento, logo abaixo do banner de Atividades
//      de Fixação (h5p-insert.js), com prévia, número do curso redigitado e
//      conferência de cada página depois de gravar.
// Tipo da disciplina: comum ("📁 Pasta H5P", páginas "Tópico N") ou
// Microfundamento ("📁 Pasta H5P MF", páginas "UNIDADE N - Tema N"), pelas
// páginas dos módulos; se elas não decidirem, pelo nome do curso
// ("Microfundamento: …", "MF - …"). O lugar do quiz em cada página vem da
// própria página (h5p-insert.js); se for o do outro tipo, a prévia avisa.
// Onde: pela chave "Salvar na pasta da equipe" das configurações
// (h5pFolderTeam, lida a cada clique). Desligada (padrão, para testes): na
// raiz do My Content de quem está logado, como pasta privada. Ligada
// (produção): dentro da pasta da equipe do tipo — PRODUÇÕES › UDA - UNIDADE
// DIGITAL DE APRENDIZAGEM na comum, PRODUÇÕES › GRADUAÇÃO EAD no
// Microfundamento (h5p-folder.js › createInTeam) —, onde nada pode ser apagado.
//
// O H5P.com é acessado pelo background.js (h5p-folder.js), com a sessão aberta
// neste Chrome; as páginas, pela API do Canvas, com a sessão desta aba. Nada é
// duplicado: pasta ou quiz com o mesmo nome fica como está; página que já tem
// o quiz não muda. Os quizzes saem um por vez, com uma pausa entre eles.
//
// O botão só aparece com a chave "Botão 📁 Pasta H5P" ligada nas
// configurações (h5pFolderEnabled, padrão desligado); ligar ou desligar vale
// na hora, sem recarregar a página.
(() => {
  'use strict';

  const courseOf = () => location.pathname.match(/^\/courses\/(\d+)/)?.[1] || null;
  if (!courseOf() || window.__svcH5pFolder) return;
  window.__svcH5pFolder = true;

  const BTN_ID     = '__svc-h5p-folder__';
  const MODAL_ID   = '__svc-h5p-folder-modal__';
  const TOAST_ID   = '__svc-h5p-folder-toast__';
  const PARENT     = '';   // '' = raiz do My Content
  const MINE       = { team: false, label: 'My Content' };
  // Pasta da equipe (produção), uma por tipo de disciplina (h5p-folder.js › TEAMS).
  const TEAM       = {
    uda:   { team: true, kind: 'uda', label: 'PRODUÇÕES › UDA - UNIDADE DIGITAL DE APRENDIZAGEM' },
    micro: { team: true, kind: 'micro', label: 'PRODUÇÕES › GRADUAÇÃO EAD' },
  };
  async function destination(kind) {
    try { return (await chrome.storage.local.get({ h5pFolderTeam: false })).h5pFolderTeam === true ? TEAM[kind] : MINE; }
    catch { return MINE; }
  }
  const H5P_HOME   = 'https://pucminasvirtual.h5p.com/content';
  const PAUSE_MS   = 1500; // entre um quiz e outro
  const RECENT_MIN = 30;   // página editada há menos que isso: avisa na prévia
  // Tipo da disciplina e páginas de tópico de cada um: comum (UDA), com
  // "Tópico N – …", e Microfundamento, com "UNIDADE N - Tema N - …" (a
  // "UNIDADE N - Síntese e referências" fica de fora). O botão diz o tipo.
  const UDA_RE     = /^\s*t[óo]pico\s*\d+/i;
  const MICRO_RE   = /^\s*unidade\s*\d+\s*[-‐-―]\s*tema\s*\d+/i;
  const LABEL      = { uda: '📁 Pasta H5P', micro: '📁 Pasta H5P MF' };
  const KIND_NAME  = { uda: 'comum', micro: 'Microfundamento' };
  const TOPIC_NAME = { uda: '"Tópico N"', micro: '"UNIDADE N - Tema N"' };
  const kindOfTitle = t => (MICRO_RE.test(t) ? 'micro' : UDA_RE.test(t) ? 'uda' : null);
  // Pelas páginas dos módulos; se elas não decidirem (nenhuma, ou dos dois
  // tipos), pelo nome do curso: "Microfundamento: …", "MF - …" ou "(MF) …".
  function kindByPages(titles) {
    const kinds = new Set(titles.map(t => kindOfTitle(String(t || '').replace(/\s+/g, ' ').trim())).filter(Boolean));
    return kinds.size === 1 ? [...kinds][0] : null;
  }
  const kindByName = name => (/^\s*(?:microfundamentos?\b|mf\s*[-:]|\(mf\))/.test(fold(name)) ? 'micro' : 'uda');

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

  // Páginas de tópico dos módulos, dos dois tipos, na ordem dos módulos,
  // sem repetir: [{ title, url, kind }].
  async function topicPages() {
    const modules = await getAll(`${api()}/modules?include[]=items&per_page=50`);
    const out = [], seen = new Set();
    for (const m of modules) {
      // Módulo grande vem sem a lista de itens: busca à parte.
      const items = Array.isArray(m.items) ? m.items : await getAll(`${api()}/modules/${m.id}/items?per_page=100`);
      for (const it of items) {
        const t = String(it.title || '').replace(/\s+/g, ' ').trim();
        const kind = kindOfTitle(t);
        if (it.type !== 'Page' || !kind || seen.has(norm(t))) continue;
        seen.add(norm(t));
        out.push({ title: t, url: it.page_url || '', kind });
      }
    }
    return out;
  }

  // Tipo ao abrir a página de módulos, sem pedido a mais: os títulos que a
  // página já mostra; só se eles não decidirem, o nome do curso. No clique,
  // vale a lista completa da API (onClick).
  async function detectKind() {
    const titles = [...document.querySelectorAll('.context_module_item .ig-title')].map(a => a.textContent);
    return kindByPages(titles) || kindByName(await courseName());
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

  // Nome sem a sigla da frente ("UDA - ", "MF - ", "(UDA) ", "Microfundamento: "…),
  // para achar na pasta da equipe uma pasta com o mesmo nome e outro prefixo.
  // Só serve para avisar: o nome nunca é mudado sozinho (há UDA, MF e outras siglas).
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
  const coreName = s => fold(String(s || '').replace(/^\s*(?:\([A-Z]{1,6}\)|[A-Z]{1,6}\s*[-‐-―:]|[Mm]icrofundamentos?\s*[-‐-―:])\s*/, ''));

  // Confirmação: nome editável e o que fazer com os tópicos; opcionalmente,
  // os .h5p com as questões (h5p-package.js), ligados pelo "Tópico N" — só
  // na disciplina comum. kind: o tipo da disciplina; others: páginas de
  // tópico do outro tipo, que ficam de fora.
  // dest.folders (modo equipe): as pastas que já existem lá, para o aviso de
  // nome igual (a pasta existente é usada) ou parecido (só cria escolhendo).
  // Resolve { title, quizzes: bool, insert: bool, files: Map | null } ou null.
  function ask(name, topics, dest, kind, others = []) {
    return modal(ui => {
      ui.line(`📁 Criar pasta no H5P.com?${kind === 'micro' ? ' — Microfundamento' : ''}`, { fontSize: '14px', fontWeight: 'bold', color: '#e2e8f0' })
        .setAttribute('data-kind', kind);
      if (dest.team) {
        const w = ui.line(`⚠ Pasta da equipe (${dest.label}): o que for criado lá não pode ser apagado. Para testar, desligue "Salvar na pasta da equipe" nas configurações.`, { color: '#fbbf24' });
        w.setAttribute('data-dest', 'team');
      } else {
        ui.line('Destino de teste: My Content, em pasta privada (só você vê). Para a produção, ligue "Salvar na pasta da equipe" nas configurações.', { fontSize: '11px', color: '#94a3b8' })
          .setAttribute('data-dest', 'mine');
      }
      ui.line(`Onde: ${dest.label} (pucminasvirtual.h5p.com). Nome da pasta:`);
      const input = ui.input(name, 'Nome da pasta');
      const note = document.createElement('div');
      note.setAttribute('data-name-note', '');
      Object.assign(note.style, { margin: '-6px 0 12px', fontSize: '12px', lineHeight: '1.4' });
      ui.box.appendChild(note);
      let quizzes = null, insert = null, files = null, reading = false;
      let blocked = false, anyway = false, lastCore = null;
      const { yes, enable } = ui.buttons('Cancelar', 'Criar');
      const sync = () => enable(!!input.value.trim() && !reading && !blocked);

      // Nome igual a uma pasta da equipe: ela é usada. Mesmo nome com outro
      // prefixo: "Criar" só libera usando a existente ou marcando "criar outra".
      const existing = dest.team ? (dest.folders || []) : [];
      function checkName() {
        const typed = input.value.trim();
        const core = coreName(typed);
        if (core !== lastCore) anyway = false;   // a escolha vale só para o nome em que foi feita
        lastCore = core;
        const same = existing.find(f => norm(f.title) === norm(typed));
        const similar = same || !core ? [] : existing.filter(f => coreName(f.title) === core);
        note.replaceChildren();
        blocked = false;
        if (same) {
          note.style.color = '#93c5fd';
          note.textContent = `Já existe "${same.title}" na pasta da equipe: ela será usada, e nada novo é criado.`;
          return;
        }
        if (!similar.length) return;
        blocked = !anyway;
        note.style.color = '#fbbf24';
        const head = document.createElement('div');
        head.textContent = '⚠ Já existe na pasta da equipe uma pasta com esse nome, com outro prefixo:';
        note.appendChild(head);
        for (const f of similar.slice(0, 3)) {
          const row = document.createElement('div');
          Object.assign(row.style, { display: 'flex', gap: '8px', alignItems: 'center', margin: '4px 0 0 8px' });
          const t = document.createElement('span');
          t.textContent = `"${f.title}"`;
          t.style.color = '#e2e8f0';
          const use = document.createElement('button');
          use.type = 'button';
          use.textContent = 'Usar esta';
          use.setAttribute('data-use-folder', f.title);
          Object.assign(use.style, { padding: '2px 8px', borderRadius: '4px', border: '1px solid #475569', background: '#2a2a3e', color: '#e2e8f0', cursor: 'pointer', fontSize: '11px' });
          use.onclick = () => { input.value = f.title; checkName(); sync(); };
          row.append(t, use);
          note.appendChild(row);
        }
        const lab = document.createElement('label');
        Object.assign(lab.style, { display: 'flex', gap: '6px', alignItems: 'center', margin: '6px 0 0', cursor: 'pointer', color: '#cbd5e1' });
        const c = document.createElement('input');
        c.type = 'checkbox'; c.checked = anyway; c.setAttribute('data-new-anyway', '');
        c.onchange = () => { anyway = c.checked; blocked = !anyway; sync(); };
        lab.append(c, document.createTextNode('Criar outra pasta mesmo assim (lá ela não pode ser apagada)'));
        note.appendChild(lab);
      }
      checkName();
      if (topics.length) {
        quizzes = ui.check(`Criar também 1 quiz por tópico (${topics.length}), dentro da pasta:`, true, 'data-quizzes');
        const ul = document.createElement('ul');
        Object.assign(ul.style, { margin: '0 0 8px', padding: '0 0 0 22px', fontSize: '12px', color: '#cbd5e1', maxHeight: '220px', overflowY: 'auto', lineHeight: '1.5' });
        const renderList = () => {
          ul.replaceChildren(...topics.map(t => {
            const li = document.createElement('li');
            li.textContent = t.title;
            if (files) {
              const q = files.get(t.title);
              const s = document.createElement('span');
              s.setAttribute('data-file', q ? q.source : '');
              s.textContent = q ? ` ← ${q.source}` : ' — provisória';
              s.style.color = q ? '#4ade80' : '#94a3b8';
              li.appendChild(s);
              // O começo da pergunta, para conferir o par antes de criar.
              if (q?.preview) {
                const p = document.createElement('div');
                p.setAttribute('data-preview', '');
                p.textContent = `“${q.preview}${q.preview.length >= 90 ? '…' : ''}”`;
                Object.assign(p.style, { color: '#94a3b8', fontSize: '11px', fontStyle: 'italic' });
                li.appendChild(p);
              }
            }
            return li;
          }));
        };
        renderList();
        ui.box.appendChild(ul);

        {
          // Arquivos .h5p (ou o .zip do Extrator de Questões). Na comum, cada um
          // vai para a página "Tópico N" do seu título; no Microfundamento, a
          // "Questão N" (numerada pela página da sessão da FIC) vai para a N-ª
          // página da lista acima (h5p-package.js).
          const row = document.createElement('div');
          Object.assign(row.style, { display: 'flex', gap: '8px', alignItems: 'center', margin: '0 0 6px', fontSize: '12px' });
          const pick = document.createElement('button');
          pick.type = 'button';
          pick.textContent = '📎 Escolher arquivos .h5p';
          Object.assign(pick.style, { padding: '5px 10px', borderRadius: '4px', border: '1px solid #475569', background: '#2a2a3e', color: '#e2e8f0', cursor: 'pointer', fontSize: '12px' });
          const fileInput = document.createElement('input');
          fileInput.type = 'file'; fileInput.multiple = true; fileInput.accept = '.h5p,.zip';
          fileInput.setAttribute('data-h5p-files', '');
          fileInput.style.display = 'none';
          const status = document.createElement('span');
          status.style.color = '#94a3b8';
          status.textContent = 'opcional — sem arquivo, a questão vai provisória';
          row.append(pick, fileInput, status);
          ui.box.appendChild(row);
          const problems = ui.line('', { fontSize: '11px', color: '#fbbf24', whiteSpace: 'pre-line', display: 'none' });
          problems.setAttribute('data-h5p-problems', '');
          pick.onclick = () => fileInput.click();
          fileInput.onchange = async () => {
            const chosen = [...fileInput.files];
            fileInput.value = '';
            if (!chosen.length) return;
            reading = true; sync();
            status.textContent = 'Lendo os arquivos…';
            try {
              const r = await window.__svcH5pPackage.load(await Promise.all(chosen.map(async f => ({ name: f.name, buffer: await f.arrayBuffer() }))), topics, kind);
              files = r.byTopic;
              status.textContent = `${chosen.length} arquivo(s) · ${files.size} de ${topics.length} tópico(s) com a questão do arquivo`;
              status.style.color = files.size ? '#4ade80' : '#fbbf24';
              problems.textContent = r.problems.length ? `Fora:\n• ${r.problems.join('\n• ')}` : '';
              problems.style.display = r.problems.length ? 'block' : 'none';
            } catch (e) {
              files = null;
              status.textContent = `Não consegui ler os arquivos: ${e.message}`;
              status.style.color = '#f87171';
            }
            renderList();
            reading = false; sync();
          };
          const syncPick = () => { pick.disabled = !quizzes.checked; row.style.opacity = quizzes.checked ? '1' : '.5'; };
          quizzes.addEventListener('change', syncPick);
          ui.line('Cada quiz é um Multiple Choice com o título exato da página. Com o .h5p do Extrator de Questões, já vai com a questão e as configurações do arquivo; sem ele, com pergunta e alternativas provisórias para a equipe trocar.', { fontSize: '11px', color: '#94a3b8' });
          if (kind === 'micro') {
            ui.line('Microfundamento: o Extrator numera as questões do relatório da FIC pela página da sessão, e a "Questão N" vai para a N-ª página da lista acima, na ordem dos módulos. Confira os pares: o começo da pergunta aparece embaixo de cada página.', { fontSize: '11px', color: '#fbbf24' })
              .setAttribute('data-micro-files', '');
          }
        }
        insert = ui.check(`Inserir cada quiz na sua página (${kind === 'micro' ? 'logo abaixo do banner de Atividades de Fixação' : 'caixa da "Atividade de Fixação"'}) — antes de gravar, mostra a prévia.`, true, 'data-insert');
      } else {
        ui.line(`Nenhuma página ${TOPIC_NAME[kind]} nos módulos: só a pasta será criada.`, { fontSize: '11px', color: '#94a3b8' });
      }
      // Disciplina com páginas dos dois tipos: o nome do curso decidiu.
      if (others.length) {
        ui.line(`⚠ Há também ${others.length} página(s) ${TOPIC_NAME[kind === 'micro' ? 'uda' : 'micro']} nos módulos: ficam de fora (pelo nome do curso, a disciplina é ${KIND_NAME[kind]}).`, { fontSize: '11px', color: '#fbbf24' })
          .setAttribute('data-others', String(others.length));
      }
      ui.line('O que já existir com o mesmo nome fica como está — nada é duplicado nem apagado.', { fontSize: '11px', color: '#94a3b8' });
      ui.box.appendChild(yes.parentElement);   // botões no fim
      const result = () => ({ title: input.value.trim(), quizzes: !!quizzes?.checked, insert: !!insert?.checked, files: quizzes?.checked ? files : null });
      input.addEventListener('input', () => { checkName(); sync(); });
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && !yes.disabled) { e.preventDefault(); ui.done(result()); } });
      yes.onclick = () => { if (!yes.disabled) ui.done(result()); };
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
      replace: ['⚠', 'vai TROCAR o H5P que está no lugar do quiz pelo da pasta'],
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

  // files: Map(título da página → questão do .h5p) ou null.
  async function createQuizzes(folder, topics, folderLine, files) {
    const made = [], existed = [], unused = [];
    let fromFile = 0;
    for (let i = 0; i < topics.length; i++) {
      const title = topics[i].title;
      const q = files?.get(title);
      toast(`${folderLine}\nCriando quizzes: ${i + 1} de ${topics.length}…`, 'busy');
      const r = await send({ action: 'h5p-create-quiz', title, parent: folder.id, ...(q ? { params: q.params } : {}) });
      if (r?.status === 'created') { made.push(r.item); if (q) fromFile++; }
      else if (r?.status === 'exists') { existed.push(r.item); if (q) unused.push(title); }
      else {
        problem(r, `${folderLine}\nQuizzes: ${made.length} criado(s), ${existed.length} já existia(m) — parou em "${title}".`);
        return null;
      }
      if (r.status === 'created' && i < topics.length - 1) await sleep(PAUSE_MS);
    }
    // Confere na lista da pasta: se os quizzes novos não aparecerem, a leitura
    // da lista falhou — clicar de novo poderia duplicar.
    let unseen = 0;
    if (made.length) {
      const l = await send({ action: 'h5p-list', parent: folder.id });
      const ids = new Set((l?.items || []).filter(i => !i.folder).map(i => i.id));
      unseen = made.filter(m => !ids.has(m.id)).length;
    }
    return { made, existed, unseen, fromFile, unused };
  }

  // Prévia de uma página: o que o h5p-insert.js faria com o quiz de mesmo título.
  function planPage(body, quiz) {
    if (!quiz) return { status: 'noquiz' };
    const I = window.__svcH5pInsert;
    const embed = I.embedHtml({ origin: location.origin, courseId: courseOf(), contentId: quiz.id, title: quiz.title });
    return I.plan(body, { contentId: quiz.id, embed });
  }

  // Página com o lugar do quiz do outro tipo: insere do mesmo jeito (o lugar
  // vem da própria página, pelo h5p-insert.js), mas avisa na prévia.
  const ODD_LAYOUT = {
    micro: 'Esta página tem a faixa "Atividade de Fixação" (modelo comum): o quiz vai na caixa da faixa.',
    uda:   'Esta página não tem a faixa; tem o banner de Atividades de Fixação (modelo Microfundamento): o quiz vai logo abaixo do banner.',
  };

  // note: aviso dos quizzes, repetido no resultado final. kind: tipo da disciplina.
  async function insertQuizzes(folder, topics, intro, note = '', kind = 'uda') {
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
        const writes = row.status === 'insert' || row.status === 'replace';
        row.note = [
          writes && row.layout && row.layout !== kind ? ODD_LAYOUT[kind] : '',
          writes && mins < RECENT_MIN ? `Editada há ${Math.max(1, Math.round(mins))} min${pg.editor ? ' por ' + pg.editor : ''}: se ainda estiver aberta no editor e for salva depois, o quiz some dela.` : '',
        ].filter(Boolean).join(' ');
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
    if (note) parts.push(note);
    toast(parts.join('\n'), done.error.length || done.warn.length || note ? 'warn' : 'ok');
  }

  let busy = false;
  async function onClick() {
    if (busy) return;
    busy = true;
    const setBtn = (text, disabled) => {
      const b = document.getElementById(BTN_ID);
      if (!b) return;
      b.textContent = text; b.disabled = disabled;
      if (text === LABEL[kind]) { b.title = TIP[kind]; b.setAttribute('data-kind', kind); }
    };
    try {
      setBtn('📁 Lendo…', true);
      const [name, pages] = await Promise.all([courseName(), topicPages().catch(() => [])]);
      // Tipo pela lista completa dos módulos (a da página pode vir incompleta).
      kind = kindByPages(pages.map(p => p.title)) || kindByName(name);
      const topics = pages.filter(p => p.kind === kind);
      const others = pages.filter(p => p.kind !== kind);
      // Destino: My Content ou a pasta da equipe do tipo (UDA ou GRADUAÇÃO EAD).
      let dest = await destination(kind);
      // Pasta da equipe: as pastas que já existem lá, para o aviso de nome
      // igual ou parecido. Sem conseguir ler, nem abre a confirmação.
      if (dest.team) {
        const l = await send({ action: 'h5p-list', team: true, kind: dest.kind });
        if (l?.status !== 'ok') return problem(l, 'Não consegui ler a pasta da equipe — nada foi criado.');
        dest = { ...dest, folders: (l.items || []).filter(i => i.folder) };
      }
      setBtn(LABEL[kind], false);
      const choice = await ask(name, topics, dest, kind, others);
      if (!choice) return;

      setBtn('📁 Criando…', true);
      toast(`Criando a pasta "${choice.title}"${dest.team ? ' na pasta da equipe' : ''}…`, 'busy');
      const r = await send({ action: 'h5p-create-folder', title: choice.title, parent: PARENT, ...(dest.team ? { team: true, kind: dest.kind } : {}) });
      if (r?.status === 'unconfirmed') {
        return toast(`O H5P.com recebeu o pedido, mas a pasta "${choice.title}" não apareceu na lista. Confira lá antes de tentar de novo.`, 'warn', { href: H5P_HOME, label: 'Abrir H5P.com' });
      }
      if (r?.status !== 'created' && r?.status !== 'exists') return problem(r);

      const open = { href: r.folder.url, label: 'Abrir pasta' };
      let line = r.status === 'created'
        ? `✓ Pasta "${r.folder.title}" criada no H5P.com (${dest.label}).`
        : `Pasta "${r.folder.title}" já existia no H5P.com (${dest.label}).`;

      let note = '';
      if (choice.quizzes) {
        const q = await createQuizzes(r.folder, topics, line, choice.files);
        if (!q) return;
        const parts = [`${q.made.length} quiz(zes) criado(s)${q.fromFile ? ` (${q.fromFile} com a questão do .h5p)` : ''}`];
        if (q.existed.length) parts.push(`${q.existed.length} já existia(m)`);
        line += `\n${parts.join(' · ')}.`;
        // Quiz que já existia não muda: a questão do arquivo ficou de fora.
        if (q.unused.length) note = `⚠ Já existia(m) na pasta e não foi(ram) trocado(s) pelo .h5p: ${q.unused.join('; ')} — troque a questão no H5P.com.`;
        if (q.unseen) {
          // Lista da pasta não confiável: inserir agora poderia apontar errado.
          return toast(`${line}\n⚠ ${q.unseen} quiz(zes) novo(s) não apareceram na lista da pasta: confira no H5P.com antes de clicar de novo.${note ? '\n' + note : ''}`, 'warn', open);
        }
      }
      if (choice.insert) return await insertQuizzes(r.folder, topics, line, note, kind);
      toast(line + (!choice.quizzes && r.status === 'exists' ? ' Nada foi criado.' : '') + (note ? '\n' + note : ''),
        note ? 'warn' : r.status === 'created' || choice.quizzes ? 'ok' : 'info', open);
    } finally {
      busy = false;
      setBtn(LABEL[kind], false);
    }
  }

  // ── Botão ─────────────────────────────────────────────────────────────
  let enabled = false;   // chave das configurações
  let kind = null;       // 'uda' | 'micro': tipo da disciplina (detectKind, depois o clique)
  let detecting = null;

  const TIP = {
    uda: 'Service Timer — cria no H5P.com uma pasta com o nome desta disciplina e um quiz por página "Tópico N", e insere cada quiz na sua página',
    micro: 'Service Timer — Microfundamento: cria no H5P.com uma pasta com o nome desta disciplina e um quiz por página "UNIDADE N - Tema N", e insere cada quiz logo abaixo do banner de Atividades de Fixação',
  };

  function mount() {
    if (!enabled || !kind || document.getElementById(BTN_ID)) return;
    const add = findAddModule();
    if (!add || !add.parentElement) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = BTN_ID;
    btn.className = 'btn';
    btn.textContent = LABEL[kind];
    btn.title = TIP[kind];
    btn.setAttribute('data-kind', kind);
    btn.style.marginInlineEnd = '6px';
    btn.addEventListener('click', onClick);
    add.before(btn);
  }

  // O Canvas monta o cabeçalho dos módulos depois do carregamento e pode
  // refazê-lo: observa e recoloca o botão.
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; mount(); });
  });

  // Desligar no meio de uma criação só tira o botão: o que já começou termina.
  function apply(on) {
    enabled = !!on;
    if (enabled) {
      observer.observe(document.documentElement, { childList: true, subtree: true });
      // O botão só aparece com o tipo decidido, para já nascer com o nome certo.
      detecting = detecting || detectKind().catch(() => 'uda').then(k => { kind = kind || k; mount(); });
      mount();
    } else {
      observer.disconnect();
      document.getElementById(BTN_ID)?.remove();
    }
  }

  chrome.storage.local.get({ h5pFolderEnabled: false })
    .then(cfg => apply(cfg.h5pFolderEnabled))
    .catch(() => {});   // extensão recarregada com a página aberta
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'h5pFolderEnabled' in changes) apply(changes.h5pFolderEnabled.newValue);
  });
})();
