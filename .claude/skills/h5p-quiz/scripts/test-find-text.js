// Regressão do "🔎 Procurar texto em outra aba ou no Word" com a extensão de
// verdade (find-text.js no service worker + find-text-panel.js na página):
//   • procura em outra aba, inclusive dentro de um iframe de outro site (o H5P
//     dentro do Canvas), e diz em que "Questão N" achou;
//   • "👁 Mostrar na aba" ativa a aba, destaca o trecho e rola a página de fora
//     até o iframe;
//   • lê o Word (.docx) e o HTML (relatório da FIC) pelo extrator.js e lembra a
//     escolha para a próxima busca;
//   • páginas de extensões aparecem na lista, mas desabilitadas.
// O menu do botão direito não é clicável pelo Playwright: o teste chama o
// mesmo FIND_TEXT.open que o menu chama, pelo service worker.
// Mesmo Chromium e playwright-core do test-manifest.js:
//   NODE_PATH=<pasta>/node_modules node .claude/skills/h5p-quiz/scripts/test-find-text.js
const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../../../..');
const DOCX = path.join(__dirname, 'fixtures/questoes-nosql.docx');
const FIC = path.join(__dirname, 'fixtures/fic-mini.html');

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

const html = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
const WACC = 'A Empresa Beta S.A. deseja calcular seu WACC. O mercado avalia seu capital próprio em R$ 200 milhões e sua dívida em R$ 50 milhões.';
const PAPEL = 'A "Companhia de Papel S.A." possui um WACC de 10% e opera em um setor maduro e de baixo risco.';
const PAGES = {
  // aba A: onde o texto é selecionado
  'https://canvas.test/curso/pagina': html('Página do Canvas', `
    <p id="papel">${PAPEL.replace('"', '“').replace('"', '”')}</p>
    <p id="wacc">Questão de Fixação: ${WACC}</p>`),
  // aba B: a referência, com seções e um "H5P" num iframe de outro site, lá embaixo
  'https://ref.test/questoes': html('Referência', `
    <h2>Questão 1</h2><p>No processo de abertura de capital, qual documento é submetido à CVM?</p>
    <h2>Questão 8</h2><p>${PAPEL} A diretoria está avaliando dois projetos mutuamente excludentes.</p>
    <h2>Questão 9</h2><p>De acordo com a Teoria do Trade-Off, a estratégia de financiamento ótima é aquela em que o benefício fiscal compensa o custo de falência.</p>
    <div style="height:2500px"></div>
    <iframe src="https://h5p.test/embed/123" style="width:100%;height:900px;border:0"></iframe>
    <div style="height:2500px"></div>`),
  'https://h5p.test/embed/123': html('H5P', `
    <div style="height:500px"></div>
    <div class="h5p-question-introduction"><p>Questão de Fixação: ${WACC.replace('S.A.', 'S.A')}
      <a href="https://exemplo.test">link</a><span class="screenreader-only">Links para um site externo.</span></p></div>
    <ul><li>15,2%</li><li>17,32%</li></ul>`),
};

