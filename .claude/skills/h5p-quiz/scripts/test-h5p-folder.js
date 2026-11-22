// Regressão do botão "📁 Pasta H5P" (página de módulos do Canvas):
//   1. h5p-folder.js (listar, criar pasta, criar quiz) contra um H5P.com falso, em Node;
//   2. offscreen.js (formEntries: o formulário como o navegador enviaria) e
//      canvas-h5p-folder.js (botão, confirmação com os tópicos, avisos) num Chrome sem tela.
// Rodar com o playwright-core instalado numa pasta qualquer (ex.: o scratchpad):
//   NODE_PATH=<pasta>/node_modules node .claude/skills/h5p-quiz/scripts/test-h5p-folder.js
// Sem o playwright-core, roda só a parte 1.
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '../../../..');
const ORIGIN = 'https://pucminasvirtual.h5p.com';
let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('✓', name); };

// ── 1. h5p-folder.js ────────────────────────────────────────────────────
const ctx = { URL, FormData, console };
ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'h5p-folder.js'), 'utf8'), ctx);
const F = ctx.H5P_FOLDER;
// Objetos vêm de outro contexto (vm): compara pelo JSON.
const same = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
// Linha como a do H5P.com de verdade (13/11/2026), resumida.
const ROW = ({ id, title, parent = '', folder = true }) => `
    <tr class="browser-row fable-row${folder ? ' folder' : ''}">
        <td class="fable-toggle-checkbox fixed-checkbox-column">
          <input type="checkbox" id="content-${id}" class="fable-toggle-row" name="content[]" value="${id}" aria-label="${esc(title)}" data-parent="${parent}">
        </td>
        <td class="content-title browser-open-item fixed-title-column no-content-icon">
          <a href="${ORIGIN}/content/${id}" class="fable-title browser-row-link">${esc(title)}</a>
          <span class="item-content-type">${folder ? 'Private folder' : 'Multiple Choice'}</span>
        </td>
        <td class="moves-to-bulk-menu">
          <a href="${ORIGIN}/content/${id}/edit-folder" title="Edit Folder" class="btn">Edit</a>
          <a class="dropdown-item delete-option-dropdown" href="#" data-name="${esc(title)}" data-content-id="${id}">Delete</a>
        </td>
    </tr>`;

// Formulário de /content/create como o navegador o enviaria (o que o
// offscreen devolve) — campos do H5P.com de verdade, resumidos.
const FORM_ENTRIES = parent => [
  ['_token', 'CSRF123'], ['title', ''], ['library', '0'], ['parameters', '{}'],
  ['frame', '1'], ['copyright', '1'], ['display_confusion_indicator', '1'], ['send_confusion_reports_to', '0'],
  ['parent', String(parent)], ['share-id', '0'], ['share-title', ''], ['visible_for', '10'],
  ['timezone_offset', '0'], ['collaborators[]', '1293039416627290598'], ['send_score_to_lms', '2'],
  ['max_attempts', '1'], ['type', '0'], ['version', '0'],
];

function fakeH5p({ logged = true, items = [], perPage = 50, postStatus = 200, hideCreated = false, rejectQuiz = null } = {}) {
  const calls = [];
  let next = 1293060630437481200n;
  const page = (url, html, status = 200) => ({ url, ok: status >= 200 && status < 300, status, text: async () => html });
  const listing = (parent, p) => {
    const mine = items.filter(i => i.parent === parent && !(hideCreated && i.created));
    const pages = Math.max(1, Math.ceil(mine.length / perPage));
    const links = pages > 1 ? [...Array(pages)].map((_, i) => `<a href="${ORIGIN}/content${parent ? '/' + parent : ''}?page=${i + 1}">${i + 1}</a>`).join('') : '';
    return `<html><head><meta name="csrf-token" content="CSRF123"></head><body><table>${
      mine.slice((p - 1) * perPage, p * perPage).map(ROW).join('')}</table><div class="pagination-wrapper">${links}</div></body></html>`;
  };
  const createPage = (parent, error = '') => `<html><head><meta name="csrf-token" content="CSRF123"></head><body>
    <form method="POST" action="${ORIGIN}/content" id="laravel-h5p-form"><input type="hidden" name="parent" value="${parent}">
    ${error ? `<div class="form-group has-error"><span class="help-block"><strong>${error}</strong></span></div>` : ''}</form></body></html>`;
  async function fetchFn(url, opts = {}) {
    const method = opts.method || 'GET';
    const fields = opts.body instanceof FormData ? [...opts.body.entries()] : null;
    calls.push({ method, url, fields, credentials: opts.credentials });
    if (!logged) return page('https://login.h5p.com/', '<html><head><title>Log in</title></head><body>login</body></html>');
    const u = new URL(url);
    if (method === 'POST') {
      if (postStatus !== 200) return page(url, 'Page Expired', postStatus);
      const f = Object.fromEntries(fields);
      if (f.type === '1') {
        items.push({ id: String(next++), title: f.title, parent: f.parent, created: true });
        return page(`${ORIGIN}/content`, listing('', 1));   // redireciona para a lista
      }
      if (rejectQuiz) return page(`${ORIGIN}/content/create?parent=${f.parent}`, createPage(f.parent, rejectQuiz));
      const id = String(next++);
      items.push({ id, title: f.title, parent: f.parent, folder: false, created: true });
      return page(`${ORIGIN}/content/${id}`, '<html><head><meta name="csrf-token" content="CSRF123"></head><body>quiz</body></html>');
    }
    if (u.pathname === '/content/create') return page(url, createPage(u.searchParams.get('parent')));
    const parent = u.pathname.match(/^\/content\/(\d+)$/)?.[1] || '';
    return page(url, listing(parent, Number(u.searchParams.get('page') || 1)));
  }
  return { fetchFn, calls, items };
}
const parseForm = async (html, formId) => {
  assert.strictEqual(formId, 'laravel-h5p-form');
  const parent = html.match(/name="parent" value="(\d*)"/)?.[1];
  return parent == null ? null : FORM_ENTRIES(parent);
};

const BIG = '1293060630437481148';   // 19 dígitos: não pode virar número
const FOLDER = '1293060648414498908';

// ── Pasta da equipe: a tela como a do H5P.com de verdade (gravação da pasta
// "UDA - UNIDADE DIGITAL DE APRENDIZAGEM" em 15/11/2026, perfil "author"):
// o "New Folder" abre o modal da pasta comum (create-folder-form, POST
// /content, type=1 — as pastas de lá são "Private folder"), aparece duas
// vezes (o menu escondido repete a barra) e os dois formulários — pasta comum
// e pasta da organização — ficam no fim da página.
const TEAM_ID = '1293047322003249328';
function fakeTeam({ pageTitle = 'UDA - UNIDADE DIGITAL DE APRENDIZAGEM', buttons = ['create-folder-action-modal'], items = null,
  formParent = TEAM_ID, orgAction = `${ORIGIN}/organization-folders`, hideCreated = false } = {}) {
  const calls = [];
  let next = 1293070000000000000n;
  const rows = items ?? [{ id: '1293050000000000001', title: 'Engenharia de Software', parent: TEAM_ID }, { id: '1293050000000000002', title: 'Direito Digital', parent: TEAM_ID }];
  const page = (url, html, status = 200) => ({ url, ok: status >= 200 && status < 300, status, text: async () => html });
  const bar = () => `<ul class="content-links"><li><a class="btn single-action confirm-content-create-action-button create-content" data-target="#confirm-content-create-action-modal" href="#" title="Add Content"><span class="btn-text">Add Content</span></a></li>
    ${buttons.map(t => `<li><a class="btn single-action create-folder-action-button" data-target="#${t}" href="#"><span class="btn-text">${/organization/.test(t) ? 'New Organization Folder' : 'New Folder'}</span></a></li>`).join('')}</ul>`;
  const html = () => `<html><head><title>${pageTitle} - H5P.com</title><meta name="csrf-token" content="CSRF123"></head><body>
    <nav class="navbar">${bar()}</nav><nav class="navbar navbar-hidden" aria-hidden="true">${bar()}</nav>
    <table>${rows.filter(i => !(hideCreated && i.created)).map(ROW).join('')}</table>
    <form method="POST" action="${ORIGIN}/content" id="create-folder-form"><input type="hidden" name="_token" value="CSRF123">
      <div data-action="create-folder" id="create-folder-action-modal"><input type="text" name="title" value="">
      <input type="hidden" name="parent" value="${formParent}"><input type="hidden" name="type" value="1"></div></form>
    <form method="POST" action="${orgAction}" id="create-organization-folder-form"><input type="hidden" name="_token" value="CSRF123">
      <div data-action="create-organization-folder" id="create-organization-folder-action-modal"><input type="text" name="title" value="">
      <input type="hidden" name="parent" value="${formParent}"></div></form></body></html>`;
  async function fetchFn(url, opts = {}) {
    const method = opts.method || 'GET';
    const fields = opts.body instanceof FormData ? [...opts.body.entries()] : null;
    calls.push({ method, url, fields });
    if (method === 'POST') {
      const f = Object.fromEntries(fields);
      rows.push({ id: String(next++), title: f.title, parent: f.parent, created: true });
      return page(`${ORIGIN}/content/${TEAM_ID}`, html());
    }
    return page(url, html());
  }
  return { fetchFn, calls };
}
// Campos de um formulário como o navegador enviaria (versão simples do formEntries do offscreen).
const parseFormSimple = async (html, id) => {
  const form = html.match(new RegExp(`<form\\b[^>]*id="${id}"[^>]*>([\\s\\S]*?)</form>`))?.[1];
  return form == null ? null : [...form.matchAll(/<input\b[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)].map(m => [m[1], m[2]]);
};

// ── .h5p como o Extrator de Questões (Machine-Learning, src/h5p.ts) gera ──
const zlib = require('zlib');
// ZIP mínimo: deflate (8), como o fflate do Extrator, ou sem compressão (0), como o .zip de vários .h5p.
function zip(files, method = 8) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const packed = method === 8 ? zlib.deflateRawSync(data) : data;
    const nm = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nm.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(offset, 42);
    parts.push(local, nm, packed);
    central.push(c, nm);
    offset += 30 + nm.length + packed.length;
  }
  const cd = Buffer.concat(central), n = Object.keys(files).length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
const MC_PARAMS = (q, correct = 1) => ({
  media: { disableImageZooming: false },
  question: `<p>Enunciado de ${q}: qual alternativa está correta?</p>\n`,
  answers: ['A', 'B', 'C', 'D'].map((l, i) => ({ correct: i === correct, tipsAndFeedback: { tip: '', chosenFeedback: `<div>Justificativa ${l}</div>\n`, notChosenFeedback: '' }, text: `<div>Alternativa ${l} de ${q}</div>\n` })),
  overallFeedback: [{ from: 0, to: 100 }],
  behaviour: { enableRetry: true, enableSolutionsButton: false, enableCheckButton: true, type: 'auto', singlePoint: false, randomAnswers: true,
    showSolutionsRequiresInput: false, confirmCheckDialog: false, confirmRetryDialog: false, autoCheck: false, passPercentage: 100, showScorePoints: false },
  UI: { checkAnswerButton: 'Verificar', tryAgainButton: 'Tentar novamente' },
});
const H5P_JSON = (title, main = 'H5P.MultiChoice', deps = [['H5P.MultiChoice', 1, 16]]) => JSON.stringify({
  title, language: 'pt', defaultLanguage: 'pt-br', mainLibrary: main, embedTypes: ['iframe'], license: 'U',
  preloadedDependencies: deps.map(([machineName, majorVersion, minorVersion]) => ({ machineName, majorVersion, minorVersion })),
});
const MC_FILE = (title, params = MC_PARAMS(title), extra = {}, deps) => zip({ 'h5p.json': H5P_JSON(title, 'H5P.MultiChoice', deps), 'content/content.json': JSON.stringify(params), ...extra });
const QS_FILE = (titles, library = 'H5P.MultiChoice 1.16') => zip({
  'h5p.json': H5P_JSON('Questões_FIXAÇÃO_rev_prof', 'H5P.QuestionSet', [['H5P.QuestionSet', 1, 20], ['H5P.MultiChoice', 1, 16]]),
  'content/content.json': JSON.stringify({ introPage: { showIntroPage: false }, progressType: 'dots', passPercentage: 50,
    questions: titles.map(t => ({ params: MC_PARAMS(t), library, metadata: { contentType: 'Multiple Choice', license: 'U', title: t }, subContentId: 'x' })) }),
});
const toAB = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

