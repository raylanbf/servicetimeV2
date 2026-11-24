// Caminho CSC — lembrete "📦 Enviar para o acervo" na tela de um chamado
// (viewHistoricoChamado.aspx, a janelinha que abre pelas listas Pendentes,
// Todos, Meus chamados...).
// Quando o serviço do chamado (campo escondido hidDesc) é um dos caminhos da
// lista em ⚙ Configurações › CSC (cscAcervoCaminhos; padrão: Gravar videoaula
// da Pós Lato Sensu), põe uma aba a mais depois de "Atividades". Clicar nela
// mostra o lembrete de reencaminhar o chamado ao Acervo depois do atendimento.
// Só lembra: não encaminha nada, não lê o conteúdo do chamado e não faz
// requisição. Sem as abas na página (layout mudou), o lembrete vai para o canto.
(() => {
  if (!/\/chamados\/viewhistoricochamado\.aspx$/i.test(location.pathname)) return;

  const campo = document.getElementById('hidDesc');
  const descricao = campo ? String(campo.value || '').trim() : '';
  if (!descricao) return;

  const { CAMINHOS_ACERVO_PADRAO, normalizar, acompanharChave } = globalThis.__svcCsc;
  const ABA_ID = 'st-csc-acervo';
  const AVISO_ID = 'st-csc-acervo-aviso';
  const nomeServico = descricao.split('/').map((p) => p.trim()).filter(Boolean).pop() || descricao;

  let ligado = false;
  let deveMostrar = false;

  // Um caminho da lista "bate" se estiver contido no caminho do serviço
  // (sem acento, maiúsculas e separadores): dá para usar um trecho do fim.
  function caminhoQueBate(lista) {
    const desc = normalizar(descricao);
    return (Array.isArray(lista) ? lista : []).find((c) => {
      const n = normalizar(c);
      return n && desc.includes(n);
    }) || null;
  }

  // RadTabStrip do Telerik: #RadTabStrip .rtsUL > li.rtsLI > span.rtsLink > span.rtsTxt
  function abaAtividades() {
    const txt = [...document.querySelectorAll('#RadTabStrip .rtsUL > li.rtsLI .rtsTxt')]
      .find((s) => normalizar(s.textContent) === 'atividades');
    return txt ? txt.closest('li.rtsLI') : null;
  }

  function remover() {
    for (const id of [ABA_ID, AVISO_ID]) {
      const e = document.getElementById(id);
      if (e) e.remove();
    }
  }

  // Lembrete num shadow DOM, para o visual do CSC não bagunçar o dele.
  // ancora = a aba (abre embaixo dela); sem ancora, fica no canto da tela.
  function criarAviso() {
    const host = document.createElement('div');
    host.id = AVISO_ID;
    host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;';
    const sombra = host.attachShadow({ mode: 'open' });
    sombra.innerHTML = `
      <style>
        .aviso { position: fixed; width: 340px; max-width: calc(100vw - 16px); box-sizing: border-box;
                 background: #fff7ed; color: #431407; border: 1px solid #ea580c; border-radius: 10px;
                 box-shadow: 0 8px 24px rgba(0,0,0,.2); font: 13px/1.45 Roboto, Segoe UI, Arial, sans-serif;
                 padding: 10px 12px; }
        .topo { display: flex; align-items: center; gap: 8px; font-weight: 700; color: #9a3412; margin-bottom: 6px; }
        .topo span { flex: 1; }
        .fechar { background: none; border: 0; color: #9a3412; font-size: 17px; line-height: 1; cursor: pointer; padding: 0 2px; }
        .nota { font-size: 11px; color: #9a3412; margin-top: 6px; }
        .entendi { margin-top: 8px; background: #ea580c; color: #fff; border: 0; border-radius: 6px;
                   padding: 5px 12px; font: inherit; font-weight: 700; cursor: pointer; }
        .entendi:hover { background: #c2410c; }
        [hidden] { display: none !important; }
      </style>
      <div class="aviso" hidden>
        <div class="topo"><span>📦 Enviar para o acervo</span><button class="fechar" title="Fechar">×</button></div>
        <div>Este chamado é do serviço <b class="servico"></b>, que está na lista do Acervo.
          Depois de atender, <b>reencaminhe o chamado para o Acervo</b>.</div>
        <div class="nota">Lista em Service Timer › ⚙ Configurações › CSC.</div>
        <button class="entendi">Entendi</button>
      </div>`;
    sombra.querySelector('.servico').textContent = nomeServico;
    document.documentElement.appendChild(host);

    const caixa = sombra.querySelector('.aviso');
    const fechar = () => { caixa.hidden = true; };
    sombra.querySelector('.fechar').addEventListener('click', fechar);
    sombra.querySelector('.entendi').addEventListener('click', fechar);

    return {
      aberto: () => !caixa.hidden,
      fechar,
      abrir(ancora) {
        caixa.hidden = false;
        if (!ancora) {
          caixa.style.right = '16px';
          caixa.style.bottom = '16px';
          return;
        }
        const r = ancora.getBoundingClientRect();
        const largura = caixa.getBoundingClientRect().width;
        caixa.style.top = `${Math.round(r.bottom + 6)}px`;
        caixa.style.left = `${Math.round(Math.max(8, Math.min(r.right - largura, window.innerWidth - largura - 8)))}px`;
      },
    };
  }

  // A aba nova copia o visual da "Atividades" e ganha o destaque laranja.
  // Ela segura os próprios eventos: o RadTabStrip trata os cliques no
  // elemento das abas e não conhece esta, então não pode recebê-los.
  function criarAba(modelo, aviso) {
    const li = document.createElement('li');
    li.id = ABA_ID;
    li.className = 'rtsLI';
    li.style.flex = '0 0 auto';
    li.title = 'Lembrete do Service Timer: reencaminhar este chamado para o Acervo';
    const link = document.createElement('span');
    link.className = 'rtsLink';
    const estiloModelo = (modelo.querySelector('.rtsLink') || modelo).getAttribute('style') || '';
    link.style.cssText = `${estiloModelo};color:#9a3412;background:#ffedd5;border-color:#ea580c;font-weight:bold;cursor:pointer;white-space:nowrap;padding-left:12px;padding-right:12px`;
    const txt = document.createElement('span');
    txt.className = 'rtsTxt';
    txt.textContent = '📦 Enviar para o acervo';
    link.appendChild(txt);
    li.appendChild(link);

    for (const tipo of ['click', 'dblclick', 'mousedown', 'mouseup', 'mouseover', 'mouseout', 'keydown', 'keyup']) {
      li.addEventListener(tipo, (ev) => ev.stopPropagation());
    }
    li.addEventListener('click', () => (aviso.aberto() ? aviso.fechar() : aviso.abrir(li)));
    return li;
  }

  function mostrar() {
    if (document.getElementById(ABA_ID)) return;
    const atividades = abaAtividades();
    if (!atividades) {
      // Sem as abas: o lembrete fica aberto no canto (uma vez só).
      if (!document.getElementById(AVISO_ID)) criarAviso().abrir(null);
      return;
    }
    const antigo = document.getElementById(AVISO_ID);
    if (antigo) antigo.remove();
    const aviso = criarAviso();
    atividades.after(criarAba(atividades, aviso));
  }

  async function aplicar() {
    if (!ligado) { deveMostrar = false; remover(); return; }
    const { cscAcervoCaminhos } = await chrome.storage.local.get({ cscAcervoCaminhos: CAMINHOS_ACERVO_PADRAO });
    if (!ligado) return;
    deveMostrar = !!caminhoQueBate(cscAcervoCaminhos);
    if (deveMostrar) mostrar();
    else remover();
  }

  acompanharChave(
    () => { ligado = true; aplicar(); },
    () => { ligado = false; aplicar(); },
  );
  chrome.storage.onChanged.addListener((mudancas, area) => {
    if (area === 'local' && 'cscAcervoCaminhos' in mudancas) aplicar();
  });

  // Se um postback parcial redesenhar as abas, a do Acervo volta.
  let timer;
  new MutationObserver(() => {
    if (!deveMostrar || document.getElementById(ABA_ID)) return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (deveMostrar) mostrar(); }, 300);
  }).observe(document.body, { childList: true, subtree: true });
})();