let fails = 0;
function check(ok, label, extra = '') {
  console.log(`${ok ? '  ok  ' : '  FALHOU'} ${label}${ok || !extra ? '' : `\n         ${extra}`}`);
  if (!ok) fails++;
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-find-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: findChromium(),
    headless: true,
    viewport: { width: 1200, height: 800 },
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });
  try {
    await ctx.route(/^https:\/\/(canvas|ref|h5p|exemplo)\.test\//, r => {
      const body = PAGES[r.request().url().split('?')[0]];
      return r.fulfill({ status: body ? 200 : 404, contentType: 'text/html; charset=utf-8', body: body || 'não achei' });
    });
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    const extId = new URL(sw.url()).host;

    const ref = await ctx.newPage();
    await ref.goto('https://ref.test/questoes');
    const a = await ctx.newPage();
    await a.goto('https://canvas.test/curso/pagina');
    await a.bringToFront();
    const tabId = url => sw.evaluate(async u => (await chrome.tabs.query({ url: u }))[0].id, url);
    const refId = await tabId('https://ref.test/*');

    const panel = s => a.locator(`#__svc-find__ ${s}`);
    async function openMenu(selectId) {
      await a.evaluate(id => {
        const sel = getSelection();
        sel.removeAllRanges();
        if (!id) return;
        const r = document.createRange();
        r.selectNodeContents(document.getElementById(id));
        sel.addRange(r);
      }, selectId);
      await sw.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ url: 'https://canvas.test/*' });
        await FIND_TEXT.open({ selectionText: '', frameId: 0 }, tab);
      });
    }
    const verdict = async () => {
      await panel('.verdict').waitFor({ timeout: 10000 });
      return { v: await panel('.verdict').innerText(), where: await panel('.where span').innerText() };
    };

    console.log('Chave nas configurações (padrão desligado):');
    check(!(await sw.evaluate(() => FIND_TEXT.enabled())), 'vem desligado');
    await openMenu('papel');
    await a.waitForTimeout(600);
    check(!(await a.locator('#__svc-find__').count()), 'desligado: o menu não abre o painel');
    // O item do menu aparece e some com a chave (contextMenus.update, visible).
    const vis = await sw.evaluate(async () => {
      const calls = [], orig = chrome.contextMenus.update;
      chrome.contextMenus.update = (id, props, cb) => { calls.push([id, props.visible]); return orig.call(chrome.contextMenus, id, props, cb); };
      await chrome.storage.local.set({ findTextEnabled: true });
      await new Promise(r => setTimeout(r, 300));
      await chrome.storage.local.set({ findTextEnabled: false });
      await new Promise(r => setTimeout(r, 300));
      chrome.contextMenus.update = orig;
      return calls;
    });
    check(JSON.stringify(vis) === '[["find-text",true],["find-text",false]]', `ligar e desligar mostra e esconde o item do menu: ${JSON.stringify(vis)}`);
    // A chave da tela de configurações (popup.html) grava findTextEnabled.
    const cfg = await ctx.newPage();
    await cfg.goto(`chrome-extension://${extId}/popup.html`);
    // ⚙: a tela de configurações liga as chaves ao abrir (buildSettings). O botão
    // fica escondido sem nome de usuário, então o clique vai pelo DOM, até o
    // popup terminar de carregar.
    await cfg.waitForFunction(() => {
      document.getElementById('btn-settings')?.click();
      return typeof document.getElementById('settings-find-text')?.onchange === 'function';
    }, null, { polling: 300, timeout: 15000 });
    check(await cfg.evaluate(() => document.getElementById('settings-find-text').checked) === false, 'a chave aparece desligada nas configurações');
    await cfg.evaluate(() => { const c = document.getElementById('settings-find-text'); c.checked = true; c.dispatchEvent(new Event('change')); });
    await cfg.waitForTimeout(300);
    check(await sw.evaluate(async () => (await chrome.storage.local.get('findTextEnabled')).findTextEnabled) === true, 'ligar a chave grava findTextEnabled');
    await cfg.close();
    await a.bringToFront();

    console.log('Outra aba:');
    await openMenu('papel');
    check((await panel('textarea').inputValue()).includes('Companhia de Papel'), 'o painel abre com o trecho selecionado');
    check(await panel('select').inputValue() === '', 'sem escolha anterior nem outra janela: espera escolher onde procurar');
    const opts = await panel('select option').allInnerTexts();
    check(opts.some(o => o.includes('Referência')), 'a aba da referência está na lista');
    await panel('select').selectOption(`tab:${refId}`);
    let r = await verdict();
    check(/IGUAL/.test(r.v), `aspas curvas não contam: ${r.v}`);
    check(/Referência › Questão 8$/.test(r.where), `achou na Questão 8: ${r.where}`);

    await panel('textarea').fill(PAPEL.replace('10%', '12%'));
    await panel('button.primary').click();
    await a.waitForFunction(() => /PARCIAL/.test(document.getElementById('__svc-find__')?.shadowRoot?.querySelector('.verdict')?.textContent || ''));
    r = await verdict();
    check(/PARCIAL/.test(r.v) && /Questão 8/.test(r.where), `"12%" no lugar de "10%": ${r.v} — ${r.where}`);
    check(await panel('.diff .act').first().innerText() === '12' && await panel('.diff .exp').first().innerText() === '10', 'diff: 12 em vermelho (sobrando), 10 em verde (faltando)');

    console.log('Dentro do iframe de outro site (H5P):');
    await openMenu('wacc');
    r = await verdict();
    check(await panel('select').inputValue() === `tab:${refId}`, 'lembrou a aba escolhida e já procurou');
    check(/PARCIAL/.test(r.v) && /Referência › H5P/.test(r.where), `achou no iframe do H5P: ${r.v} — ${r.where}`);
    // O iframe tem pouco texto além do trecho: o achado é recortado (sem o link e as
    // alternativas), e só o "Questão de Fixação:" e o ponto de "S.A." diferem.
    const found = (await panel('.pair').nth(1).textContent()).replace(/^Achado: /, '');   // dentro do <details> fechado
    // (ponto final e maiúscula inicial são tolerados: saem dos dois lados na comparação)
    check(!/15,2|link/.test(found) && /^questão de Fixação: A Empresa/i.test(found) && /50 milhões$/.test(found), `recortou o trecho no iframe: "…${found.slice(-30)}"`, found);

    await panel('.where button').click();
    await ref.waitForTimeout(800);
    const h5p = ref.frames().find(f => f.url().startsWith('https://h5p.test/'));
    const marked = await h5p.evaluate(() => (CSS.highlights.has('svc-find') ? [...CSS.highlights.get('svc-find')][0].toString() : ''));
    check(/Empresa Beta/.test(marked) && !/Links para/.test(marked), `"Mostrar na aba" destacou o trecho no iframe: "${marked.slice(0, 50)}…"`, JSON.stringify(marked));
    const onScreen = await ref.evaluate(async () => {
      const f = document.querySelector('iframe').getBoundingClientRect();
      return { top: f.top, bottom: f.bottom, h: innerHeight };
    });
    const inner = await h5p.evaluate(() => {
      const r = [...CSS.highlights.get('svc-find')][0].getBoundingClientRect();
      return r.top + r.height / 2;
    });
    const y = onScreen.top + inner;
    check(y > 0 && y < onScreen.h, `a página de fora rolou até o trecho (fica a ${Math.round(y)}px do topo, tela de ${onScreen.h}px)`);
    check(await sw.evaluate(async id => (await chrome.tabs.get(id)).active, refId), 'a aba da referência ficou ativa');
    await a.bringToFront();

    console.log('Word (.docx):');
    const bx = { TextDecoder, TextEncoder, Uint8Array }; bx.globalThis = bx;
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'extrator.js'), 'utf8'), bx);
    const paras = bx.__svcExtrator.lerWord(new Uint8Array(fs.readFileSync(DOCX))).paragrafos.map(p => p.texto);
    await panel('textarea').fill(paras[21]);
    await panel('input[type=file]').setInputFiles(DOCX);
    await a.waitForFunction(() => /docx/.test(document.getElementById('__svc-find__')?.shadowRoot?.querySelector('.where')?.textContent || ''), null, { timeout: 15000 });
    r = await verdict();
    check(/IGUAL/.test(r.v) && r.where === '📄 questoes-nosql.docx › Questão 2', `enunciado da Questão 2 no Word: ${r.v} — ${r.where}`);
    check(!(await panel('.where button').count()), 'no Word não há "Mostrar na aba"');
    const saved = await sw.evaluate(async () => { const s = await chrome.storage.local.get(['findFile', 'findTarget']); return { n: s.findFile?.questoes?.length, t: s.findTarget?.kind }; });
    check(saved.n === 6 && saved.t === 'file', 'o Word ficou guardado (6 questões) e virou a escolha');

    await a.evaluate(t => { document.getElementById('papel').textContent = t; }, paras[44].slice(0, 120).replace(/o /, 'os '));
    await openMenu('papel');
    r = await verdict();
    check(/docx/.test(await panel('select option:checked').innerText()) && /Questão 3/.test(r.where), `nova busca já no Word, sem escolher o arquivo de novo: ${r.v} — ${r.where}`);

    console.log('HTML (relatório da FIC):');
    await panel('textarea').fill('O tipo de inovação que promove melhoria em um produto ou serviço, sem impactar modelos de negócio é a:');
    await panel('input[type=file]').setInputFiles(FIC);
    await a.waitForFunction(() => /fic-mini/.test(document.getElementById('__svc-find__')?.shadowRoot?.querySelector('.where')?.textContent || ''), null, { timeout: 15000 });
    r = await verdict();
    check(/PARCIAL/.test(r.v) && r.where === '📄 fic-mini.html › Questão 2 (Tipologias de Inovação: Radical x Incremental)',
      `enunciado sem a vírgula → PARCIAL, com a questão e a sessão: ${r.v} — ${r.where}`);
    check(/2 questões/.test(await panel('select option:checked').innerText()), 'a lista mostra o HTML lido, com 2 questões');
    await panel('textarea').fill('A inovação radical rompe com o que existe; a incremental melhora o que já existe, passo a passo.');
    await panel('button.primary').click();
    await a.waitForFunction(() => /IGUAL/.test(document.getElementById('__svc-find__')?.shadowRoot?.querySelector('.verdict')?.textContent || ''));
    r = await verdict();
    check(r.where === '📄 fic-mini.html', `texto da sessão (fora das questões) também é achado: ${r.v} — ${r.where}`);

    console.log('Lista de abas:');
    const own = await ctx.newPage();
    await own.goto(`chrome-extension://${extId}/manual.html`);
    await a.bringToFront();
    await openMenu('wacc');
    await verdict();
    const ownOpt = a.locator('#__svc-find__ select option', { hasText: 'página de extensão' });
    check(await ownOpt.count() === 1 && await ownOpt.isDisabled(), 'página de extensão aparece desabilitada ("o Chrome não deixa ler")',
      JSON.stringify(await panel('select option').allInnerTexts()));
    await own.close();

    await sw.evaluate(() => chrome.storage.local.remove('findTarget'));
    await sw.evaluate(() => chrome.windows.create({ url: 'https://ref.test/questoes' }));
    await a.waitForTimeout(1500);
    await a.bringToFront();
    await openMenu('papel');
    await panel('select').evaluate(s => s.value);
    r = await verdict();
    check(/outra janela, aberta agora/.test(await panel('select option:checked').innerText()), 'sem escolha guardada: vai na aba aberta da outra janela (o outro monitor)');

    console.log('Sem seleção e fechar:');
    await openMenu(null);
    await a.waitForTimeout(500);
    check(await panel('textarea').inputValue() === '' && /Selecione/.test(await panel('textarea').getAttribute('placeholder')), 'sem seleção: o painel abre vazio para colar');
    await a.keyboard.press('Escape');
    check(!(await a.locator('#__svc-find__').count()), 'Esc fecha o painel');
    check(await a.evaluate(() => document.getElementById('papel').isConnected && !document.getElementById('__svc-find-style__')), 'a aba A não ganhou nada além do painel (já removido)');
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
