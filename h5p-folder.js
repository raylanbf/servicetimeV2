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
//     title, parent (vazio = raiz do My Content) e type=1.
//   • quiz: o formulário #laravel-h5p-form de /content/create?parent=<pasta>,
//     com as opções padrão da tela, e o que o editor do H5P põe ao salvar
//     (content-form/editor-parent.js do H5P.com): title, library
//     ("H5P.MultiChoice 1.16") e parameters = JSON {params, metadata}.
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

  // Campos que o editor do H5P.com preenche ao salvar; o resto vem do
  // formulário como a tela o abre. "Toolbar Below Content" (frame) vem
  // marcado e a equipe sempre desmarca: sai desmarcado (checkbox desmarcado
  // não vai no envio).
  const DROP = new Set(['submitter', 'frame']);
  function quizFields(entries, { title, parent }) {
    const set = {
      title, library: QUIZ_LIBRARY, parameters: JSON.stringify(quizParams(title)), parent: String(parent),
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
  // (no documento offscreen, que tem DOMParser).
  async function createQuiz(fetchFn, parseForm, { title, parent }) {
    title = cleanTitle(title);
    if (!title) throw fail('title', 'Título do quiz vazio.');
    if (!/^\d+$/.test(String(parent || ''))) throw fail('parent', 'Pasta do quiz não informada.');

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
    for (const [k, v] of quizFields(entries, { title, parent })) body.append(k, v);

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

  return { ORIGIN, QUIZ_LIBRARY, create, createQuiz, list, itemsOf, foldersOf, csrfOf, lastPageOf, norm, quizParams, quizFields, formErrorOf };
})();