(async () => {
  await ok('lê a lista: pastas e quizzes, id de 19 dígitos intacto, nome decodificado, pasta-mãe', () => {
    const html = ROW({ id: BIG, title: 'Ciência & Tecnologia "UDA"' }) + ROW({ id: '1', title: 'Quiz', folder: false })
      + ROW({ id: '2', title: 'Sub', parent: BIG });
    const items = F.itemsOf(html);
    assert.strictEqual(items.length, 3);
    same(items.map(i => [i.id, i.folder, i.parent]), [[BIG, true, ''], ['1', false, ''], ['2', true, BIG]]);
    assert.strictEqual(items[0].title, 'Ciência & Tecnologia "UDA"');
    assert.strictEqual(items[0].url, `${ORIGIN}/content/${BIG}`);
    same(F.foldersOf(html).map(f => f.id), [BIG, '2']);
  });

  await ok('pasta — sem sessão no H5P.com: erro "login" e nada é enviado', async () => {
    const h = fakeH5p({ logged: false });
    await assert.rejects(F.create(h.fetchFn, { title: 'Ambiente teste - Raylan' }), e => e.code === 'login');
    assert.ok(!h.calls.some(c => c.method === 'POST'));
  });

  await ok('pasta — cria na raiz: POST com _token, title, parent vazio e type=1; devolve a pasta nova', async () => {
    const h = fakeH5p({ items: [{ id: BIG, title: 'teste', parent: '' }] });
    const r = await F.create(h.fetchFn, { title: '  Ambiente   teste - Raylan ' });
    assert.strictEqual(r.status, 'created');
    assert.strictEqual(r.folder.title, 'Ambiente teste - Raylan');
    assert.match(r.folder.id, /^\d{19}$/);
    const post = h.calls.find(c => c.method === 'POST');
    assert.strictEqual(post.url, `${ORIGIN}/content`);
    same(post.fields, [['_token', 'CSRF123'], ['title', 'Ambiente teste - Raylan'], ['parent', ''], ['type', '1']]);
    assert.ok(h.calls.every(c => c.credentials === 'include'), 'todos os pedidos levam a sessão');
  });

  await ok('pasta — já existe (maiúsculas, espaços, travessão e &amp;): avisa e não cria', async () => {
    const h = fakeH5p({ items: [{ id: BIG, title: 'Ambiente Teste – Raylan & Cia', parent: '' }] });
    const r = await F.create(h.fetchFn, { title: 'ambiente teste - raylan  & cia' });
    assert.strictEqual(r.status, 'exists');
    assert.strictEqual(r.folder.id, BIG);
    assert.ok(!h.calls.some(c => c.method === 'POST'));
  });

  await ok('pasta — mesmo nome dentro de outra pasta ou num quiz não conta como existente', async () => {
    const h = fakeH5p({ items: [{ id: '5', title: 'Ambiente teste - Raylan', parent: BIG }, { id: '6', title: 'Ambiente teste - Raylan', parent: '', folder: false }] });
    const r = await F.create(h.fetchFn, { title: 'Ambiente teste - Raylan' });
    assert.strictEqual(r.status, 'created');
    assert.notStrictEqual(r.folder.id, '6');
  });

  await ok('pasta — lista com mais de uma página: acha a pasta da página 2', async () => {
    const items = [...Array(60)].map((_, i) => ({ id: String(1000 + i), title: `Pasta ${i}`, parent: '' }));
    const h = fakeH5p({ items });
    const r = await F.create(h.fetchFn, { title: 'Pasta 57' });
    assert.strictEqual(r.status, 'exists');
    assert.strictEqual(r.folder.id, '1057');
    assert.ok(h.calls.some(c => c.url.endsWith('?page=2')));
  });

  await ok('pasta — sessão expirada (419) vira "expired"; pedido aceito sem aparecer na lista, "unconfirmed"; nome vazio não chama nada', async () => {
    await assert.rejects(F.create(fakeH5p({ postStatus: 419 }).fetchFn, { title: 'X' }), e => e.code === 'expired');
    assert.strictEqual((await F.create(fakeH5p({ hideCreated: true }).fetchFn, { title: 'X' })).status, 'unconfirmed');
    const h = fakeH5p();
    await assert.rejects(F.create(h.fetchFn, { title: '   ' }), e => e.code === 'title');
    assert.strictEqual(h.calls.length, 0);
  });

  await ok('equipe — confere a pasta (título e lista), manda o formulário que o "New Folder" da tela abre, só com o nome, e confirma na lista', async () => {
    const h = fakeTeam();
    const r = await F.createInTeam(h.fetchFn, parseFormSimple, { title: '  Ambiente   teste - Raylan ' });
    assert.strictEqual(r.status, 'created');
    assert.strictEqual(r.folder.title, 'Ambiente teste - Raylan');
    assert.strictEqual(r.folder.parent, TEAM_ID);
    const posts = h.calls.filter(c => c.method === 'POST');
    assert.strictEqual(posts.length, 1);
    assert.strictEqual(posts[0].url, `${ORIGIN}/content`);
    same(posts[0].fields, [['_token', 'CSRF123'], ['title', 'Ambiente teste - Raylan'], ['parent', TEAM_ID], ['type', '1']]);
    assert.ok(h.calls.every(c => c.method === 'POST' || c.url.startsWith(`${ORIGIN}/content/${TEAM_ID}`)), 'só lê a pasta da equipe');
    same([F.TEAM.id, F.TEAM.title], [TEAM_ID, 'UDA - UNIDADE DIGITAL DE APRENDIZAGEM']);
  });

  await ok('equipe — se o "New Folder" da tela abrir o formulário de pasta da organização, é ele que vai (POST /organization-folders)', async () => {
    const h = fakeTeam({ buttons: ['create-organization-folder-action-modal'] });
    assert.strictEqual((await F.createInTeam(h.fetchFn, parseFormSimple, { title: 'Nova UDA' })).status, 'created');
    const post = h.calls.find(c => c.method === 'POST');
    assert.strictEqual(post.url, `${ORIGIN}/organization-folders`);
    same(post.fields, [['_token', 'CSRF123'], ['title', 'Nova UDA'], ['parent', TEAM_ID]]);
  });

  await ok('equipe — pasta com o mesmo nome já existe lá: não cria', async () => {
    const h = fakeTeam();
    const r = await F.createInTeam(h.fetchFn, parseFormSimple, { title: 'direito  digital' });
    same([r.status, r.folder.id], ['exists', '1293050000000000002']);
    assert.ok(!h.calls.some(c => c.method === 'POST'));
  });

  await ok('equipe — nada é enviado se: a página não é a pasta da UDA, a lista vem vazia, falta o botão ou há dois, o formulário aponta para outra pasta ou outro site', async () => {
    const cases = [
      [{ pageTitle: 'PRODUÇÕES' }, /abriu como "PRODUÇÕES"/],
      [{ items: [] }, /Não consegui ler o que há na pasta da equipe/],
      [{ buttons: [] }, /não achei o botão "New Folder"/],
      [{ buttons: ['create-folder-action-modal', 'create-organization-folder-action-modal'] }, /2 botões de pasta nova/],
      [{ formParent: FOLDER }, /não aponta para a pasta da equipe/],
      [{ buttons: ['create-organization-folder-action-modal'], orgAction: 'https://outro.exemplo/organization-folders' }, /endereço inesperado/],
    ];
    for (const [opts, re] of cases) {
      const h = fakeTeam(opts);
      await assert.rejects(F.createInTeam(h.fetchFn, parseFormSimple, { title: 'Nova UDA' }), e => e.code === 'dest' && re.test(e.message) && /Nada foi criado\./.test(e.message));
      assert.ok(!h.calls.some(c => c.method === 'POST'), `sem POST: ${JSON.stringify(opts)}`);
    }
    const h = fakeTeam();
    await assert.rejects(F.createInTeam(h.fetchFn, async () => null, { title: 'Nova UDA' }), e => e.code === 'form');
    assert.ok(!h.calls.some(c => c.method === 'POST'));
  });

  // GRADUAÇÃO EAD (Microfundamento), como na gravação de 20/11/2026: o mesmo
  // "New Folder" da pasta comum, com as pastas "Microfundamento: …" dentro.
  const GRAD_ID = '1293047321834512708';
  const GRAD_ROWS = [{ id: '1293050000000000011', title: 'Microfundamento: Estatística de Dados Gerenciais', parent: GRAD_ID },
    { id: '1293050000000000012', title: 'Microfundamento: Inovação na Concepção de Negócios', parent: GRAD_ID }];

  await ok('equipe Microfundamento — kind "micro": confere e cria dentro de PRODUÇÕES › GRADUAÇÃO EAD; nome igual usa a que existe', async () => {
    same([F.teamOf('micro').id, F.teamOf('micro').title, F.teamOf().id], [GRAD_ID, 'GRADUAÇÃO EAD', TEAM_ID]);
    const h = fakeTeam({ pageTitle: 'GRADUAÇÃO EAD', formParent: GRAD_ID, items: GRAD_ROWS });
    const r = await F.createInTeam(h.fetchFn, parseFormSimple, { title: 'Microfundamento: Gestão de Projetos', kind: 'micro' });
    same([r.status, r.folder.parent], ['created', GRAD_ID]);
    same(h.calls.find(c => c.method === 'POST').fields, [['_token', 'CSRF123'], ['title', 'Microfundamento: Gestão de Projetos'], ['parent', GRAD_ID], ['type', '1']]);
    assert.ok(h.calls.every(c => c.method === 'POST' || c.url.startsWith(`${ORIGIN}/content/${GRAD_ID}`)), 'só lê a GRADUAÇÃO EAD');
    const h2 = fakeTeam({ pageTitle: 'GRADUAÇÃO EAD', formParent: GRAD_ID, items: GRAD_ROWS });
    const r2 = await F.createInTeam(h2.fetchFn, parseFormSimple, { title: 'microfundamento:  inovação na concepção de negócios', kind: 'micro' });
    same([r2.status, r2.folder.id], ['exists', '1293050000000000012']);
    assert.ok(!h2.calls.some(c => c.method === 'POST'));
  });

  await ok('equipe Microfundamento — nada é enviado se a tela for a da UDA, se o formulário apontar para a pasta da UDA ou se o tipo for desconhecido', async () => {
    const wrongPage = fakeTeam({ items: GRAD_ROWS });   // título "UDA - UNIDADE DIGITAL…"
    await assert.rejects(F.createInTeam(wrongPage.fetchFn, parseFormSimple, { title: 'X', kind: 'micro' }), e => e.code === 'dest' && /abriu como "UDA - UNIDADE DIGITAL DE APRENDIZAGEM", e não "GRADUAÇÃO EAD"/.test(e.message));
    const wrongForm = fakeTeam({ pageTitle: 'GRADUAÇÃO EAD', items: GRAD_ROWS });   // parent = pasta da UDA
    await assert.rejects(F.createInTeam(wrongForm.fetchFn, parseFormSimple, { title: 'X', kind: 'micro' }), e => e.code === 'dest' && /não aponta para a pasta da equipe/.test(e.message));
    const h = fakeTeam();
    await assert.rejects(F.createInTeam(h.fetchFn, parseFormSimple, { title: 'X', kind: 'constructor' }), e => e.code === 'dest' && /Tipo de disciplina desconhecido/.test(e.message));
    for (const x of [wrongPage, wrongForm, h]) assert.ok(!x.calls.some(c => c.method === 'POST'));
    assert.strictEqual(h.calls.length, 0, 'tipo desconhecido nem lê');
  });

  await ok('equipe — pedido aceito sem a pasta aparecer na lista: "unconfirmed" (não tenta de novo)', async () => {
    const h = fakeTeam({ hideCreated: true });
    assert.strictEqual((await F.createInTeam(h.fetchFn, parseFormSimple, { title: 'Nova UDA' })).status, 'unconfirmed');
    assert.strictEqual(h.calls.filter(c => c.method === 'POST').length, 1);
  });

  const T1 = 'Tópico 1 – Níveis de Maturidade em Compliance e Integridade: Diagnóstico e Realidade Organizacional';

  await ok('quiz — cria na pasta: abre /content/create?parent=, manda o formulário da tela com título, library e parameters do editor', async () => {
    const h = fakeH5p({ items: [{ id: FOLDER, title: 'Ambiente teste - Raylan', parent: '' }] });
    const r = await F.createQuiz(h.fetchFn, parseForm, { title: T1, parent: FOLDER });
    assert.strictEqual(r.status, 'created');
    assert.match(r.item.id, /^\d{19}$/);
    assert.strictEqual(r.item.url, `${ORIGIN}/content/${r.item.id}`);
    same(h.calls.map(c => `${c.method} ${c.url}`), [`GET ${ORIGIN}/content/${FOLDER}`, `GET ${ORIGIN}/content/create?parent=${FOLDER}`, `POST ${ORIGIN}/content`]);
    const f = h.calls[2].fields;
    const get = k => f.filter(([n]) => n === k).map(([, v]) => v);
    same(get('title'), [T1]);
    same(get('library'), ['H5P.MultiChoice 1.16']);
    same(get('parent'), [FOLDER]);
    same(get('submitter'), ['Save']);
    same(get('type'), ['0']);
    same(get('frame'), [], '"Toolbar Below Content" sai desmarcado');
    same([get('copyright'), get('visible_for'), get('send_score_to_lms'), get('_token')], [['1'], ['10'], ['2'], ['CSRF123']]);
    same(get('timezone_offset'), [String(new Date().getTimezoneOffset())]);
    const p = JSON.parse(get('parameters')[0]);
    same(p.metadata, { title: T1, license: 'U', defaultLanguage: 'pt-br' });
    assert.strictEqual(p.params.question, '<p>Pergunta</p>');
    same(p.params.answers.map(a => [a.text, a.correct]), [['<div>Alternativa A</div>', false], ['<div>Alternativa B</div>', false], ['<div>Alternativa C</div>', false], ['<div>Alternativa D</div>', false]]);
    same(Object.keys(p.params), ['media', 'answers', 'overallFeedback', 'behaviour', 'UI', 'confirmCheck', 'confirmRetry', 'question']);
    same([p.params.behaviour.enableSolutionsButton, p.params.behaviour.showScorePoints, p.params.behaviour.randomAnswers, p.params.UI.checkAnswerButton],
      [false, false, true, 'Verificar']);
  });

  await ok('quiz — já existe na pasta (mesmo título): não cria; pasta com o mesmo nome não conta', async () => {
    const h = fakeH5p({ items: [{ id: '77', title: T1.replace('–', '-'), parent: FOLDER, folder: false }] });
    const r = await F.createQuiz(h.fetchFn, parseForm, { title: T1, parent: FOLDER });
    assert.strictEqual(r.status, 'exists');
    assert.strictEqual(r.item.id, '77');
    assert.ok(!h.calls.some(c => c.method === 'POST'));
    const h2 = fakeH5p({ items: [{ id: '78', title: T1, parent: FOLDER, folder: true }] });
    assert.strictEqual((await F.createQuiz(h2.fetchFn, parseForm, { title: T1, parent: FOLDER })).status, 'created');
  });

  await ok('quiz — H5P.com volta ao formulário com erro: "rejected" com a mensagem dele', async () => {
    const h = fakeH5p({ rejectQuiz: 'The title field is required.' });
    await assert.rejects(F.createQuiz(h.fetchFn, parseForm, { title: 'X', parent: FOLDER }),
      e => e.code === 'rejected' && /The title field is required\./.test(e.message));
  });

  await ok('quiz — sem formulário na tela, sem pasta, sem sessão ou 419: erro e nada (ou nada além do POST recusado) é criado', async () => {
    await assert.rejects(F.createQuiz(fakeH5p().fetchFn, async () => null, { title: 'X', parent: FOLDER }), e => e.code === 'form');
    await assert.rejects(F.createQuiz(fakeH5p().fetchFn, parseForm, { title: 'X', parent: '' }), e => e.code === 'parent');
    const h = fakeH5p({ logged: false });
    await assert.rejects(F.createQuiz(h.fetchFn, parseForm, { title: 'X', parent: FOLDER }), e => e.code === 'login');
    assert.ok(!h.calls.some(c => c.method === 'POST'));
    await assert.rejects(F.createQuiz(fakeH5p({ postStatus: 419 }).fetchFn, parseForm, { title: 'X', parent: FOLDER }), e => e.code === 'expired');
  });

  await ok('quiz — com a questão do .h5p: parameters leva o conteúdo do arquivo com o título da página; o resto do formulário igual', async () => {
    const h = fakeH5p({ items: [{ id: FOLDER, title: 'Ambiente teste - Raylan', parent: '' }] });
    const params = MC_PARAMS('TÓPICO 1');
    assert.strictEqual((await F.createQuiz(h.fetchFn, parseForm, { title: T1, parent: FOLDER, params })).status, 'created');
    const f = h.calls[2].fields;
    const get = k => f.filter(([n]) => n === k).map(([, v]) => v);
    same(JSON.parse(get('parameters')[0]), { params, metadata: { title: T1, license: 'U', defaultLanguage: 'pt-br' } });
    same([get('title'), get('library'), get('frame'), get('submitter')], [[T1], ['H5P.MultiChoice 1.16'], [], ['Save']]);
  });

  await ok('quiz — questão inválida (sem alternativas, lista, texto) é recusada antes de abrir o H5P.com', async () => {
    for (const params of [{ question: '<p>x</p>' }, [1, 2], 'x']) {
      const h = fakeH5p();
      await assert.rejects(F.createQuiz(h.fetchFn, parseForm, { title: T1, parent: FOLDER, params }), e => e.code === 'params');
      assert.strictEqual(h.calls.length, 0);
    }
  });

  // ── h5p-package.js ──
  const pctx = { TextDecoder, Blob, Response, DecompressionStream, console };
  pctx.globalThis = pctx;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'h5p-package.js'), 'utf8'), pctx);
  const P = pctx.__svcH5pPackage;
  const PAGES = ['Tópico 1 – Níveis de Maturidade', 'Tópico 2 – Fundamentos', 'Tópico 3 – Riscos', 'Tópico 4 – LGPD', 'Tópico 10 – Encerramento'].map(title => ({ title }));
  const load = async files => {
    const r = await P.load(files.map(([name, buf]) => ({ name, buffer: toAB(buf) })), PAGES);
    return { map: Object.fromEntries([...r.byTopic].map(([t, q]) => [t, q.source])), byTopic: r.byTopic, problems: [...r.problems] };
  };

  await ok('pacote — número do tópico: "TÓPICO 1", "Tópico 01 – …", "topico_3", "Tópico 10"; sem número, nada', () => {
    same(['TÓPICO 1', 'Tópico 01 – Níveis', 'topico_3.h5p', 'Tópico 10 – Fim', 'Tópico–2', 'Tópicos de Aprendizagem', 'Questão 1'].map(P.topicNumber),
      ['1', '1', '3', '10', '2', null, null]);
  });

  await ok('pacote — um .h5p de Múltipla escolha por tópico (como o Extrator baixa): cada um vai para a página de mesmo número, com o conteúdo intacto', async () => {
    const r = await load([['TÓPICO 1.h5p', MC_FILE('TÓPICO 1')], ['TÓPICO 10 (1).h5p', MC_FILE('TÓPICO 10')]]);
    same(r.map, { [PAGES[0].title]: 'TÓPICO 1.h5p', [PAGES[4].title]: 'TÓPICO 10 (1).h5p' });
    same(r.byTopic.get(PAGES[0].title).params, MC_PARAMS('TÓPICO 1'));
    same(r.problems, []);
  });

  await ok('pacote — o .zip com os .h5p (sem compressão) e o Question Set: cada questão separada no seu tópico', async () => {
    const z = zip({ 'Questões/TÓPICO 1.h5p': MC_FILE('TÓPICO 1'), 'Questões/TÓPICO 2.h5p': MC_FILE('TÓPICO 2') }, 0);
    const r = await load([['Questões - questões H5P.zip', z], ['Questões_FIXAÇÃO_rev_prof.h5p', QS_FILE(['TÓPICO 3', 'TÓPICO 4'])]]);
    same(r.map, { [PAGES[0].title]: 'TÓPICO 1.h5p', [PAGES[1].title]: 'TÓPICO 2.h5p',
      [PAGES[2].title]: 'Questões_FIXAÇÃO_rev_prof.h5p › TÓPICO 3', [PAGES[3].title]: 'Questões_FIXAÇÃO_rev_prof.h5p › TÓPICO 4' });
    same(r.byTopic.get(PAGES[3].title).params, MC_PARAMS('TÓPICO 4'));
    same(r.problems, []);
  });

  await ok('pacote — título sem número: usa o nome do arquivo; sem número em nenhum, fica de fora', async () => {
    const r = await load([['Tópico_02.h5p', MC_FILE('Questão 1')], ['questao.h5p', MC_FILE('Questão 7')]]);
    same(r.map, { [PAGES[1].title]: 'Tópico_02.h5p' });
    same(r.problems, ['questao.h5p: sem "Tópico N" no título nem no nome do arquivo.']);
  });

  await ok('pacote — fica de fora, com o motivo: imagem, outra versão, outro tipo, sem correta, sem página, dois para o mesmo tópico, arquivo que não é .h5p', async () => {
    const semCorreta = MC_PARAMS('TÓPICO 3', -1);
    const r = await load([
      ['TÓPICO 1.h5p', MC_FILE('TÓPICO 1', undefined, { 'content/images/fig.png': Buffer.from([137, 80, 78, 71]) })],
      ['TÓPICO 2.h5p', MC_FILE('TÓPICO 2', undefined, {}, [['H5P.MultiChoice', 1, 14]])],
      ['TÓPICO 3.h5p', MC_FILE('TÓPICO 3', semCorreta)],
      ['TÓPICO 4.h5p', zip({ 'h5p.json': H5P_JSON('TÓPICO 4', 'H5P.TrueFalse', [['H5P.TrueFalse', 1, 8]]), 'content/content.json': '{}' })],
      ['TÓPICO 5.h5p', MC_FILE('TÓPICO 5')],
      ['a.h5p', MC_FILE('TÓPICO 10')], ['b.h5p', MC_FILE('TÓPICO 10')],
      ['set.h5p', QS_FILE(['TÓPICO 4'], 'H5P.TrueFalse 1.8')],
      ['FIC.docx', Buffer.from('não é zip')],
    ]);
    same(r.map, {});
    same(r.problems, [
      'TÓPICO 1.h5p: tem imagem, áudio ou vídeo — suba este pelo H5P.com.',
      'TÓPICO 2.h5p: é H5P.MultiChoice 1.14; o H5P.com da PUC usa H5P.MultiChoice 1.16.',
      'TÓPICO 3.h5p: nenhuma alternativa marcada como correta.',
      'TÓPICO 4.h5p: é H5P.TrueFalse — só entram Múltipla escolha e Question Set de múltipla escolha.',
      'set.h5p › TÓPICO 4: é H5P.TrueFalse 1.8 — só entra Múltipla escolha (H5P.MultiChoice 1.16).',
      'FIC.docx: não é um .h5p nem um .zip válido.',
      'TÓPICO 5.h5p: não há página "Tópico 5" marcada nos módulos.',
      'Tópico 10: 2 questões (a.h5p; b.h5p) — deixe só uma.',
    ]);
  });

  await ok('pacote — duas páginas "Tópico 1" nos módulos: a questão não vai para nenhuma', async () => {
    const r = await P.load([{ name: 'TÓPICO 1.h5p', buffer: toAB(MC_FILE('TÓPICO 1')) }], [{ title: 'Tópico 1 – A' }, { title: 'Tópico 1 – B' }]);
    same([r.byTopic.size, [...r.problems]], [0, ['TÓPICO 1.h5p: há 2 páginas "Tópico 1" marcadas nos módulos.']]);
  });

  // ── 2. Chrome sem tela ────────────────────────────────────────────────
  let chromium;
  try { ({ chromium } = require('playwright-core')); } catch { console.log('\n(playwright-core ausente: parte 2 pulada)'); }
  if (chromium) {
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    try {
      await offscreenTests(browser);
      await insertRuleTests(browser);
      await canvasTests(browser);
      await microCanvasTests(browser);
      await marksTests(browser);
    } finally { await browser.close(); }
  }
  console.log(`\n${n} verificações OK`);
})().catch(e => { console.error('✗', e); process.exit(1); });

