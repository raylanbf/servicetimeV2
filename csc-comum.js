// Caminho CSC — peças comuns aos scripts do mundo isolado em csc.pucminas.br
// (csc-content.js, csc-chamado.js, csc-acervo.js e csc-arvore.js). O painel
// (popup.html) também carrega este arquivo, pelo normalizar e pela lista
// padrão do Acervo; ao carregar, nada aqui mexe na página.
//
// Tudo aqui só LÊ a tela: nenhum script do CSC faz requisição ao servidor.
// Liga e desliga em ⚙ Configurações › CSC (cscEnabled, padrão desligado);
// vale na hora, nas abas do CSC já abertas.
//
// Veio da extensão Caminho CSC (C:\Users\Casa\csc-links-extensao, v1.4.0),
// com dados e mensagens de nomes próprios (cscServicos, cscCatalogo, stCsc),
// para não misturar com ela se as duas estiverem instaladas.
globalThis.__svcCsc = globalThis.__svcCsc || (() => {
  const CHAVE = 'cscEnabled';

  // Serviços cujos chamados precisam ser reencaminhados ao Acervo depois do
  // atendimento (lembrete do csc-acervo.js). Vale enquanto a lista em
  // ⚙ Configurações › CSC (cscAcervoCaminhos) nunca tiver sido salva.
  const CAMINHOS_ACERVO_PADRAO = [
    'CSC - Central de Serviços Compartilhados/Serviços do Núcleo de Educação Digital (NED)/Pós-graduação Lato Sensu/Produção/criação de conteúdos/Gravar videoaula',
  ];

  // Texto "comparável": sem acento, minúsculo, e / > | - _ viram espaço.
  // Assim o caminho do hidDesc, o do cabeçalho do chamado (todo minúsculo)
  // e o digitado na busca batem entre si.
  function normalizar(texto) {
    return String(texto || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[\/>»|\\\-–—_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Chama aoLigar quando a chave está (ou passa a ficar) ligada, e aoDesligar
  // quando passa a ficar desligada.
  function acompanharChave(aoLigar, aoDesligar) {
    let ligado = false;
    const aplicar = (on) => {
      on = !!on;
      if (on === ligado) return;
      ligado = on;
      const fn = on ? aoLigar : aoDesligar;
      if (fn) fn();
    };
    chrome.storage.local.get({ [CHAVE]: false })
      .then((c) => aplicar(c[CHAVE]))
      .catch(() => {});
    chrome.storage.onChanged.addListener((mudancas, area) => {
      if (area === 'local' && CHAVE in mudancas) aplicar(mudancas[CHAVE].newValue);
    });
  }

  // Formulário de abertura de um serviço: o mesmo endereço que o CSC monta no
  // duplo clique da árvore (AbreTela). width/height não mudam o serviço.
  // origem: Incidente = solicitante; ChamadosGrupo = atendente.
  function montarLink(origin, id, origem) {
    return `${origin}/Chamados/viewIncidenteDireto.aspx?id=${id}&origem=${encodeURIComponent(origem)}&width=1632&height=756&incidenteid=0&Userid=0`;
  }

  async function copiar(texto) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  // Catálogo por origem: { itens: { [id]: { id, nome, caminho, tipo, fonte?, grupos? } }, atualizado }.
  function normalizarCatalogo(c) {
    const itens = {};
    if (c && c.itens) {
      for (const it of Object.values(c.itens)) if (it && it.id) itens[it.id] = it;
    }
    return { atualizado: (c && c.atualizado) || null, itens };
  }

  return { CAMINHOS_ACERVO_PADRAO, normalizar, acompanharChave, montarLink, copiar, normalizarCatalogo };
})();
