// Mapa de elementos (popup.js › blockMapMain) num editor TinyMCE real, nas versões
// 5 e 6. Cobre o que ele absorveu dos antigos "Duplicar bloco na página" e
// "Reorganizar blocos (arrastar)" (retirados em 24/11/2026) e os defeitos achados
// na época: soltar "depois de um card" caía DENTRO do card, M digitava "m" no
// texto e ficava preso, a cópia não era achada pelo clique no editor, o painel
// ficava fora de ordem ao mover um bloco com filhos e o destaque (contorno
// verde) ia junto para o HTML salvo.
// Rodar com o playwright-core instalado numa pasta qualquer:
//   NODE_PATH=<pasta>/node_modules node .claude/skills/h5p-quiz/scripts/test-map.js
// Usa o Chrome do sistema (CHROME_PATH) e o TinyMCE do cdnjs — precisa de rede.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '../../../..');
const popup = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const ini = popup.indexOf('function blockMapMain(');
const MAP = popup.slice(ini, popup.indexOf('\n// ── Edição em escala', ini));

const CONTENT = `<div id="banner" data-k="banner" style="background: #4d4961; color: #fff; padding: 8px;"><p>Banner da página</p></div>
<div id="conteudo" class="content-box" data-k="conteudo"><p data-k="p1">Primeiro parágrafo</p><p data-k="p2">Segundo parágrafo</p><ul><li>Item A</li><li>Item B</li></ul></div>
<div id="mod1" class="card" data-k="card1" style="padding: 12px; border: 1px solid #ccc;"><h3>Card um</h3><p data-k="card1p">Texto do card um</p></div>
<div id="mod2" class="card" data-k="card2" style="padding: 12px; border: 1px solid #ccc;"><h3>Card dois</h3><p>Texto do card dois</p></div>
<p data-k="final">Parágrafo final</p>`;

const pageHtml = ver => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Editar página</title></head>
<body style="font-family: sans-serif; margin: 0 0 0 320px;">
<div style="display: flex; gap: 8px; padding: 6px 0;"><input id="titulo" style="width: 300px;"><div id="fora" style="width: 200px; height: 24px; background: #eee;">fora</div></div>
<textarea id="wiki_page_body"></textarea>
<script src="https://cdnjs.cloudflare.com/ajax/libs/tinymce/${ver}/tinymce.min.js"></script>
<script>
tinymce.init({ selector: '#wiki_page_body', height: 820, menubar: false, promotion: false, branding: false, license_key: 'gpl',
  toolbar: 'bold italic', init_instance_callback: () => { window.__ready = true; } });
