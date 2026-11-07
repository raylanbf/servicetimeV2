// Simulação do botão "Importar quiz H5P" (Fase 2): página de edição do Canvas
// com TinyMCE 6 real (plugin media), menu da tomadinha, popup do H5P.com falso
// que navega a cada busca (seções My/All Content) e chrome.storage simulado e
// compartilhado entre os frames. Os scripts reais do repositório são injetados
// como o manifest faria. Rodar com o playwright-core instalado numa pasta
// qualquer (ex.: o scratchpad):
//   NODE_PATH=<pasta>/node_modules node .claude/skills/h5p-quiz/scripts/test-quiz.js
// Usa o Chrome do sistema (CHROME_PATH) e o TinyMCE do cdnjs — precisa de rede.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '../../../..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SRC = {
  width: read('h5p-width.js'), justify: read('canvas-justify.js'), button: read('canvas-h5p.js'),
  bridge: read('canvas-h5p-bridge.js'), search: read('h5p-search.js'),
};

const FAKE_CHROME = `
if (!window.chrome || !window.chrome.storage) {
  window.chrome = window.chrome || {};
  window.chrome.storage = {
    local: {
      get: k => window.__st('get', k === undefined ? null : k),
      set: o => window.__st('set', o),
      remove: k => window.__st('remove', k),
    },
    onChanged: { addListener: fn => (window.__stL = window.__stL || []).push(fn) },
  };
  window.__stFire = ch => (window.__stL || []).forEach(fn => fn(ch, 'local'));
}`;

const T = 'Razões, proporções e percentuais em cenários financeiros elementares';
const iframeOf = (id, w = 800) =>
  `<iframe class="lti-embed" style="width: ${w}px; height: 600px;" title="" src="https://pucminas.instructure.com/courses/282082/external_tools/retrieve?display=borderless&amp;url=https%3A%2F%2Fpucminasvirtual.h5p.com%2Fcontent%2F${id}" width="${w}" height="600" allowfullscreen="allowfullscreen"></iframe>`;
const OLD_BOX = `<p style="text-align: center;">${iframeOf('1292991947646133608', '100%').replace('width: 100%px', 'width: 100%')}</p>`;

function pageHtml({ box, band = true, ids = true, extra = '' }) {
  return `<p>Texto do tópico.</p><p>&nbsp;</p>${extra}
<div id="conteudo" class="content-box" style="background-color: #f7f7f7;"><h5>Refer&ecirc;ncias</h5><ul><li>SOBRENOME, Nome.</li></ul></div>
${band ? `<div ${ids ? 'id="questao-fixacao-banner" ' : ''}style="background: #155382; text-align: center;"><span style="color: #ffffff;">&nbsp;Atividade de Fixa&ccedil;&atilde;o N&atilde;o Pontuada - Ao concluir este t&oacute;pico, responda &agrave; quest&atilde;o:&nbsp;</span></div>` : ''}
<div ${ids ? 'id="questao-fixacao-atividade" ' : ''}style="background-color: #ffffff; padding: 1.5% 2.5%;">${box}</div>
<p style="text-align: right;"><strong>&gt;&gt; Quando se sentir pronto(a), avance para o pr&oacute;ximo t&oacute;pico.</strong></p>`;
}

