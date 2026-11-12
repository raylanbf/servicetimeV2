// Simulação do "Inserir vídeos do Studio" do painel, de ponta a ponta:
// - Studio falso (pucminas.instructuremedia.com) com o studio-hook.js e o
//   studio-capture.js: a lista "tiles" tem 45 vídeos em 3 páginas e só
//   responde com o cabeçalho de autorização que a SPA usou.
// - Canvas falso com 3 unidades de pós (módulos) e páginas "virgens".
// - Painel real (popup.html) com chrome.* falso.
// Planilha: o .xlsx salvo pelo Excel (fixtures/planilha-excel.xlsx) e texto colado.
// Rodar com o playwright-core instalado numa pasta qualquer (ex.: o scratchpad):
//   NODE_PATH=<pasta>/node_modules node .claude/skills/h5p-quiz/scripts/test-studio-videos.js
// Usa o Chrome do sistema (CHROME_PATH). Não precisa de rede.
const { chromium } = require('playwright-core');
const fs   = require('fs');
const path = require('path');

const ROOT   = path.resolve(__dirname, '../../../..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HOST   = 'https://pucminas.instructure.com';
const STUDIO = 'https://pucminas.instructuremedia.com';
const COURSE = '282082';
const TAB    = `${HOST}/courses/${COURSE}/modules`;

// ── Páginas de pós "virgens" ──────────────────────────────────────────
const H4    = t => `<h4><strong><span style="font-size: 14pt; color: #464545; font-family: 'Aleo regular', Verdana, Arial;">${t}</span></strong></h4>`;
const BLOCK = `                    ${H4('Tema')}\n                    <p>&nbsp;</p>\n                    <p style="text-align: center;"><strong>[videoaula]</strong></p>\n                    <p style="text-align: center;">&nbsp;</p>\n`;
const PAGE  = n => `<div id="topo" class="content-box" style="margin-top: 0;">
    <div id="geral" class="col-xs-12 col-sm-12 col-md-12 col-lg-12 col-xl-12">
        <div class="grid-row">
            <div id="texto-box" class="col-xs-12 col-sm-12 col-md-12 col-lg-12 col-xl-12">
                <div style="background-color: #ececee; padding: 1%;">
                    <h4><span style="color: #3f9a91;"><strong><span style="font-size: 14pt;">OBJETIVOS DA AULA</span></strong></span></h4>
                    <p>Nesta aula, vamos abordar os seguintes t&oacute;picos:</p>
                </div>
                <hr />
                <div style="text-align: justify;">
${BLOCK.repeat(n)}                    <p>&nbsp;</p>
                </div>
            </div>
        </div>
    </div>
</div>`;

const pages = {};
function resetPages() {
  const pg = (title, n) => ({ title, body: PAGE(n), updated_at: new Date(Date.now() - 4000 * 60000).toISOString(), editor: 'Ana' });
  Object.assign(pages, {
    'u1-associacoes':  pg('Unidade 1 - 1. Associações contábeis', 5),
    'u1-ativo':        pg('Unidade 1 - 2. Ativo', 1),
    'u1-patrimonio':   pg('Unidade 1 - 3. Patrimônio', 1),
    'u1-balanco':      pg('Unidade 1 - 4. Balanço', 1),
    'u2-passivo':      pg('Unidade 2 - 1. Passivo', 1),
    'u3-associacoes':  pg('Unidade 3 - 1. Associações contábeis', 1),
  });
}
const item = slug => ({ type: 'Page', title: pages[slug].title, page_url: slug });
const modules = () => [
  { id: 1, name: 'UNIDADE 1', items: [item('u1-associacoes'), item('u1-ativo'), item('u1-patrimonio'), item('u1-balanco')] },
  { id: 2, name: 'UNIDADE 2', items: [item('u2-passivo')] },
  { id: 3, name: 'UNIDADE 3', items: [item('u3-associacoes')] },
  { id: 4, name: 'Encerramento', items: [{ type: 'ExternalUrl', title: 'Pesquisa' }] },
];

// ── Coleção do Studio: 45 vídeos, 20 por página ──────────────────────
const NAMES = ['ASSOC_01.mp4', 'ASSOC_02.mp4', 'ASSOC_03.mp4', 'ASSOC_04.mp4', 'ASSOC_05.mp4', 'ATIVO_01.mp4',
  'PASSIVO_01.mp4', 'PAT_01.mp4', 'PAT_02.mp4', ...Array.from({ length: 36 }, (_, i) => `Aula extra ${i + 1}`)];
const VIDEOS = NAMES.map((title, i) => ({ id: 1000 + i, launch: `uuid-${i}-${1000 + i}`, title }));
const idOf = name => VIDEOS.find(v => v.title === name).launch;
const tile = v => ({ item_type: 'media', data: {
  title: v.title, has_captions: true,
  collection: { id: 586827, name: 'Contabilidade – Pós', type: 'course_wide' },
  pandata_tokens: { auth: 'SEGREDO-DO-TILE' },
  media: { id: v.id, lti_launch_id: v.launch, title: v.title, author: { email: 'autor@pucminas.br' }, pandata_tokens: { auth: 'SEGREDO' } },
} });
const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const LTI = `${b64url({ alg: 'HS256' })}.${b64url({ lti_course_id: Number(COURSE), lti_user_email: 'eu@pucminas.br' })}.assinatura`;
const STUDIO_PAGE = `${STUDIO}/lti-app/media-picker/collections/courses/586827?lti_params=${LTI}`;
const STUDIO_HTML = `<!DOCTYPE html><html><body><h1>Studio</h1><script>
  // A SPA pede a 1ª página com o cabeçalho de autorização.
  fetch('/api/media_management/collections/586827/tiles?page=1&per_page=20&sort_by=created_at&order=desc',
    { headers: { Authorization: 'Bearer token-da-spa', Accept: 'application/json' } }).then(r => r.json());
</script></body></html>`;

// ── chrome.* falso do painel ───────────────────────────────────────────
const FAKE_CHROME = `(() => {
  const noop = new Proxy(function () {}, { get: (t, p) => (p === 'then' ? undefined : noop), apply: () => noop });
  const wrap = o => new Proxy(o, { get: (t, p) => (p in t ? t[p] : noop) });
  const store = { usuario: 'Teste', video_width: 620, video_height: 398 };
  const listeners = [];
  window.__store = store;
  window.__tabUrl = ${JSON.stringify(TAB)};
  const fake = wrap({
    storage: wrap({
      local: wrap({
        get: async k => {
          if (k == null) return { ...store };
          const keys = typeof k === 'string' ? [k] : Array.isArray(k) ? k : Object.keys(k);
          const out = {};
          for (const key of keys) if (key in store) out[key] = JSON.parse(JSON.stringify(store[key]));
          return out;
        },
        set: async o => {
          const changes = {};
          for (const [k, v] of Object.entries(o)) { changes[k] = { oldValue: store[k], newValue: v }; store[k] = v; }
          listeners.forEach(l => l(changes, 'local'));
        },
        remove: async () => {},
      }),
      onChanged: wrap({ addListener: l => listeners.push(l) }),
    }),
    tabs: wrap({
      query:  async () => [{ id: 7, url: window.__tabUrl, active: true }],
      create: async o => window.__tabEvent({ op: 'create', ...o }),
      update: async (id, o) => window.__tabEvent({ op: 'update', id, ...o }),
      remove: async id => window.__tabEvent({ op: 'remove', id }),
    }),
    scripting: wrap({
      executeScript: ({ func, args }) => window.__exec({ func: func.toString(), args: args || [] }),
    }),
    runtime: wrap({ getURL: p => 'https://ext.test/' + p, getManifest: () => ({ version: '0.0.0' }), id: 'teste' }),
    downloads: wrap({ download: async o => { window.__downloads.push(o); return 1; } }),
  });
  window.__downloads = [];
  Object.defineProperty(window, 'chrome', { value: fake, configurable: true, writable: true });
})();`;

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ✔ ' : '  ✘ ') + msg); if (!cond) failures++; };

(async () => {
  resetPages();
  const puts = [], tabEvents = [], tilesCalls = [];
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 420, height: 1400 } });
  await context.addCookies([{ name: '_csrf_token', value: 'tok%2B1', domain: 'pucminas.instructure.com', path: '/' }]);

  // ── Canvas falso ─────────────────────────────────────────────────────
  await context.route(HOST + '/**', async route => {
    const req = route.request();
    const u   = new URL(req.url());
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const api = `/api/v1/courses/${COURSE}`;
    if (u.pathname === `${api}/modules`) return json(modules());
    const pm = u.pathname.match(new RegExp(`^${api}/pages/([^/]+)$`));
    if (pm) {
      const slug = decodeURIComponent(pm[1]);
      const pg   = pages[slug];
      if (!pg) return json({ errors: [{ message: 'page not found' }] }, 404);
      if (req.method() === 'PUT') {
        const data = JSON.parse(req.postData() || '{}');
        puts.push({ slug, csrf: req.headers()['x-csrf-token'] });
        pg.body = data.wiki_page.body;
        pg.updated_at = new Date().toISOString();
      }
      return json({ url: slug, title: pg.title, body: pg.body, updated_at: pg.updated_at, last_edited_by: { display_name: pg.editor } });
    }
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!DOCTYPE html><html><body><h1>Canvas</h1></body></html>' });
  });
  const canvas = await context.newPage();
  canvas.on('pageerror', e => { console.log('[canvas pageerror]', e.message); failures++; });
  await canvas.goto(TAB);

  // ── Studio falso ─────────────────────────────────────────────────────
  await context.route(STUDIO + '/**', async route => {
    const req = route.request();
    const u   = new URL(req.url());
    if (/\/tiles$/.test(u.pathname)) {
      const auth = req.headers()['authorization'];
      tilesCalls.push({ page: u.searchParams.get('page'), auth });
      if (auth !== 'Bearer token-da-spa') return route.fulfill({ status: 401, body: '{"error":"unauthorized"}' });
      const page = Number(u.searchParams.get('page') || 1);
      const body = { tiles: VIDEOS.slice((page - 1) * 20, page * 20).map(tile),
        meta: { current_page: page, per_page: 20, last_page: 3, total_count: VIDEOS.length } };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    }
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: STUDIO_HTML });
  });

  // ── Painel ───────────────────────────────────────────────────────────
  await context.route('https://ext.test/**', route => {
    const f = path.join(ROOT, new URL(route.request().url()).pathname.slice(1));
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png' }[path.extname(f)] || 'application/octet-stream';
    return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(f) });
  });
  const panel = await context.newPage();
  panel.on('pageerror', e => { console.log('[painel pageerror]', e.message); failures++; });
  await panel.exposeBinding('__exec', async (_src, { func, args }) => {
    const result = await canvas.evaluate(([src, a]) => (0, eval)('(' + src + ')')(...a), [func, args]);
    return [{ result }];
  });

  // "Abrir o Studio": abre o frame do Studio com o hook e a captura (o
  // storage dele é o do painel, como no Chrome de verdade).
  let studioPage = null;
  await panel.exposeBinding('__tabEvent', async (_src, ev) => {
    tabEvents.push(ev);
    if (ev.op !== 'create') return undefined;
    (async () => {
      studioPage = await context.newPage();
      studioPage.on('pageerror', e => { console.log('[studio pageerror]', e.message); failures++; });
      await studioPage.exposeBinding('__toPanel', (_s, o) => panel.evaluate(x => chrome.storage.local.set(x), o));
      await studioPage.addInitScript({ content: `Object.defineProperty(window, 'chrome', { value: { storage: { local: { set: o => window.__toPanel(o) } } }, configurable: true });` });
      await studioPage.addInitScript({ path: path.join(ROOT, 'studio-hook.js') });
      await studioPage.addInitScript({ path: path.join(ROOT, 'studio-capture.js') });
      await studioPage.goto(STUDIO_PAGE);
    })();
    return { id: 99, url: ev.url };
  });
  await panel.addInitScript({ content: FAKE_CHROME });
  await panel.goto('https://ext.test/popup.html');
  await panel.waitForFunction(() => typeof S !== 'undefined' && S && S.video_width === 620, null, { timeout: 10000 });

  const text  = sel => panel.locator(sel).innerText().catch(() => '');
  const shown = sel => panel.locator(sel).isVisible();
  async function waitText(sel, re, ms = 15000) {
    const start = Date.now();
    while (Date.now() - start < ms) { const t = await text(sel); if (re.test(t)) return t; await panel.waitForTimeout(100); }
    return await text(sel);
  }
  const rowsInfo = () => panel.evaluate(() => [...document.querySelectorAll('#stu-results .bulk-course-row')].map(r => ({
    cls: r.className.replace('bulk-course-row ', ''), title: r.querySelector('.bulk-page-title')?.textContent,
    count: r.querySelector('.bulk-count')?.textContent || '', items: r.querySelector('.vid-video-list')?.innerText || '',
    note: r.querySelector('.bulk-course-note')?.textContent || '',
  })));

  // ── Abrir a ferramenta ───────────────────────────────────────────────
  console.log('Abrir');
  await panel.evaluate(() => show('main'));
  await panel.click('#btn-canvas');
  await panel.click('#btn-canvas-studio');
  check(await shown('#view-canvas-studio'), 'tela "Vídeos do Studio" aberta pelo menu do Canvas');
  check(await waitText('#stu-course-label', /#/) === `curso #${COURSE}`, 'curso da aba');
  check(await waitText('#stu-studio-info', /lidos/) === 'Ainda não lidos neste curso.', 'sem lista do Studio ainda');

  // ── 1. Ler vídeos do Studio ──────────────────────────────────────────
  console.log('Ler o Studio');
  await panel.click('#btn-stu-read');
  const info = await waitText('#stu-studio-info', /^45 vídeo/, 20000);
  check(/^45 vídeo\(s\) · coleção "Contabilidade – Pós" · lidos agora$/.test(info), 'lista completa (3 páginas): ' + info);
  const create = tabEvents.find(e => e.op === 'create');
  check(create?.url === `${HOST}/courses/${COURSE}/external_tools/33` && create.active === true, 'abre o Studio do curso: ' + create?.url);
  check(tilesCalls.length === 3 && tilesCalls.every(c => c.auth === 'Bearer token-da-spa'), `pede as páginas 2 e 3 com o cabeçalho da SPA (${tilesCalls.map(c => c.page).join(', ')})`);
  await panel.waitForTimeout(300);
  check(tabEvents.some(e => e.op === 'remove' && e.id === 99) && tabEvents.some(e => e.op === 'update' && e.id === 7 && e.active),
    'fecha a aba do Studio e volta para a do curso');
  const rec = await panel.evaluate(() => window.__store['studioVideos:282082']);
  const raw = JSON.stringify(rec);
  check(rec.videos.length === 45 && rec.complete && rec.studioDomain === 'pucminas.instructuremedia.com' && rec.videos[0].id === 'uuid-0-1000',
    'gravado em studioVideos:<curso> com o código do embed (lti_launch_id)');
  check(!/SEGREDO|@pucminas/.test(raw), 'tokens e e-mails da resposta não são gravados');
  check(await panel.locator('#btn-stu-read').textContent() === '🔄  Ler vídeos do Studio de novo', 'botão vira "ler de novo"');

  // ── 2. Planilha do Excel ─────────────────────────────────────────────
  console.log('Planilha .xlsx');
  await panel.setInputFiles('#stu-file', path.join(__dirname, 'fixtures', 'planilha-excel.xlsx'));
  const sheetInfo = await waitText('#stu-sheet-info', /vídeo/);
  check(sheetInfo === '5 vídeo(s) em 3 página(s).', '.xlsx do Excel (aba ativa, célula mesclada, negrito parcial, número): ' + sheetInfo);
  const ta = (await panel.inputValue('#stu-sheet')).split('\n');
  check(ta[0] === 'Página\tTítulo acima do vídeo\tVídeo no Studio' && ta[1] === 'Associações contábeis\tIntrodução & conceitos\tASSOC_01' &&
    ta[2] === '\tTipos de associação\tassoc 02' && ta[4] === 'Ativo\t"Ativo ""circulante"""\tATIVO_01' && ta[5] === 'Passivo\t12\tPASSIVO_01',
    'vira texto por tab no quadro, para conferir: ' + JSON.stringify(ta.slice(0, 6)));

  // Exemplo: a tabela na tela e o modelo .xlsx para baixar, que a própria ferramenta lê.
  console.log('Exemplo');
  const example = await panel.evaluate(() => [...document.querySelectorAll('.stu-example tr')].map(r => [...r.cells].map(c => c.textContent)));
  check(example[0].join(' | ') === 'Página | Título acima do vídeo | Nome do vídeo no Studio' && example.length === 5, 'tabela de exemplo na tela: ' + example.length + ' linhas');
  await panel.click('#btn-stu-example');
  const dl = await panel.evaluate(() => window.__downloads[0]);
  check(dl?.url === 'https://ext.test/modelos/planilha-videos-studio.xlsx' && dl.filename === 'Modelo - vídeos do Studio.xlsx', 'baixar exemplo: ' + JSON.stringify(dl));
  const MODEL = path.join(ROOT, 'modelos', 'planilha-videos-studio.xlsx');
  check(fs.existsSync(MODEL) && fs.readFileSync(MODEL).subarray(0, 2).toString() === 'PK', 'o modelo existe e é um .xlsx');
  await panel.fill('#stu-sheet', '');
  await panel.setInputFiles('#stu-file', MODEL);
  check(await waitText('#stu-sheet-info', /^7 vídeo/) === '7 vídeo(s) em 3 página(s).', 'o modelo, enviado de volta, é lido certo: ' + await text('#stu-sheet-info'));
  const modelRows = (await panel.inputValue('#stu-sheet')).split('\n');
  check(modelRows[0] === 'Página\tTítulo acima do vídeo\tNome do vídeo no Studio' && modelRows[4] === 'Associações contábeis\tEstudo de caso\tASSOC_04',
    'conteúdo do modelo: ' + JSON.stringify(modelRows.slice(0, 2)));
  if (process.env.OUT_DIR) await panel.screenshot({ path: path.join(process.env.OUT_DIR, 'studio-exemplo.png'), clip: { x: 0, y: 0, width: 420, height: 700 } });

  // Texto colado: o caso completo.
  const SHEET = [
    'Página\tTítulo acima do vídeo\tVídeo no Studio',
    'Associações contábeis\tIntrodução & conceitos\tASSOC_01',
    '\tTipos de associação\tassoc 02',
    'Associações contábeis\t\tASSOC_03.mp4',
    'Ativo\tAtivo circulante\tATIVO_01',
    'Passivo\tPassivo\tPASSIVO_01',
    'Patrimônio\tParte 1\tPAT_01',
    'Patrimônio\tParte 2\tPAT_02',
    'Balanço\tBalanço\tBAL_99',
    'Inexistente\tx\tASSOC_04',
  ].join('\n');
  await panel.fill('#stu-sheet', SHEET);
  check(await waitText('#stu-sheet-info', /vídeo/) === '9 vídeo(s) em 6 página(s).', 'texto colado: ' + await text('#stu-sheet-info'));

  // ── 3. Módulos: nenhum marcado de início ─────────────────────────────
  console.log('Módulos');
  await panel.click('#btn-stu-modules');
  await panel.waitForSelector('#stu-modules-list .vid-mod-item');
  const mods = await panel.evaluate(() => [...document.querySelectorAll('#stu-modules-list .vid-mod-item')].map(r => ({
    name: r.querySelector('.bulk-page-title').textContent, checked: r.querySelector('input').checked, disabled: r.querySelector('input').disabled })));
  check(mods.length === 4 && mods.every(m => !m.checked), 'começa sem nenhum módulo marcado');
  check(mods[3].disabled, 'módulo sem páginas desabilitado');
  check(await panel.locator('#btn-stu-preview').isDisabled(), 'sem módulo marcado: prévia desabilitada');

  // ── Prévia só da Unidade 1 ───────────────────────────────────────────
  console.log('Prévia (Unidade 1)');
  await panel.click('#stu-mod-1');
  await panel.click('#btn-stu-preview');
  let head = await waitText('#stu-results', /Prévia/);
  check(head.startsWith('Prévia — 4 vídeo(s) em 2 página(s). 3 página(s) com problema não serão gravadas. 1 fora dos módulos marcados. Nada foi gravado ainda.'), 'resumo: ' + head.split('\n')[0]);
  let rows = await rowsInfo();
  const by = t => rows.find(r => r.title === t) || {};
  const assoc = by('Unidade 1 - 1. Associações contábeis');
  check(assoc.cls === 'warn' && assoc.count === '3×', '"Associações contábeis" acha a da Unidade 1 (a da Unidade 3 não está marcada)');
  check(assoc.items === '1. Tema → "Introdução & conceitos" · 🎬 ASSOC_01.mp4\n2. Tema → "Tipos de associação" · 🎬 ASSOC_02.mp4\n3. Tema · 🎬 ASSOC_03.mp4',
    'cada espaço com título e vídeo (linha mesclada herda a página; título vazio mantém "Tema"): ' + JSON.stringify(assoc.items));
  check(/2 espaço\(s\) da página ficam sem vídeo/.test(assoc.note), 'avisa os espaços que sobram');
  check(by('Unidade 1 - 2. Ativo').cls === 'ok', 'Ativo pronto');
  check(by('Unidade 2 - 1. Passivo').cls === 'zero' && /módulo "UNIDADE 2", que não está marcado/.test(by('Unidade 2 - 1. Passivo').note), 'Passivo: fora dos módulos marcados, fica como está');
  check(by('Unidade 1 - 3. Patrimônio').cls === 'error' && /só tem 1 espaço/.test(by('Unidade 1 - 3. Patrimônio').items), 'Patrimônio: 2 vídeos e 1 espaço → bloqueada');
  check(by('Unidade 1 - 4. Balanço').cls === 'error' && /BAL_99: não está na coleção do Studio/.test(by('Unidade 1 - 4. Balanço').items), 'Balanço: vídeo fora da coleção → bloqueada');
  check(by('Inexistente').cls === 'error' && /não encontrada/.test(by('Inexistente').note), 'página que não existe');
  check(await panel.locator('#btn-stu-apply').textContent() === '✅  Aplicar em 2 página(s)', 'botão: ' + await panel.locator('#btn-stu-apply').textContent());
  check(puts.length === 0, 'a prévia não grava nada');
  if (process.env.OUT_DIR) await panel.screenshot({ path: path.join(process.env.OUT_DIR, 'studio-previa.png'), fullPage: true });

  // Todos os módulos: o mesmo nome em duas unidades fica ambíguo.
  await panel.click('#btn-stu-toggle-all');
  check(!(await shown('#btn-stu-apply')), 'mudar os módulos apaga a prévia');
  await panel.click('#btn-stu-preview');
  await waitText('#stu-results', /Prévia/);
  rows = await rowsInfo();
  check(/2 páginas com esse nome/.test(rows.find(r => r.title === 'Associações contábeis')?.note || ''), 'todas as unidades: "Associações contábeis" ambíguo, não chuta');
  check(rows.find(r => r.title === 'Unidade 2 - 1. Passivo')?.cls === 'ok', 'todas as unidades: Passivo entra');
  await panel.click('#btn-stu-toggle-all');
  await panel.click('#stu-mod-1');
  await panel.click('#btn-stu-preview');
  await waitText('#stu-results', /Prévia/);

  // Depois da prévia, alguém acrescenta um espaço na página Ativo.
  pages['u1-ativo'].body += `\n${H4('Novo')}<p>[videoaula]</p>`;
  const assocBefore = pages['u1-associacoes'].body;

  // ── Aplicar ──────────────────────────────────────────────────────────
  console.log('Aplicar');
  await panel.click('#btn-stu-apply');
  check(await text('#vid-confirm-sub') === '4 vídeo(s) do Studio entram em 2 página(s). Grava direto no Canvas.', 'confirmação: ' + await text('#vid-confirm-sub'));
  await panel.fill('#vid-confirm-course', '282083');
  await panel.click('#btn-vid-confirm-ok');
  check(/não é o do curso da aba aberta/.test(await waitText('#vid-confirm-alert', /⚠/)) && puts.length === 0, 'número errado: não grava');
  await panel.fill('#vid-confirm-course', COURSE);
  await panel.press('#vid-confirm-course', 'Enter');
  head = await waitText('#stu-results > div:first-child', /^(✅|Nada)/, 20000);
  check(head === '✅ 3 vídeo(s) inseridos em 1 página(s). 1 página(s) com problema.', 'resumo: ' + head);
  rows = await rowsInfo();
  check(puts.length === 1 && puts[0].slug === 'u1-associacoes' && puts[0].csrf === 'tok+1', 'só a página que não mudou é gravada, com o CSRF');
  check(/A página mudou depois da prévia \(tinha 1 espaço\(s\) de vídeo, agora tem 2\)/.test(by('Unidade 1 - 2. Ativo').note || rows.find(r => r.title === 'Unidade 1 - 2. Ativo')?.note),
    'Ativo mudou depois da prévia: nada gravado nela');
  const body = pages['u1-associacoes'].body;
  const ids = ['ASSOC_01.mp4', 'ASSOC_02.mp4', 'ASSOC_03.mp4'].map(idOf);
  check(ids.every(id => body.includes(`custom_arc_media_id%3D${id}%26`)) && body.indexOf(ids[0]) < body.indexOf(ids[1]) && body.indexOf(ids[1]) < body.indexOf(ids[2]), 'os 3 vídeos na ordem');
  check(body.includes(H4('Introdução &amp; conceitos')) && body.includes(H4('Tipos de associação')) && body.split(H4('Tema')).length - 1 === 3,
    'títulos trocados com a mesma formatação; o 3º (sem título na planilha) e os 2 que sobraram ficam "Tema"');
  check(body.split('[videoaula]').length - 1 === 2, 'sobram 2 espaços');
  const firstH = assocBefore.indexOf(H4('Tema'));
  check(body.slice(0, firstH) === assocBefore.slice(0, firstH), 'antes do 1º vídeo, nada mudou');
  check(body.includes(`<p style="text-align: center;"><iframe class="lti-embed" style="width: 620px; height: 398px; display: inline-block;" title="Introdução &amp; conceitos" src="/courses/${COURSE}/external_tools/retrieve?display=borderless&amp;url=`),
    'embed do Studio centralizado, no tamanho das Configurações');

  // ── De novo: não duplica ─────────────────────────────────────────────
  console.log('Segunda prévia');
  pages['u1-ativo'].body = PAGE(1);
  await panel.click('#btn-stu-preview');
  await waitText('#stu-results', /Prévia/);
  rows = await rowsInfo();
  check(rows.find(r => r.title === 'Unidade 1 - 1. Associações contábeis')?.cls === 'error', 'página já preenchida: a mesma planilha não cabe mais (não duplica vídeo)');

  await browser.close();
  console.log(failures ? `\n${failures} FALHA(S)` : '\nTUDO OK');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
