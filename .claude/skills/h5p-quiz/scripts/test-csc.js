// Regressão do Caminho CSC no Service Timer, com a extensão de verdade
// (csc-*.js nas páginas do CSC + csc-panel.js na tela 🎫 do painel), em
// páginas falsas de csc.pucminas.br:
//   • chave desligada (padrão): nada acontece no CSC — o botão direito da
//     árvore continua normal, sem barrinha e sem gravar nada;
//   • ligar na ⚙ vale na hora na aba da árvore já aberta: aprende os serviços
//     carregados, o botão direito num serviço mostra o menu (numa pasta, não),
//     "Abrir em nova aba" abre o link direto e abrir uma pasta aprende mais;
//   • formulário dentro do iframe: barrinha e "Serviços salvos";
//   • chamado: grupos do histórico só das linhas do serviço atual;
//   • lembrete do Acervo: aba "📦 Enviar para o acervo" depois de "Atividades"
//     só no chamado de um serviço da lista (padrão: Gravar videoaula), sem
//     passar os cliques ao RadTabStrip; no canto quando não há abas; a lista
//     da ⚙ vale na hora;
//   • busca do painel por nome, grupo e cabeçalho do chamado colado;
//   • desligar devolve o botão direito normal na aba aberta;
//   • os dados têm nomes próprios (cscServicos/cscCatalogo), não os da
//     extensão Caminho CSC (servicos/catalogo).
// Mesmo Chromium e playwright-core do test-manifest.js:
//   NODE_PATH=<pasta>/node_modules node .claude/skills/h5p-quiz/scripts/test-csc.js
const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../..');
const CSC = 'https://csc.pucminas.br';

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
const DESC = 'CSC - Central de Serviços Compartilhados/Serviços de TI/Rede Acadêmica/Acesso Canvas/Suporte ao Canvas';
const FORM_URL = `${CSC}/Chamados/viewIncidenteDireto.aspx?id=4952&origem=Incidente&width=1632&height=756&incidenteid=0&Userid=0`;

// Árvore RadTreeView falsa: só o que o csc-arvore-main.js usa ($find, get_nodes,
// get_count, getNode, get_text, get_value, get_element). A pasta do NED vem
// fechada; window.__abrirPastaNed() faz o que o Telerik faz quando você a abre.
const ARVORE = html('Abertura de chamado', `
  <input type="hidden" id="MainContent_hidorigem" value="Incidente">
  <div id="ctl00_MainContent_rdTreeView"><ul id="raiz"></ul></div>
  <script>
    const colecao = k => ({ get_count: () => k.length, getNode: i => k[i] });
    function no(texto, valor, filhos = []) {
      const li = document.createElement('li'); li.className = 'rtLI';
      const span = document.createElement('span'); span.className = 'rtIn'; span.textContent = texto;
      const ul = document.createElement('ul');
      li.append(span, ul);
      const n = { kids: [], li, ul, get_text: () => texto, get_value: () => valor, get_element: () => li, get_nodes() { return colecao(this.kids); } };
      filhos.forEach(f => pendurar(n, f));
      return n;
    }
    function pendurar(pai, filho) { pai.kids.push(filho); pai.ul.appendChild(filho.li); }
    const raiz = { kids: [], ul: document.getElementById('raiz') };
    const ned = no('Serviços do Núcleo de Educação Digital (NED)', '20;N;N;N;0;1;1');
    pendurar(raiz, no('CSC - Central de Serviços Compartilhados', '1;N;N;N;0;1;1', [
      no('Serviços de TI', '2;N;N;N;0;1;1', [
        no('Rede Acadêmica', '3;N;N;N;0;1;1', [
          no('Acesso Canvas', '4;N;N;N;0;1;1', [
            no('Suporte ao Canvas', '4952;S;S;S;1940;5;5'),
          ]),
        ]),
      ]),
      ned,
    ]));
    window.$find = id => id === 'ctl00_MainContent_rdTreeView' ? { get_nodes: () => colecao(raiz.kids) } : null;
    window.__abrirPastaNed = () => {
      pendurar(ned, no('Atendimento de SUPORTE AO DOCENTE', '6548;S;S;S;1;5;5'));
      pendurar(ned, no('Atualização de disciplina', '7001;S;S;S;1;5;5'));
    };
  </script>`);