const CANVAS = `<!DOCTYPE html><html><head><title>Editar Tópico 5</title></head><body style="font-family:sans-serif">
<label>Título da página * <input id="wikipage-title-input" data-testid="wikipage-title-input" name="title" type="text" style="width:600px"></label>
<textarea id="wiki_page_body"></textarea>
<script src="https://cdnjs.cloudflare.com/ajax/libs/tinymce/6.8.3/tinymce.min.js"></script>
<script>
  window.openH5pDialog = () => {
    const d = document.createElement('span');
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-label', 'Incorporar conteúdo da ferramenta externa');
    d.innerHTML = '<h2>Interactive Content – H5P</h2><button id="close-dialog">×</button>' +
      '<iframe id="external_tool_button_frame" name="external_tool_launch" class="tool_launch" title="Incorporar conteúdo da ferramenta externa" style="width:900px;height:500px" src="https://pucminasvirtual.h5p.com/lti/ctx1/content"></iframe>';
    Object.assign(d.style, { position: 'fixed', top: '40px', left: '40px', background: '#fff', border: '1px solid #000', zIndex: 10 });
    document.body.appendChild(d);
    d.querySelector('#close-dialog').onclick = () => d.remove();
  };
  // Deep linking do LTI: o Canvas insere onde o cursor está e fecha o popup.
  window.addEventListener('message', e => {
    if (!e.data || e.data.type !== 'deeplink') return;
    const ed = tinymce.activeEditor;
    if (window.__insertElsewhere) {
      const p = ed.getBody().querySelector('p');
      const r = ed.dom.createRng(); r.setStart(p.firstChild, 0); r.collapse(true); ed.selection.setRng(r);
    }
    ed.insertContent(window.__iframeOf(e.data.id));
    document.querySelector('[role="dialog"]')?.remove();
  });
  tinymce.init({
    selector: '#wiki_page_body', plugins: 'media', height: 600, menubar: false, promotion: false, license_key: 'gpl',
    toolbar: 'bold italic | appstemp', extended_valid_elements: 'iframe[*]',
    setup: ed => ed.ui.registry.addMenuButton('appstemp', {
      text: 'Apps', tooltip: 'apps-temp',
      fetch: cb => cb([
        { type: 'menuitem', text: 'Interactive Content – H5P', onAction: () => window.openH5pDialog() },
        { type: 'menuitem', text: 'Studio', onAction: () => {} },
      ]),
    }),
    init_instance_callback: () => { window.__ready = true; },
  });
</script></body></html>`;

