// Regressão do manifest: carrega a extensão de verdade (não injeta arquivos à
// mão, como os outros testes) e confere, em páginas falsas do Canvas, o que
// existe em cada mundo. Pega o caso de 20/11/2026: o Chrome injeta cada
// arquivo uma vez só por página, mesmo listado em duas entradas de mundos
// diferentes. Com o h5p-width.js na entrada ISOLATED da Pasta H5P e na
// MAIN do botão, valendo para as mesmas páginas, o mundo MAIN ficava sem o
// __svcH5pWidth e o botão H5P do editor parava em "reading 'quizBox'".
//
// Precisa de um Chromium que aceite --load-extension (o Chrome comum não
// aceita mais): o do Playwright (npx playwright install chromium) ou
// CHROMIUM_PATH. Rodar com o playwright-core instalado numa pasta qualquer:
//   NODE_PATH=<pasta>/node_modules node .claude/skills/h5p-quiz/scripts/test-manifest.js
const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../..');
const EXT_NAME = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).name;

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), 'ms-playwright');
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) {
    for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const p = path.join(base, d, sub);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('Não achei o Chromium do Playwright: rode "npx playwright install chromium" ou defina CHROMIUM_PATH.');
}

const PAGE = `<!doctype html><html><head><title>Canvas falso</title></head><body>
  <div class="header-bar"><a class="add_module_link" href="#">+ Módulo</a></div>
  <div class="tox-tinymce"><div class="tox-toolbar__primary"></div></div>
</body></html>`;

// O que cada mundo da página tem. O isolado é o da extensão, lido pelo CDP
// (o Playwright só avalia no mundo da página).
async function worlds(ctx, url) {
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(page);
  const contexts = [];
  cdp.on('Runtime.executionContextCreated', e => contexts.push(e.context));
  await cdp.send('Runtime.enable');   // anuncia os contextos que já existem
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const iso = contexts.find(c => c.auxData?.frameId === frameTree.frame.id && c.auxData?.type === 'isolated' && c.name === EXT_NAME);
  const probe = `({
    width:  typeof window.__svcH5pWidth?.quizBox,
    button: window.__svcH5pBtnInstalled === true,
    bridge: window.__svcH5pBridge === true,
    insert: typeof window.__svcH5pInsert?.plan,
    folder: window.__svcH5pFolder === true,
    marks:  typeof window.__svcH5pMarks?.refresh,
  })`;
  const main = await page.evaluate(probe);
  const isolated = iso ? (await cdp.send('Runtime.evaluate', { expression: probe, contextId: iso.id, returnByValue: true })).result.value : null;
  await page.close();
  return { main, isolated };
}

let fails = 0;
function check(ok, label) {
  console.log(`${ok ? '  ok  ' : '  FALHOU'} ${label}`);
  if (!ok) fails++;
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-manifest-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: findChromium(),
    headless: true,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });
  try {
    await ctx.route('https://pucminas.instructure.com/**', r =>
      r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE }));

    console.log('Edição de página (botão H5P do editor):');
    const ed = await worlds(ctx, 'https://pucminas.instructure.com/courses/282082/pages/topico-1/edit');
    check(ed.main.width === 'function', 'MAIN tem o __svcH5pWidth.quizBox (h5p-width.js)');
    check(ed.main.button, 'MAIN tem o botão (canvas-h5p.js)');
    check(!!ed.isolated, 'achei o mundo isolado da extensão');
    check(ed.isolated?.bridge === true, 'ISOLATED tem a ponte (canvas-h5p-bridge.js)');

    console.log('Página de módulos (📁 Pasta H5P):');
    const mo = await worlds(ctx, 'https://pucminas.instructure.com/courses/282082/modules');
    check(!!mo.isolated, 'achei o mundo isolado da extensão');
    check(mo.isolated?.width === 'function', 'ISOLATED tem o __svcH5pWidth.quizBox (h5p-width.js)');
    check(mo.isolated?.insert === 'function', 'ISOLATED tem o __svcH5pInsert (h5p-insert.js)');
    check(mo.isolated?.folder === true, 'ISOLATED tem a Pasta H5P (canvas-h5p-folder.js)');
    check(mo.isolated?.marks === 'function', 'ISOLATED tem o selo H5P dos módulos (canvas-h5p-marks.js)');
    check(ed.isolated?.marks === 'undefined' && ed.main.marks === 'undefined', 'edição de página não tem o selo H5P dos módulos');
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