const FORM = html('Abertura', `<div class="titulo"><span>Abertura de chamado para o serviço: ${DESC}</span></div><form><textarea></textarea></form>`);
// A lista de chamados com o formulário aberto na janelinha interna (iframe).
const LISTA_COM_FORM = html('Pendentes', `<iframe id="janela" src="${FORM_URL}" style="width:900px;height:400px"></iframe>`);

const linhaHist = (servico, grupo) => `<tr><td>01/11/2026</td><td>${servico}</td><td>${grupo}</td></tr>`;
// Abas como as da gravação de 17/11/2026 (RadTabStrip + o CSS da página que
// põe as abas lado a lado). O ouvinte no #RadTabStrip faz o papel do Telerik,
// que trata os cliques ali: conta os que ele receberia.
const ABAS = `
  <style>.RadTabStrip .rtsUL { display: flex; list-style: none; margin: 0; padding: 0; } .RadTabStrip .rtsLI { flex: 1; } .rtsLink { display: block; text-align: center; padding: 5px; }</style>
  <div id="RadTabStrip" class="RadTabStrip RadTabStrip_Bootstrap rtsHorizontal rtsTop" style="font-size:9pt;"><div class="rtsLevel rtsLevel1"><ul class="rtsUL">${
    ['Histórico', 'Detalhes', 'Anexos', 'Print', 'Resolução', 'Horas', 'Atividades'].map((t, i) =>
      `<li class="rtsLI${i ? '' : ' rtsSelected'}"><span class="rtsLink" style="color:#3A3F49;font-family:Roboto;font-weight:normal;border: 1px solid #3A3F49; border-radius: 12px 12px 0px 0px;"><span class="rtsTxt">${t}</span></span></li>`).join('')
  }</ul></div></div>
  <script>window.__cliquesTelerik = 0; document.getElementById('RadTabStrip').addEventListener('click', () => window.__cliquesTelerik++);</script>`;
const GRAVAR = 'CSC - Central de Serviços Compartilhados/Serviços do Núcleo de Educação Digital (NED)/Pós-graduação Lato Sensu/Produção/criação de conteúdos/Gravar videoaula';
const CHAMADO = (id, desc, linhas, abas = true) => html('Chamado', `
  <input type="hidden" id="hidTipoItem" value="S">
  <input type="hidden" id="hidCatalogoServicosId" value="${id}">
  <input type="hidden" id="hidDesc" value="${desc}">
  <span id="lblCabecalho">Código 1 - ${desc.toLowerCase()}</span>
  ${abas ? ABAS : ''}
  <div id="gridHistorico"><table id="gridHistorico_ctl00">
    <thead><tr><th class="rgHeader">Data</th><th class="rgHeader">Serviço</th><th class="rgHeader">Grupo</th></tr></thead>
    <tbody>${linhas.join('')}</tbody>
  </table></div>`);

function pagina(url) {
  const u = new URL(url);
  const p = u.pathname.toLowerCase();
  if (p === '/chamados/incidentev2.aspx') return ARVORE;
  if (p === '/chamados/viewincidentedireto.aspx') return FORM;
  if (p === '/chamados/pendentesv2') return LISTA_COM_FORM;
  if (p === '/chamados/viewhistoricochamado.aspx' && u.searchParams.get('Codigo') === '1028224') {
    return CHAMADO('4952', DESC, [
      linhaHist(DESC, 'RES_TI_PUC_Lourdes'),
      linhaHist(DESC, 'RES_NED/TED_Suporte_Canvas'),
      linhaHist('CSC - Central de Serviços Compartilhados/Outro serviço', 'RES_DE_OUTRO_SERVICO'),
      linhaHist(DESC, 'RES_NED/CEAD_Gestão_do_Ambiente_Virtual'),
    ]);
  }
  if (p === '/chamados/viewhistoricochamado.aspx' && u.searchParams.get('Codigo') === '1030000') {
    const d = 'CSC - Central de Serviços Compartilhados/Serviços do Núcleo de Educação Digital (NED)/Gravação de vídeo';
    return CHAMADO('8001', d, [linhaHist(d, 'RES_NED/Acervo')]);
  }
  if (p === '/chamados/viewhistoricochamado.aspx' && u.searchParams.get('Codigo') === '1018448') {
    return CHAMADO('9100', GRAVAR, [linhaHist(GRAVAR, 'RES_NED/COED_Gestão')]);
  }
  if (p === '/chamados/viewhistoricochamado.aspx' && u.searchParams.get('Codigo') === '1018449') {
    return CHAMADO('9100', GRAVAR, [linhaHist(GRAVAR, 'RES_NED/COED_Gestão')], false); // sem as abas
  }
  return null;
}

