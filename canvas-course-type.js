// Tipo da disciplina no Canvas: escreve "Fluxo de produção" ou "Reaproveitamento"
// abaixo do nome do curso, no cabeçalho com o caminho de navegação. A regra
// olha a 1ª importação de conteúdo do curso (a de menor id que não falhou): se
// veio de um template do fluxo de produção (⚙ Configurações), a disciplina é
// nova; se veio de qualquer outro curso ou arquivo, é reaproveitamento.
// Liga e desliga em ⚙ Configurações › Canvas LMS — nasce ligado.
(() => {
  'use strict';

  const courseOf = () => location.pathname.match(/^\/courses\/(\d+)/)?.[1] || null;
  let courseId = courseOf();
  if (!courseId || window.__svcCourseType) return;
  window.__svcCourseType = true;

  const BOX_ID = '__svc-course-type__';
  // Mesmo padrão de DEFAULT_CANVAS_FLOW_TEMPLATES no popup.js.
  const DEFAULT_TEMPLATES = ['Template 2025 Deduca'];

  const KINDS = {
    fluxo: { label: 'Fluxo de produção', bg: '#e5f5ec', fg: '#0b6b3a', bd: '#b5dfc6' },
    reap:  { label: 'Reaproveitamento',  bg: '#e8f1fb', fg: '#1b4f8a', bd: '#bcd4ef' },
    none:  { label: 'Sem importações',   bg: '#f1f3f4', fg: '#4a5568', bd: '#d5dbdf' },
  };

  // Sem acento, minúsculo, travessões como hífen e espaços colapsados.
  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();

  const RETRY_MS = [1500, 4000];   // esperas antes da 2ª e da 3ª tentativa

  async function getJson(url) {
    let res = null;
    for (let i = 0; ; i++) {
      try { res = await fetch(url, { headers: { Accept: 'application/json' } }); } catch { res = null; }
      if (res?.ok) break;
      // 401/404 = sem permissão no curso: não adianta insistir. O resto (403 do
      // limite de requisições do Canvas, que estoura na página inicial cheia de
      // chamadas, 5xx ou rede) é passageiro e tenta de novo.
      const status = res?.status || 0;
      if (status === 401 || status === 404 || i >= RETRY_MS.length) throw new Error(`HTTP ${status}`);
      await new Promise(r => setTimeout(r, RETRY_MS[i]));
    }
    // GET com sessão pode vir com o prefixo anti-sequestro do Canvas.
    const data = JSON.parse((await res.text()).replace(/^while\(1\);/, ''));
    const next = (res.headers.get('Link') || '').match(/<([^>]+)>;\s*rel="next"/)?.[1] || null;
    return { data, next };
  }

  // A API lista as importações da mais nova para a mais antiga (sem as
  // sincronizações de Blueprint); a 1ª é a de menor id entre as que não falharam.
  async function fetchFirstImport() {
    let url   = `/api/v1/courses/${courseId}/content_migrations?per_page=100`;
    let first = null;
    for (let guard = 0; url && guard < 30; guard++) {
      const { data, next } = await getJson(url);
      for (const m of Array.isArray(data) ? data : []) {
        if (m.workflow_state === 'failed') continue;
        if (!first || m.id < first.id) first = m;
      }
      url = next;
    }
    if (!first) return null;
    return {
      name: first.settings?.source_course_name || first.attachment?.display_name
         || first.migration_type_title || 'origem desconhecida',
      date: first.created_at || first.started_at || null,
    };
  }

  function clear() {
    const box = document.getElementById(BOX_ID);
    if (!box) return;
    box.parentElement.style.flexWrap = '';
    box.remove();
  }

  function render(info, templates) {
    const crumbs = document.querySelector('.ic-app-crumbs');
    if (!crumbs) return;

    const kind = !info ? 'none'
      : templates.some(t => norm(t) && norm(info.name).includes(norm(t))) ? 'fluxo' : 'reap';
    const k = KINDS[kind];
    const date   = info?.date ? new Date(info.date).toLocaleDateString('pt-BR') : '';
    const detail = info
      ? `1ª importação: ${info.name}${date ? ' · ' + date : ''}`
      : 'nenhuma importação de conteúdo neste curso';

    let box = document.getElementById(BOX_ID);
    if (!box) {
      box = document.createElement('div');
      box.id = BOX_ID;
      Object.assign(box.style, {
        flexBasis: '100%', display: 'flex', alignItems: 'center', gap: '6px',
        minWidth: '0', margin: '0 0 6px', fontSize: '12px', lineHeight: '18px',
      });
      crumbs.appendChild(box);
    }
    // .ic-app-crumbs é um flex em linha: com a quebra, a linha nova fica
    // embaixo do caminho de navegação em vez de ao lado dele.
    crumbs.style.flexWrap = 'wrap';

    box.title = `Service Timer — ${detail}. Fluxo de produção = 1ª importação vinda de: ${templates.join(', ')}.`;
    box.innerHTML = '';

    const pill = document.createElement('span');
    pill.textContent = k.label;
    Object.assign(pill.style, {
      background: k.bg, color: k.fg, border: `1px solid ${k.bd}`, borderRadius: '10px',
      padding: '0 8px', fontWeight: '700', whiteSpace: 'nowrap', flexShrink: '0',
    });

    const text = document.createElement('span');
    text.textContent = detail;
    Object.assign(text.style, {
      color: '#6b7780', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    });

    box.append(pill, text);
  }

  let firstImport = null;   // busca da 1ª importação do curso atual (uma por curso)
  let shown       = null;   // { info, templates } na tela — para redesenhar sem buscar de novo

  async function refresh() {
    const cfg = await chrome.storage.local.get({ courseTypeEnabled: true, canvasFlowTemplates: null });
    if (!cfg.courseTypeEnabled) { shown = null; clear(); return; }
    const templates = cfg.canvasFlowTemplates?.length ? cfg.canvasFlowTemplates : DEFAULT_TEMPLATES;
    const course = courseId;
    try {
      const info = await (firstImport ||= fetchFirstImport());
      if (course !== courseId) return;   // trocou de curso no meio da busca
      shown = { info, templates };
      render(info, templates);
    } catch {
      if (course !== courseId) return;   // erro da busca do curso anterior
      // Sem permissão no curso ou API fora do ar: não mostra nada, e esquece a
      // busca que falhou para a próxima atualização tentar de novo.
      firstImport = shown = null;
      clear();
    }
  }

  // O Canvas pode refazer o cabeçalho depois que a página carrega, e a linha
  // some junto: observa a página e a recoloca com o resultado já buscado. Se a
  // URL passar para outro curso sem recarregar, busca de novo.
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const now = courseOf();
      if (now !== courseId) {
        courseId = now;
        firstImport = shown = null;
        clear();
        if (now) refresh();
        return;
      }
      if (shown && !document.getElementById(BOX_ID)) render(shown.info, shown.templates);
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  refresh();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('courseTypeEnabled' in changes || 'canvasFlowTemplates' in changes)) refresh();
  });
})();
