'use strict';

// Pastas e quizzes do H5P.com da PUC — usado pelo botão "📁 Pasta H5P" da
// página de módulos do Canvas (canvas-h5p-folder.js), pelo background.js
// (importScripts).
//
// Sem API oficial: usa a sessão do H5P.com aberta neste Chrome e os mesmos
// formulários da tela (descobertos com o Gravador de Ações em 13/11/2026):
//   • lista: GET /content (raiz do My Content) ou /content/<id da pasta>; cada
//     item é um <tr class="browser-row fable-row [folder]"> com o checkbox
//     value=<id> data-parent=<pasta-mãe, vazio na raiz> e o link
//     <a href=".../content/<id>" class="fable-title …">nome</a>. 50 por página.
//   • pasta: POST /content (multipart) com _token (o csrf-token da página),
//     title, parent (vazio = raiz do My Content) e type=1 — pasta privada.
//     Na pasta da equipe (createInTeam: a da UDA ou, no Microfundamento, a
//     GRADUAÇÃO EAD), o formulário que o botão "New Folder" da tela dela
//     abrir (a tela também tem POST /organization-folders).
//     Nada é apagado nem alterado: só GET e os POST de criar.
//   • quiz: o formulário #laravel-h5p-form de /content/create?parent=<pasta>,
//     com as opções padrão da tela, e o que o editor do H5P põe ao salvar
//     (content-form/editor-parent.js do H5P.com): title, library
//     ("H5P.MultiChoice 1.16") e parameters = JSON {params, metadata}; params
//     é a questão provisória ou a de um .h5p escolhido (h5p-package.js).
//     O H5P.com responde redirecionando para /content/<id novo>.
// IDs têm 19 dígitos: ficam sempre como texto.
globalThis.H5P_FOLDER = (() => {
  const ORIGIN = 'https://pucminasvirtual.h5p.com';
  const MAX_PAGES = 20;
  const QUIZ_LIBRARY = 'H5P.MultiChoice 1.16';

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const decode = s => String(s || '').replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  // Comparação de nomes: sem diferença de espaços, maiúsculas e travessões.
  const norm = s => decode(s).normalize('NFC').replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
  const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function csrfOf(html) {
    return html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)/i)?.[1]
        || html.match(/<input[^>]+name=["']_token["'][^>]+value=["']([^"']+)/i)?.[1] || null;
  }

  // Pastas e conteúdos da lista.
  function itemsOf(html) {
    const out = [];
    for (const row of html.split(/<tr\b/i).slice(1)) {
      const cls = row.match(/^[^>]*\bclass=["']([^"']*)/i)?.[1] || '';
      if (!/\bbrowser-row\b/.test(cls)) continue;
      const link = row.match(/<a[^>]+href=["'][^"']*\/content\/(\d+)["'][^>]*class=["'][^"']*fable-title[^"']*["'][^>]*>([^<]*)<\/a>/i);
      if (!link) continue;
      const parent = row.match(/\bdata-parent=["'](\d*)["']/i)?.[1] ?? '';
      out.push({ id: link[1], title: decode(link[2]).trim(), parent, folder: /\bfolder\b/.test(cls), url: `${ORIGIN}/content/${link[1]}` });
    }
    return out;
  }
  const foldersOf = html => itemsOf(html).filter(i => i.folder);

  // Maior número de página nos links da paginação (Laravel: ?page=N).
  function lastPageOf(html) {
    let max = 1;
    for (const m of html.matchAll(/href=["'][^"']*[?&](?:amp;)?page=(\d+)/gi)) max = Math.max(max, Number(m[1]));
    return Math.min(max, MAX_PAGES);
  }

  const listUrl = parent => (parent ? `${ORIGIN}/content/${parent}` : `${ORIGIN}/content`);
  const fail = (code, message) => Object.assign(new Error(message), { code });

  async function request(fetchFn, url, opts = {}) {
    try { return await fetchFn(url, { credentials: 'include', ...opts, headers: { Accept: 'text/html', ...(opts.headers || {}) } }); }
    catch { throw fail('network', 'Sem conexão com o H5P.com.'); }
  }

  async function getPage(fetchFn, url) {
    const res = await request(fetchFn, url);
    const html = await res.text();
    // Sem sessão o H5P.com manda para login.h5p.com (ou /login).
    if (new URL(res.url || url).hostname !== new URL(ORIGIN).hostname || /\/login\b/.test(new URL(res.url || url).pathname) || !csrfOf(html)) {
      throw fail('login', 'Não há sessão aberta no H5P.com neste Chrome.');
    }
    if (!res.ok) throw fail('http', `O H5P.com respondeu ${res.status} ao abrir ${new URL(url).pathname}.`);
    return html;
  }

  // Itens que estão direto em `parent` ('' = raiz do My Content), de todas as páginas.
  async function list(fetchFn, parent = '') {
    const first = await getPage(fetchFn, listUrl(parent));
    const items = itemsOf(first);
    const last = lastPageOf(first);
    for (let p = 2; p <= last; p++) items.push(...itemsOf(await getPage(fetchFn, `${listUrl(parent)}?page=${p}`)));
    const seen = new Set();
    const mine = items.filter(i => i.parent === String(parent) && !seen.has(i.id) && seen.add(i.id));
    return { csrf: csrfOf(first), items: mine, folders: mine.filter(i => i.folder) };
  }

  const cleanTitle = t => String(t || '').replace(/\s+/g, ' ').trim();

  // ── Pasta ─────────────────────────────────────────────────────────────
  // { status: 'created' | 'exists' | 'unconfirmed', folder?, title }
  async function create(fetchFn, { title, parent = '' }) {
    title = cleanTitle(title);
    if (!title) throw fail('title', 'Nome da pasta vazio.');

    const before = await list(fetchFn, parent);
    const same = before.folders.find(f => norm(f.title) === norm(title));
    if (same) return { status: 'exists', folder: same, title };

    const form = new FormData();
    form.append('_token', before.csrf);
    form.append('title', title);
    form.append('parent', String(parent));
    form.append('type', '1');
    const res = await request(fetchFn, `${ORIGIN}/content`, { method: 'POST', body: form });
    if (res.status === 419) throw fail('expired', 'A sessão do H5P.com expirou. Recarregue o H5P.com e tente de novo.');
    if (!res.ok) throw fail('http', `O H5P.com respondeu ${res.status} ao criar a pasta.`);

    // Confere na lista: a pasta nova é a que tem esse nome e não existia antes.
    const old = new Set(before.folders.map(f => f.id));
    const after = await list(fetchFn, parent);
    const made = after.folders.find(f => norm(f.title) === norm(title) && !old.has(f.id));
    return made ? { status: 'created', folder: made, title } : { status: 'unconfirmed', title };
  }

  // ── Pasta na pasta da equipe (produção) ──────────────────────────────
  // Uma por tipo de disciplina, dentro de PRODUÇÕES:
  //   uda   — "UDA - UNIDADE DIGITAL DE APRENDIZAGEM" (gravação de 15/11/2026);
  //   micro — "GRADUAÇÃO EAD", dos Microfundamentos (gravação de 20/11/2026;
  //           as pastas lá dentro se chamam "Microfundamento: <disciplina>").
  // Lá nada pode ser apagado, então nada é enviado sem antes conferir: (1) a
  // página aberta é mesmo essa pasta (título); (2) a lista dela foi lida;
  // (3) qual formulário o botão "New Folder" da própria tela abre (pasta
  // comum, POST /content, ou pasta da organização, POST
  // /organization-folders) e que ele aponta para ela. O formulário vai como
  // a tela o tem, só com o nome preenchido.
  // Nas duas telas reais (perfil "author"), o "New Folder" abre o da pasta
  // comum: POST /content com parent = a pasta da equipe e type=1 — as pastas
  // lá dentro são "Private folder" com colaboradores. O ensaio sobre o HTML
  // gravado de cada uma montou exatamente esse pedido.
  const TEAMS = {
    uda:   { id: '1293047322003249328', title: 'UDA - UNIDADE DIGITAL DE APRENDIZAGEM', label: 'PRODUÇÕES › UDA - UNIDADE DIGITAL DE APRENDIZAGEM' },
    micro: { id: '1293047321834512708', title: 'GRADUAÇÃO EAD', label: 'PRODUÇÕES › GRADUAÇÃO EAD' },
  };
  const TEAM = TEAMS.uda;
  // A pasta da equipe do tipo (sem tipo: a da UDA). Tipo desconhecido: erro, nada vai.
  function teamOf(kind = 'uda') {
    if (!Object.prototype.hasOwnProperty.call(TEAMS, kind)) throw fail('dest', `Tipo de disciplina desconhecido (${kind}). Nada foi criado.`);
    return TEAMS[kind];
  }

  const pageTitleOf = html => decode(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+-\s+H5P\.com\s*$/i, '').replace(/\s+/g, ' ').trim();

  // O formulário que o botão "New Folder" da tela abre: { formId, action } ou { error }.
  function newFolderFormOf(html) {
    const targets = new Set();
    for (const m of html.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      const target = m[2].match(/\bdata-target=["']#([\w-]+)["']/i)?.[1];
      const text = decode(m[3].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      if (target && /^new (organization )?folder$/i.test(text)) targets.add(target);
    }
    if (targets.size !== 1) {
      return { error: targets.size ? `a tela tem ${targets.size} botões de pasta nova (${[...targets].join(', ')})` : 'não achei o botão "New Folder" na tela' };
    }
    const modal = [...targets][0];
    for (const f of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
      if (!new RegExp(`\\bid=["']${modal}["']`).test(f[2])) continue;
      const formId = f[1].match(/\bid=["']([^"']+)["']/i)?.[1];
      const action = decode(f[1].match(/\baction=["']([^"']+)["']/i)?.[1] || '');
      return formId ? { formId, action } : { error: 'o formulário da pasta nova não tem id' };
    }
    return { error: `não achei o formulário de "${modal}"` };
  }

  // kind: 'uda' (padrão) ou 'micro' — qual pasta da equipe (TEAMS).
  // { status: 'created' | 'exists' | 'unconfirmed', folder?, title }
  async function createInTeam(fetchFn, parseForm, { title, kind = 'uda' }) {
    const TEAM = teamOf(kind);
    title = cleanTitle(title);
    if (!title) throw fail('title', 'Nome da pasta vazio.');
    const nothing = 'Nada foi criado.';

    const html = await getPage(fetchFn, listUrl(TEAM.id));
    const found = pageTitleOf(html);
    if (norm(found) !== norm(TEAM.title)) {
      throw fail('dest', `A pasta da equipe abriu como "${found || 'sem título'}", e não "${TEAM.title}". ${nothing}`);
    }
    const before = await list(fetchFn, TEAM.id);
    if (!before.items.length) throw fail('dest', `Não consegui ler o que há na pasta da equipe. ${nothing}`);
    const same = before.folders.find(f => norm(f.title) === norm(title));
    if (same) return { status: 'exists', folder: same, title };

    const form = newFolderFormOf(html);
    if (form.error) throw fail('dest', `Não sei criar pasta na pasta da equipe: ${form.error}. ${nothing}`);
    let action = null;
    try { action = new URL(form.action, ORIGIN); } catch { /* fica null */ }
    if (!action || action.origin !== ORIGIN || !['/content', '/organization-folders'].includes(action.pathname)) {
      throw fail('dest', `O formulário de pasta nova da pasta da equipe vai para um endereço inesperado (${form.action || 'vazio'}). ${nothing}`);
    }
    const entries = await parseForm(html, form.formId);
    if (!Array.isArray(entries) || !entries.some(([k]) => k === '_token')) throw fail('form', `Não consegui ler o formulário de pasta nova do H5P.com. ${nothing}`);
    const parents = entries.filter(([k]) => k === 'parent').map(([, v]) => String(v));
    if (parents.length !== 1 || parents[0] !== TEAM.id) throw fail('dest', `O formulário de pasta nova não aponta para a pasta da equipe. ${nothing}`);
    if (!entries.some(([k]) => k === 'title')) throw fail('form', `O formulário de pasta nova não tem o campo do nome. ${nothing}`);

    const body = new FormData();
    let named = false;
    for (const [k, v] of entries) {
      if (k !== 'title') body.append(k, v);
      else if (!named) { body.append('title', title); named = true; }
    }
    const res = await request(fetchFn, action.href, { method: 'POST', body });
    if (res.status === 419) throw fail('expired', 'A sessão do H5P.com expirou. Recarregue o H5P.com e tente de novo.');
    if (!res.ok) throw fail('http', `O H5P.com respondeu ${res.status} ao criar a pasta.`);

    const old = new Set(before.folders.map(f => f.id));
    const after = await list(fetchFn, TEAM.id);
    const made = after.folders.find(f => norm(f.title) === norm(title) && !old.has(f.id));
    return made ? { status: 'created', folder: made, title } : { status: 'unconfirmed', title };
  }

  // ── Quiz ──────────────────────────────────────────────────────────────
  // Conteúdo de um Multiple Choice novo, igual ao que o editor do H5P.com
  // gera (quiz criado à mão em 13/11/2026): textos em pt-BR, "Tentar
  // novamente" e "Verificar" ligados, "Mostrar solução" e pontuação
  // desligados, alternativas embaralhadas. Pergunta e alternativas vão com
  // texto provisório, para a equipe trocar no editor.
  const PLACEHOLDER_QUESTION = 'Pergunta';
  const PLACEHOLDER_ANSWERS = ['Alternativa A', 'Alternativa B', 'Alternativa C', 'Alternativa D'];
  function quizParams(title) {
    const params = {
      media: { disableImageZooming: false },
      answers: PLACEHOLDER_ANSWERS.map(text => ({
        correct: false, tipsAndFeedback: { tip: '', chosenFeedback: '', notChosenFeedback: '' }, text: `<div>${escHtml(text)}</div>`,
      })),
      overallFeedback: [{ from: 0, to: 100 }],
      behaviour: {
        enableRetry: true, enableSolutionsButton: false, enableCheckButton: true, type: 'auto', singlePoint: false,
        randomAnswers: true, showSolutionsRequiresInput: true, confirmCheckDialog: false, confirmRetryDialog: false,
        autoCheck: false, passPercentage: 100, showScorePoints: false,
      },
      UI: {
        checkAnswerButton: 'Verificar', submitAnswerButton: 'Enviar', showSolutionButton: 'Mostrar solução',
        tryAgainButton: 'Tentar Novamente', tipsLabel: 'Mostrar dica',
        scoreBarLabel: 'Você conseguiu :num de :total pontos possíveis', tipAvailable: 'Dica disponível',
        feedbackAvailable: 'Feedback disponível', readFeedback: 'Ler feedback', wrongAnswer: 'Resposta incorreta',
        correctAnswer: 'Resposta correta', shouldCheck: 'Deveria ter sido verificado',
        shouldNotCheck: 'Não deveria ter sido marcado', noInput: 'Por favor, responda antes de visualizar a solução',
        a11yCheck: 'Confira as respostas. As respostas serão marcadas como corretas, incorretas ou não respondidas.',
        a11yShowSolution: 'Mostrar a solução. A tarefa será marcada com sua solução correta.',
        a11yRetry: 'Repita a tarefa. Redefina todas as respostas e inicie a tarefa novamente.',
      },
      confirmCheck: { header: 'Finalizar ?', body: 'Você tem certeza que deseja finalizar ?', cancelLabel: 'Cancelar', confirmLabel: 'Finalizar' },
      confirmRetry: { header: 'Tentar Novamente ?', body: 'Você tem certeza que deseja tentar novamente ?', cancelLabel: 'Cancelar', confirmLabel: 'Confirmar' },
      question: `<p>${escHtml(PLACEHOLDER_QUESTION)}</p>`,
    };
    return { params, metadata: { title, license: 'U', defaultLanguage: 'pt-br' } };
  }

  // Conteúdo do quiz: a questão de um .h5p (params, já conferido pelo
  // h5p-package.js) ou a provisória. O título é sempre o da página.
  const quizContent = (title, params) => (params
    ? { params, metadata: { title, license: 'U', defaultLanguage: 'pt-br' } }
    : quizParams(title));

  // Campos que o editor do H5P.com preenche ao salvar; o resto vem do
  // formulário como a tela o abre. "Toolbar Below Content" (frame) vem
  // marcado e a equipe sempre desmarca: sai desmarcado (checkbox desmarcado
  // não vai no envio).
  const DROP = new Set(['submitter', 'frame']);
  function quizFields(entries, { title, parent, params }) {
    const set = {
      title, library: QUIZ_LIBRARY, parameters: JSON.stringify(quizContent(title, params)), parent: String(parent),
      timezone_offset: String(new Date().getTimezoneOffset()),
    };
    const out = [], done = new Set();
    for (const [k, v] of entries) {
      if (DROP.has(k)) continue;
      if (k in set) { if (!done.has(k)) { out.push([k, set[k]]); done.add(k); } continue; }
      out.push([k, v]);
    }
    for (const k of Object.keys(set)) if (!done.has(k)) out.push([k, set[k]]);
    out.push(['submitter', 'Save']);   // o editor põe um hidden "submitter" com o botão clicado
    return out;
  }

  // Mensagem de erro de validação que o H5P.com mostra ao voltar para o formulário.
  function formErrorOf(html) {
    const msgs = [...html.matchAll(/class=["'][^"']*help-block[^"']*["'][^>]*>\s*(?:<strong>)?([^<]{3,})/gi)].map(m => decode(m[1]).trim()).filter(Boolean);
    const alert = html.match(/class=["'][^"']*alert-danger[^"']*["'][^>]*>([\s\S]{0,400}?)<\/div>/i)?.[1];
    if (alert) msgs.push(decode(alert.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());
    return [...new Set(msgs)].join(' · ');
  }

  // { status: 'created' | 'exists', item, title }
  // parseForm(html, formId) → [[nome, valor], …] como o navegador enviaria
  // (no documento offscreen, que tem DOMParser). params: a questão de um
  // .h5p (opcional; sem ela, a provisória). Quiz que já existe não muda.
  async function createQuiz(fetchFn, parseForm, { title, parent, params = null }) {
    title = cleanTitle(title);
    if (!title) throw fail('title', 'Título do quiz vazio.');
    if (!/^\d+$/.test(String(parent || ''))) throw fail('parent', 'Pasta do quiz não informada.');
    if (params !== null && (typeof params !== 'object' || Array.isArray(params) || !Array.isArray(params.answers))) {
      throw fail('params', `A questão do arquivo .h5p para "${title}" não é uma Múltipla escolha válida.`);
    }

    const { items } = await list(fetchFn, parent);
    const same = items.find(i => !i.folder && norm(i.title) === norm(title));
    if (same) return { status: 'exists', item: same, title };

    const createUrl = `${ORIGIN}/content/create?parent=${parent}`;
    const html = await getPage(fetchFn, createUrl);
    const entries = await parseForm(html, 'laravel-h5p-form');
    if (!Array.isArray(entries) || !entries.some(([k]) => k === '_token')) {
      throw fail('form', 'Não encontrei o formulário de criação do H5P.com (a tela pode ter mudado).');
    }
    const body = new FormData();
    for (const [k, v] of quizFields(entries, { title, parent, params })) body.append(k, v);

    const res = await request(fetchFn, `${ORIGIN}/content`, { method: 'POST', body });
    if (res.status === 419) throw fail('expired', 'A sessão do H5P.com expirou. Recarregue o H5P.com e tente de novo.');
    if (!res.ok) throw fail('http', `O H5P.com respondeu ${res.status} ao criar o quiz.`);
    const id = new URL(res.url || '', ORIGIN).pathname.match(/^\/content\/(\d+)\/?$/)?.[1];
    if (!id) {
      const why = formErrorOf(await res.text().catch(() => ''));
      throw fail('rejected', `O H5P.com não aceitou o quiz "${title}"${why ? ': ' + why : '.'}`);
    }
    return { status: 'created', item: { id, title, parent: String(parent), folder: false, url: `${ORIGIN}/content/${id}` }, title };
  }

  return { ORIGIN, QUIZ_LIBRARY, TEAM, TEAMS, teamOf, create, createInTeam, createQuiz, list, itemsOf, foldersOf, csrfOf, lastPageOf, norm, quizParams, quizFields, formErrorOf, pageTitleOf, newFolderFormOf };
})();