async function offscreenTests(browser) {
  const page = await browser.newPage();
  const requests = [];
  page.on('request', r => requests.push(r.url()));
  await page.setContent('<!doctype html><html><body><textarea id="sink"></textarea></body></html>');
  await page.evaluate(() => { window.chrome = { runtime: { onMessage: { addListener: () => {} } } }; });
  await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'offscreen.js'), 'utf8') });
  const FORM = `<html><body><form id="outro"><input name="x" value="1"></form>
    <form method="POST" action="${ORIGIN}/content" enctype="multipart/form-data" id="laravel-h5p-form">
      <input type="hidden" name="_token" value="CSRF123">
      <input type="hidden" name="title" id="hidden-title">
      <input type="hidden" name="library" value="0">
      <input type="checkbox" name="frame" value="1">
      <input type="checkbox" name="embed" value="1" checked disabled>
      <input type="checkbox" name="copyright" value="1" checked>
      <select name="send_score_to_lms"><option value="1">a</option><option value="2" selected>b</option></select>
      <select name="sem_selecao"><option value="p">p</option><option value="q">q</option></select>
      <input type="radio" name="visible_for" value="0"><input type="radio" name="visible_for" value="10" checked><input type="radio" name="visible_for" value="20">
      <textarea name="Embed code">&lt;iframe src="x"&gt;&lt;/iframe&gt;</textarea>
      <input type="file" name="arquivo">
      <input type="submit" name="submitter" value="Save">
      <script>window.__rodou = true;</script>
      <img src="https://exemplo.invalid/img.png">
      <input type="hidden" name="type" value="0">
    </form></body></html>`;

  await ok('offscreen — formEntries monta os campos como o navegador (marcados, selecionados, sem desabilitados, arquivos e botões)', async () => {
    const entries = await page.evaluate(html => formEntries(html, 'laravel-h5p-form'), FORM);
    same(entries, [['_token', 'CSRF123'], ['title', ''], ['library', '0'], ['copyright', '1'], ['send_score_to_lms', '2'],
      ['sem_selecao', 'p'], ['visible_for', '10'], ['Embed code', '<iframe src="x"></iframe>'], ['type', '0']]);
    assert.strictEqual(await page.evaluate(() => window.__rodou), undefined, 'script do formulário não roda');
    assert.ok(!requests.some(u => u.includes('exemplo.invalid')), 'imagem do formulário não é carregada');
    assert.strictEqual(await page.evaluate(() => document.forms.length), 0, 'o formulário sai do documento depois');
  });

  await ok('offscreen — formulário inexistente devolve null', async () => {
    assert.strictEqual(await page.evaluate(html => formEntries(html, 'nao-existe'), FORM), null);
    assert.strictEqual(await page.evaluate(() => formEntries('<div id="laravel-h5p-form"></div>', 'laravel-h5p-form')), null);
  });
  await page.close();
}

// ── Página de tópico da UDA (template real, resumido — PLANO-H5P.md §2.1) ──
const CANVAS = 'https://pucminas.instructure.com';
const COURSE = 238653;
const BAND = '<div id="questao-fixacao-banner" style="background: linear-gradient(90deg, #0b3d91, #1e88e5); padding: 20px 1%; text-align: center;">'
  + '<span style="color: #ffffff;">&nbsp;Atividade de Fixa&ccedil;&atilde;o N&atilde;o Pontuada - Ao concluir este t&oacute;pico, responda &agrave; quest&atilde;o:&nbsp;</span></div>';
const BOX_OPEN = '<div id="questao-fixacao-atividade" style="margin-top: 1px; margin-bottom: 10px; background-color: #ffffff; padding: 1.5% 2.5%;">';
const BEFORE = '<div id="faixa" class="content-box"><h2>T&oacute;pico 1</h2></div>\n<!-- <div> comentário com div -->\n'
  + '<div id="conteudo" class="content-box"><div class="grid-row"><p>Texto com <strong>negrito</strong> e &nbsp;espa&ccedil;os.</p>'
  + '<div><iframe class="lti-embed" src="https://pucminas.instructure.com/courses/1/external_tools/retrieve?display=borderless&amp;url=https%3A%2F%2Fpucminas.instructuremedia.com%2Flti%2Flaunch" width="700" height="422"></iframe></div>'
  + '<p><iframe src="https://pucminasvirtual.h5p.com/content/111/embed" width="1088" height="637"></iframe></p></div></div>\n'
  + '<div id="faixa" class="content-box"><p>Refer&ecirc;ncias</p></div>\n' + BAND + '\n' + BOX_OPEN;
const AFTER = '</div>\n<p style="text-align: right;">&gt;&gt; Quando se sentir pronto(a), avance&hellip;</p>';
const TOPIC = inner => BEFORE + inner + AFTER;
const MARKER_BOX = '\n    <p style="text-align: center;">[iframe - Atividade de Fixa&ccedil;&atilde;o H5P]</p>\n';
const H5P_IFRAME = id => `<iframe class="lti-embed" style="width: 100%; height: 600px;" title="" src="${CANVAS}/courses/${COURSE}/external_tools/retrieve?display=borderless&amp;url=https%3A%2F%2Fpucminasvirtual.h5p.com%2Fcontent%2F${id}" width="100%" height="600"></iframe>`;
const QUIZ_ID = '1293060652244304478';

