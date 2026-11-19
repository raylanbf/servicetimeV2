// Teste da janela assets/confirmar-curso.js num Chrome sem tela (playwright-core).
// Uso (na pasta scripts):  npm install  e depois  npm run testar-confirmar
// Chrome em outro lugar:   CHROME_PATH="caminho/do/chrome" npm run testar-confirmar
// Rode de novo sempre que mexer no confirmarCurso.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'assets', 'confirmar-curso.js'), 'utf8');
const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find(p => fs.existsSync(p));

let falhas = 0, total = 0;
const assert = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  if (!CHROME) {
    console.log('Não achei o Google Chrome. Informe o caminho em CHROME_PATH.');
    process.exit(2);
  }
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  await page.setContent('<!DOCTYPE html><html><body><p>painel</p></body></html>');
  await page.addScriptTag({ content: SRC });

  // Abre a janela; o curso da aba é controlado por window.__aba.
  const abrir = (extra = {}) => page.evaluate(extra => {
    window.__res = undefined;
    window.__aba = '123456';
    confirmarCurso(Object.assign({
      titulo: 'Gravar em 2 páginas?', resumo: 'Teste', itens: ['Tópico 1 <b>x</b>', 'Tópico 2'],
      cursoDaPrevia: '123456', cursoAtual: async () => window.__aba,
    }, extra)).then(v => { window.__res = v; });
  }, extra);
  const res = () => page.evaluate(() => window.__res);
  const alerta = () => page.$eval('#__confirmar-curso__ [role=alert]', e => e.style.display !== 'none' ? e.textContent : '').catch(() => '(fechada)');
  const aberta = () => page.$('#__confirmar-curso__').then(Boolean);

  async function caso(nome, fn) {
    total++;
    try { await fn(); console.log('ok   ', nome); }
    catch (e) { falhas++; console.log('FALHA', nome, '—', e.message); }
    await page.evaluate(() => document.getElementById('__confirmar-curso__')?.remove());
  }

  await caso('itens entram como texto (sem HTML) e o foco vai para o campo', async () => {
    await abrir();
    const li = await page.$eval('#__confirmar-curso__ li', e => e.innerHTML);
    assert(li === 'Tópico 1 &lt;b&gt;x&lt;/b&gt;', li);
    assert(await page.evaluate(() => document.activeElement.id) === '__confirmar-curso__-numero', 'foco');
    const txt = await page.$eval('#__confirmar-curso__', e => e.textContent);
    assert(!txt.includes('123456'), 'o número não aparece na janela');
  });

  await caso('letras → aviso, continua aberta', async () => {
    await abrir();
    await page.fill('#__confirmar-curso__-numero', 'abc');
    await page.press('#__confirmar-curso__-numero', 'Enter');
    await page.waitForTimeout(50);
    assert(/só os algarismos/.test(await alerta()) && await aberta() && (await res()) === undefined, await alerta());
  });

  await caso('número errado → aviso "nada foi alterado"', async () => {
    await abrir();
    await page.fill('#__confirmar-curso__-numero', '123457');
    await page.click('#__confirmar-curso__ button:has-text("Gravar")');
    await page.waitForTimeout(50);
    assert(/não é o do curso da aba aberta.*nada foi alterado/.test(await alerta()) && (await res()) === undefined, await alerta());
  });

  await caso('aba trocou de curso depois da prévia → recusa mesmo com o número da aba', async () => {
    await abrir();
    await page.evaluate(() => { window.__aba = '999'; });
    await page.fill('#__confirmar-curso__-numero', '999');
    await page.press('#__confirmar-curso__-numero', 'Enter');
    await page.waitForTimeout(50);
    assert(/outro curso, não do curso da prévia/.test(await alerta()) && (await res()) === undefined, await alerta());
  });

  await caso('aba fora do Canvas → recusa', async () => {
    await abrir();
    await page.evaluate(() => { window.__aba = null; });
    await page.fill('#__confirmar-curso__-numero', '123456');
    await page.press('#__confirmar-curso__-numero', 'Enter');
    await page.waitForTimeout(50);
    assert(/não é de um curso do Canvas/.test(await alerta()) && (await res()) === undefined, await alerta());
  });

  await caso('número certo → fecha e devolve o número', async () => {
    await abrir();
    await page.fill('#__confirmar-curso__-numero', ' 123456 ');
    await page.press('#__confirmar-curso__-numero', 'Enter');
    await page.waitForTimeout(50);
    assert((await res()) === '123456' && !(await aberta()), String(await res()));
  });

  await caso('Esc cancela (null)', async () => {
    await abrir();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
    assert((await res()) === null && !(await aberta()), String(await res()));
  });

  await caso('clique fora cancela; Cancelar cancela', async () => {
    await abrir();
    await page.mouse.click(5, 5);
    await page.waitForTimeout(50);
    assert((await res()) === null, 'clique fora');
    await abrir();
    await page.click('#__confirmar-curso__ button:has-text("Cancelar")');
    await page.waitForTimeout(50);
    assert((await res()) === null, 'Cancelar');
  });

  await caso('nome do curso aparece quando informado', async () => {
    await abrir({ nomeDoCurso: 'Cálculo I' });
    const txt = await page.$eval('#__confirmar-curso__', e => e.textContent);
    assert(txt.includes('Curso da prévia: Cálculo I'), txt);
  });

  await browser.close();
  console.log(`\n${total - falhas}/${total} casos OK${falhas ? '' : ' — TUDO OK'}`);
  process.exit(falhas ? 1 : 0);
})();
