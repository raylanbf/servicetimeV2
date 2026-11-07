// Teste do editor de capa de vídeo (thumb.html): abre a página real com um
// chrome.storage falso, com o título do exemplo dos templates, e confere a
// quebra das linhas, o tamanho da letra, a troca de template (lembrada entre
// aberturas), o ajuste de texto longo, o Enter, o limpar, o nome do arquivo e o
// PNG baixado. Com OUT_DIR, salva as capas geradas para conferir a olho.
//   NODE_PATH=<pasta>/node_modules [OUT_DIR=<pasta>] node .claude/skills/h5p-quiz/scripts/test-thumb.js
// Usa o Chrome do sistema (CHROME_PATH). Não precisa de rede.
const { chromium } = require('playwright-core');
const fs   = require('fs');
const path = require('path');

const ROOT   = path.resolve(__dirname, '../../../..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT    = process.env.OUT_DIR || '';
const TITLE  = 'Compliance de Fachada ou Cultura Real? Desvendando os Níveis de Maturidade Organizacional';

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ✔ ' : '  ✘ ') + msg); if (!cond) failures++; };
const pngSize = buf => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), png: buf.slice(1, 4).toString() === 'PNG' });

(async () => {
  const store = {};
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://ext.test' });
  await context.route('https://ext.test/**', route => {
    const f = path.join(ROOT, decodeURIComponent(new URL(route.request().url()).pathname.slice(1)));
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf' }[path.extname(f)] || 'application/octet-stream';
    return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(f) });
  });
  await context.exposeBinding('__st', (_s, op, arg) => {
    if (op === 'set') { Object.assign(store, arg); return null; }
    const keys = typeof arg === 'string' ? [arg] : Array.isArray(arg) ? arg : Object.keys(arg || {});
    const out = {};
    for (const k of keys) if (k in store) out[k] = store[k];
    return out;
  });
  await context.addInitScript(() => {
    Object.defineProperty(window, 'chrome', {
      configurable: true, writable: true,
      value: { storage: { local: { get: k => window.__st('get', k), set: o => window.__st('set', o) } } },
    });
  });

  const page = await context.newPage();
  page.on('pageerror', e => { console.log('[pageerror]', e.message); failures++; });
  const open = async text => {
    await page.goto('https://ext.test/thumb.html' + (text != null ? '?text=' + encodeURIComponent(text) : ''));
    await page.waitForFunction(() => window.__thumbReady, null, { timeout: 15000 });
  };
  const state = () => page.evaluate(() => window.__thumbState);
  const type  = async text => { await page.fill('#thumb-text', text); };
  async function save(name) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-thumb-download')]);
    const file = await dl.path();
    const buf  = fs.readFileSync(file);
    if (OUT) fs.copyFileSync(file, path.join(OUT, name));
    return { name: dl.suggestedFilename(), size: pngSize(buf) };
  }

  // ── Abre com o texto selecionado ─────────────────────────────────────
  console.log('Abrir com o texto selecionado');
  await open('  Compliance de Fachada ou Cultura\nReal? Desvendando os Níveis   de Maturidade Organizacional ');
  check(await page.inputValue('#thumb-text') === TITLE, 'texto da seleção numa linha só, sem espaços sobrando');
  check(await page.evaluate(() => document.fonts.check('700 100px "Alegreya Sans"')), 'fonte Alegreya Sans carregada');
  let s = await state();
  check(s.template === 'puc-azul', 'template padrão: azul');
  check(JSON.stringify(s.lines) === JSON.stringify(['Compliance de Fachada ou Cultura', 'Real? Desvendando os Níveis de', 'Maturidade Organizacional']),
    'mesmas 3 linhas do exemplo: ' + JSON.stringify(s.lines));
  check(s.size >= 100 && s.size <= 106 && s.fits, `letra perto da do exemplo (${s.size}px)`);
  check(/Letra: \d+ px · 3 linha/.test(await page.textContent('#thumb-size')), 'mostra o tamanho da letra');
  let d = await save('capa-azul.png');
  check(d.size.png && d.size.w === 1920 && d.size.h === 1080, 'PNG 1920×1080');
  check(d.name === 'Compliance de Fachada ou Cultura Real Desvendando os Níveis de Maturidade Organizacional.png', 'nome do arquivo sem "?": ' + d.name);
  if (OUT) await page.screenshot({ path: path.join(OUT, 'thumb-editor.png') });

  // ── Templates ────────────────────────────────────────────────────────
  console.log('Templates');
  check(await page.locator('.th-tpl').count() === 3, '3 templates na lista');
  await page.click('.th-tpl[data-id="puc-geometrico"]');
  s = await state();
  check(s.template === 'puc-geometrico' && s.fits, `geométrico: ${s.lines.length} linha(s), ${s.size}px`);
  await save('capa-geometrico.png');
  await page.click('.th-tpl[data-id="puc-libras"]');
  s = await state();
  check(s.template === 'puc-libras' && store.thumbTemplate === 'puc-libras', 'Libras escolhido e guardado');
  await save('capa-libras.png');
  await open('Outro vídeo');
  check((await state()).template === 'puc-libras', 'reabre no último template usado');

  // ── Texto ────────────────────────────────────────────────────────────
  console.log('Texto');
  s = await state();
  check(s.lines.length === 1 && s.size === 100, 'texto curto: 1 linha na letra máxima');
  await type('Linha um\nLinha dois');
  s = await state();
  check(JSON.stringify(s.lines) === '["Linha um","Linha dois"]', 'Enter força a quebra');
  await type(Array(8).fill('Governança, riscos e compliance nas organizações').join(' '));
  s = await state();
  check(s.fits && s.size < 80, `texto longo: a letra diminui (${s.size}px, ${s.lines.length} linhas) e cabe`);
  await type(Array(40).fill('Governança, riscos e compliance nas organizações').join(' '));
  s = await state();
  check(!s.fits && await page.isVisible('#thumb-warn'), 'texto grande demais: aviso para encurtar');
  await page.click('#btn-thumb-clear');
  s = await state();
  check(s.lines.length === 0 && await page.isDisabled('#btn-thumb-download') && await page.isDisabled('#btn-thumb-copy'), 'limpar: sem texto, botões desabilitados');
  await type('Introdução');
  check(!(await page.isDisabled('#btn-thumb-download')) && !(await page.isVisible('#thumb-warn')), 'digitar de novo libera os botões');

  // ── Copiar ───────────────────────────────────────────────────────────
  console.log('Copiar');
  await page.click('#btn-thumb-copy');
  await page.waitForFunction(() => document.getElementById('thumb-status').textContent, null, { timeout: 5000 });
  const st = await page.textContent('#thumb-status');
  const clip = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    return items.map(i => i.types).flat();
  }).catch(e => ['erro: ' + e.message]);
  check(/copiada/.test(st) && clip.includes('image/png'), 'imagem na área de transferência — ' + st + ' ' + JSON.stringify(clip));

  // ── Sem texto na abertura (botão do painel) ──────────────────────────
  console.log('Abrir pelo painel (sem texto)');
  await open(null);
  check(await page.inputValue('#thumb-text') === '' && await page.isDisabled('#btn-thumb-download'), 'abre vazio, esperando o texto');

  await browser.close();
  console.log(failures ? `\n${failures} FALHA(S)` : '\nTUDO OK');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