// ── Popup do H5P.com ───────────────────────────────────────────────────
const h5p = { section: 'all', quizzes: [], searches: [] };
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
function h5pPage(url) {
  const u = new URL(url);
  // Como no H5P.com: a seção vem de content_scope (mine | shared | all).
  const sc = u.searchParams.get('content_scope');
  if (sc) h5p.section = sc === 'mine' ? 'my' : sc;
  const q = u.searchParams.get('search');
  const visible = h5p.quizzes.filter(z => h5p.section !== 'my' || z.mine);
  let rows;
  if (q !== null) {
    h5p.searches.push({ q, section: h5p.section });
    rows = visible.filter(z => z.title.toLowerCase().includes(q.toLowerCase()));   // diferencia hífen de travessão
  }
  const label = h5p.section === 'my' ? 'My Content' : 'All Content';
  const body = rows
    ? `<h1 id="content-page-title" class="hidden-but-read">Search results</h1><div class="list-title">Showing results (${rows.length})</div>
       <table class="table table-borderless fable"><tbody>${rows.map(z => `
        <tr class="browser-row fable-row content-item"><td><input type="checkbox" class="fable-toggle-row" id="content-${z.id}" name="content[]" aria-label="${esc(z.title)}"></td>
        <td><a class="fable-title browser-row-link" href="/lti/ctx1/content/${z.id}">${esc(z.title.slice(0, 50))}</a></td>
        <td class="moves-to-bulk-menu"><button class="btn btn-medium btn-green" type="button" title="Select this content" data-insert="${z.id}">Insert</button><button class="more-options" type="button" title="More Options">…</button></td></tr>`).join('')}</tbody></table>`
    : `<table class="table table-borderless fable"><tbody><tr class="browser-row fable-row"><td><a class="fable-title" href="#">teste</a> Private folder</td></tr></tbody></table>`;
  return `<!DOCTYPE html><html><head><title>${rows ? 'Search results' : label} - H5P.com</title></head><body>
<nav><ul class="secondary-menu"><li class="transition"><a href="/lti/ctx1/content?content_scope=mine">My Content</a></li><li class="transition"><a href="/lti/ctx1/content?content_scope=shared">Shared with me</a></li><li class="transition"><a href="/lti/ctx1/content?content_scope=all">All Content</a></li></ul>
<div class="dropdown show-on-mobile"><button class="btn btn-square" id="dropdown-content-section-mobile">${label}</button></div></nav>
<div class="search-bar content"><form class="prevent-double-submission append-filters" role="search" method="get" action="/lti/ctx1/content">
<div class="input-group search-bar-input-group"><input class="form-control" name="search" type="search" placeholder="Search content" aria-label="Search content" value="${esc(q || '')}"><button class="btn btn-grey" type="submit" title="Search">🔍</button></div>
<div class="search-filters-dialog" style="display:none"><input type="radio" id="content_all" name="content_scope" value="all" checked><input type="radio" id="content_shared" name="content_scope" value="shared"><input type="hidden" name="scope" value="all"></div></form></div>
${body}
<script>document.querySelectorAll('[data-insert]').forEach(b => b.onclick = () => parent.postMessage({ type: 'deeplink', id: b.dataset.insert }, '*'));</script>
</body></html>`;
}
// Quiz já inserido na página (nível 2): também tem um campo "search", para
// provar que o script não age fora do popup.
const QUIZ = `<!DOCTYPE html><html><head><title>- H5P.com</title></head><body><input name="search"><p>No question text provided</p></body></html>`;
const RETRIEVE = u => `<!DOCTYPE html><html><body style="margin:0"><iframe style="width:100%;height:580px;border:0" src="https://pucminasvirtual.h5p.com/lti/4282629/content/${decodeURIComponent(new URL(u).searchParams.get('url')).split('/').pop()}"></iframe></body></html>`;

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ✔ ' : '  ✘ ') + msg); if (!cond) failures++; };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  page.on('pageerror', e => { console.log('[pageerror]', e.message); failures++; });

  const store = {};
  await page.exposeBinding('__st', async (_src, op, arg) => {
    if (op === 'get') {
      if (arg == null) return { ...store };
      const keys = typeof arg === 'string' ? [arg] : Array.isArray(arg) ? arg : Object.keys(arg);
      const out = {};
      for (const k of keys) if (k in store) out[k] = store[k];
      return out;
    }
    const changes = {};
    if (op === 'set') for (const [k, v] of Object.entries(arg)) { changes[k] = { oldValue: store[k], newValue: v }; store[k] = v; }
    if (op === 'remove') for (const k of [].concat(arg)) if (k in store) { changes[k] = { oldValue: store[k] }; delete store[k]; }
    for (const f of page.frames()) f.evaluate(ch => window.__stFire && window.__stFire(ch), changes).catch(() => {});
  });

  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('cdnjs.cloudflare.com')) return route.continue();
    const html = url.includes('/lti/ctx1/') ? h5pPage(url)
      : url.includes('/lti/4282629/') ? QUIZ
      : url.includes('/external_tools/retrieve') ? RETRIEVE(url)
      : url.includes('/pages/') ? CANVAS : '';
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });

  // Content script do h5p.com (all_frames): entra a cada documento novo.
  const inject = f => f.waitForLoadState('domcontentloaded')
    .then(() => f.addScriptTag({ content: FAKE_CHROME + '\n' + SRC.search })).catch(() => {});
  page.on('framenavigated', f => { if (f.url().includes('h5p.com/lti/')) inject(f); });

  await page.goto('https://pucminas.instructure.com/courses/282082/pages/topico-5/edit');
  await page.waitForFunction(() => window.__ready, null, { timeout: 30000 });
  await page.evaluate(src => { window.__iframeOf = new Function('id', src); },
    `return '${iframeOf('ID').replace(/'/g, "\\'")}'.replace('ID', id);`);
  for (const s of [FAKE_CHROME, SRC.bridge, SRC.width, SRC.justify, SRC.button]) await page.addScriptTag({ content: s });
  await page.waitForSelector('.__svc-h5p-btn__', { timeout: 5000 });

  const MINE = [
    { id: '111', title: `Tópico 5 - ${T}`, mine: true },          // hífen
    { id: '222', title: `Tópico 5 – ${T} Ray`, mine: true },
    { id: '444', title: 'Tópico 1 – Conjuntos numéricos', mine: true },
  ];
  const OTHER = { id: '333', title: `Tópico 5 – ${T}`, mine: false };   // de outra pessoa, nome idêntico

  async function setup({ title, html, quizzes = [...MINE, OTHER], section = 'all', elsewhere = false }) {
    Object.assign(h5p, { section, quizzes, searches: [] });
    for (const k of Object.keys(store)) delete store[k];
    await page.evaluate(([html, title, elsewhere]) => {
      document.getElementById('__svc-toast__')?.remove();
      document.querySelector('#wikipage-title-input').value = title;
      window.__insertElsewhere = elsewhere;
      const ed = tinymce.activeEditor;
      ed.setContent(html); ed.undoManager.clear(); ed.undoManager.add(); ed.setDirty(false);
    }, [html, title, elsewhere]);
    await page.waitForTimeout(600);
    return page.evaluate(() => tinymce.activeEditor.getContent());
  }
  const toastText = () => page.evaluate(() => document.getElementById('__svc-toast__')?.textContent || '');
  async function waitToast(re, ms = 20000) {
    const start = Date.now();
    while (Date.now() - start < ms) { const t = await toastText(); if (re.test(t)) return t; await page.waitForTimeout(150); }
    return await toastText();
  }
  const boxInfo = () => page.evaluate(() => {
    const doc = new DOMParser().parseFromString(tinymce.activeEditor.getContent(), 'text/html');
    const band = [...doc.querySelectorAll('div')].find(d => /Atividade de Fixa/.test(d.textContent) && !d.querySelector('div'));
    const box = band?.nextElementSibling;
    return {
      html: box?.innerHTML || '',
      frames: [...(box?.querySelectorAll('iframe') || [])].map(f => ({
        id: decodeURIComponent(f.getAttribute('src')).split('/').pop(), width: f.getAttribute('width'),
        sw: f.style.width, sh: f.style.height, title: f.getAttribute('title'), inP: f.parentElement.tagName,
      })),
      total: doc.querySelectorAll('iframe').length,
      text: box?.textContent.trim(),
    };
  });
  const outsideBox = html => html.replace(/(Pontuada[\s\S]*?<\/div>\s*<div[^>]*>)[\s\S]*?(<\/div>\s*<p style="text-align: right;")/, '$1…$2');
  const confirmText = () => page.evaluate(() => document.getElementById('__svc-h5p-confirm__')?.textContent || null);
  const answer = yes => page.click(`#__svc-h5p-confirm__ button:has-text("${yes ? 'Sim' : 'Não'}")`);

  // ── Barra ────────────────────────────────────────────────────────────
  console.log('Barra do editor');
  check(await page.evaluate(() => {
    const b = document.querySelector('.__svc-h5p-btn__'), j = document.querySelector('.__svc-justify-btn__');
    return !!b && !!j && b.parentElement === j.parentElement && j.nextElementSibling === b;
  }), 'botão H5P logo depois do Justificar, no mesmo grupo');

  // ── A: troca, My Content, hífen x travessão ─────────────────────────
  console.log('A · caixa com H5P antigo, popup em All Content, quiz com hífen, carrossel H5P no corpo');
  {
    // O carrossel do corpo do tópico também é H5P: não pode ir para 100%.
    const carousel = `<p style="text-align: center;">${iframeOf('999', 700)}</p>`;
    const original = await setup({ title: `Tópico 5 – ${T}`, html: pageHtml({ box: OLD_BOX, extra: carousel }) });
    await page.click('.__svc-h5p-btn__');
    const c = await confirmText();
    check(/Quer importar o H5P para a página\?/.test(c || ''), 'pergunta antes de fazer qualquer coisa');
    check(/será substituído/.test(c || ''), 'avisa que o H5P da caixa vai ser trocado');
    check(!store.h5pPending, 'nada pedido antes do Sim');
    await answer(true);
    await page.waitForTimeout(400);
    // Um quiz já inserido na página recebe o script de novo com o pedido no ar.
    for (const f of page.frames().filter(f => f.url().includes('/lti/4282629/'))) await inject(f);
    const t = await waitToast(/✓ Quiz|⚠/);
    check(/✓ Quiz "Tópico 5 - Razões/.test(t) && /substituí/.test(t), 'aviso: ' + t);
    const b = await boxInfo();
    check(b.frames.length === 1 && b.frames[0].id === '111', 'caixa só com o quiz 111 (o seu, de hífen) — ' + JSON.stringify(b.frames));
    check(b.frames[0]?.sw === '100%' && b.frames[0]?.width === '100%' && b.frames[0]?.sh === '600px', '100% de largura, altura mantida');
    check(b.frames[0]?.title === `Tópico 5 - ${T}`, 'title do iframe = nome do quiz');
    check(b.frames[0]?.inP === 'P' && /text-align: center/.test(b.html), 'dentro do parágrafo centralizado');
    check(h5p.section === 'my', 'popup passou para My Content');
    check(h5p.searches.length === 1 && h5p.searches[0].q === T && h5p.searches[0].section === 'my', 'buscou só o texto depois do traço, em My Content — ' + JSON.stringify(h5p.searches));
    check(!store.h5pPending, 'pedido consumido');
    check(await page.evaluate(() => [...document.querySelectorAll('iframe')].length) >= 1 && !(await page.$('[role="dialog"]')), 'popup fechado');
    const after = await page.evaluate(() => tinymce.activeEditor.getContent());
    check(outsideBox(after) === outsideBox(original), 'fora da caixa, nada mudou');
    const car = await page.evaluate(html => {
      const f = [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('iframe')].find(x => x.src.includes('content%2F999'));
      return f && { width: f.getAttribute('width'), sw: f.style.width };
    }, after);
    check(car?.width === '700' && car?.sw === '700px', 'carrossel H5P do corpo continua com 700px — ' + JSON.stringify(car));
    check(await page.evaluate(() => tinymce.activeEditor.isDirty()), 'página marcada como alterada (não salva sozinha)');
    await page.evaluate(() => { tinymce.activeEditor.undoManager.undo(); tinymce.activeEditor.undoManager.undo(); });
    check(await page.evaluate(() => tinymce.activeEditor.getContent()) === original, 'dois Ctrl+Z voltam ao original (a troca e a inserção do Canvas)');
  }

  // ── B: Não ───────────────────────────────────────────────────────────
  console.log('B · resposta Não');
  {
    const original = await setup({ title: `Tópico 5 – ${T}`, html: pageHtml({ box: OLD_BOX }) });
    await page.click('.__svc-h5p-btn__');
    await answer(false);
    await page.waitForTimeout(800);
    check(!(await confirmText()) && !(await page.$('[role="dialog"]')), 'nada abre');
    check(!store.h5pPending && h5p.searches.length === 0, 'nenhum pedido, nenhuma busca');
    check(await page.evaluate(() => tinymce.activeEditor.getContent()) === original, 'página intacta');
    await page.click('.__svc-h5p-btn__');
    await page.keyboard.press('Escape');
    check(!(await confirmText()) && !store.h5pPending, 'Esc também cancela');
    await page.click('.__svc-h5p-btn__');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    check(!(await confirmText()) && !store.h5pPending, 'Enter cai no "Não" (foco padrão)');
  }

  // ── C: nenhum quiz ───────────────────────────────────────────────────
  console.log('C · nenhum quiz com o nome');
  {
    const original = await setup({ title: 'Tópico 9 – Assunto que não existe', html: pageHtml({ box: OLD_BOX }), section: 'my' });
    await page.click('.__svc-h5p-btn__'); await answer(true);
    const t = await waitToast(/⚠ Nenhum/);
    check(/Nenhum quiz seu \(My Content\) com o nome "Tópico 9/.test(t), 'aviso: ' + t);
    check(!store.h5pPending, 'pedido encerrado');
    check(!!(await page.$('[role="dialog"]')), 'popup continua aberto para escolher à mão');
    await page.click('#close-dialog');
    const t2 = await waitToast(/fechado sem inserir/, 6000);
    check(/nada foi alterado/.test(t2), 'fechar o popup: ' + t2);
    check(await page.evaluate(() => tinymce.activeEditor.getContent()) === original, 'página intacta');
  }

  // ── D: dois quizzes com o mesmo nome ─────────────────────────────────
  console.log('D · dois quizzes seus com o mesmo nome');
  {
    const twins = [...MINE, { id: '555', title: `Tópico 5 – ${T}`, mine: true }];
    const original = await setup({ title: `Tópico 5 – ${T}`, html: pageHtml({ box: OLD_BOX }), quizzes: twins, section: 'my' });
    await page.click('.__svc-h5p-btn__'); await answer(true);
    const t = await waitToast(/⚠ \d+ quizzes/);
    check(/⚠ 2 quizzes seus/.test(t), 'aviso: ' + t);
    const popup = page.frames().find(f => f.url().includes('/lti/ctx1/'));
    const marked = await popup.evaluate(() => [...document.querySelectorAll('tr.content-item')].filter(tr => tr.style.outline).length);
    check(marked === 2, `os 2 marcados em laranja no popup (${marked})`);
    check(await page.evaluate(() => tinymce.activeEditor.getContent()) === original, 'nada inserido sozinho');
    // A pessoa escolhe um à mão: o botão ainda arruma o quiz na caixa.
    await popup.click('button[data-insert="555"]');
    const t2 = await waitToast(/✓ Quiz/);
    const b = await boxInfo();
    check(b.frames.length === 1 && b.frames[0].id === '555' && b.frames[0].sw === '100%', 'escolha manual vai para a caixa, no lugar do antigo — ' + t2);
  }

  // ── E/F: caixa com outro conteúdo / sem faixa ────────────────────────
  console.log('E · caixa com outro conteúdo');
  {
    await setup({ title: `Tópico 5 – ${T}`, html: pageHtml({ box: '<p>Texto que alguém pôs aqui</p>' }) });
    await page.click('.__svc-h5p-btn__');
    const t = await waitToast(/⚠/, 3000);
    check(/outro conteúdo além do H5P/.test(t) && !(await confirmText()), 'para antes de perguntar: ' + t);
  }
  console.log('F · página sem a faixa');
  {
    await setup({ title: `Tópico 5 – ${T}`, html: pageHtml({ box: OLD_BOX, band: false }) });
    await page.click('.__svc-h5p-btn__');
    const t = await waitToast(/⚠/, 3000);
    check(/Não achei a faixa/.test(t) && !(await confirmText()), 'aviso: ' + t);
  }

  // ── G: Insert cai fora da caixa ──────────────────────────────────────
  console.log('G · o Canvas insere fora da caixa (caixa vazia)');
  {
    const original = await setup({ title: `Tópico 5 – ${T}`, html: pageHtml({ box: '<p style="text-align: center;">&nbsp;</p>' }), section: 'my', elsewhere: true });
    await page.click('.__svc-h5p-btn__');
    check(!/substituído/.test(await confirmText() || ''), 'caixa vazia: sem aviso de troca');
    await answer(true);
    const t = await waitToast(/✓ Quiz|⚠/);
    const b = await boxInfo();
    check(b.frames.length === 1 && b.frames[0].id === '111' && b.total === 1, 'quiz movido para a caixa, nenhum fora — ' + t);
    const after = await page.evaluate(() => tinymce.activeEditor.getContent());
    check(outsideBox(after) === outsideBox(original), 'o parágrafo onde caiu ficou como era');
  }

  // ── H: página da AVA, sem ids, com o marcador ────────────────────────
  console.log('H · página da AVA (sem ids, com o marcador)');
  {
    await setup({ title: `Tópico 5 – ${T}`, html: pageHtml({ ids: false, box: '<p style="text-align: center;">[iframe - Atividade de Fixa&ccedil;&atilde;o H5P]</p>' }), section: 'my' });
    await page.click('.__svc-h5p-btn__'); await answer(true);
    const t = await waitToast(/✓ Quiz|⚠/);
    const b = await boxInfo();
    check(b.frames.length === 1 && b.frames[0].id === '111' && !/iframe -/.test(b.text), 'marcador trocado pelo quiz — ' + t);
  }

  await browser.close();
  console.log(failures ? `\n${failures} FALHA(S)` : '\nTUDO OK');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
