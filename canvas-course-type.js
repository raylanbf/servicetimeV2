// Tipo da disciplina no Canvas: escreve "Fluxo de produção" ou "Reaproveitamento"
// abaixo do nome do curso, no cabeçalho com o caminho de navegação. A regra
// olha a 1ª importação de conteúdo do curso (a de menor id que não falhou): se
// veio de um template do fluxo de produção (⚙ Configurações), a disciplina é
// nova; se veio de qualquer outro curso ou arquivo, é reaproveitamento.
// Liga e desliga em ⚙ Configurações › Canvas LMS — nasce desligado.
(() => {
  'use strict';

  const courseId = location.pathname.match(/^\/courses\/(\d+)/)?.[1];
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

  async function getJson(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

  let firstImport = null;   // uma busca por página, reaproveitada ao mudar a configuração

  async function refresh() {
    const cfg = await chrome.storage.local.get({ courseTypeEnabled: false, canvasFlowTemplates: null });
    if (!cfg.courseTypeEnabled) { clear(); return; }
    const templates = cfg.canvasFlowTemplates?.length ? cfg.canvasFlowTemplates : DEFAULT_TEMPLATES;
    try {
      render(await (firstImport ||= fetchFirstImport()), templates);
    } catch {
      clear();   // sem permissão no curso ou API fora do ar: não mostra nada
    }
  }

  refresh();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('courseTypeEnabled' in changes || 'canvasFlowTemplates' in changes)) refresh();
  });
})();
