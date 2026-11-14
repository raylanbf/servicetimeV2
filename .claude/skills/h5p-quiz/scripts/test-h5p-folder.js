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

  // ── 2. Chrome sem tela ────────────────────────────────────────────────
  let chromium;
  try { ({ chromium } = require('playwright-core')); } catch { console.log('\n(playwright-core ausente: parte 2 pulada)'); }
  if (chromium) {
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    try {
      await offscreenTests(browser);
      await insertRuleTests(browser);
      await canvasTests(browser);
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
  await page.addInitScript(() => {
    document.cookie = '_csrf_token=abc%2B123; path=/';
    window.__sent = [];
    window.__h5p = { folder: null, quiz: () => null, list: () => ({ status: 'ok', items: [] }) };
    Object.defineProperty(window, 'chrome', { configurable: true, value: { runtime: { sendMessage: async m => {
      window.__sent.push(m);
      if (m.action === 'h5p-create-folder') return window.__h5p.folder;
      if (m.action === 'h5p-create-quiz') return window.__h5p.quiz(m);
      if (m.action === 'h5p-list') return window.__h5p.list(m);
    } } } });
  });
  await page.goto(`${CANVAS}/courses/${COURSE}/modules`);
  for (const f of ['h5p-width.js', 'h5p-insert.js', 'canvas-h5p-folder.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, f), 'utf8') });

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
