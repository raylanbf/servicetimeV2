// Simulação do "Vídeos em lote" do painel: o popup.html real (com popup.js e
// video-size.js) roda numa página com um chrome.* falso; o executeScript
// serializa a função e roda na aba de um Canvas falso, que responde à API de
// módulos e páginas (com paginação, módulo sem a lista de itens, página que
// some, edição recente) e guarda o que o PUT grava. Rodar com o
// playwright-core instalado numa pasta qualquer (ex.: o scratchpad):
//   NODE_PATH=<pasta>/node_modules node .claude/skills/h5p-quiz/scripts/test-video-batch.js
// Usa o Chrome do sistema (CHROME_PATH). Não precisa de rede.
const { chromium } = require('playwright-core');
const fs   = require('fs');
const path = require('path');

const ROOT   = path.resolve(__dirname, '../../../..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HOST   = 'https://pucminas.instructure.com';
const COURSE = '282082';
const TAB    = `${HOST}/courses/${COURSE}/pages/topico-1-pagina-1`;

// ── Conteúdo das páginas ───────────────────────────────────────────────
const STUDIO = (w, h, aw, ah, id) => `<iframe class="lti-embed" style="width: ${w}px; height: ${h}px; display: inline-block;" title="Vídeo ${id}" src="${HOST}/courses/${COURSE}/external_tools/retrieve?display=borderless&amp;url=https%3A%2F%2Fpucminas.instructuremedia.com%2Flti%2Flaunch%3Fcustom_arc_media_id%3D${id}" width="${aw}" height="${ah}" loading="lazy" allowfullscreen="allowfullscreen" data-studio-resizable="true"></iframe>`;
const YT       = (w, h) => `<iframe width="${w}" height="${h}" src="https://www.youtube.com/embed/abc" title="YouTube video player" frameborder="0" allowfullscreen></iframe>`;
const VIMEO    = (w, h) => `<iframe src="https://player.vimeo.com/video/1" width="${w}" height="${h}" allowfullscreen></iframe>`;
const MEDIA    = (w, h) => `<iframe style="width: ${w}px; height: ${h}px; display: inline-block;" title="v" data-media-type="video" src="/media_attachments_iframe/1?type=video" allowfullscreen="allowfullscreen" data-media-id="1"></iframe>`;
const GENIALLY = '<div style="position: relative; padding-bottom: 65.53%;"><iframe style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" title="Genially" src="https://view.genially.com/6ab6" width="1030" height="675" allowfullscreen="allowfullscreen"></iframe></div>';
const QUIZ     = `<iframe class="lti-embed" style="width: 100%; height: 600px;" title="" src="${HOST}/courses/${COURSE}/external_tools/retrieve?display=borderless&amp;url=https%3A%2F%2Fpucminasvirtual.h5p.com%2Fcontent%2F129" width="779" height="600" allowfullscreen="allowfullscreen"></iframe>`;

const P1 = s1 => `<div id="conteudo"><h4>Introdu&ccedil;&atilde;o</h4>\n<p>Texto &ndash; com entidades.</p>\n<p style="text-align: center;">${s1}</p>\n` +
  `<p>${'%YT%'}</p>\n${GENIALLY}\n<div id="questao-fixacao-banner">Atividade de Fixa&ccedil;&atilde;o</div>\n<div id="questao-fixacao-atividade"><p>${QUIZ}</p></div></div>`;
const P1_BEFORE = P1(STUDIO(700, 442, 720, 405, 'p1a')).replace('%YT%', YT(560, 315));
const P1_AFTER  = P1(STUDIO(620, 398, 620, 398, 'p1a')).replace('%YT%', YT(620, 398));
const P4_SIZES  = [[560, 315], [640, 360], [700, 442], [720, 405], [800, 450], [480, 270], [854, 480], [1024, 576], [600, 338]];
const P4 = (sized) => `<p>${sized ? MEDIA(620, 398) : MEDIA(320, 240)}</p>\n` +
  P4_SIZES.map(([w, h], i) => `<p>${sized ? STUDIO(620, 398, 620, 398, 'p4' + i) : STUDIO(w, h, w, h, 'p4' + i)}</p>`).join('\n');

const ago = min => new Date(Date.now() - min * 60000).toISOString();
const pages = {};
function resetPages() {
  Object.assign(pages, {
    'topico-1-pagina-1': { title: 'Tópico 1 – Página 1', body: P1_BEFORE, updated_at: ago(4000), editor: 'Ana' },
    'topico-1-pagina-2': { title: 'Tópico 1 – Página 2', body: `<p>${STUDIO(620, 398, 620, 398, 'p2a')}</p><p>${STUDIO(620, 398, 620, 398, 'p2b')}</p>`, updated_at: ago(4000), editor: 'Ana' },
    'topico-2-pagina-1': { title: 'Tópico 2 – Página 1', body: '<p>Sem vídeo aqui.</p><img src="x.png" width="300" height="200">', updated_at: ago(4000), editor: 'Ana' },
    'topico-2-pagina-2': { title: 'Tópico 2 – Página 2', body: `<p>${VIMEO(640, 360)}</p>`, updated_at: ago(5), editor: 'Fulano de Tal' },
    'topico-3-pagina-1': { title: 'Tópico 3 – Página 1', body: P4(false), updated_at: ago(4000), editor: 'Ana' },
  });
}
const item = (type, slug, title) => ({ type, title: title || pages[slug]?.title || slug, page_url: type === 'Page' ? slug : undefined });
function modules() {
  return [
    { id: 1, name: 'UNIDADE 1 – Tópico 1', items: [item('Page', 'topico-1-pagina-1'), item('Assignment', null, 'Tarefa 1'), item('Page', 'topico-1-pagina-2'), item('SubHeader', null, 'Leituras')] },
    { id: 2, name: 'Tópico 2' },   // sem "items": módulo grande, lista à parte
    { id: 3, name: 'Saiba Mais', items: [item('ExternalUrl', null, 'Site')] },
    { id: 4, name: 'Tópico 3', items: [item('Page', 'pagina-apagada', 'Página apagada'), item('Page', 'topico-3-pagina-1')] },
  ];
}
const MOD2_ITEMS = () => [item('Page', 'topico-2-pagina-1'), item('Page', 'topico-1-pagina-1'), item('Page', 'topico-2-pagina-2')];

// ── chrome.* falso do painel ───────────────────────────────────────────
const FAKE_CHROME = `(() => {
  const noop = new Proxy(function () {}, { get: (t, p) => (p === 'then' ? undefined : noop), apply: () => noop });
  const wrap = o => new Proxy(o, { get: (t, p) => (p in t ? t[p] : noop) });
  const store = { usuario: 'Teste', video_width: 620, video_height: 398 };
  window.__tabUrl = ${JSON.stringify(TAB)};
  const fake = wrap({
    storage: wrap({
      local: wrap({
        get: async k => {
          if (k == null) return { ...store };
          const keys = typeof k === 'string' ? [k] : Array.isArray(k) ? k : Object.keys(k);
          const out = Array.isArray(k) || typeof k === 'string' ? {} : { ...k };
          for (const key of keys) if (key in store) out[key] = store[key];
          return out;
        },
        set: async o => { Object.assign(store, o); },
        remove: async () => {},
      }),
      onChanged: wrap({ addListener() {} }),
    }),
    tabs: wrap({ query: async () => [{ id: 7, url: window.__tabUrl, active: true }] }),
    scripting: wrap({
      executeScript: ({ func, args, files }) => window.__exec({ func: func ? func.toString() : null, args: args || [], files: files || null }),
    }),
    runtime: wrap({ getURL: p => 'https://ext.test/' + p, getManifest: () => ({ version: '0.0.0' }), id: 'teste' }),
  });
  Object.defineProperty(window, 'chrome', { value: fake, configurable: true, writable: true });
})();`;

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ✔ ' : '  ✘ ') + msg); if (!cond) failures++; };

(async () => {
  resetPages();
  const puts = [];
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await context.addCookies([{ name: '_csrf_token', value: 'tok%2B1', domain: 'pucminas.instructure.com', path: '/' }]);

  // ── Canvas falso ─────────────────────────────────────────────────────
  await context.route(HOST + '/**', async route => {
    const req = route.request();
    const u   = new URL(req.url());
    const json = (data, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers });
    const api = `/api/v1/courses/${COURSE}`;
    if (u.pathname === `${api}/modules`) {
      const all = modules().map(m => (u.searchParams.getAll('include[]').includes('items') ? m : { id: m.id, name: m.name }));
      // Paginação: 2 por página, com o Link do Canvas.
      const page = Number(u.searchParams.get('page') || 1);
      const next = page * 2 < all.length ? { Link: `<${HOST}${api}/modules?include[]=items&page=${page + 1}&per_page=100>; rel="next"` } : {};
      return json(all.slice((page - 1) * 2, page * 2), 200, next);
    }
    if (u.pathname === `${api}/modules/2/items`) return json(MOD2_ITEMS());
    const pm = u.pathname.match(new RegExp(`^${api}/pages/([^/]+)$`));
    if (pm) {
      const slug = decodeURIComponent(pm[1]);
      const pg   = pages[slug];
      if (!pg) return json({ errors: [{ message: 'page not found' }] }, 404);
      if (req.method() === 'PUT') {
        const data = JSON.parse(req.postData() || '{}');
        puts.push({ slug, csrf: req.headers()['x-csrf-token'], body: data.wiki_page?.body });
        pg.body = data.wiki_page.body;
        pg.updated_at = new Date().toISOString();
        pg.editor = 'Teste';
      }
      return json({ url: slug, title: pg.title, body: pg.body, updated_at: pg.updated_at, last_edited_by: { display_name: pg.editor } });
    }
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!DOCTYPE html><html><body><h1>Canvas</h1></body></html>' });
  });
  const canvas = await context.newPage();
  canvas.on('pageerror', e => { console.log('[canvas pageerror]', e.message); failures++; });
  await canvas.goto(TAB);

  // ── Painel ───────────────────────────────────────────────────────────
  await context.route('https://ext.test/**', route => {
    const f = path.join(ROOT, new URL(route.request().url()).pathname.slice(1));
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png' }[path.extname(f)] || 'application/octet-stream';
    return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(f) });
  });
  const panel = await context.newPage();
  panel.on('pageerror', e => { console.log('[painel pageerror]', e.message); failures++; });
  await panel.exposeBinding('__exec', async (_src, { func, args, files }) => {
    if (files) {
      for (const f of files) await canvas.addScriptTag({ content: fs.readFileSync(path.join(ROOT, f), 'utf8') });
      return [{ result: undefined }];
    }
    const result = await canvas.evaluate(([src, a]) => (0, eval)('(' + src + ')')(...a), [func, args]);
    return [{ result }];
  });
  await panel.addInitScript({ content: FAKE_CHROME });
  await panel.goto('https://ext.test/popup.html');
  await panel.waitForFunction(() => typeof S !== 'undefined' && S && S.video_width === 620, null, { timeout: 10000 });

  const text   = sel => panel.locator(sel).innerText().catch(() => '');
  const shown  = sel => panel.locator(sel).isVisible();
  const setTab = url => panel.evaluate(u => { window.__tabUrl = u; }, url);
  async function waitText(sel, re, ms = 15000) {
    const start = Date.now();
    while (Date.now() - start < ms) { const t = await text(sel); if (re.test(t)) return t; await panel.waitForTimeout(100); }
    return await text(sel);
  }
  const rowsInfo = () => panel.evaluate(() => [...document.querySelectorAll('#vid-results .bulk-course-row')].map(r => ({
    cls: r.className.replace('bulk-course-row ', ''), title: r.querySelector('.bulk-page-title')?.textContent,
    count: r.querySelector('.bulk-count')?.textContent || '', videos: r.querySelector('.vid-video-list')?.textContent || '',
    note: r.querySelector('.bulk-course-note')?.textContent || '',
  })));

  // ── Abrir a ferramenta ───────────────────────────────────────────────
  console.log('Abrir');
  await panel.evaluate(() => show('main'));
  await panel.click('#btn-canvas');
  await panel.click('#btn-canvas-videos');
  check(await shown('#view-canvas-videos'), 'tela "Vídeos em lote" aberta pelo menu do Canvas');
  check(await waitText('#vid-course-label', /#/) === `curso #${COURSE}`, 'curso da aba: ' + await text('#vid-course-label'));
  check(await text('#vid-size-label') === '620×398', 'tamanho das Configurações: ' + await text('#vid-size-label'));

  // ── Módulos ──────────────────────────────────────────────────────────
  console.log('Ler módulos');
  await panel.click('#btn-vid-modules');
  const st = await waitText('#vid-status', /módulo/);
  check(st === `4 módulo(s), 6 página(s) no curso #${COURSE}`, 'status (sem repetir a página que está em 2 módulos): ' + st);
  const mods = await panel.evaluate(() => [...document.querySelectorAll('#vid-modules-list .vid-mod-item')].map(r => ({
    name: r.querySelector('.bulk-page-title').textContent, count: r.querySelector('.vid-mod-count').textContent,
    checked: r.querySelector('input').checked, disabled: r.querySelector('input').disabled,
  })));
  check(mods.length === 4, '4 módulos (com paginação da API)');
  check(mods[0].checked && mods[1].checked && mods[3].checked, 'módulos com páginas já vêm marcados');
  check(mods[0].count === '2 pág.' && mods[1].count === '3 pág.' && mods[3].count === '2 pág.', 'páginas por módulo (só itens do tipo Página; módulo grande lido à parte) — ' + mods.map(m => m.count).join(', '));
  check(!mods[2].checked && mods[2].disabled && mods[2].count === 'sem páginas', 'módulo sem páginas: desmarcado e desabilitado');
  check(await text('#btn-vid-toggle-all') === 'desmarcar todos', 'link "desmarcar todos"');

  // ── Prévia ───────────────────────────────────────────────────────────
  console.log('Prévia');
  await panel.click('#btn-vid-preview');
  let head = await waitText('#vid-results', /Prévia/);
  check(head.startsWith('Prévia — 13 vídeo(s) em 3 página(s) vão para 620×398. 2 página(s) sem nada a mudar. 1 com erro. Nada foi gravado ainda.'), 'resumo: ' + head.split('\n')[0]);
  let rows = await rowsInfo();
  const by = t => rows.find(r => r.title === t) || {};
  check(rows.length === 6, `6 páginas lidas, sem repetir a que está em 2 módulos (${rows.length})`);
  check(by('Tópico 1 – Página 1').cls === 'ok' && by('Tópico 1 – Página 1').count === '2×', 'Página 1: 2 vídeos a mudar');
  check(by('Tópico 1 – Página 1').videos === 'Studio 700×442 → 620×398 · YouTube 560×315 → 620×398', 'Página 1 lista os vídeos (Genially e quiz H5P de fora): ' + by('Tópico 1 – Página 1').videos);
  check(by('Tópico 1 – Página 2').cls === 'zero' && /já está/.test(by('Tópico 1 – Página 2').videos), 'Página 2: vídeos já no tamanho');
  check(by('Tópico 2 – Página 1').cls === 'zero' && by('Tópico 2 – Página 1').note === 'Sem vídeos nesta página.', 'página sem vídeo');
  check(by('Tópico 2 – Página 2').cls === 'warn' && /Editada há 5 min por Fulano de Tal/.test(by('Tópico 2 – Página 2').note), 'edição recente avisada: ' + by('Tópico 2 – Página 2').note);
  check(by('Página apagada').cls === 'error' && /HTTP 404/.test(by('Página apagada').note), 'página que sumiu: erro só nela');
  check(by('Tópico 3 – Página 1').count === '10×', '10 vídeos numa página (mídia do Canvas + 9 do Studio)');
  const btnTxt = await panel.locator('#btn-vid-apply').textContent();
  check(btnTxt === '✅  Aplicar em 3 página(s)', 'botão: ' + btnTxt);
  check(puts.length === 0, 'a prévia não grava nada');
  if (process.env.OUT_DIR) await panel.screenshot({ path: path.join(process.env.OUT_DIR, 'video-batch-previa.png'), fullPage: true });

  // ── Mudar a seleção descarta a prévia ────────────────────────────────
  console.log('Seleção');
  await panel.click('#vid-mod-4');
  check(!(await shown('#btn-vid-apply')) && !(await text('#vid-results')), 'desmarcar um módulo apaga a prévia e o "Aplicar"');
  await panel.click('#vid-mod-4');
  await panel.click('#btn-vid-toggle-all');
  check((await panel.evaluate(() => [...document.querySelectorAll('#vid-modules-list input')].filter(c => c.checked).length)) === 0, '"desmarcar todos"');
  await panel.click('#btn-vid-preview');
  check(/Marque ao menos um módulo/.test(await waitText('#vid-status', /Marque/)), 'sem módulo marcado: avisa');
  await panel.click('#btn-vid-toggle-all');
  check((await panel.evaluate(() => [...document.querySelectorAll('#vid-modules-list input')].filter(c => c.checked).length)) === 3, '"marcar todos" (os 3 com páginas)');

  // Aba trocada para outro curso: a prévia não roda.
  await setTab(`${HOST}/courses/282999/pages/x`);
  await panel.click('#btn-vid-preview');
  check(/A aba ativa é do curso #282999/.test(await waitText('#vid-status', /aba ativa/)), 'aba de outro curso: prévia bloqueada');
  await setTab(TAB);

  await panel.click('#btn-vid-preview');
  await waitText('#vid-results', /Prévia/);

  // Depois da prévia: alguém salva a Página 1 (parágrafo novo) e outra
  // pessoa já ajusta o Vimeo da Tópico 2 – Página 2.
  pages['topico-1-pagina-1'].body += '\n<p>Par&aacute;grafo salvo depois da pr&eacute;via.</p>';
  pages['topico-2-pagina-2'].body = `<p>${VIMEO(620, 398)}</p>`;

  // ── Confirmação pelo número do curso ─────────────────────────────────
  console.log('Confirmação');
  await panel.click('#btn-vid-apply');
  check(await shown('#modal-vid-confirm'), 'abre a confirmação');
  if (process.env.OUT_DIR) await panel.screenshot({ path: path.join(process.env.OUT_DIR, 'video-batch-confirmacao.png') });
  check(await text('#vid-confirm-sub') === '13 vídeo(s) em 3 página(s) vão para 620×398. Grava direto no Canvas.', 'texto: ' + await text('#vid-confirm-sub'));
  await panel.fill('#vid-confirm-course', '282083');
  await panel.click('#btn-vid-confirm-ok');
  let al = await waitText('#vid-confirm-alert', /⚠/);
  check(/O número digitado \(282083\) não é o do curso da aba aberta/.test(al) && await shown('#modal-vid-confirm'), 'número errado: alerta e continua aberto — ' + al);
  await panel.fill('#vid-confirm-course', 'abc');
  await panel.click('#btn-vid-confirm-ok');
  check(/só os algarismos/.test(await waitText('#vid-confirm-alert', /algarismos/)), 'texto que não é número: alerta');
  await setTab(`${HOST}/courses/282999/pages/x`);
  await panel.fill('#vid-confirm-course', '282999');
  await panel.click('#btn-vid-confirm-ok');
  check(/outro curso, não do curso da prévia \(#282082\)/.test(await waitText('#vid-confirm-alert', /outro curso/)), 'número da aba, mas a aba mudou de curso depois da prévia: alerta');
  await setTab(TAB);
  check(puts.length === 0, 'nada gravado com número errado');
  await panel.keyboard.press('Escape');
  check(!(await shown('#modal-vid-confirm')) && puts.length === 0, 'Esc cancela');

  await panel.click('#btn-vid-apply');
  check(await panel.inputValue('#vid-confirm-course') === '' && !(await shown('#vid-confirm-alert')), 'reabre limpo');
  await panel.fill('#vid-confirm-course', COURSE);
  await panel.press('#vid-confirm-course', 'Enter');

  // ── Aplicar ──────────────────────────────────────────────────────────
  console.log('Aplicar');
  head = await waitText('#vid-results > div:first-child', /^(✅|Nada foi alterado)/, 20000);
  check(head.startsWith('✅ 12 vídeo(s) gravado(s) em 620×398, em 2 página(s). 1 página(s) sem nada a mudar.'), 'resumo: ' + head.split('\n')[0]);
  rows = await rowsInfo();
  check(puts.length === 2 && puts.every(p => p.csrf === 'tok+1'), `2 páginas gravadas, com o CSRF da sessão (${puts.map(p => p.slug).join(', ')})`);
  const p1 = pages['topico-1-pagina-1'].body;
  check(p1 === P1_AFTER + '\n<p>Par&aacute;grafo salvo depois da pr&eacute;via.</p>', 'Página 1: só os 2 vídeos mudaram, byte a byte, e o parágrafo salvo depois da prévia ficou');
  check(pages['topico-3-pagina-1'].body === P4(true), 'Tópico 3: os 10 vídeos em 620×398, resto igual');
  check(by('Tópico 2 – Página 2').cls === 'zero' && /já estavam em 620×398/.test(by('Tópico 2 – Página 2').note), 'página ajustada por outra pessoa depois da prévia: nada gravado');
  check(!puts.some(p => ['topico-1-pagina-2', 'topico-2-pagina-1'].includes(p.slug)), 'páginas sem nada a mudar não são gravadas');
  check(!(await shown('#btn-vid-apply')), '"Aplicar" some depois de gravar');

  // ── De novo: nada a mudar ────────────────────────────────────────────
  console.log('Segunda prévia');
  await panel.click('#btn-vid-preview');
  head = await waitText('#vid-results', /Prévia/);
  check(head.startsWith('Prévia — nenhum vídeo para mudar.'), 'resumo: ' + head.split('\n')[0]);
  check(!(await shown('#btn-vid-apply')), 'sem "Aplicar"');

  // ── Tamanho mudou nas Configurações depois da prévia ────────────────
  console.log('Configurações mudaram');
  await panel.evaluate(() => { S.video_width = 640; S.video_height = 360; });
  await panel.click('#btn-vid-preview');
  head = await waitText('#vid-results', /Prévia/);
  check(/vão para 640×360/.test(head), 'prévia usa o tamanho das Configurações: ' + head.split('\n')[0]);
  await panel.evaluate(() => { S.video_width = 620; S.video_height = 398; });
  const before = puts.length;
  await panel.click('#btn-vid-apply');
  check(/tamanho das Configurações mudou/.test(await waitText('#vid-status', /Configurações/)) && !(await shown('#modal-vid-confirm')) && puts.length === before,
    'tamanho trocado depois da prévia: pede outra prévia, sem gravar');

  await browser.close();
  console.log(failures ? `\n${failures} FALHA(S)` : '\nTUDO OK');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