let fails = 0;
function check(ok, label, extra = '') {
  console.log(`${ok ? '  ok  ' : '  FALHOU'} ${label}${ok || !extra ? '' : `\n         ${extra}`}`);
  if (!ok) fails++;
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-csc-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: findChromium(),
    headless: true,
    viewport: { width: 1200, height: 800 },
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });
  try {
    await ctx.route(`${CSC}/**`, r => {
      const body = pagina(r.request().url());
      return r.fulfill({ status: body ? 200 : 404, contentType: 'text/html; charset=utf-8', body: body || 'não achei' });
    });
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    const extId = new URL(sw.url()).host;
    const storage = () => sw.evaluate(() => chrome.storage.local.get(null));
    await sw.evaluate(() => chrome.storage.local.set({ usuario: 'Teste' }));

    // Botão direito num item da árvore, pelo mundo da página. Devolve se o
    // menu normal do Chrome foi bloqueado.
    const botaoDireito = (pg, texto) => pg.evaluate(t => {
      const span = [...document.querySelectorAll('#ctl00_MainContent_rdTreeView span.rtIn')].find(s => s.textContent === t);
      const r = span.getBoundingClientRect();
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 });
      span.dispatchEvent(ev);
      return ev.defaultPrevented;
    }, texto);
    const menuAberto = pg => pg.evaluate(() => {
      const host = document.getElementById('st-csc-menu');
      const menu = host && host.shadowRoot.querySelector('.menu');
      return menu && !menu.hidden ? host.shadowRoot.querySelector('.titulo b').textContent : null;
    });

    console.log('Chave desligada (padrão):');
    const arvore = await ctx.newPage();
    await arvore.goto(`${CSC}/Chamados/IncidenteV2.aspx?origem=Incidente`);
    await arvore.waitForTimeout(1500);
    check(await botaoDireito(arvore, 'Suporte ao Canvas') === false, 'botão direito num serviço continua com o menu normal');
    await arvore.waitForTimeout(300);
    check(await menuAberto(arvore) === null, 'sem o menu do Caminho CSC');
    const lista = await ctx.newPage();
    await lista.goto(`${CSC}/Chamados/PendentesV2`);
    await lista.waitForTimeout(2000);
    const formFrame = () => lista.frames().find(f => f.url().includes('viewIncidenteDireto.aspx'));
    check(await formFrame().evaluate(() => !document.getElementById('st-csc-barra')), 'formulário sem a barrinha');
    const ch0 = await ctx.newPage();
    await ch0.goto(`${CSC}/Chamados/viewHistoricoChamado.aspx?id=1&Codigo=1028224&origem=VisualizaChamadosGrupo`);
    await ch0.waitForTimeout(1200);
    await ch0.goto(`${CSC}/Chamados/viewHistoricoChamado.aspx?id=3&Codigo=1018448&origem=VisualizaChamadosGrupo`);
    await ch0.waitForTimeout(1200);
    check(await ch0.evaluate(() => !document.getElementById('st-csc-acervo') && !document.getElementById('st-csc-acervo-aviso')), 'chamado de Gravar videoaula sem a aba do Acervo');
    await ch0.close();
    let st = await storage();
    check(st.cscEnabled === undefined && !st.cscServicos && !st.cscCatalogo, `nada gravado: ${JSON.stringify(Object.keys(st))}`);

    console.log('Ligar na ⚙ Configurações:');
    const painel = await ctx.newPage();
    await painel.goto(`chrome-extension://${extId}/popup.html`);
    await painel.waitForFunction(() => {
      document.getElementById('btn-settings')?.click();
      return typeof document.getElementById('settings-csc')?.onchange === 'function';
    }, null, { polling: 300, timeout: 15000 });
    check(await painel.evaluate(() => document.getElementById('settings-csc').checked) === false, 'a chave aparece desligada');
    check(await painel.evaluate(() => document.getElementById('btn-csc').style.display) === 'none', 'o 🎫 do cabeçalho está escondido');
    await painel.evaluate(() => { const c = document.getElementById('settings-csc'); c.checked = true; c.dispatchEvent(new Event('change')); });
    await painel.waitForTimeout(300);
    check((await storage()).cscEnabled === true, 'ligar grava cscEnabled');
    check(await painel.evaluate(() => document.getElementById('btn-csc').style.display) === '', 'o 🎫 aparece na hora');

    console.log('Árvore (aba já aberta, vale na hora):');
    await arvore.bringToFront();
    await arvore.waitForTimeout(1500);
    st = await storage();
    const inc = () => (st.cscCatalogo && st.cscCatalogo.Incidente && st.cscCatalogo.Incidente.itens) || {};
    check(inc()['4952'] && inc()['4952'].nome === 'Suporte ao Canvas', 'aprendeu o serviço carregado', JSON.stringify(inc()));
    check(inc()['4952'] && inc()['4952'].caminho === 'CSC - Central de Serviços Compartilhados / Serviços de TI / Rede Acadêmica / Acesso Canvas', `com o caminho das pastas: ${inc()['4952'] && inc()['4952'].caminho}`);
    check(Object.keys(inc()).length === 1, `pasta fechada não é aberta (só 1 serviço): ${Object.keys(inc())}`);
    check(await botaoDireito(arvore, 'Suporte ao Canvas') === true, 'botão direito num serviço bloqueia o menu normal');
    await arvore.waitForTimeout(300);
    check(await menuAberto(arvore) === 'Suporte ao Canvas', 'e mostra o menu com o nome do serviço');
    const novaAba = ctx.waitForEvent('page');
    await arvore.evaluate(() => document.getElementById('st-csc-menu').shadowRoot.querySelector('.abrir').click());
    const aberta = await novaAba;
    await aberta.waitForLoadState();
    check(aberta.url() === FORM_URL, `"Abrir em nova aba" abre o link direto: ${aberta.url()}`);
    await aberta.close();
    await arvore.bringToFront();
    check(await botaoDireito(arvore, 'Serviços de TI') === false, 'botão direito numa pasta continua com o menu normal');
    await arvore.evaluate(() => window.__abrirPastaNed());
    await arvore.waitForTimeout(1200);
    st = await storage();
    check(inc()['6548'] && inc()['7001'] && inc()['7001'].caminho === 'CSC - Central de Serviços Compartilhados / Serviços do Núcleo de Educação Digital (NED)',
      `abrir a pasta do NED aprende os serviços dela: ${Object.keys(inc())}`);

    console.log('Formulário na janelinha (iframe):');
    await lista.bringToFront();
    await lista.reload();
    await lista.waitForTimeout(2000);
    check(await formFrame().evaluate(() => !!document.getElementById('st-csc-barra')), 'a barrinha aparece dentro do iframe');
    st = await storage();
    const salvo = st.cscServicos && st.cscServicos['4952|Incidente'];
    check(salvo && salvo.nome === 'Suporte ao Canvas' && salvo.link === FORM_URL, `vai para os serviços salvos: ${JSON.stringify(salvo)}`);

    console.log('Chamado:');
    const ch = await ctx.newPage();
    await ch.goto(`${CSC}/Chamados/viewHistoricoChamado.aspx?id=1&Codigo=1028224&origem=VisualizaChamadosGrupo`);
    await ch.waitForTimeout(1200);
    await ch.goto(`${CSC}/Chamados/viewHistoricoChamado.aspx?id=2&Codigo=1030000&origem=VisualizaChamadosGrupo`);
    await ch.waitForTimeout(1200);
    await ch.close();
    st = await storage();
    check(JSON.stringify(inc()['4952'].grupos) === JSON.stringify(['RES_TI_PUC_Lourdes', 'RES_NED/TED_Suporte_Canvas', 'RES_NED/CEAD_Gestão_do_Ambiente_Virtual']),
      `grupos só das linhas do serviço atual: ${JSON.stringify(inc()['4952'].grupos)}`);
    check(inc()['4952'].nome === 'Suporte ao Canvas' && !inc()['4952'].fonte, 'serviço que veio da árvore mantém nome e caminho');
    check(inc()['8001'] && inc()['8001'].fonte === 'chamado' && inc()['8001'].nome === 'Gravação de vídeo', `serviço novo, só visto num chamado, entra no catálogo: ${JSON.stringify(inc()['8001'])}`);

    console.log('Tela 🎫 CSC do painel:');
    await painel.bringToFront();
    await painel.evaluate(() => document.getElementById('btn-csc').click());
    await painel.waitForTimeout(500);
    check(await painel.evaluate(() => document.getElementById('view-csc').classList.contains('active')), 'o 🎫 abre a tela');
    const nomes = () => painel.$$eval('#csc-servicos .csc-nome', els => els.map(e => e.textContent));
    const buscar = async q => { await painel.fill('#csc-busca', q); await painel.waitForTimeout(300); return nomes(); };
    let n = await nomes();
    check(n.includes('Suporte ao Canvas') && n.length === 3, `"Serviços salvos": o do formulário + os 2 de exemplo: ${JSON.stringify(n)}`);
    check(await painel.$eval('#csc-status', e => e.textContent) === 'Conhecidos até agora: Solicitante: 4 serviços · Atendente: 0 serviços', 'contagem do catálogo');
    check(await painel.$$eval('#csc-listas button', b => b.length) === 4, 'os 4 botões das listas de chamados');
    n = await buscar('atualizacao disciplina');
    check(n[0] === 'Atualização de disciplina', `busca sem acento: ${JSON.stringify(n)}`);
    n = await buscar('RES_NED/CEAD_Gestão_do_Ambiente_Virtual');
    check(JSON.stringify(n) === '["Suporte ao Canvas"]', `busca pelo grupo: ${JSON.stringify(n)}`);
    n = await buscar('Código 1028224 - Csc - central de serviços compartilhados/serviços de ti/rede acadêmica/acesso canvas/suporte ao canvas');
    check(n[0] === 'Suporte ao Canvas', `cabeçalho do chamado colado: ${JSON.stringify(n)}`);
    n = await buscar('acervo');
    check(JSON.stringify(n) === '["Gravação de vídeo"]', `busca pelo grupo do Acervo: ${JSON.stringify(n)}`);
    // ☆ Salvar um resultado da busca.
    await painel.evaluate(() => [...document.querySelectorAll('#csc-servicos button')].find(b => b.textContent === '☆ Salvar').click());
    await painel.waitForTimeout(400);
    check(!!(await storage()).cscServicos['8001|Incidente'], '☆ Salvar põe nos serviços salvos');
    // Atualiza sozinha enquanto navega (painel aberto ao lado do CSC).
    await painel.fill('#csc-busca', 'nucleo');
    await painel.waitForTimeout(300);
    await sw.evaluate(async () => {
      const { cscCatalogo } = await chrome.storage.local.get('cscCatalogo');
      cscCatalogo.Incidente.itens['7777'] = { id: '7777', nome: 'Serviço novo do núcleo', caminho: 'CSC / Núcleo', tipo: '' };
      await chrome.storage.local.set({ cscCatalogo });
    });
    await painel.waitForTimeout(400);
    check((await nomes()).includes('Serviço novo do núcleo'), 'a busca aberta se atualiza quando o catálogo muda');

    console.log('Lembrete do Acervo:');
    // O que a aba do Acervo mostra: posição, texto, se está na linha das
    // outras abas e se o lembrete está aberto.
    const acervo = pg => pg.evaluate(() => {
      const aba = document.getElementById('st-csc-acervo');
      const host = document.getElementById('st-csc-acervo-aviso');
      const caixa = host && host.shadowRoot.querySelector('.aviso');
      const abas = [...document.querySelectorAll('#RadTabStrip .rtsUL > li')];
      const ativ = abas.find(li => li.textContent === 'Atividades');
      return {
        aba: aba ? aba.textContent : null,
        depoisDeAtividades: !!aba && ativ && ativ.nextElementSibling === aba && abas[abas.length - 1] === aba,
        mesmaLinha: !!aba && ativ && Math.abs(aba.getBoundingClientRect().top - ativ.getBoundingClientRect().top) < 2,
        avisoAberto: !!caixa && !caixa.hidden,
        servico: caixa ? caixa.querySelector('.servico').textContent : null,
        canto: !!caixa && caixa.style.bottom === '16px',
        cliquesTelerik: window.__cliquesTelerik,
      };
    });
    const gv = await ctx.newPage();
    await gv.goto(`${CSC}/Chamados/viewHistoricoChamado.aspx?id=3&Codigo=1018448&origem=VisualizaChamadosGrupo`);
    await gv.waitForTimeout(1200);
    let a = await acervo(gv);
    check(a.aba === '📦 Enviar para o acervo' && a.depoisDeAtividades, `chamado de Gravar videoaula ganha a aba depois de "Atividades": ${JSON.stringify(a)}`);
    check(a.mesmaLinha, 'a aba fica na mesma linha das outras');
    check(!a.avisoAberto, 'o lembrete começa fechado');
    await gv.click('#st-csc-acervo');
    await gv.waitForTimeout(200);
    a = await acervo(gv);
    check(a.avisoAberto && a.servico === 'Gravar videoaula', `clicar na aba abre o lembrete com o serviço: ${a.servico}`);
    check(a.cliquesTelerik === 0, `o clique não chega ao RadTabStrip: ${a.cliquesTelerik}`);
    await gv.evaluate(() => document.getElementById('st-csc-acervo-aviso').shadowRoot.querySelector('.entendi').click());
    check(!(await acervo(gv)).avisoAberto, '"Entendi" fecha o lembrete');
    await gv.click('#RadTabStrip li:nth-child(2)');
    check((await acervo(gv)).cliquesTelerik === 1, 'as abas do CSC continuam recebendo os próprios cliques');

    const sc = await ctx.newPage();
    await sc.goto(`${CSC}/Chamados/viewHistoricoChamado.aspx?id=1&Codigo=1028224&origem=VisualizaChamadosGrupo`);
    await sc.waitForTimeout(1200);
    check((await acervo(sc)).aba === null, 'chamado de outro serviço (Suporte ao Canvas) não ganha a aba');

    const semAbas = await ctx.newPage();
    await semAbas.goto(`${CSC}/Chamados/viewHistoricoChamado.aspx?id=4&Codigo=1018449&origem=VisualizaChamadosGrupo`);
    await semAbas.waitForTimeout(1200);
    a = await acervo(semAbas);
    check(a.aba === null && a.avisoAberto && a.canto, `sem as abas na página, o lembrete aparece aberto no canto: ${JSON.stringify(a)}`);
    await semAbas.close();

    // A lista da ⚙ vale na hora nos chamados abertos (grava ao sair da caixa).
    const listaCfg = await painel.evaluate(() => document.getElementById('settings-csc-acervo').value);
    check(listaCfg === GRAVAR, `a ⚙ mostra o caminho padrão: ${listaCfg}`);
    const salvarLista = v => painel.evaluate(v => {
      const t = document.getElementById('settings-csc-acervo');
      t.value = v;
      t.dispatchEvent(new Event('change'));
    }, v);
    await salvarLista('acesso canvas/suporte ao canvas');
    await gv.waitForTimeout(500);
    check(JSON.stringify((await storage()).cscAcervoCaminhos) === '["acesso canvas/suporte ao canvas"]', 'a lista é gravada ao sair da caixa');
    check((await acervo(sc)).aba === '📦 Enviar para o acervo', 'um trecho do fim do caminho (minúsculo, sem o começo) já basta');
    check((await acervo(gv)).aba === null, 'o chamado que saiu da lista perde a aba');
    await salvarLista('');
    await gv.waitForTimeout(500);
    check((await acervo(sc)).aba === null && JSON.stringify((await storage()).cscAcervoCaminhos) === '[]', 'lista vazia: nenhum lembrete');
    await salvarLista(GRAVAR);
    await gv.waitForTimeout(500);
    check((await acervo(gv)).aba === '📦 Enviar para o acervo', 'voltar o caminho devolve a aba');
    await sc.close();

    console.log('Desligar:');
    await painel.evaluate(() => document.getElementById('btn-settings').click());
    await painel.evaluate(() => { const c = document.getElementById('settings-csc'); c.checked = false; c.dispatchEvent(new Event('change')); });
    await painel.waitForTimeout(300);
    check(await painel.evaluate(() => document.getElementById('btn-csc').style.display) === 'none', 'o 🎫 some na hora');
    await arvore.bringToFront();
    await arvore.waitForTimeout(500);
    check(await botaoDireito(arvore, 'Suporte ao Canvas') === false, 'na árvore aberta, o botão direito volta ao normal');
    await arvore.waitForTimeout(300);
    check(await menuAberto(arvore) === null, 'e o menu do Caminho CSC não aparece');
    check((await acervo(gv)).aba === null && !(await acervo(gv)).avisoAberto, 'no chamado aberto, a aba do Acervo some');
    check(await painel.evaluate(() => document.getElementById('settings-csc-acervo').disabled), 'a lista do Acervo fica apagada sem a chave');
    await gv.close();

    st = await storage();
    check(!('servicos' in st) && !('catalogo' in st) && !('semeado' in st), 'nada gravado com os nomes da extensão Caminho CSC');
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
