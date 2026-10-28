'use strict';

// Botão "Importar quiz H5P" na barra do editor do Canvas, ao lado do
// Justificar. Na edição de uma página de tópico, depois da confirmação: acha a
// caixa logo abaixo da faixa "Atividade de Fixação Não Pontuada", põe o cursor
// nela, abre o "Interactive Content – H5P" e deixa o pedido para o
// h5p-search.js buscar o título da página e clicar em Insert (a ponte é o
// canvas-h5p-bridge.js). Quando o quiz entra no editor, ele vai para a caixa no
// lugar do H5P que havia, com 100% de largura (h5p-width.js). A página não é
// salva sozinha. Ver PLANO-H5P.md, seções 2.1 e 5.
(() => {
  if (window.__svcH5pBtnInstalled) return;
  window.__svcH5pBtnInstalled = true;

  const WAIT_INSERT_MS = 3 * 60 * 1000;   // depois disso, considera o popup abandonado
  const PAGE_EDIT  = /^\/courses\/\d+\/pages\/[^/]+\/edit/;
  // Marcador das páginas geradas pela AVA, no texto normalizado e no original.
  const MARKER     = /\[\s*iframe\s*-\s*atividade\s+de\s+fixacao\s+h5p\s*\]/;
  const MARKER_RAW = /\[\s*iframe\s*-\s*atividade\s+de\s+fixa[çc][ãa]o\s+h5p\s*\]/i;
  const ERR = '#b45309', OK = '#166534', INFO = '#1e1e2e';

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm  = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
  async function waitFor(find, timeout) {
    const start = Date.now();
    for (;;) {
      const el = find();
      if (el || Date.now() - start > timeout) return el || null;
      await sleep(120);
    }
  }

  function toast(text, bg, ms) {
    document.getElementById('__svc-toast__')?.remove();
    const el = document.createElement('div');
    el.id = '__svc-toast__';
    el.textContent = text;
    Object.assign(el.style, {
      position: 'fixed', bottom: '24px', right: '24px', maxWidth: '420px',
      background: bg, color: '#fff', padding: '10px 16px', borderRadius: '6px',
      fontFamily: 'system-ui', fontSize: '13px', lineHeight: '1.4',
      zIndex: '2147483647', boxShadow: '0 2px 8px rgba(0,0,0,.4)',
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms || 4000);
  }

  // ── Editor ───────────────────────────────────────────────────────────
  function findEditorFor(container) {
    const tm = window.tinymce;
    if (!tm) return null;
    const all = [].concat((typeof tm.get === 'function' ? tm.get() : tm.editors) || []);
    return all.find(ed => ed.getContainer && ed.getContainer() === container) || tm.activeEditor || null;
  }

  // H5P no editor visual: o TinyMCE embrulha o iframe num span de prévia.
  function isH5p(el) {
    if (el.matches('span.mce-preview-object')) {
      return /h5p/i.test(el.getAttribute('data-mce-p-src') || el.querySelector('iframe')?.getAttribute('src') || '');
    }
    return el.tagName === 'IFRAME' && /h5p/i.test(el.getAttribute('src') || '') && !el.closest('span.mce-preview-object');
  }
  const h5pIn = root => [...root.querySelectorAll('span.mce-preview-object, iframe')].filter(isH5p);

  // A caixa do quiz: a div logo depois da faixa. Ela só pode ter H5P, o
  // marcador da AVA e parágrafos vazios — outra coisa faz o botão parar.
  function findBox(body) {
    const isBand = d => norm(d.textContent).startsWith('atividade de fixacao');
    const bands  = [...body.querySelectorAll('div')].filter(d => isBand(d) && ![...d.querySelectorAll('div')].some(isBand));
    if (bands.length !== 1) {
      return { error: bands.length
        ? `Achei ${bands.length} faixas "Atividade de Fixação" nesta página — deve haver só uma.`
        : 'Não achei a faixa "Atividade de Fixação Não Pontuada" nesta página.' };
    }
    const box = bands[0].nextElementSibling;
    if (!box || box.tagName !== 'DIV') return { error: 'Não achei a caixa logo abaixo da faixa "Atividade de Fixação".' };
    const probe = box.cloneNode(true);
    h5pIn(probe).forEach(n => n.remove());
    const extra = probe.querySelector('img, iframe, video, audio, object, embed, table, a, span.mce-preview-object');
    if (norm(probe.textContent).replace(MARKER, '').trim() || extra) {
      return { error: 'A caixa abaixo da faixa tem outro conteúdo além do H5P — confira. Nada foi alterado.' };
    }
    return { box, old: h5pIn(box) };
  }

  // Leva o quiz recém-inserido para a caixa, tira o que havia nela e põe o
  // nome do quiz e os 100% de largura — num passo só de Ctrl+Z.
  function place(ed, box, old, node, label, blocksBefore) {
    const body = ed.getBody();
    ed.undoManager.transact(() => {
      let p = [...box.children].find(c => c.tagName === 'P');
      if (!p) { p = ed.dom.create('p', { style: 'text-align: center;' }); box.appendChild(p); }
      if (!box.contains(node)) {
        const from = node.parentElement;
        p.appendChild(node);
        // Parágrafo que o Canvas criou só para o quiz fica vazio: sai também.
        if (from && from !== body && from.tagName === 'P' && !blocksBefore.has(from) &&
            !norm(from.textContent) && !from.querySelector('img, iframe, span.mce-preview-object')) from.remove();
      }
      old.forEach(n => { if (n !== node && n.isConnected) n.remove(); });
      p.childNodes.forEach(t => { if (t.nodeType === 3) t.data = t.data.replace(MARKER_RAW, '').replace(/^\s+$/, ''); });

      // Nome do quiz no iframe, para o leitor de tela.
      if (node.matches('span.mce-preview-object')) node.setAttribute('data-mce-p-title', label);
      (node.tagName === 'IFRAME' ? node : node.querySelector('iframe'))?.setAttribute('title', label);
      node.scrollIntoView({ block: 'center' });

      // 100% de largura, pela mesma regra do "Redimensionar H5P".
      const W = window.__svcH5pWidth;
      const html = ed.getContent();
      const r = W.h5pEdits(html);
      if (r.edits.length) {
        const win = ed.getWin(), y = win.scrollY;
        ed.setContent(W.applyEdits(html, r.edits));
        win.scrollTo(0, y);
      }
    });
    ed.setDirty(true);
    ed.nodeChanged();
  }

  // ── Confirmação ──────────────────────────────────────────────────────
  // Botão apertado sem querer não muda nada: só segue com "Sim".
  function confirmImport(title, replacing) {
    return new Promise(resolve => {
      document.getElementById('__svc-h5p-confirm__')?.remove();
      const overlay = document.createElement('div');
      overlay.id = '__svc-h5p-confirm__';
      Object.assign(overlay.style, {
        position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.55)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: '2147483647', fontFamily: 'system-ui, sans-serif',
      });
      const box = document.createElement('div');
      Object.assign(box.style, {
        background: '#1e1e2e', color: '#e2e8f0', padding: '18px 20px', borderRadius: '8px',
        width: '420px', maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box', boxShadow: '0 4px 24px rgba(0,0,0,.7)',
      });
      const line = (text, style) => {
        const el = document.createElement('p');
        el.textContent = text;
        Object.assign(el.style, { margin: '0 0 10px', lineHeight: '1.4', fontSize: '12px', color: '#cbd5e1' }, style);
        box.appendChild(el);
      };
      line('🧩 Quer importar o H5P para a página?', { fontSize: '14px', fontWeight: 'bold', color: '#e2e8f0' });
      line(`Quiz: "${title}"`);
      if (replacing) line('O H5P que já está na caixa da Atividade de Fixação será substituído.', { color: '#fbbf24' });
      line('Busca só nos seus conteúdos (My Content) do H5P.com. A página não é salva sozinha.', { fontSize: '11px', color: '#94a3b8' });

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
      const no  = mk('Não', false);
      const yes = mk('Sim', true);
      box.appendChild(row);

      function done(value) {
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
        resolve(value);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      }
      no.onclick  = () => done(false);
      yes.onclick = () => done(true);
      document.addEventListener('keydown', onKey, true);
      let downOnBackdrop = false;
      overlay.addEventListener('mousedown', e => { downOnBackdrop = e.target === overlay; });
      overlay.addEventListener('click', e => { if (downOnBackdrop && e.target === overlay) done(false); });

      overlay.appendChild(box);
      document.body.appendChild(overlay);
      no.focus();   // Enter sem querer também não importa
    });
  }

  // ── Abrir o app ──────────────────────────────────────────────────────
  // Tomadinha (aria-label "apps-temp" no Canvas da PUC) → "Interactive Content
  // – H5P". Em janela estreita a tomadinha vai para o "Mais...".
  async function openH5pApp(container) {
    const label  = b => b.getAttribute('aria-label') || b.getAttribute('title') || '';
    const isApps = b => /\bapps?\b|aplicativ/i.test(label(b));
    let btn = [...container.querySelectorAll('.tox-tbtn, .tox-split-button')].find(isApps);
    if (!btn) {
      const more = [...container.querySelectorAll('.tox-tbtn')].find(b => /^(mais|more)\b/i.test(label(b)));
      if (more) {
        more.click();
        btn = await waitFor(() => [...document.querySelectorAll('.tox-tbtn, .tox-split-button')].find(isApps), 1500);
      }
    }
    if (!btn) return false;
    btn.click();
    const item = await waitFor(() => [...document.querySelectorAll('.tox-collection__item, [role="menuitem"]')]
      .find(it => /interactive content|h5p/i.test(it.getAttribute('aria-label') || it.textContent || '')), 3000);
    if (!item) return false;
    item.click();
    return true;
  }

  const popupOpen = () => [...document.querySelectorAll('[role="dialog"]')]
    .some(d => d.querySelector('iframe#external_tool_button_frame') || /interactive content/i.test(d.textContent.slice(0, 300)));

  // ── Um clique ────────────────────────────────────────────────────────
  let current = null;   // importação em andamento: { stop }

  async function run(container) {
    const ed = findEditorFor(container);
    if (!ed) return;
    const ifr = ed.iframeElement || container.querySelector('iframe');
    if (!ifr || !ifr.getClientRects().length) {
      toast('⚠ Volte ao editor visual (o </> está ativo) e clique de novo.', ERR);
      return;
    }
    const title = (document.querySelector('#wikipage-title-input, input[data-testid="wikipage-title-input"], input[name="title"]')?.value || '').trim();
    if (!title) { toast('⚠ Não achei o título da página para buscar o quiz.', ERR); return; }
    const first = findBox(ed.getBody());
    if (first.error) { toast('⚠ ' + first.error, ERR, 7000); return; }

    if (!(await confirmImport(title, first.old.length > 0))) return;
    if (current) current.stop();   // clique de novo recomeça

    // A página pode ter mudado enquanto a confirmação estava aberta.
    const body  = ed.getBody();
    const found = findBox(body);
    if (found.error) { toast('⚠ ' + found.error, ERR, 7000); return; }

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const before       = new Set(h5pIn(body));
    const blocksBefore = new Set(body.querySelectorAll('p'));
    let quizTitle = null, settled = false, seenPopup = false, closedAt = 0;

    // Cursor no parágrafo da caixa (ou na própria caixa), depois do que houver.
    try {
      ed.focus();
      const rng = ed.dom.createRng();
      rng.selectNodeContents([...found.box.children].find(c => c.tagName === 'P') || found.box);
      rng.collapse(false);
      ed.selection.setRng(rng);
    } catch (_) {}

    const onMsg = e => {
      const d = e.data;
      if (e.source !== window || !d || d.__svc !== 'h5pResult' || d.id !== id) return;
      if (d.status === 'insert') { quizTitle = d.title; toast('⏳ Quiz encontrado — inserindo...', INFO); }
      else if (d.status === 'none') {
        const near = d.near?.length ? ` Achei: ${d.near.map(t => `"${t}"`).join(', ')}.` : '';
        toast(`⚠ Nenhum quiz seu (My Content) com o nome "${title}".${near} Escolha no popup ou feche-o.`, ERR, 10000);
      }
      else if (d.status === 'many')   toast(`⚠ ${d.count} quizzes seus com o nome "${title}" — marquei em laranja no popup. Escolha um.`, ERR, 10000);
      else if (d.status === 'reload') toast('⚠ A extensão foi atualizada. Recarregue a página (F5) e tente de novo.', ERR, 10000);
      else if (d.status === 'error')  toast('⚠ ' + (d.detail || 'Erro na busca do H5P.'), ERR, 10000);
    };

    const stop = () => {
      settled = true;
      obs.disconnect();
      pageObs.disconnect();
      clearInterval(watch);
      window.removeEventListener('message', onMsg);
      window.postMessage({ __svc: 'h5pCancel', id }, '*');
      if (current?.stop === stop) current = null;
    };
    current = { stop };

    // O quiz novo é o H5P que não estava na página antes do clique — também
    // vale se a pessoa escolheu outro à mão no popup.
    const obs = new MutationObserver(() => {
      if (settled) return;
      const fresh = h5pIn(body).filter(n => !before.has(n));
      if (!fresh.length) return;
      settled = true;
      setTimeout(() => {   // deixa o TinyMCE terminar de montar a prévia
        stop();
        try {
          place(ed, found.box, found.old, fresh[0], quizTitle || title, blocksBefore);
          toast(`✓ Quiz "${quizTitle || title}" inserido${found.old.length ? ' (substituí o H5P que estava)' : ''}. Confira e salve a página.`, OK, 7000);
        } catch (err) {
          toast('⚠ O quiz entrou, mas não consegui arrumá-lo na caixa: ' + err.message, ERR, 10000);
        }
      }, 150);
    });
    obs.observe(body, { childList: true, subtree: true });

    // Popup fechado sem Insert, ou abandonado: encerra sem mexer em nada. O
    // abrir/fechar é visto na hora, por observador — uma checagem periódica
    // perderia um popup que abre e fecha entre duas checagens.
    const checkPopup = () => {
      if (settled) return;
      if (popupOpen()) { seenPopup = true; closedAt = 0; }
      else if (seenPopup && !closedAt) closedAt = Date.now();
    };
    const pageObs = new MutationObserver(checkPopup);
    pageObs.observe(document.body, { childList: true, subtree: true });
    const startedAt = Date.now();
    const watch = setInterval(() => {
      checkPopup();
      if (settled) return;
      // O Insert fecha o popup e o quiz entra logo depois: espera um pouco.
      if ((closedAt && Date.now() - closedAt > 2500) || Date.now() - startedAt > WAIT_INSERT_MS) {
        stop();
        toast('Popup do H5P fechado sem inserir — nada foi alterado.', INFO);
      }
    }, 500);

    window.addEventListener('message', onMsg);
    window.postMessage({ __svc: 'h5pRequest', id, title }, '*');
    toast('⏳ Abrindo o Interactive Content – H5P...', INFO);
    if (!(await openH5pApp(container)) && !settled) {
      toast('⚠ Não achei o "Interactive Content – H5P" no menu de aplicativos. Abra-o pela tomadinha — a busca continua automática.', ERR, 10000);
    }
  }

  // ── Botão na barra ───────────────────────────────────────────────────
  // Selo "H5P" em texto de verdade, na fonte da barra e na cor dos outros
  // ícones (currentColor): legível no tamanho da barra, ao contrário de um
  // texto miúdo dentro de SVG.
  const ICON =
    '<span aria-hidden="true" style="font-family: inherit; font-size: 11px; font-weight: 700; line-height: 1; ' +
    'letter-spacing: .02em; padding: 3px 3px 2px; border: 1.5px solid currentColor; border-radius: 4px; ' +
    'pointer-events: none;">H5P</span>';

  function buildButton(container) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tox-tbtn __svc-h5p-btn__';
    btn.title = 'Importar o quiz H5P do tópico';
    btn.setAttribute('aria-label', 'Importar o quiz H5P do tópico');
    btn.innerHTML = ICON;
    // Sem isso, o clique tira o foco do editor antes de começar.
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      run(container).catch(err => toast('⚠ ' + err.message, ERR, 8000));
    });
    return btn;
  }

  // Ao lado do "Justificar" (canvas-justify.js), se ele já estiver na barra.
  function injectInto(toolbar) {
    if (toolbar.querySelector('.__svc-h5p-btn__')) return;
    const container = toolbar.closest('.tox-tinymce');
    if (!container) return;
    const justify = toolbar.querySelector('.__svc-justify-btn__');
    if (justify) { justify.parentElement.appendChild(buildButton(container)); return; }
    const group = document.createElement('div');
    group.className = 'tox-toolbar__group';
    group.appendChild(buildButton(container));
    toolbar.appendChild(group);
  }

  function scan() {
    if (!PAGE_EDIT.test(location.pathname) || !document.querySelector('.tox-tinymce')) return;
    document.querySelectorAll('.tox-toolbar__primary').forEach(injectInto);
  }

  scan();
  // O Canvas monta o editor depois e a barra é refeita quando a janela muda
  // de largura: observa e recoloca o botão.
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; scan(); }, 300);
  }).observe(document.body, { childList: true, subtree: true });
})();