async function insertRuleTests(browser) {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  for (const f of ['h5p-width.js', 'h5p-insert.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, f), 'utf8') });
  const embed = await page.evaluate(([c, id]) => window.__svcH5pInsert.embedHtml({ origin: 'https://pucminas.instructure.com', courseId: c, contentId: id, title: 'Tópico 1 – Níveis & "Maturidade"' }), [COURSE, QUIZ_ID]);
  const plan = (html, id = QUIZ_ID) => page.evaluate(([h, i, e]) => window.__svcH5pInsert.plan(h, { contentId: i, embed: e }), [html, id, embed]);

  await ok('inserção — iframe igual ao que o Canvas grava: lti-embed, 100% × 600, url do conteúdo, título do quiz', async () => {
    assert.strictEqual(embed, '<iframe class="lti-embed" style="width: 100%; height: 600px;" title="Tópico 1 – Níveis &amp; &quot;Maturidade&quot;" '
      + `src="${CANVAS}/courses/${COURSE}/external_tools/retrieve?display=borderless&amp;url=https%3A%2F%2Fpucminasvirtual.h5p.com%2Fcontent%2F${QUIZ_ID}" `
      + 'width="100%" height="600" loading="lazy" allowfullscreen="allowfullscreen" webkitallowfullscreen="webkitallowfullscreen" mozallowfullscreen="mozallowfullscreen" '
      + 'allow="geolocation *; microphone *; camera *; midi *; encrypted-media *; autoplay *; clipboard-write *; display-capture *"></iframe>');
    same(await page.evaluate(srcs => srcs.map(s => window.__svcH5pInsert.contentIdOf(s)), [
      `${CANVAS}/courses/1/external_tools/retrieve?display=borderless&url=https%3A%2F%2Fpucminasvirtual.h5p.com%2Fcontent%2F${QUIZ_ID}`,
      'https://pucminasvirtual.h5p.com/content/42/embed', 'https://pucminasvirtual.h5p.com/lti/4282629/content/43', 'https://www.youtube.com/embed/x']),
    [QUIZ_ID, '42', '43', null]);
  });

  await ok('inserção — caixa com o marcador da AVA: o quiz entra no parágrafo dele; o resto da página fica byte a byte igual', async () => {
    const r = await plan(TOPIC(MARKER_BOX));
    assert.strictEqual(r.status, 'insert');
    assert.strictEqual(r.body, TOPIC(`\n    <p style="text-align: center;">${embed}</p>\n`));
    assert.strictEqual((await plan(r.body)).status, 'same', 'de novo: nada a fazer');
  });

  await ok('inserção — caixa com outro quiz: troca (o antigo sai); com o mesmo quiz: nada muda', async () => {
    const old = '1292991947646133608';
    const r = await plan(TOPIC(`\n    <p style="text-align: center;">${H5P_IFRAME(old)}</p>\n`));
    assert.strictEqual(r.status, 'replace');
    same(r.oldIds, [old]);
    assert.strictEqual(r.body, TOPIC(`\n    <p style="text-align: center;">${embed}</p>\n`));
    const s = await plan(TOPIC(`<p style="text-align: center;">${H5P_IFRAME(QUIZ_ID)}</p>`));
    assert.strictEqual(s.status, 'same');
    assert.strictEqual(s.body, undefined);
  });

  await ok('inserção — caixa vazia ou só com parágrafos vazios: parágrafo centralizado com o quiz', async () => {
    assert.strictEqual((await plan(TOPIC(''))).body, TOPIC(`<p style="text-align: center;">${embed}</p>`));
    assert.strictEqual((await plan(TOPIC('<p>&nbsp;</p><p></p>'))).body, TOPIC(`<p>${embed}</p><p></p>`));
  });

  await ok('inserção — caixa com outro conteúdo (texto, imagem, link, vídeo): página fica de fora', async () => {
    for (const inner of ['<p>Responda no fórum.</p>', '<p><img src="x.png" alt=""></p>', '<p><a href="/x">link</a></p>',
      '<p><iframe src="https://www.youtube.com/embed/x"></iframe></p>']) {
      const r = await plan(TOPIC(inner));
      assert.strictEqual(r.status, 'error', inner);
      assert.match(r.error, /outro conteúdo além do H5P/);
      assert.strictEqual(r.body, undefined);
    }
  });

  await ok('inserção — sem a faixa ou com duas faixas: página fica de fora', async () => {
    const none = await plan('<p>Página sem faixa</p>');
    assert.strictEqual(none.status, 'error');
    assert.match(none.error, /Não achei a faixa/);
    const two = await plan(TOPIC(MARKER_BOX) + BAND + BOX_OPEN + '</div>');
    assert.strictEqual(two.status, 'error');
    assert.match(two.error, /2 faixas/);
  });

  // ── Microfundamento (modelo antigo): página real, curso 111810 ──
  // Sem a faixa: a referência é a imagem banner-atividades-fixacao, e o quiz
  // fica no parágrafo logo depois do bloco dela.
  const MF = fs.readFileSync(path.join(__dirname, 'fixtures', 'microfundamento-tema.html'), 'utf8');
  const MF_OLD = '1293064802061305358';
  const MF_SLOT = MF.match(/<p style="text-align: center;"><iframe class="lti-embed" style="width: 100%; height: 600px;" title=""[^>]*1293064802061305358[^>]*><\/iframe><\/p>/)[0];
  const MF_BANNER = MF.match(/<div style="margin-top: 0px; text-align: center;"><img id="5964569"[^>]*><\/div>/)[0];
  const MF_NEW = `<p style="text-align: center;">${embed}</p>`;
  const MF_NOSLOT = MF.replace(MF_SLOT + '\n', '');

  await ok('Microfundamento — página real: troca o H5P logo abaixo do banner; o resto (vídeo do Studio, menu, imagens) fica byte a byte igual', async () => {
    const r = await plan(MF);
    assert.strictEqual(r.status, 'replace');
    assert.strictEqual(r.layout, 'micro');
    same(r.oldIds, [MF_OLD]);
    assert.strictEqual(r.body, MF.replace(MF_SLOT, MF_NEW));
    assert.strictEqual((await plan(r.body)).status, 'same', 'de novo: nada a fazer');
    assert.strictEqual((await plan(MF, MF_OLD)).status, 'same', 'já com este quiz: nada muda');
  });

  await ok('Microfundamento — sem o quiz (logo abaixo vem o "Voltar ao topo"): parágrafo novo logo depois do banner', async () => {
    const r = await plan(MF_NOSLOT);
    assert.strictEqual(r.status, 'insert');
    assert.strictEqual(r.body, MF_NOSLOT.replace(MF_BANNER, MF_BANNER + MF_NEW));
    assert.strictEqual((await plan(r.body)).status, 'same', 'de novo: nada a fazer');
  });

  await ok('Microfundamento — parágrafo vazio ou com o marcador logo abaixo do banner: o quiz entra nele', async () => {
    assert.strictEqual((await plan(MF.replace(MF_SLOT, '<p>&nbsp;</p>'))).body, MF.replace(MF_SLOT, `<p>${embed}</p>`));
    const marker = '<p style="text-align: center;">[iframe - Atividade de Fixa&ccedil;&atilde;o H5P]</p>';
    assert.strictEqual((await plan(MF.replace(MF_SLOT, marker))).body, MF.replace(MF_SLOT, MF_NEW));
  });

  await ok('Microfundamento — casos duvidosos ficam de fora: H5P com texto, H5P mais abaixo, dois banners, banner com texto', async () => {
    const cases = [
      [MF.replace(MF_SLOT, MF_SLOT.replace('</iframe>', '</iframe> Responda')), /outro conteúdo além do H5P/],
      [MF.replace(MF_SLOT, '<p>Responda:</p>' + MF_SLOT), /não logo abaixo/],
      [MF.replace(MF_SLOT, '<p>&nbsp;</p>' + MF_SLOT), /não logo abaixo/],
      [MF.replace(MF_BANNER, MF_BANNER + MF_BANNER), /2 banners/],
      [MF.replace(MF_BANNER, MF_BANNER.replace('<img', 'Atividades <img')), /bloco só dele/],
    ];
    for (const [html, re] of cases) {
      const r = await plan(html);
      assert.strictEqual(r.status, 'error', String(re));
      assert.match(r.error, re);
      assert.strictEqual(r.body, undefined);
    }
  });

  await ok('UDA com a faixa e também uma imagem "banner-atividades-fixacao": vale a faixa (a regra da UDA não muda)', async () => {
    const withImg = html => html.replace(BAND, '<div><img src="/b.png" alt="banner-atividades-fixacao.jpg"></div>\n' + BAND);
    const r = await plan(withImg(TOPIC(MARKER_BOX)));
    assert.strictEqual(r.layout, 'uda');
    assert.strictEqual(r.body, withImg(TOPIC(`\n    <p style="text-align: center;">${embed}</p>\n`)));
  });
  await page.close();
}

async function canvasTests(browser) {
  const TOPICS = ['Tópico 1 – Níveis de Maturidade', 'Tópico 2 – Fundamentos da Integridade', 'Tópico 3 – Riscos Trabalhistas', 'Tópico 4 – LGPD e LAI'];
  const URLS = ['topico-1', 'topico-2', 'topico-3', 'topico-4'];
  const MODULES = [
    { id: 1, name: 'UNIDADE DIGITAL', items: [
      { title: 'Motivação – Por que devo aprender este conteúdo?', type: 'Page', page_url: 'motivacao' },
      { title: 'Tópicos de Aprendizagem', type: 'SubHeader' },
      { title: TOPICS[0], type: 'Page', page_url: URLS[0] },
      { title: TOPICS[1], type: 'Page', page_url: URLS[1] },
      { title: 'Tópico 1 – Quiz antigo', type: 'Quiz' },
      { title: 'Aplicação Prática', type: 'Page', page_url: 'aplicacao' },
    ] },
    { id: 2, name: 'Módulo grande (sem itens na lista)' },
    { id: 3, name: 'Repetido', items: [{ title: TOPICS[0], type: 'Page', page_url: URLS[0] }] },
  ];
  const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <nav class="ic-app-crumbs"><ol><li><a href="/courses/${COURSE}"><span>Ambiente teste - Raylan</span></a></li><li><span>Módulos</span></li></ol></nav>
    <div id="content"><div class="header-bar" id="hb"><div class="header-bar-right header-right-flex">
      <button class="btn" id="expand_collapse_all">Recolher tudo</button>
      <button class="btn btn-primary add_module_link"><i class="icon-plus"></i> Módulo</button>
    </div></div></div></body></html>`;
  // Páginas do Canvas falso: GET e PUT pela API.
  const pages = {};
  const puts = [];
  let failPut = null;
  const resetPages = () => {
    const ago = min => new Date(Date.now() - min * 60000).toISOString();
    pages[URLS[0]] = { body: TOPIC(MARKER_BOX), updated_at: ago(5), last_edited_by: { display_name: 'Ana' } };
    pages[URLS[1]] = { body: TOPIC(`<p style="text-align: center;">${H5P_IFRAME('902')}</p>`), updated_at: ago(600) };
    pages[URLS[2]] = { body: TOPIC('<p>Responda no fórum.</p>'), updated_at: ago(600) };
    pages[URLS[3]] = { body: TOPIC(MARKER_BOX), updated_at: ago(600) };
    puts.length = 0;
    failPut = null;
  };
  resetPages();

  const page = await browser.newPage();
  await page.route(`${CANVAS}/**`, async route => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: 'while(1);' + JSON.stringify(body) });
    if (u.pathname === `/api/v1/courses/${COURSE}`) return json({ id: COURSE, name: 'Ambiente teste - Raylan' });
    if (u.pathname === `/api/v1/courses/${COURSE}/modules`) return json(MODULES);
    if (u.pathname === `/api/v1/courses/${COURSE}/modules/2/items`) return json([{ title: TOPICS[2], type: 'Page', page_url: URLS[2] }, { title: TOPICS[3], type: 'Page', page_url: URLS[3] }]);
    const pm = u.pathname.match(new RegExp(`^/api/v1/courses/${COURSE}/pages/([^/]+)$`));
    if (pm) {
      const url = decodeURIComponent(pm[1]);
      if (req.method() === 'PUT') {
        const body = JSON.parse(req.postData()).wiki_page.body;
        puts.push({ url, body, csrf: req.headers()['x-csrf-token'] });
        if (failPut === url) return json({ errors: [{ message: 'falhou' }] }, 500);
        pages[url] = { ...pages[url], body, updated_at: new Date().toISOString() };
      }
      return json({ url, ...pages[url] });
    }
    return route.fulfill({ contentType: 'text/html', body: PAGE });
  });
  // chrome.runtime.sendMessage falso: responde por ação, com o que o teste definir.
  // chrome.storage falso: começa com a chave do botão desligada (o padrão);
  // __setCfg muda e avisa os ouvintes, como o popup faria.
  await page.addInitScript(() => {
    document.cookie = '_csrf_token=abc%2B123; path=/';
    window.__sent = [];
    window.__h5p = { folder: null, quiz: () => null, list: () => ({ status: 'ok', items: [] }) };
    const cfg = {}, listeners = [];
    window.__setCfg = (key, value) => {
      const oldValue = cfg[key];
      cfg[key] = value;
      listeners.forEach(fn => fn({ [key]: { oldValue, newValue: value } }, 'local'));
    };
    Object.defineProperty(window, 'chrome', { configurable: true, value: {
      runtime: { sendMessage: async m => {
        window.__sent.push(m);
        if (m.action === 'h5p-create-folder') return window.__h5p.folder;
        if (m.action === 'h5p-create-quiz') return window.__h5p.quiz(m);
        if (m.action === 'h5p-list') return window.__h5p.list(m);
      } },
      storage: {
        local: { get: async defaults => Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, k in cfg ? cfg[k] : v])) },
        onChanged: { addListener: fn => listeners.push(fn) },
      },
    } });
  });
  await page.goto(`${CANVAS}/courses/${COURSE}/modules`);
  for (const f of ['h5p-width.js', 'h5p-insert.js', 'h5p-package.js', 'canvas-h5p-folder.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, f), 'utf8') });

  const BTN = '#__svc-h5p-folder__', MODAL = '#__svc-h5p-folder-modal__', TOAST = '#__svc-h5p-folder-toast__';
  const CREATE = `${MODAL} button[data-create]`;
  const sent = () => page.evaluate(() => window.__sent);
  const reset = () => page.evaluate(() => { window.__sent = []; });
  const toastText = async () => (await page.textContent(TOAST)).replace('×', '').trim();
  const waitToast = re => page.waitForFunction(r => new RegExp(r).test(document.getElementById('__svc-h5p-folder-toast__')?.textContent || ''), re.source, { timeout: 15000 });
  const folderUrl = `${ORIGIN}/content/${FOLDER}`;
  // Respostas do background: pasta e quizzes; a lista traz os quizzes criados
  // (ou, com `existing`, os que já estavam na pasta).
  const setup = (folderStatus, quizFn = 'created', listAll = true, existing = null) => page.evaluate(([st, folderId, url, q, all, ex]) => {
    window.__h5p.folder = { status: st, title: 'Ambiente teste - Raylan', folder: { id: folderId, title: 'Ambiente teste - Raylan', url } };
    let next = 900;
    const made = [];
    window.__h5p.quiz = m => {
      const mode = typeof q === 'string' ? q : q[m.title] || 'created';
      if (mode === 'login') return { status: 'error', code: 'login', message: 'Não há sessão aberta no H5P.com neste Chrome.' };
      const item = { id: String(next++), title: m.title, folder: false, url: 'x' };
      if (mode === 'created') made.push(item);
      return { status: mode, item, title: m.title };
    };
    window.__h5p.list = () => ({ status: 'ok', items: ex || (all ? made : []) });
  }, [folderStatus, FOLDER, folderUrl, quizFn, listAll, existing]);
  // Só pasta + quizzes (sem a inserção nas páginas).
  const startQuizzesOnly = async () => { await page.click(BTN); await page.uncheck(`${MODAL} input[data-insert]`); await page.click(CREATE); };

  await ok('canvas — com a chave desligada (padrão) não há botão; ligar mostra, desligar tira, sem recarregar', async () => {
    await page.waitForSelector('.add_module_link');
    await page.waitForTimeout(150);   // tempo do get() e de um quadro do observador
    assert.strictEqual(await page.$(BTN), null);
    await page.evaluate(() => window.__setCfg('h5pFolderEnabled', true));
    await page.waitForSelector(BTN);
    await page.evaluate(() => window.__setCfg('h5pFolderEnabled', false));
    await page.waitForSelector(BTN, { state: 'detached' });
    // O Canvas refazendo o cabeçalho não traz o botão de volta.
    await page.evaluate(() => { const a = document.querySelector('.add_module_link'); a.replaceWith(a.cloneNode(true)); });
    await page.waitForTimeout(150);
    assert.strictEqual(await page.$(BTN), null);
    await page.evaluate(() => window.__setCfg('h5pFolderEnabled', true));
  });

  await ok('canvas — botão "📁 Pasta H5P" logo antes do "+ Módulo"', async () => {
    await page.waitForSelector(BTN);
    assert.match(await page.$eval(BTN, b => b.nextElementSibling.className), /add_module_link/);
    assert.strictEqual(await page.textContent(BTN), '📁 Pasta H5P');
  });

  await ok('canvas — confirmação: nome da disciplina, os tópicos (páginas "Tópico N", em ordem, sem repetir, inclusive de módulo grande) e as duas opções marcadas; Cancelar não manda nada', async () => {
    await page.click(BTN);
    await page.waitForSelector(MODAL);
    assert.strictEqual(await page.inputValue(`${MODAL} input[type=text]`), 'Ambiente teste - Raylan');
    same(await page.$$eval(`${MODAL} li`, lis => lis.map(l => l.textContent)), TOPICS);
    assert.ok(await page.isChecked(`${MODAL} input[data-quizzes]`));
    assert.ok(await page.isChecked(`${MODAL} input[data-insert]`));
    assert.match(await page.textContent(MODAL), /1 quiz por tópico \(4\)/);
    await page.click(`${MODAL} button:text-is("Cancelar")`);
    assert.strictEqual(await page.$(MODAL), null);
    assert.strictEqual((await sent()).length, 0);
  });

  await ok('canvas — Esc cancela; nome vazio desliga "Criar"', async () => {
    await page.click(BTN);
    await page.waitForSelector(MODAL);
    await page.fill(`${MODAL} input[type=text]`, '   ');
    assert.ok(await page.$eval(CREATE, b => b.disabled));
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.$(MODAL), null);
    assert.strictEqual((await sent()).length, 0);
  });

  await ok('canvas — Criar: pasta e depois 1 quiz por tópico, na pasta, um por vez; confere a lista; aviso com "Abrir pasta"', async () => {
    await setup('created');
    await startQuizzesOnly();
    await waitToast(/4 quiz\(zes\) criado\(s\)/);
    same(await sent(), [
      { action: 'h5p-create-folder', title: 'Ambiente teste - Raylan', parent: '' },
      ...TOPICS.map(title => ({ action: 'h5p-create-quiz', title, parent: FOLDER })),
      { action: 'h5p-list', parent: FOLDER },
    ]);
    assert.strictEqual(await toastText(), '✓ Pasta "Ambiente teste - Raylan" criada no H5P.com (My Content).\n4 quiz(zes) criado(s).Abrir pasta');
    assert.strictEqual(await page.getAttribute(`${TOAST} a`, 'href'), folderUrl);
    assert.strictEqual(await page.textContent(BTN), '📁 Pasta H5P');
    assert.strictEqual(puts.length, 0, 'sem a opção de inserir, nenhuma página muda');
  });

  await ok('canvas — desmarcando quizzes e inserção, só a pasta', async () => {
    await reset();
    await setup('created');
    await page.click(BTN);
    await page.uncheck(`${MODAL} input[data-quizzes]`);
    await page.uncheck(`${MODAL} input[data-insert]`);
    await page.click(CREATE);
    await waitToast(/criada no H5P/);
    same((await sent()).map(m => m.action), ['h5p-create-folder']);
  });

  await ok('canvas — pasta e um quiz já existiam: cria só os que faltam e diz quantos já existiam', async () => {
    await reset();
    await setup('exists', { [TOPICS[1]]: 'exists' });
    await startQuizzesOnly();
    await waitToast(/3 quiz\(zes\) criado\(s\) · 1 já existia\(m\)/);
    assert.strictEqual(await toastText(), 'Pasta "Ambiente teste - Raylan" já existia no H5P.com (My Content).\n3 quiz(zes) criado(s) · 1 já existia(m).Abrir pasta');
  });

  const FILES = `${MODAL} input[data-h5p-files]`;
  const chooseFiles = async files => {
    await page.setInputFiles(FILES, files.map(([name, buffer]) => ({ name, mimeType: 'application/zip', buffer })));
    await page.waitForFunction(() => /tópico\(s\) com a questão do arquivo|Não consegui ler/.test(document.getElementById('__svc-h5p-folder-modal__')?.textContent || ''));
  };

  await ok('canvas — arquivos .h5p: a lista mostra o arquivo de cada tópico e o que ficou de fora; o quiz sai com a questão do arquivo, os outros provisórios', async () => {
    await reset();
    await setup('created');
    await page.click(BTN);
    await chooseFiles([['TÓPICO 1.h5p', MC_FILE('TÓPICO 1')], ['Questões_FIXAÇÃO.h5p', QS_FILE(['TÓPICO 3'])], ['TÓPICO 9.h5p', MC_FILE('TÓPICO 9')]]);
    same(await page.$$eval(`${MODAL} li [data-file]`, ss => ss.map(s => s.getAttribute('data-file'))), ['TÓPICO 1.h5p', '', 'Questões_FIXAÇÃO.h5p › TÓPICO 3', '']);
    assert.match(await page.textContent(MODAL), /3 arquivo\(s\) · 2 de 4 tópico\(s\) com a questão do arquivo/);
    assert.match(await page.textContent(`${MODAL} [data-h5p-problems]`), /TÓPICO 9\.h5p: não há página "Tópico 9" marcada nos módulos\./);
    await page.uncheck(`${MODAL} input[data-insert]`);
    await page.click(CREATE);
    await waitToast(/quiz\(zes\) criado/);
    const quizzes = (await sent()).filter(m => m.action === 'h5p-create-quiz');
    same(quizzes.map(m => [m.title, !!m.params]), TOPICS.map((t, i) => [t, i === 0 || i === 2]));
    same(quizzes[0].params, MC_PARAMS('TÓPICO 1'));
    same(quizzes[2].params, MC_PARAMS('TÓPICO 3'));
    assert.strictEqual(await toastText(), '✓ Pasta "Ambiente teste - Raylan" criada no H5P.com (My Content).\n4 quiz(zes) criado(s) (2 com a questão do .h5p).Abrir pasta');
  });

  await ok('canvas — desmarcar uma página tira o quiz dela (o .h5p dela vai para "Fora"); "Mostrar as outras páginas" deixa marcar outra página dos módulos, na ordem', async () => {
    await reset();
    await setup('created');
    await page.click(BTN);
    await page.uncheck(`${MODAL} input[data-topic="${URLS[1]}"]`);
    assert.match(await page.textContent(MODAL), /1 quiz por tópico \(3\)/);
    await chooseFiles([['TÓPICO 2.h5p', MC_FILE('TÓPICO 2')], ['TÓPICO 3.h5p', MC_FILE('TÓPICO 3')]]);
    assert.match(await page.textContent(`${MODAL} [data-h5p-problems]`), /TÓPICO 2\.h5p: não há página "Tópico 2" marcada nos módulos\./);
    assert.match(await page.textContent(MODAL), /2 arquivo\(s\) · 1 de 3 tópico\(s\) com a questão do arquivo/);
    const titles = () => page.$$eval(`${MODAL} li`, lis => lis.map(l => l.getAttribute('data-title')));
    same(await titles(), TOPICS);
    await page.check(`${MODAL} input[data-show-all]`);
    same(await titles(), ['Motivação – Por que devo aprender este conteúdo?', TOPICS[0], TOPICS[1], 'Aplicação Prática', TOPICS[2], TOPICS[3]]);
    await page.check(`${MODAL} input[data-topic="aplicacao"]`);
    assert.match(await page.textContent(MODAL), /1 quiz por tópico \(4\)/);
    await page.uncheck(`${MODAL} input[data-insert]`);
    await page.click(CREATE);
    await waitToast(/quiz\(zes\) criado/);
    const quizzes = (await sent()).filter(m => m.action === 'h5p-create-quiz');
    same(quizzes.map(m => [m.title, !!m.params]), [[TOPICS[0], false], ['Aplicação Prática', false], [TOPICS[2], true], [TOPICS[3], false]]);
    same(quizzes[2].params, MC_PARAMS('TÓPICO 3'));
  });

  await ok('canvas — arquivo para um quiz que já existia: não troca e avisa; com "1 quiz por tópico" desmarcado, os arquivos não vão', async () => {
    await reset();
    await setup('exists', { [TOPICS[0]]: 'exists' });
    await page.click(BTN);
    await chooseFiles([['TÓPICO 1.h5p', MC_FILE('TÓPICO 1')], ['TÓPICO 2.h5p', MC_FILE('TÓPICO 2')]]);
    await page.uncheck(`${MODAL} input[data-insert]`);
    await page.click(CREATE);
    await waitToast(/não foi\(ram\) trocado/);
    assert.match(await toastText(), /3 quiz\(zes\) criado\(s\) \(1 com a questão do \.h5p\) · 1 já existia\(m\)\.\n⚠ Já existia\(m\) na pasta e não foi\(ram\) trocado\(s\) pelo \.h5p: Tópico 1 – Níveis de Maturidade — troque a questão no H5P\.com\./);
    await reset();
    await page.click(BTN);
    await chooseFiles([['TÓPICO 2.h5p', MC_FILE('TÓPICO 2')]]);
    await page.uncheck(`${MODAL} input[data-quizzes]`);
    assert.ok(await page.$eval(`${MODAL} input[data-h5p-files]`, i => i.previousElementSibling.disabled), 'botão dos arquivos apagado');
    await page.uncheck(`${MODAL} input[data-insert]`);
    await page.click(CREATE);
    await waitToast(/Nada foi criado/);
    same((await sent()).map(m => m.action), ['h5p-create-folder']);
  });

  await ok('canvas — destino: desligado, avisa que é o My Content (teste); ligado "Salvar na pasta da equipe", avisa que lá nada pode ser apagado e o pedido vai para a pasta da equipe', async () => {
    await reset();
    await setup('created');
    await page.click(BTN);
    assert.strictEqual(await page.getAttribute(`${MODAL} [data-dest]`, 'data-dest'), 'mine');
    assert.match(await page.textContent(MODAL), /Onde: My Content/);
    await page.click(`${MODAL} button:text-is("Cancelar")`);
    await page.evaluate(() => window.__setCfg('h5pFolderTeam', true));
    await page.click(BTN);
    assert.strictEqual(await page.getAttribute(`${MODAL} [data-dest]`, 'data-dest'), 'team');
    assert.match(await page.textContent(MODAL), /⚠ Pasta da equipe \(PRODUÇÕES › UDA - UNIDADE DIGITAL DE APRENDIZAGEM\): o que for criado lá não pode ser apagado\./);
    await page.uncheck(`${MODAL} input[data-quizzes]`);
    await page.uncheck(`${MODAL} input[data-insert]`);
    await page.click(CREATE);
    await waitToast(/criada no H5P/);
    same(await sent(), [{ action: 'h5p-list', team: true, kind: 'uda' }, { action: 'h5p-create-folder', title: 'Ambiente teste - Raylan', parent: '', team: true, kind: 'uda' }]);
    assert.match(await toastText(), /criada no H5P\.com \(PRODUÇÕES › UDA - UNIDADE DIGITAL DE APRENDIZAGEM\)\./);
    await page.evaluate(() => window.__setCfg('h5pFolderTeam', false));
  });

  await ok('canvas — equipe: mesmo nome com outro prefixo ("UDA - …") avisa e segura "Criar" até escolher: usar a existente ou criar outra mesmo assim', async () => {
    await reset();
    await setup('created');
    await page.evaluate(() => {
      window.__setCfg('h5pFolderTeam', true);
      window.__h5p.list = m => ({ status: 'ok', items: m.team ? [
        { id: '701', title: 'UDA - Ambiente teste - Raylan', folder: true, url: 'x' },
        { id: '702', title: 'MF - Outra disciplina', folder: true, url: 'x' },
      ] : [] });
    });
    const NOTE = `${MODAL} [data-name-note]`;
    await page.click(BTN);
    await page.waitForSelector(MODAL);
    assert.match(await page.textContent(NOTE), /Já existe na pasta da equipe uma pasta com esse nome, com outro prefixo:"UDA - Ambiente teste - Raylan"Usar esta/);
    assert.strictEqual(await page.$$eval(`${MODAL} button[data-use-folder]`, b => b.length), 1, 'só a parecida, não a MF de outro nome');
    assert.ok(await page.$eval(CREATE, b => b.disabled), '"Criar" segura');
    await page.click(`${MODAL} button[data-use-folder]`);
    assert.strictEqual(await page.inputValue(`${MODAL} input[type=text]`), 'UDA - Ambiente teste - Raylan');
    assert.match(await page.textContent(NOTE), /Já existe "UDA - Ambiente teste - Raylan" na pasta da equipe: ela será usada, e nada novo é criado\./);
    assert.ok(!(await page.$eval(CREATE, b => b.disabled)));
    await page.fill(`${MODAL} input[type=text]`, 'Disciplina nova');
    assert.strictEqual((await page.textContent(NOTE)).trim(), '', 'nome sem parecida: sem aviso');
    assert.ok(!(await page.$eval(CREATE, b => b.disabled)));
    await page.fill(`${MODAL} input[type=text]`, 'Ambiente teste - Raylan');
    assert.ok(await page.$eval(CREATE, b => b.disabled), 'de volta ao nome parecido: segura de novo');
    await page.check(`${MODAL} input[data-new-anyway]`);
    assert.ok(!(await page.$eval(CREATE, b => b.disabled)));
    await page.uncheck(`${MODAL} input[data-quizzes]`);
    await page.uncheck(`${MODAL} input[data-insert]`);
    await page.click(CREATE);
    await waitToast(/criada no H5P/);
    same((await sent()).map(m => [m.action, m.title || '', !!m.team]), [['h5p-list', '', true], ['h5p-create-folder', 'Ambiente teste - Raylan', true]]);
  });

  await ok('canvas — equipe: sem conseguir ler a pasta da equipe (sem sessão), avisa e nem abre a confirmação; no My Content não há essa leitura', async () => {
    await reset();
    await page.evaluate(() => { window.__h5p.list = () => ({ status: 'error', code: 'login', message: 'Não há sessão aberta no H5P.com neste Chrome.' }); });
    await page.click(BTN);
    await waitToast(/Entre no H5P\.com/);
    assert.match(await toastText(), /Não consegui ler a pasta da equipe — nada foi criado\./);
    assert.strictEqual(await page.$(MODAL), null);
    same((await sent()).map(m => m.action), ['h5p-list']);
    await page.evaluate(() => window.__setCfg('h5pFolderTeam', false));
    await reset();
    await page.click(BTN);
    await page.waitForSelector(MODAL);
    assert.strictEqual((await page.textContent(`${MODAL} [data-name-note]`)).trim(), '');
    await page.click(`${MODAL} button:text-is("Cancelar")`);
    same(await sent(), []);
  });

  await ok('canvas — erro no meio (sessão caiu no 2º quiz): para ali, diz onde parou e não mexe nas páginas', async () => {
    await reset();
    await setup('exists', { [TOPICS[1]]: 'login' });
    await page.click(BTN);
    await page.click(CREATE);
    await waitToast(/parou em/);
    same((await sent()).map(m => m.action), ['h5p-create-folder', 'h5p-create-quiz', 'h5p-create-quiz']);
    assert.match(await toastText(), /Entre no H5P\.com.*\n.*Quizzes: 1 criado\(s\), 0 já existia\(m\) — parou em "Tópico 2 – Fundamentos da Integridade"\./s);
    assert.strictEqual(puts.length, 0);
  });

  await ok('canvas — quizzes novos que não aparecem na lista da pasta: avisa e não insere nas páginas', async () => {
    await reset();
    await setup('exists', 'created', false);
    await page.click(BTN);
    await page.click(CREATE);
    await waitToast(/não apareceram na lista/);
    assert.match(await toastText(), /⚠ 4 quiz\(zes\) novo\(s\) não apareceram na lista da pasta/);
    assert.strictEqual(puts.length, 0);
  });

  // ── Inserção nas páginas ──
  const IDS = ['901', '902', '903'];   // tópicos 1–3 têm quiz na pasta; o 4 não
  const EXISTING = TOPICS.slice(0, 3).map((title, i) => ({ id: IDS[i], title, folder: false, url: 'x' }));
  const embedFor = (i) => page.evaluate(([c, id, t]) => window.__svcH5pInsert.embedHtml({ origin: location.origin, courseId: c, contentId: id, title: t }), [COURSE, IDS[i], TOPICS[i]]);
  const startInsertOnly = async () => {
    await page.click(BTN);
    await page.uncheck(`${MODAL} input[data-quizzes]`);
    await page.click(CREATE);
    await page.waitForSelector(`${MODAL} input[data-course]`, { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => /Inserir os quizzes/.test(document.getElementById('__svc-h5p-folder-modal__')?.textContent || ''), null, { timeout: 15000 });
  };

  await ok('canvas — inserir: prévia por página (recebe, já tem, caixa com outro conteúdo, sem quiz na pasta) e aviso de edição recente; nada gravado', async () => {
    await reset();
    resetPages();
    await setup('exists', 'created', true, EXISTING);
    await startInsertOnly();
    const text = await page.textContent(MODAL);
    assert.match(text, /Prévia — 1 página\(s\) para gravar\. Nada foi gravado ainda\./);
    assert.match(text, /Tópico 1 – Níveis de Maturidadevai receber o quiz Editada há 5 min por Ana/);
    assert.match(text, /Tópico 2 – Fundamentos da Integridadejá tem este quiz/);
    assert.match(text, /Tópico 3 – Riscos Trabalhistas.*outro conteúdo além do H5P/);
    assert.match(text, /Tópico 4 – LGPD e LAInão achei na pasta um quiz com o título desta página/);
    same(await page.$$eval(`${MODAL} input[data-page]`, cs => cs.map(c => c.getAttribute('data-page'))), [URLS[0]]);
    assert.strictEqual(puts.length, 0);
  });

  await ok('canvas — inserir: só grava com o número do curso certo; grava a página marcada, confere e avisa', async () => {
    assert.ok(await page.$eval(CREATE, b => b.disabled));
    await page.fill(`${MODAL} input[data-course]`, '123');
    assert.ok(await page.$eval(CREATE, b => b.disabled), 'número errado');
    await page.fill(`${MODAL} input[data-course]`, String(COURSE));
    assert.ok(!(await page.$eval(CREATE, b => b.disabled)));
    assert.strictEqual(await page.textContent(CREATE), 'Gravar em 1 página(s)');
    await page.click(CREATE);
    await waitToast(/Quiz inserido em/);
    assert.strictEqual(await toastText(), '✓ Quiz inserido em 1 página(s).');
    same(puts.map(p => p.url), [URLS[0]]);
    assert.strictEqual(puts[0].csrf, 'abc+123', 'CSRF do cookie do Canvas');
    assert.strictEqual(puts[0].body, TOPIC(`\n    <p style="text-align: center;">${await embedFor(0)}</p>\n`));
  });

  await ok('canvas — inserir de novo: nada para gravar ("já tem este quiz")', async () => {
    await reset();
    await startInsertOnly();
    assert.match(await page.textContent(MODAL), /Prévia — nenhuma página para gravar\./);
    assert.strictEqual(await page.$(`${MODAL} input[data-course]`), null);
    await page.click(`${MODAL} button:text-is("Fechar")`);
    await waitToast(/Nenhuma página foi alterada/);
    assert.strictEqual(puts.length, 1);
  });

  await ok('canvas — inserir: desmarcar todas desliga "Gravar"; erro do Canvas ao gravar aparece no aviso', async () => {
    resetPages();
    pages[URLS[3]].body = TOPIC(MARKER_BOX);
    await reset();
    await setup('exists', 'created', true, [...EXISTING, { id: '904', title: TOPICS[3], folder: false, url: 'x' }]);
    await startInsertOnly();
    await page.fill(`${MODAL} input[data-course]`, String(COURSE));
    for (const c of await page.$$(`${MODAL} input[data-page]`)) await c.uncheck();
    assert.ok(await page.$eval(CREATE, b => b.disabled));
    await page.check(`${MODAL} input[data-page="${URLS[0]}"]`);
    await page.check(`${MODAL} input[data-page="${URLS[3]}"]`);
    failPut = URLS[3];
    await page.click(CREATE);
    await waitToast(/Não gravado/);
    assert.match(await toastText(), /✓ Quiz inserido em 1 página\(s\)\.\n✗ Não gravado: Tópico 4 – LGPD e LAI: O Canvas respondeu 500/);
    assert.strictEqual(pages[URLS[3]].body, TOPIC(MARKER_BOX), 'página com erro fica como estava');
  });

  await ok('canvas — extensão recarregada (sendMessage falha): pede F5', async () => {
    await page.evaluate(() => { window.chrome.runtime.sendMessage = async () => { throw new Error('Extension context invalidated.'); }; });
    await page.click(BTN);
    await page.click(CREATE);
    await waitToast(/recarregue esta página/);
  });

  await ok('canvas — o Canvas refaz o cabeçalho: o botão volta', async () => {
    await page.evaluate(() => { const hb = document.getElementById('hb'); const copy = hb.cloneNode(true); copy.querySelector('#__svc-h5p-folder__')?.remove(); hb.replaceWith(copy); });
    await page.waitForSelector(BTN);
    assert.strictEqual(await page.$$eval(BTN, b => b.length), 1);
  });

  await page.close();
}

// Microfundamento: módulos como os do curso 111810 (UNIDADE N - Tema N - …,
// mais de 6 páginas, Síntese e Atividade avaliativa de fora) e páginas no
// modelo antigo, com o banner de Atividades de Fixação.
async function microCanvasTests(browser) {
  const C = 111810;
  const U1 = ['Inovação: conceito', 'Tipologias de Inovação: Radical x Incremental', 'Inovação: concorrência e competitividade',
    'Inovação: Diferenciação e Posicionamento', 'Ecossistema de Inovação', 'Difusão da Inovação'];
  const U2 = ['Introdução a Negócios Inovadores', 'Spin-offs, Spin-Ins e Spin-Outs', 'Oportunidades de Mercado', 'Transformação Digital', 'Tecnologias Emergentes'];
  const TEMA = [1, 1, 2, 2, 3, 3, 1, 1, 2, 3, 3];
  const TOPICS = [...U1.map(t => ['UNIDADE 1', t]), ...U2.map(t => ['UNIDADE 2', t])].map(([u, t], i) => `${u} - Tema ${TEMA[i]} - ${t}`);
  const URLS = TOPICS.map((_, i) => `pagina-${i + 1}`);
  const item = i => ({ title: TOPICS[i], type: 'Page', page_url: URLS[i] });
  const MODULES = [
    { id: 1, name: 'UNIDADE 1 - INOVAÇÃO', items: [...[0, 1, 2, 3, 4, 5].map(item), { title: 'UNIDADE 1 - Síntese e referências', type: 'Page', page_url: 'sintese-1' }] },
    { id: 2, name: 'UNIDADE 1 - ATIVIDADE AVALIATIVA', items: [{ title: 'ATIVIDADE OBJETIVA - M54a - Inovação', type: 'Quiz' }] },
    { id: 3, name: 'UNIDADE 2 - NEGÓCIOS INOVADORES', items: [...[6, 7, 8, 9, 10].map(item), { title: 'UNIDADE 2 - Síntese e referências', type: 'Page', page_url: 'sintese-2' }] },
  ];
  const MF = fs.readFileSync(path.join(__dirname, 'fixtures', 'microfundamento-tema.html'), 'utf8');
  const MF_SLOT = MF.match(/<p style="text-align: center;"><iframe class="lti-embed" style="width: 100%; height: 600px;" title=""[^>]*1293064802061305358[^>]*><\/iframe><\/p>/)[0];
  const MF_BANNER = MF.match(/<div style="margin-top: 0px; text-align: center;"><img id="5964569"[^>]*><\/div>/)[0];
  const pages = {};
  URLS.forEach((u, i) => { pages[u] = { body: i === 0 ? MF : MF.replace(MF_SLOT + '\n', ''), updated_at: '2026-01-01T00:00:00Z' }; });
  // A última página ficou no modelo comum (com a faixa): insere, mas a prévia avisa.
  pages[URLS[10]].body = TOPIC(MARKER_BOX);
  const INITIAL = JSON.parse(JSON.stringify(pages));   // os testes de inserção gravam nas páginas
  const puts = [];
  // O que o Canvas falso mostra: nome do curso, módulos da API e títulos na página.
  const course = { name: 'Microfundamento: Inovação na Concepção de Negócios (MODELO)', modules: MODULES, dom: [] };

  const page = await browser.newPage();
  await page.route(`${CANVAS}/**`, async route => {
    const req = route.request();
    const u = new URL(req.url());
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: 'while(1);' + JSON.stringify(body) });
    if (u.pathname === `/api/v1/courses/${C}`) return json({ id: C, name: course.name });
    if (u.pathname === `/api/v1/courses/${C}/modules`) return json(course.modules);
    // Lista das páginas com o corpo: só com course.list (sem ela, a Pasta H5P
    // não consegue ler e marca as páginas de tópico, como antes).
    if (u.pathname === `/api/v1/courses/${C}/pages`) {
      course.listReads = (course.listReads || 0) + 1;
      if (course.list) return json(Object.entries(pages).map(([url, p]) => ({ url, body: p.body })));
    }
    const pm = u.pathname.match(new RegExp(`^/api/v1/courses/${C}/pages/([^/]+)$`));
    if (pm) {
      const url = decodeURIComponent(pm[1]);
      if (req.method() === 'PUT') {
        const body = JSON.parse(req.postData()).wiki_page.body;
        puts.push({ url, body });
        pages[url] = { ...pages[url], body };
      }
      return json({ url, ...pages[url] });
    }
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body>
      <div id="content"><div class="header-bar"><button class="btn btn-primary add_module_link">Módulo</button></div>
      <div id="context_modules">${course.dom.map(t => `<li class="context_module_item"><span class="item_name"><a class="ig-title title item_link">${t}</a></span></li>`).join('')}</div></div></body></html>` });
  });
  const QUIZ = i => String(1293070000000000000n + BigInt(i));
  // window.__team liga "Salvar na pasta da equipe"; a GRADUAÇÃO EAD tem as
  // pastas da gravação de 20/11/2026.
  await page.addInitScript(([titles, ids]) => {
    document.cookie = '_csrf_token=abc; path=/';
    window.__sent = [];
    const items = titles.map((title, i) => ({ id: ids[i], title, folder: false, url: 'x' }));
    const grad = [{ id: '1293050000000000011', title: 'Microfundamento: Estatística de Dados Gerenciais', folder: true, url: 'x' },
      { id: '1293050000000000012', title: 'Microfundamento: Inovação na Concepção de Negócios', folder: true, url: 'x' }];
    Object.defineProperty(window, 'chrome', { configurable: true, value: {
      runtime: { sendMessage: async m => {
        window.__sent.push(m);
        if (m.action === 'h5p-create-folder') return { status: 'exists', title: m.title, folder: { id: '77', title: m.title, url: 'https://pucminasvirtual.h5p.com/content/77' } };
        if (m.action === 'h5p-list') return { status: 'ok', items: m.team ? grad : items };
        if (m.action === 'h5p-create-quiz') return { status: 'created', item: { id: String(9000 + window.__sent.length), title: m.title, parent: m.parent, folder: false, url: 'x' }, title: m.title };
      } },
      storage: { local: { get: async d => ({ ...d, h5pFolderEnabled: true, ...(window.__team ? { h5pFolderTeam: true } : {}) }) }, onChanged: { addListener: () => {} } },
    } });
  }, [TOPICS, TOPICS.map((_, i) => QUIZ(i))]);
  const BTN = '#__svc-h5p-folder__', MODAL = '#__svc-h5p-folder-modal__', CREATE = `${MODAL} button[data-create]`;
  // Abre a página de módulos de novo, com o Canvas falso como estiver em `course`.
  const open = async () => {
    await page.goto(`${CANVAS}/courses/${C}/modules`);
    for (const f of ['h5p-width.js', 'h5p-insert.js', 'h5p-package.js', 'canvas-h5p-folder.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, f), 'utf8') });
    await page.waitForSelector(BTN);
  };
  const button = () => page.$eval(BTN, b => [b.textContent, b.getAttribute('data-kind')]);
  await open();

  await ok('Microfundamento — o botão vira "📁 Pasta H5P MF"; confirmação: as 11 páginas "UNIDADE N - Tema N" em ordem (Síntese e Atividade avaliativa de fora), .h5p do Extrator pela "Questão N", inserção abaixo do banner', async () => {
    same(await button(), ['📁 Pasta H5P MF', 'micro']);
    await page.click(BTN);
    await page.waitForSelector(MODAL);
    const text = await page.textContent(MODAL);
    assert.match(text, /^📁 Criar pasta no H5P\.com\? — Microfundamento/);
    same(await page.$$eval(`${MODAL} li`, lis => lis.map(l => l.textContent)), TOPICS);
    assert.match(text, /1 quiz por tópico \(11\)/);
    assert.match(text, /Inserir cada quiz na sua página \(logo abaixo do banner de Atividades de Fixação\)/);
    assert.ok(await page.$(`${MODAL} input[data-h5p-files]`), 'escolhe .h5p também no Microfundamento');
    assert.match(await page.textContent(`${MODAL} [data-micro-files]`), /a "Questão N" vai para a N-ª página marcada na lista acima/);
    assert.strictEqual(await page.$(`${MODAL} [data-others]`), null);
  });

  await ok('Microfundamento — inserção: troca o quiz que havia, as sem quiz ganham o parágrafo depois do banner, a página no modelo comum vai na faixa com aviso na prévia; o resto fica igual', async () => {
    await page.uncheck(`${MODAL} input[data-quizzes]`);
    await page.click(CREATE);
    await page.waitForSelector(`${MODAL} input[data-course]`, { timeout: 15000 });
    const text = await page.textContent(MODAL);
    assert.match(text, /11 página\(s\) para gravar/);
    assert.match(text, /vai TROCAR o H5P que está no lugar do quiz pelo da pasta/);
    assert.match(text, /Difusão da Inovação.*Tecnologias Emergentes.*Esta página tem a faixa "Atividade de Fixação" \(modelo comum\): o quiz vai na caixa da faixa\./s);
    assert.strictEqual((text.match(/modelo comum/g) || []).length, 1, 'aviso só na página do outro modelo');
    await page.fill(`${MODAL} input[data-course]`, String(C));
    await page.click(CREATE);
    await page.waitForFunction(() => /Quiz inserido em/.test(document.getElementById('__svc-h5p-folder-toast__')?.textContent || ''), null, { timeout: 30000 });
    assert.match(await page.textContent('#__svc-h5p-folder-toast__'), /✓ Quiz inserido em 11 página\(s\)\./);
    assert.strictEqual(puts.length, 11);
    const embed = i => page.evaluate(([c, id, t]) => window.__svcH5pInsert.embedHtml({ origin: location.origin, courseId: c, contentId: id, title: t }), [C, QUIZ(i), TOPICS[i]]);
    assert.strictEqual(pages[URLS[0]].body, MF.replace(MF_SLOT, `<p style="text-align: center;">${await embed(0)}</p>`));
    const noSlot = MF.replace(MF_SLOT + '\n', '');
    assert.strictEqual(pages[URLS[5]].body, noSlot.replace(MF_BANNER, MF_BANNER + `<p style="text-align: center;">${await embed(5)}</p>`));
    assert.strictEqual(pages[URLS[10]].body, TOPIC(`\n    <p style="text-align: center;">${await embed(10)}</p>\n`));
    same(await button(), ['📁 Pasta H5P MF', 'micro']);
  });

  // O zip que o Extrator gera do relatório da FIC: "Questão N.h5p", título "Questão N".
  await ok('Microfundamento — .h5p do Extrator ("Questão N"): vai para a N-ª página da lista, com o começo da pergunta para conferir; "Tópico N", 2 para a mesma página e número além das páginas ficam de fora', async () => {
    await page.evaluate(() => { window.__sent = []; });
    await page.click(BTN);
    await page.waitForSelector(MODAL);
    const extrator = zip({
      'Questão 1.h5p': MC_FILE('Questão 1'), 'Questão 3.h5p': MC_FILE('Questão 3'), 'Questão 11.h5p': MC_FILE('Questão 11'),
      'Questão 12.h5p': MC_FILE('Questão 12'), 'TÓPICO 2.h5p': MC_FILE('TÓPICO 2'),
    }, 0);
    await page.setInputFiles(`${MODAL} input[data-h5p-files]`, [
      { name: 'Microfundamento_Inovação - questões H5P.zip', mimeType: 'application/zip', buffer: extrator },
      { name: 'questao_05.h5p', mimeType: 'application/octet-stream', buffer: MC_FILE('outro título') },
      { name: 'Questão 5 (cópia).h5p', mimeType: 'application/octet-stream', buffer: MC_FILE('Questão 5') },
    ]);
    await page.waitForFunction(() => /tópico\(s\) com a questão do arquivo|Não consegui ler/.test(document.getElementById('__svc-h5p-folder-modal__')?.textContent || ''));
    const pairs = await page.$$eval(`${MODAL} li`, lis => lis.map(l => [l.querySelector('[data-file]')?.getAttribute('data-file'), l.querySelector('[data-preview]')?.textContent || '']));
    same(pairs.map(p => p[0]), ['Questão 1.h5p', '', 'Questão 3.h5p', '', '', '', '', '', '', '', 'Questão 11.h5p']);
    assert.match(pairs[2][1], /^“Enunciado de Questão 3: qual alternativa está correta\?”$/);
    assert.match(await page.textContent(MODAL), /3 de 11 tópico\(s\) com a questão do arquivo/);
    const fora = await page.textContent(`${MODAL} [data-h5p-problems]`);
    assert.match(fora, /Questão 12\.h5p: não há a 12ª página marcada nos módulos \(são 11\)\./);
    assert.match(fora, /TÓPICO 2\.h5p: sem "Questão N" no título nem no nome do arquivo\./);
    assert.match(fora, /Questão 5: 2 questões \(questao_05\.h5p; Questão 5 \(cópia\)\.h5p\) — deixe só uma\./);
    await page.uncheck(`${MODAL} input[data-insert]`);
    await page.click(CREATE);
    // 11 quizzes com 1,5 s entre um e outro (PAUSE_MS)
    await page.waitForFunction(() => /quiz\(zes\) criado/.test(document.getElementById('__svc-h5p-folder-toast__')?.textContent || ''), null, { timeout: 40000 })
      .catch(async () => { throw new Error('aviso: ' + await page.evaluate(() => document.getElementById('__svc-h5p-folder-toast__')?.textContent)); });
    assert.match(await page.textContent('#__svc-h5p-folder-toast__'), /11 quiz\(zes\) criado\(s\) \(3 com a questão do \.h5p\)/);
    const quizzes = await page.evaluate(() => window.__sent.filter(m => m.action === 'h5p-create-quiz'));
    same(quizzes.map(m => [m.title, !!m.params]), TOPICS.map((t, i) => [t, i === 0 || i === 2 || i === 10]));
    same(quizzes[2].params, MC_PARAMS('Questão 3'));
  });

  await ok('Microfundamento — página que não vai ter quiz: desmarcar passa a "Questão N" para a N-ª página marcada; troca à mão página a página (a que sobra vai para "Fora"; a mesma em duas páginas segura o "Criar"); só as marcadas ganham quiz', async () => {
    await open();
    await page.click(BTN);
    await page.waitForSelector(MODAL);
    const extrator = zip(Object.fromEntries([1, 2, 3, 4].map(n => [`Questão ${n}.h5p`, MC_FILE(`Questão ${n}`)])), 0);
    await page.setInputFiles(`${MODAL} input[data-h5p-files]`, [{ name: 'questoes.zip', mimeType: 'application/zip', buffer: extrator }]);
    await page.waitForFunction(() => /tópico\(s\) com a questão do arquivo/.test(document.getElementById('__svc-h5p-folder-modal__')?.textContent || ''));
    const pairs = () => page.$$eval(`${MODAL} li`, lis => lis.slice(0, 7).map(l => [l.getAttribute('data-title'), l.querySelector('[data-file]')?.getAttribute('data-file') ?? null]));
    same(await pairs(), [[TOPICS[0], 'Questão 1.h5p'], [TOPICS[1], 'Questão 2.h5p'], [TOPICS[2], 'Questão 3.h5p'], [TOPICS[3], 'Questão 4.h5p'], [TOPICS[4], ''], [TOPICS[5], ''], [TOPICS[6], '']]);
    // A 2ª página não vai ter quiz: a Questão 2 passa para a 3ª, e assim por diante.
    await page.uncheck(`${MODAL} input[data-topic="${URLS[1]}"]`);
    assert.ok(await page.$(`${MODAL} li[data-off][data-title="${TOPICS[1]}"]`));
    same(await pairs(), [[TOPICS[0], 'Questão 1.h5p'], [TOPICS[1], null], [TOPICS[2], 'Questão 2.h5p'], [TOPICS[3], 'Questão 3.h5p'], [TOPICS[4], 'Questão 4.h5p'], [TOPICS[5], ''], [TOPICS[6], '']]);
    assert.match(await page.textContent(MODAL), /1 quiz por tópico \(10\)/);
    assert.match(await page.textContent(MODAL), /4 de 10 tópico\(s\) com a questão do arquivo/);
    // Outra página dos módulos (a Síntese da unidade 1) entra marcada, na ordem; a unidade 2 sai.
    assert.strictEqual(await page.$(`${MODAL} li[data-title="UNIDADE 1 - Síntese e referências"]`), null);
    await page.check(`${MODAL} input[data-show-all]`);
    await page.check(`${MODAL} input[data-topic="sintese-1"]`);
    for (const u of URLS.slice(6)) await page.uncheck(`${MODAL} input[data-topic="${u}"]`);
    assert.match(await page.textContent(MODAL), /1 quiz por tópico \(6\)/);
    // Troca à mão: a 5ª página com a provisória → a Questão 4 fica sem página; vai para a 6ª.
    const choose = (i, label) => page.selectOption(`${MODAL} li[data-title="${TOPICS[i]}"] select`, label === null ? '-1' : { label: `← ${label}` });
    await choose(4, null);
    assert.match(await page.textContent(`${MODAL} [data-h5p-problems]`), /Questão 4\.h5p: não vai para nenhuma página\./);
    await choose(5, 'Questão 4.h5p');
    assert.strictEqual(await page.$eval(`${MODAL} [data-h5p-problems]`, e => e.style.display), 'none');
    // A mesma questão em duas páginas segura o "Criar" até ficar em uma só.
    await choose(3, 'Questão 1.h5p');
    assert.ok((await page.textContent(`${MODAL} [data-h5p-dups]`)).includes(`⚠ Questão 1.h5p está em 2 páginas (${TOPICS[0]}; ${TOPICS[3]}): deixe em uma só.`));
    assert.ok(await page.$eval(CREATE, b => b.disabled), '"Criar" segura');
    await choose(3, 'Questão 3.h5p');
    assert.ok(!(await page.$eval(CREATE, b => b.disabled)), '"Criar" libera');
    await page.uncheck(`${MODAL} input[data-insert]`);
    await page.click(CREATE);
    await page.waitForFunction(() => /quiz\(zes\) criado/.test(document.getElementById('__svc-h5p-folder-toast__')?.textContent || ''), null, { timeout: 30000 });
    const quizzes = await page.evaluate(() => window.__sent.filter(m => m.action === 'h5p-create-quiz'));
    same(quizzes.map(m => [m.title, !!m.params]), [[TOPICS[0], true], [TOPICS[2], true], [TOPICS[3], true], [TOPICS[4], false], [TOPICS[5], true], ['UNIDADE 1 - Síntese e referências', false]]);
    same([quizzes[0].params, quizzes[1].params, quizzes[2].params, quizzes[4].params], ['Questão 1', 'Questão 2', 'Questão 3', 'Questão 4'].map(q => MC_PARAMS(q)));
  });

  await ok('Microfundamento — vêm marcadas só as páginas que já têm o H5P ou o marcador no lugar do quiz (com o selo na lista); a "Questão N" vai para a N-ª delas', async () => {
    Object.assign(course, { list: true, listReads: 0 });
    for (const u of Object.keys(INITIAL)) pages[u] = { ...INITIAL[u] };
    await open();
    await page.click(BTN);
    await page.waitForSelector(MODAL);
    // Página 1: H5P abaixo do banner; página 11: modelo comum, com o marcador; as outras, sem nada.
    const rows = () => page.$$eval(`${MODAL} li`, lis => lis.map(l => [l.getAttribute('data-title'), !l.hasAttribute('data-off'), l.querySelector('[data-slot]')?.getAttribute('data-slot') || '']));
    same(await rows(), TOPICS.map((t, i) => [t, i === 0 || i === 10, i === 0 ? 'quiz' : i === 10 ? 'marker' : '']));
    assert.strictEqual(await page.getAttribute(`${MODAL} [data-default]`, 'data-default'), 'slot');
    assert.match(await page.textContent(MODAL), /1 quiz por tópico \(2\)/);
    assert.match(await page.getAttribute(`${MODAL} li[data-title="${TOPICS[0]}"] [data-slot]`, 'title'), /Já tem um H5P no lugar do quiz \(nº 1293064802061305358\)/);
    assert.strictEqual(course.listReads, 1);
    const extrator = zip({ 'Questão 1.h5p': MC_FILE('Questão 1'), 'Questão 2.h5p': MC_FILE('Questão 2') }, 0);
    await page.setInputFiles(`${MODAL} input[data-h5p-files]`, [{ name: 'q.zip', mimeType: 'application/zip', buffer: extrator }]);
    await page.waitForFunction(() => /tópico\(s\) com a questão do arquivo/.test(document.getElementById('__svc-h5p-folder-modal__')?.textContent || ''));
    same(await page.$$eval(`${MODAL} li:not([data-off]) [data-file]`, ss => ss.map(s => s.getAttribute('data-file'))), ['Questão 1.h5p', 'Questão 2.h5p']);
    await page.keyboard.press('Escape');
  });

  await ok('Microfundamento — com o selo H5P já lido na página, a Pasta H5P usa a leitura dele (sem ler as páginas de novo); sem nenhuma página com H5P ou marcador, marca as de tópico, como antes', async () => {
    Object.assign(course, { list: true, listReads: 0 });
    await open();
    await page.evaluate(([a, b]) => { window.__svcH5pMarks = { pages: async () => new Map([[a, { quiz: { title: '', id: '9' }, marker: false }], [b, { quiz: null, marker: false }]]) }; }, [URLS[3], URLS[4]]);
    await page.click(BTN);
    await page.waitForSelector(MODAL);
    same(await page.$$eval(`${MODAL} li:not([data-off])`, lis => lis.map(l => l.getAttribute('data-title'))), [TOPICS[3]]);
    assert.strictEqual(course.listReads, 0);
    await page.keyboard.press('Escape');
    // Nenhuma com H5P nem marcador (disciplina nova): todas as "UNIDADE N - Tema N", sem selo.
    await page.evaluate(() => { window.__svcH5pMarks = { pages: async () => new Map() }; });
    await page.click(BTN);
    await page.waitForSelector(MODAL);
    same(await page.$$eval(`${MODAL} li:not([data-off])`, lis => lis.map(l => l.getAttribute('data-title'))), TOPICS);
    assert.strictEqual(await page.getAttribute(`${MODAL} [data-default]`, 'data-default'), 'topics');
    assert.strictEqual(await page.$(`${MODAL} [data-slot]`), null);
    await page.keyboard.press('Escape');
    Object.assign(course, { list: false });
  });

  await ok('tipo — nome sem "Microfundamento", mas a página de módulos só com "UNIDADE N - Tema N": "📁 Pasta H5P MF" pelos títulos da página', async () => {
    Object.assign(course, { name: 'Inovação na Concepção de Negócios', dom: TOPICS.slice(0, 3) });
    await open();
    same(await button(), ['📁 Pasta H5P MF', 'micro']);
  });

  await ok('tipo — página de módulos sem títulos (ainda carregando): vale o nome — "MF - …" é MF, outro nome é comum; no clique, a lista da API decide', async () => {
    Object.assign(course, { name: 'MF - Inovação na Concepção de Negócios', dom: [] });
    await open();
    same(await button(), ['📁 Pasta H5P MF', 'micro']);
    Object.assign(course, { name: 'Inovação na Concepção de Negócios' });
    await open();
    same(await button(), ['📁 Pasta H5P', 'uda']);
    await page.click(BTN);
    await page.waitForSelector(MODAL);
    same(await button(), ['📁 Pasta H5P MF', 'micro']);   // a API só tem "UNIDADE N - Tema N"
    assert.match(await page.textContent(MODAL), /— Microfundamento/);
    await page.keyboard.press('Escape');
  });

  await ok('tipo — curso com os dois tipos de página: o nome decide e as do outro tipo ficam de fora, com aviso', async () => {
    const mixed = [{ id: 9, name: 'Extra', items: [{ title: 'Tópico 1 – Página comum', type: 'Page', page_url: 'topico-1' }] }, ...MODULES];
    Object.assign(course, { name: 'Microfundamento: Inovação na Concepção de Negócios', modules: mixed, dom: [] });
    await open();
    await page.click(BTN);
    await page.waitForSelector(MODAL);
    same(await page.$$eval(`${MODAL} li`, lis => lis.map(l => l.textContent)), TOPICS);
    assert.match(await page.textContent(`${MODAL} [data-others]`), /Há também 1 página\(s\) "Tópico N" nos módulos: ficam desmarcadas \(pelo nome do curso, a disciplina é Microfundamento\)/);
    await page.keyboard.press('Escape');
    Object.assign(course, { name: 'Ambiente teste' });
    await open();
    await page.click(BTN);
    await page.waitForSelector(MODAL);
    same(await page.$$eval(`${MODAL} li`, lis => lis.map(l => l.textContent)), ['Tópico 1 – Página comum']);
    assert.match(await page.textContent(`${MODAL} [data-others]`), /Há também 11 página\(s\) "UNIDADE N - Tema N".*a disciplina é comum/);
    same(await button(), ['📁 Pasta H5P', 'uda']);
    assert.ok(await page.$(`${MODAL} input[data-h5p-files]`), 'comum: escolhe .h5p');
    await page.keyboard.press('Escape');
  });

  await ok('Microfundamento — produção ligada: a pasta vai para PRODUÇÕES › GRADUAÇÃO EAD (kind "micro"); o nome igual ao de lá usa a existente; sem o "Microfundamento:" avisa e segura', async () => {
    Object.assign(course, { name: 'Microfundamento: Inovação na Concepção de Negócios', modules: MODULES, dom: [] });
    await open();
    await page.evaluate(() => { window.__team = true; window.__sent = []; });
    await page.click(BTN);
    await page.waitForSelector(MODAL);
    assert.match(await page.textContent(MODAL), /⚠ Pasta da equipe \(PRODUÇÕES › GRADUAÇÃO EAD\): o que for criado lá não pode ser apagado\./);
    const NOTE = `${MODAL} [data-name-note]`, NAME = `${MODAL} input[type=text]`;
    assert.match(await page.textContent(NOTE), /Já existe "Microfundamento: Inovação na Concepção de Negócios" na pasta da equipe: ela será usada/);
    await page.fill(NAME, 'Inovação na Concepção de Negócios');
    assert.match(await page.textContent(NOTE), /com outro prefixo:"Microfundamento: Inovação na Concepção de Negócios"Usar esta/);
    assert.ok(await page.$eval(CREATE, b => b.disabled), '"Criar" segura');
    await page.click(`${MODAL} button[data-use-folder]`);
    await page.uncheck(`${MODAL} input[data-quizzes]`);
    await page.uncheck(`${MODAL} input[data-insert]`);
    await page.click(CREATE);
    await page.waitForFunction(() => /já existia no H5P/.test(document.getElementById('__svc-h5p-folder-toast__')?.textContent || ''), null, { timeout: 15000 });
    assert.match(await page.textContent('#__svc-h5p-folder-toast__'), /\(PRODUÇÕES › GRADUAÇÃO EAD\)/);
    same(await page.evaluate(() => window.__sent), [{ action: 'h5p-list', team: true, kind: 'micro' },
      { action: 'h5p-create-folder', title: 'Microfundamento: Inovação na Concepção de Negócios', parent: '', team: true, kind: 'micro' }]);
  });
  await page.close();
}

// Selo "H5P" na página de módulos (canvas-h5p-marks.js): só as páginas com o
// quiz no lugar da Atividade de Fixação, UDA e Microfundamento; só lê, um
// pedido por vez. Os selos saem todos juntos, no fim da leitura: quando o
// primeiro aparece, a leitura acabou.
async function marksTests(browser) {
  const C = 238700;
  const MF = fs.readFileSync(path.join(__dirname, 'fixtures', 'microfundamento-tema.html'), 'utf8');
  const MF_ID = '1293064802061305358';
  const MF_SLOT = MF.match(new RegExp(`<p style="text-align: center;"><iframe class="lti-embed" style="width: 100%; height: 600px;" title=""[^>]*${MF_ID}[^>]*></iframe></p>`))[0];
  const TITLED = H5P_IFRAME(QUIZ_ID).replace('title=""', 'title="Tópico 1 – Níveis de Maturidade"');
  const pages = {};
  const resetPages = () => Object.assign(pages, {
    'com-quiz': TOPIC(`<p style="text-align: center;">${TITLED}</p>`),   // UDA: quiz na caixa da faixa
    'marcador': TOPIC(MARKER_BOX),                                        // UDA: só o marcador (o corpo tem outro H5P)
    'sintese':  '<p>S&iacute;ntese e refer&ecirc;ncias</p>',
    'mf-quiz':  MF,                                                       // Microfundamento: quiz abaixo do banner
    'mf-vazia': MF.replace(MF_SLOT + '\n', ''),                          // Microfundamento sem o quiz
    'fora':     TOPIC(`<p>${TITLED}</p>`),                                // fora dos módulos
  });
  resetPages();
  const MODULES = [
    { id: 1, name: 'UNIDADE 1', items: [
      { id: 11, title: 'Tópico 1', type: 'Page', page_url: 'com-quiz' },
      { id: 12, title: 'Tópico 2', type: 'Page', page_url: 'marcador' },
      { id: 13, title: 'Questionário', type: 'Quiz' },
      { id: 14, title: 'Síntese', type: 'Page', page_url: 'sintese' },
    ] },
    { id: 2, name: 'Módulo grande (sem itens na lista)' },
    { id: 3, name: 'Repetido', items: [{ id: 31, title: 'Tópico 1', type: 'Page', page_url: 'com-quiz' }] },
  ];
  const ITEMS_2 = [
    { id: 21, title: 'UNIDADE 1 - Tema 1 - Inovação', type: 'Page', page_url: 'mf-quiz' },
    { id: 22, title: 'UNIDADE 1 - Tema 2 - Difusão', type: 'Page', page_url: 'mf-vazia' },
  ];
  // Item como o da página de módulos clássica; sem .ig-admin = quem só vê o curso.
  const LI = (id, title, admin = true) => `<li id="context_module_item_${id}" class="context_module_item wiki_page"><div class="ig-row">
    <div class="ig-info"><div class="module-item-title"><span class="item_name"><a class="ig-title title item_link" href="#">${title}</a></span></div></div>
    ${admin ? '<div class="ig-admin"><span class="publish-icon">✓</span><a class="al-trigger">⋮</a></div>' : ''}</div></li>`;
  const MODULES_PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="content"><div id="context_modules">
    <div class="context_module"><ul class="ig-list">${LI(11, 'Tópico 1')}${LI(12, 'Tópico 2')}${LI(13, 'Questionário')}${LI(14, 'Síntese')}</ul></div>
    <div class="context_module"><ul class="ig-list">${LI(22, 'UNIDADE 1 - Tema 2 - Difusão')}</ul></div>
    <div class="context_module"><ul class="ig-list">${LI(31, 'Tópico 1', false)}</ul></div>
  </div></div></body></html>`;

  // Canvas falso: módulos, itens do módulo grande, lista das páginas (3 por
  // vez, ligadas pelo Link, com o corpo se mode.withBody) e página avulsa.
  // maxInflight: o máximo de pedidos ao mesmo tempo.
  const mode = {};
  const log = [];
  let inflight = 0, maxInflight = 0;
  const page = await browser.newPage();
  await page.route(`${CANVAS}/**`, async route => {
    const u = new URL(route.request().url());
    if (!u.pathname.startsWith('/api/')) {
      return route.fulfill({ contentType: 'text/html', body: u.pathname.endsWith('/modules') ? MODULES_PAGE : '<!doctype html><html><body><div id="content">Tarefas</div></body></html>' });
    }
    inflight++; maxInflight = Math.max(maxInflight, inflight);
    log.push(decodeURIComponent(u.pathname + u.search).replace(`/api/v1/courses/${C}`, ''));
    await new Promise(r => setTimeout(r, 30 + (mode.slow || 0)));
    inflight--;
    const json = (body, headers = {}, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: 'while(1);' + JSON.stringify(body) });
    if (u.pathname === `/api/v1/courses/${C}/modules`) {
      if (mode.limitOnce) { mode.limitOnce = false; return route.fulfill({ status: 403, headers: { 'Retry-After': '0.1' }, body: '403 Forbidden (Rate Limit Exceeded)' }); }
      if (mode.denied) return json({ status: 'unauthorized' }, {}, 401);
      return json(MODULES, { 'X-Rate-Limit-Remaining': '700' });
    }
    if (u.pathname === `/api/v1/courses/${C}/modules/2/items`) return json(ITEMS_2);
    if (u.pathname === `/api/v1/courses/${C}/pages`) {
      const withBody = mode.withBody !== false && u.searchParams.get('include[]') === 'body';
      const all = Object.entries(pages).map(([url, body]) => ({ url, title: url, ...(withBody ? { body } : {}) }));
      const p = Number(u.searchParams.get('page') || 1);
      const next = p * 3 < all.length ? { Link: `<${CANVAS}${u.pathname}?include[]=body&per_page=100&page=${p + 1}>; rel="next"` } : {};
      return json(all.slice((p - 1) * 3, p * 3), next);
    }
    const pm = u.pathname.match(new RegExp(`^/api/v1/courses/${C}/pages/([^/]+)$`));
    if (pm) {
      const url = decodeURIComponent(pm[1]);
      if (mode.unreadable === url) return json({ status: 'unauthorized' }, {}, 401);
      return json({ url, body: pages[url] });
    }
    return json({}, {}, 404);
  });
  // chrome.storage falso, sem a chave gravada (vale o padrão); __setCfg
  // muda e avisa os ouvintes, como o popup faria. Fica no sessionStorage, para
  // o cache dos selos passar de uma abertura para a outra — só com
  // "?keepcache" no endereço; sem ele, cada abertura começa do zero.
  await page.addInitScript(() => {
    if (!/[?&]keepcache\b/.test(location.search)) sessionStorage.removeItem('__cfg');
    const cfg = JSON.parse(sessionStorage.getItem('__cfg') || '{}'), listeners = [];
    const save = () => sessionStorage.setItem('__cfg', JSON.stringify(cfg));
    const copy = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
    window.__setCfg = (key, value) => {
      const oldValue = cfg[key];
      cfg[key] = value;
      save();
      listeners.forEach(fn => fn({ [key]: { oldValue, newValue: value } }, 'local'));
    };
    Object.defineProperty(window, 'chrome', { configurable: true, value: {
      runtime: { sendMessage: async () => null },
      storage: {
        local: {
          get: async d => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, k in cfg ? copy(cfg[k]) : v])),
          set: async o => {
            const changes = {};
            for (const [k, v] of Object.entries(o)) { changes[k] = { oldValue: cfg[k], newValue: copy(v) }; cfg[k] = copy(v); }
            save();
            listeners.forEach(fn => fn(changes, 'local'));
          },
        },
        onChanged: { addListener: fn => listeners.push(fn) },
      },
    } });
  });
  const open = async (where = 'modules') => {
    log.length = 0; maxInflight = 0;
    await page.goto(`${CANVAS}/courses/${C}/${where}`);
    for (const f of ['h5p-width.js', 'h5p-insert.js', 'canvas-h5p-marks.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, f), 'utf8') });
  };
  const MARK = '.__svc-h5p-mark';
  const marks = () => page.$$eval(MARK, bs => bs.map(b => [b.closest('li').id.replace('context_module_item_', ''), b.textContent]));
  const tip = id => page.$eval(`#context_module_item_${id} ${MARK}`, b => b.title);

  await open();

  await ok('selo H5P — nasce ligado; selo só nas páginas com o quiz no lugar da Atividade de Fixação, antes do ícone de publicado; marcador, H5P só no corpo e Síntese sem selo; a mesma página em dois módulos ganha nos dois', async () => {
    await page.waitForSelector(`#context_module_item_11 ${MARK}`);
    same(await marks(), [['11', 'H5P'], ['31', 'H5P']]);
    same(await page.$eval('#context_module_item_11 .ig-admin', a => [...a.children].map(c => c.className)), ['__svc-h5p-mark', 'publish-icon', 'al-trigger']);
    // Sem .ig-admin (quem só vê o curso): logo depois do título.
    assert.ok(await page.$eval(`#context_module_item_31 ${MARK}`, b => b.previousElementSibling.classList.contains('ig-title')));
    assert.strictEqual(await tip(11), `Tem o quiz H5P da Atividade de Fixação: Tópico 1 – Níveis de Maturidade (nº ${QUIZ_ID} no H5P.com)`);
    assert.strictEqual(await page.$eval(`#context_module_item_11 ${MARK}`, b => b.getAttribute('aria-label')), await tip(11));
  });

  await ok('selo H5P — só GET, um pedido por vez: módulos, itens do módulo grande e a lista das páginas com o corpo (2 vezes, pelo Link); nenhuma página avulsa', async () => {
    assert.strictEqual(maxInflight, 1);
    same(log, ['/modules?include[]=items&per_page=50', '/modules/2/items?per_page=100',
      '/pages?include[]=body&per_page=100', '/pages?include[]=body&per_page=100&page=2']);
  });

  await ok('selo H5P — Microfundamento: item que o Canvas monta depois (módulo aberto) ganha o selo; sem o quiz abaixo do banner, não', async () => {
    await page.evaluate(html => document.getElementById('context_module_item_22').insertAdjacentHTML('beforebegin', html), LI(21, 'UNIDADE 1 - Tema 1 - Inovação'));
    await page.waitForSelector(`#context_module_item_21 ${MARK}`);
    assert.strictEqual(await tip(21), `Tem o quiz H5P da Atividade de Fixação (nº ${MF_ID} no H5P.com)`);
    assert.strictEqual(await page.$(`#context_module_item_22 ${MARK}`), null);
  });

  await ok('selo H5P — o Canvas refaz o item: o selo volta, um só', async () => {
    await page.evaluate(() => { const li = document.getElementById('context_module_item_11'); const copy = li.cloneNode(true); copy.querySelector('.__svc-h5p-mark').remove(); li.replaceWith(copy); });
    await page.waitForSelector(`#context_module_item_11 ${MARK}`);
    await page.waitForTimeout(100);
    assert.strictEqual(await page.$$eval(`#context_module_item_11 ${MARK}`, b => b.length), 1);
  });

  await ok('selo H5P — desligar tira os selos e ligar põe de volta, sem recarregar e sem pedir de novo', async () => {
    log.length = 0;
    await page.evaluate(() => window.__setCfg('h5pMarksEnabled', false));
    await page.waitForSelector(MARK, { state: 'detached' });
    await page.evaluate(() => window.__setCfg('h5pMarksEnabled', true));
    await page.waitForSelector(`#context_module_item_11 ${MARK}`);
    same(await marks(), [['11', 'H5P'], ['21', 'H5P'], ['31', 'H5P']]);
    same(log, []);
  });

  await ok('selo H5P — refresh() (o "📁 Pasta H5P" chama depois de inserir) lê de novo: página que ganhou o quiz ganha o selo, a que perdeu perde', async () => {
    pages.marcador = TOPIC(`<p style="text-align: center;">${H5P_IFRAME('902')}</p>`);
    pages['com-quiz'] = TOPIC(MARKER_BOX);
    await page.evaluate(() => window.__svcH5pMarks.refresh());
    same(await marks(), [['12', 'H5P'], ['21', 'H5P']]);
    assert.strictEqual(await tip(12), 'Tem o quiz H5P da Atividade de Fixação (nº 902 no H5P.com)');
    resetPages();
  });

  await ok('selo H5P — Canvas sem o corpo na lista: lê só as páginas dos módulos, uma por vez; a que não deu para ler ganha "H5P ?"; 403 do limite espera e repete', async () => {
    Object.assign(mode, { withBody: false, unreadable: 'sintese', limitOnce: true });
    await open();
    await page.waitForSelector(`#context_module_item_11 ${MARK}`);
    same(await marks(), [['11', 'H5P'], ['14', 'H5P ?'], ['31', 'H5P']]);
    assert.strictEqual(await tip(14), 'Não consegui ler esta página (HTTP 401): não sei se ela tem o quiz H5P da Atividade de Fixação.');
    assert.strictEqual(await page.$eval(`#context_module_item_14 ${MARK}`, b => b.getAttribute('data-state')), 'error');
    assert.strictEqual(maxInflight, 1);
    assert.strictEqual(log.filter(l => l.startsWith('/modules?')).length, 2);   // o 403 e a repetição
    same(log.filter(l => /^\/pages\/[^?]+$/.test(l)), ['/pages/com-quiz', '/pages/marcador', '/pages/sintese', '/pages/mf-quiz', '/pages/mf-vazia']);
    for (const k of Object.keys(mode)) delete mode[k];
  });

  await ok('selo H5P — sem conseguir ler os módulos: nenhum selo e um aviso para recarregar (não parece que nenhuma página tem o quiz)', async () => {
    mode.denied = true;
    await open();
    await page.waitForFunction(() => /não consegui/.test(document.getElementById('__svc-h5p-mark-toast__')?.textContent || ''));
    assert.match(await page.textContent('#__svc-h5p-mark-toast__'), /Selo H5P nos módulos: não consegui ler os módulos e as páginas \(HTTP 401\)\. Recarregue a página/);
    assert.strictEqual(await page.$(MARK), null);
    delete mode.denied;
  });

  await ok('selo H5P — sem selos guardados, avisa que está lendo; na próxima vez, os da última leitura aparecem na hora (sem o aviso) e a leitura nova corrige', async () => {
    const TOAST = '#__svc-h5p-mark-toast__';
    mode.slow = 300;
    await open();
    await page.waitForSelector(`${TOAST}[data-kind="busy"]`);
    assert.strictEqual(await page.textContent(TOAST), 'Selo H5P: lendo os módulos e as páginas…');
    await page.waitForSelector(`#context_module_item_11 ${MARK}`, { timeout: 15000 });
    assert.strictEqual(await page.$(TOAST), null);
    // Guarda só os selos azuis, de todos os itens dos módulos (o 21 ainda não está na tela).
    await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('__cfg') || '{}').h5pMarksCache);
    const cache = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__cfg')).h5pMarksCache);
    same(Object.keys(cache), [String(C)]);
    same(Object.keys(cache[C].items), ['11', '21', '31']);
    // Na leitura nova, o 11 e o 31 perdem o quiz e o 12 ganha.
    pages['com-quiz'] = TOPIC(MARKER_BOX);
    pages.marcador = TOPIC(`<p style="text-align: center;">${H5P_IFRAME('902')}</p>`);
    await open('modules?keepcache');
    await page.waitForSelector(`#context_module_item_11 ${MARK}`);
    same(await marks(), [['11', 'H5P'], ['31', 'H5P']]);   // do cache, antes de o Canvas responder
    assert.strictEqual(await page.$(TOAST), null);
    await page.waitForSelector(`#context_module_item_12 ${MARK}`, { timeout: 15000 });
    same(await marks(), [['12', 'H5P']]);
    resetPages();
    delete mode.slow;
  });

  await ok('selo H5P — fora da página de módulos: nenhum pedido', async () => {
    await open('assignments');
    await page.waitForTimeout(300);
    same(log, []);
  });
  await page.close();
}