</script></body></html>`;

let failures = 0;
const ok = (cond, msg, extra) => {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FALHOU  ' + msg + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
};

async function suite(browser, ver) {
  console.log(`\n── TinyMCE ${ver} ──`);
  const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', r => r.request().url().includes('cdnjs')
    ? r.continue() : r.fulfill({ contentType: 'text/html; charset=utf-8', body: pageHtml(ver) }));
  await page.goto('https://pucminas.instructure.com/courses/1/pages/topico-1/edit');
  await page.waitForFunction(() => window.__ready, null, { timeout: 30000 });
  const frame = page.frameLocator('#wiki_page_body_ifr');

  const ev = (fn, arg) => page.evaluate(fn, arg);
  const order = () => ev(() => [...tinymce.activeEditor.getBody().children].map(e => e.getAttribute('data-k') || e.tagName).join(','));
  const saved = () => ev(() => tinymce.activeEditor.getContent());
  const inSync = () => ev(() => {
    const rows = [...document.querySelectorAll('[data-map-row]')];
    if (!rows.length) return 'sem linhas';
    if (rows.some(r => !r.__el.isConnected)) return 'linha de um bloco que não existe mais';
    for (let i = 1; i < rows.length; i++)
      if (!(rows[i - 1].__el.compareDocumentPosition(rows[i].__el) & Node.DOCUMENT_POSITION_FOLLOWING)) return 'fora de ordem na linha ' + i;
    return 'ok';
  });
  const activeEl = () => ev(() => {
    const r = [...document.querySelectorAll('[data-map-row]')].find(x => x.style.background.includes('34, 197, 94'));
    return r ? (r.__el.getAttribute('data-k') || r.__el.tagName) + (r.textContent.includes('(cópia)') ? '(cópia)' : '') : null;
  });
  const tagRows = t => ev(t => [...document.querySelectorAll('[data-map-row]')].filter(r => r.textContent.includes('(' + t + ')')).length, t);
  // Caixa (coordenadas da página) da linha do mapa de um bloco do editor; n = qual ocorrência do seletor.
  const rowBox = (sel, n = 0) => ev(([sel, n]) => {
    const el = tinymce.activeEditor.getBody().querySelectorAll(sel)[n];
    const row = [...document.querySelectorAll('[data-map-row]')].find(r => r.__el === el);
    if (!row) return null;
    const b = row.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }, [sel, n]);
  const clickRow = async (sel, n) => { const b = await rowBox(sel, n); await page.mouse.click(b.x + 60, b.y + b.h / 2); await page.waitForTimeout(450); };
  const edBox = async (sel, n = 0) => frame.locator(sel).nth(n).boundingBox();
  const focusOutside = async () => { await page.locator('#fora').click(); };
  const openMap = () => ev(src => (new Function('return ' + src))()([{ name: 'Aviso', html: '<p data-k="aviso">AVISO SALVO</p>' }]), MAP);
  const reset = async () => {
    await ev(() => window.__svcMapCleanup && window.__svcMapCleanup());
    await ev(c => { const ed = tinymce.activeEditor; ed.setContent(c); ed.undoManager.clear(); ed.undoManager.add(); }, CONTENT);
    await openMap();
    await focusOutside();
    await page.waitForTimeout(150);
  };
  // M + arrastar: de (x1,y1) a (x2,y2), em coordenadas da página.
  const mDrag = async (x1, y1, x2, y2, { releaseMFirst = false } = {}) => {
    await page.keyboard.down('m');
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 10 });
    await page.waitForTimeout(80);
    if (releaseMFirst) await page.keyboard.up('m');
    await page.mouse.up();
    if (!releaseMFirst) await page.keyboard.up('m');
    await page.waitForTimeout(250);
  };
  const BASE = 'banner,conteudo,card1,card2,final';

  // ── Duplicar ───────────────────────────────────────────────────────────
  await reset();
  ok(await inSync() === 'ok', 'mapa abre com as linhas na ordem da página');
  await clickRow('[data-k=card1]');
  await page.getByRole('button', { name: '📑 Duplicar' }).click();
  await page.waitForTimeout(300);
  ok(await order() === 'banner,conteudo,card1,card1,card2,final', 'Duplicar põe a cópia logo abaixo do original', await order());
  ok(await ev(() => tinymce.activeEditor.getBody().querySelectorAll('#mod1').length) === 1, 'a cópia sai sem o id (sem âncora repetida)');
  ok(await activeEl() === 'card1(cópia)', 'a cópia fica selecionada, com a linha "(cópia)"', await activeEl());
  ok(await inSync() === 'ok', 'painel em ordem depois de duplicar', await inSync());
  await ev(() => tinymce.activeEditor.undoManager.undo());
  await page.waitForTimeout(200);
  ok(await order() === BASE, 'Ctrl+Z desfaz a cópia', await order());
  ok(await tagRows('cópia') === 0 && await inSync() === 'ok', 'depois do Ctrl+Z o mapa é refeito (sem linha de bloco que sumiu)', await inSync());

  // ── Cópia achada pelo clique no editor; Delete ─────────────────────────
  await clickRow('[data-k=card1]');
  await page.getByRole('button', { name: '📑 Duplicar' }).click();
  await page.waitForTimeout(300);
  await clickRow('[data-k=banner]');                                  // tira a seleção da cópia
  const cb = await edBox('[data-k=card1]', 1);
  await page.mouse.click(cb.x + 4, cb.y + 4);                           // clique na borda da cópia, no editor
  await page.waitForTimeout(300);
  ok(await activeEl() === 'card1(cópia)', 'clicar na cópia dentro do editor seleciona a linha dela', await activeEl());
  await page.keyboard.press('Delete');
  await page.waitForTimeout(250);
  ok(await order() === BASE, 'Delete exclui a cópia selecionada', await order());
  ok(await tagRows('cópia') === 0 && await inSync() === 'ok', 'nenhuma linha sobrando no painel depois do Delete', await inSync());

  // ── M com o cursor no texto ───────────────────────────────────────────
  await frame.locator('[data-k=final]').click();
  await page.keyboard.down('m');
  await page.waitForTimeout(600);                                       // repetição automática da tecla
  const cur = await ev(() => tinymce.activeEditor.getDoc().documentElement.style.cursor);
  await page.keyboard.up('m');
  await page.waitForTimeout(100);
  const finalText = () => ev(() => tinymce.activeEditor.getBody().querySelector('[data-k=final]').textContent);
  ok(await finalText() === 'Parágrafo final', 'segurar M com o cursor no texto não escreve "m"', await finalText());
  ok(cur === 'grab', 'M segurado no editor: cursor "grab"', cur);
  ok(await ev(() => tinymce.activeEditor.getDoc().documentElement.style.cursor) === 'pointer', 'soltar o M no editor devolve o cursor (não fica preso)');
  await page.locator('#titulo').click();
  await page.keyboard.type('mm');
  await page.keyboard.press('Delete');
  ok(await page.locator('#titulo').inputValue() === 'mm', 'campos do Canvas (título) continuam aceitando M');
  ok(await order() === BASE, 'Delete num campo do Canvas não exclui o bloco selecionado', await order());

  // ── Arrastar pelo painel ──────────────────────────────────────────────
  await reset();
  let s = await rowBox('[data-k=final]'), d = await rowBox('[data-k=banner]');
  await mDrag(s.x + 60, s.y + s.h / 2, d.x + 60, d.y + 4);
  ok(await order() === 'final,banner,conteudo,card1,card2', 'M + arrastar a linha leva o bloco para antes do outro', await order());
  ok(await inSync() === 'ok', 'painel em ordem depois de mover', await inSync());

  await reset();
  errors.length = 0;
  s = await rowBox('[data-k=conteudo]'); d = await rowBox('[data-k=p2]');
  await mDrag(s.x + 60, s.y + s.h / 2, d.x + 60, d.y + d.h - 4);
  ok(await order() === BASE && !errors.length, 'arrastar um bloco sobre um filho dele não faz nada (nem erro)', [await order(), errors]);

  await reset();
  s = await rowBox('[data-k=conteudo]'); d = await rowBox('[data-k=card2]');
  await mDrag(s.x + 60, s.y + s.h / 2, d.x + 60, d.y + d.h - 4);
  ok(await order() === 'banner,card1,card2,conteudo,final', 'soltar na metade de baixo do card põe o bloco DEPOIS do card (não dentro)', await order());
  ok(await inSync() === 'ok', 'as linhas dos filhos acompanham o bloco movido', await inSync());

  await reset();
  s = await rowBox('[data-k=final]');
  const into = await edBox('[data-k=card1]');
  await mDrag(s.x + 60, s.y + s.h / 2, into.x + 40, into.y + 10);
  ok(await order() === BASE, 'soltar a linha fora do painel (no editor) cancela', await order());
  ok(await ev(() => !tinymce.activeEditor.getBody().innerHTML.includes('box-shadow: 0 0 10px')) , 'a linha verde não fica no editor');

  // ── Arrastar direto na página ────────────────────────────────────────
  await reset();
  await clickRow('[data-k=card2]');
  let a = await edBox('[data-k=card2]'), b = await edBox('[data-k=card1]');
  await page.keyboard.down('m');
  await page.mouse.move(a.x + 30, a.y + a.height / 2);
  await page.waitForTimeout(80);
  ok(await ev(() => !!tinymce.activeEditor.getDoc().documentElement.querySelector(':scope > div')), 'destaques ficam numa camada fora do <body>');
  await page.keyboard.up('m');
  await mDrag(a.x + 30, a.y + a.height / 2, b.x + 30, b.y + 6);
  ok(await order() === 'banner,conteudo,card2,card1,final', 'M + arrastar o bloco selecionado na página move o bloco', await order());
  ok(await activeEl() === 'card2', 'o bloco movido continua selecionado', await activeEl());
  ok(await inSync() === 'ok', 'painel em ordem depois de mover na página', await inSync());

  await reset();
  a = await edBox('[data-k=p1]'); b = await edBox('[data-k=p2]');
  await mDrag(a.x + 30, a.y + a.height / 2, b.x + 30, b.y + b.height - 3);
  ok(await ev(() => [...tinymce.activeEditor.getBody().querySelector('[data-k=conteudo]').children].map(e => e.getAttribute('data-k') || e.tagName).join(',')) === 'p2,p1,UL',
    'sem seleção, o M pega o bloco mais interno e troca com os do mesmo nível');

  await reset();
  await frame.locator('[data-k=card1p]').click();                     // cursor no texto do card
  await page.waitForTimeout(300);
  ok(await activeEl() === 'card1p', 'clicar no texto seleciona o parágrafo');
  a = await edBox('[data-k=card1p]');
  await page.mouse.move(a.x + 30, a.y + a.height / 2);
  await page.keyboard.down('m');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(250);
  ok(await activeEl() === 'card1', 'M + ↑ sobe para o card inteiro', await activeEl());
  b = await edBox('[data-k=card2]');
  await page.mouse.down();
  await page.mouse.move(b.x + 30, b.y + b.height - 4, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('m');
  await page.waitForTimeout(250);
  ok(await order() === 'banner,conteudo,card2,card1,final', '…e o arraste leva o card inteiro', await order());
  ok(await ev(() => tinymce.activeEditor.getBody().querySelector('[data-k=card1p]').textContent) === 'Texto do card um', 'nada de "m" digitado no meio do arraste');

  await reset();
  a = await edBox('[data-k=final]'); b = await edBox('[data-k=banner]');
  await mDrag(a.x + 30, a.y + a.height / 2, b.x + 30, b.y + 4, { releaseMFirst: true });
  ok(await order() === 'final,banner,conteudo,card1,card2', 'soltar o M um instante antes do mouse não perde o arraste', await order());

  // ── Nada do mapa no HTML salvo ───────────────────────────────────────
  await reset();
  await clickRow('[data-k=card1]');
  const hb = await rowBox('[data-k=card2]');
  await page.mouse.move(hb.x + 60, hb.y + hb.h / 2);                    // passa o mouse em outra linha (laranja)
  await page.waitForTimeout(100);
  const html = await saved();
  ok(!/outline|box-shadow|__svcMapPulse|opacity/.test(html), 'bloco selecionado e destacado: nada disso vai para o HTML salvo', html.slice(0, 200));
  await page.mouse.move(5, 940);

  // ── Inserir bloco salvo ──────────────────────────────────────────────
  await clickRow('[data-k=final]');
  await page.getByRole('button', { name: '➕ Inserir' }).click();
  await page.getByRole('button', { name: '📦 Aviso' }).click();
  await page.getByRole('button', { name: '⬇ Depois' }).click();
  await page.waitForTimeout(300);
  ok((await order()).endsWith('final,aviso') && await tagRows('novo') === 1, '➕ Inserir põe o bloco salvo depois, com a linha "(novo)"', await order());
  ok(await inSync() === 'ok', 'painel em ordem depois de inserir', await inSync());

  // ── Fechar ──────────────────────────────────────────────────────────
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const left = await ev(() => {
    const d = tinymce.activeEditor.getDoc();
    return { panel: document.querySelectorAll('[data-map-row]').length, layer: d.documentElement.querySelectorAll(':scope > div').length,
      style: [...d.querySelectorAll('style')].some(s => s.textContent.includes('__svcMapPulse')), cursor: d.documentElement.style.cursor, fn: !!window.__svcMapCleanup };
  });
  ok(!left.panel && !left.layer && !left.style && !left.cursor && !left.fn, 'ESC fecha o mapa e não deixa nada para trás', left);
  ok(!errors.length, 'nenhum erro na página', errors);
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    for (const ver of ['5.10.9', '6.8.3']) await suite(browser, ver);
  } finally { await browser.close(); }
  console.log(failures ? `\n${failures} FALHA(S)` : '\nTUDO OK');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
