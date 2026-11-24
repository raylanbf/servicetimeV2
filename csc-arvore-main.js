// Caminho CSC — árvore de serviços (IncidenteV2.aspx), no mundo da própria
// página (world: MAIN), para enxergar os objetos do Telerik ($find).
// 1) Lê SOMENTE os serviços que já estão carregados na árvore (as pastas que
//    você abriu navegando). Não abre pastas e não faz requisição ao servidor.
// 2) No botão direito em cima de um serviço, avisa o csc-arvore.js para mostrar
//    o menu "Copiar link do serviço".
// Fica parado até o csc-arvore.js dizer "pronto" (chave cscEnabled ligada).
// Sem isso, o botão direito ficaria sem menu nenhum com a chave desligada,
// porque é aqui que o menu normal do Chrome é bloqueado.
(() => {
  if (window.top !== window) return;
  if (!/\/chamados\/incidentev2\.aspx$/i.test(location.pathname)) return;

  const ID_ARVORE = 'ctl00_MainContent_rdTreeView';
  const elArvore = document.getElementById(ID_ARVORE);
  if (!elArvore) return;

  const campoOrigem = document.getElementById('MainContent_hidorigem');
  const origem = (campoOrigem && campoOrigem.value) || new URLSearchParams(location.search).get('origem') || '';
  if (origem !== 'Incidente' && origem !== 'ChamadosGrupo') return;

  let ativo = false;
  const enviar = (dados) => window.postMessage({ stCsc: 'main', ...dados }, location.origin);
  const pegarArvore = () => (typeof window.$find === 'function' ? window.$find(ID_ARVORE) : null);
  const textoDo = (no) => (no.get_text() || '').replace(/\s+/g, ' ').trim();

  // Valor do item: "ID;S/N;...;tipo;..."  (S no 2º campo = serviço final)
  function lerServico(no) {
    const partes = String(no.get_value() || '').split(';');
    if (partes[1] === 'S' && /^\d+$/.test(partes[0])) return { id: partes[0], tipo: partes[3] || '' };
    return null;
  }

  // Percorre só o que já está carregado. get_nodes() de uma pasta que nunca
  // foi aberta vem vazio (nada é pedido ao servidor).
  function percorrer(arvore, aoVisitar) {
    const visitar = (colecao, caminho) => {
      for (let i = 0; i < colecao.get_count(); i++) {
        const no = colecao.getNode(i);
        if (aoVisitar(no, caminho) === false) return false;
        if (!lerServico(no) && visitar(no.get_nodes(), [...caminho, textoDo(no)]) === false) return false;
      }
      return true;
    };
    visitar(arvore.get_nodes(), []);
  }

  // ---------- 1) Aprender os serviços visíveis ----------
  let ultimaAssinatura = '';
  function lerArvore() {
    if (!ativo) return;
    const arvore = pegarArvore();
    if (!arvore) return;
    const itens = [];
    percorrer(arvore, (no, caminho) => {
      const s = lerServico(no);
      if (s) itens.push({ id: s.id, nome: textoDo(no), caminho: caminho.join(' / '), tipo: s.tipo });
    });
    const assinatura = itens.map((it) => it.id).join(',');
    if (!itens.length || assinatura === ultimaAssinatura) return;
    ultimaAssinatura = assinatura;
    enviar({ tipo: 'servicos', itens });
  }

  let timer;
  const agendar = () => {
    clearTimeout(timer);
    timer = setTimeout(lerArvore, 500);
  };
  new MutationObserver(() => { if (ativo) agendar(); }).observe(elArvore, { childList: true, subtree: true });

  // Conversa com o csc-arvore.js: "pronto" liga (e manda a lista de novo,
  // caso a leitura anterior tenha se perdido); "desligado" para tudo.
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.stCsc !== 'isolado') return;
    if (ev.data.tipo === 'pronto') {
      ativo = true;
      ultimaAssinatura = '';
      agendar();                 // pastas que já vieram abertas
      setTimeout(agendar, 2500); // caso o Telerik ainda não estivesse pronto
    } else if (ev.data.tipo === 'desligado') {
      ativo = false;
      clearTimeout(timer);
    }
  });
  // Se o csc-arvore.js chegou antes e o "pronto" se perdeu, ele responde a este "olá".
  enviar({ tipo: 'ola' });

  // ---------- 2) Botão direito em cima de um serviço ----------
  elArvore.addEventListener('contextmenu', (ev) => {
    if (!ativo) return;
    const li = ev.target && ev.target.closest ? ev.target.closest('li.rtLI') : null;
    const arvore = pegarArvore();
    if (!li || !arvore || !elArvore.contains(li)) return;

    let achado = null;
    percorrer(arvore, (no, caminho) => {
      if (no.get_element() === li) {
        achado = { no, caminho };
        return false; // para de procurar
      }
      return true;
    });
    if (!achado) return;
    const s = lerServico(achado.no);
    if (!s) return; // pasta: deixa o menu normal do Chrome

    ev.preventDefault();
    enviar({
      tipo: 'menu',
      x: ev.clientX,
      y: ev.clientY,
      servico: { id: s.id, nome: textoDo(achado.no), caminho: achado.caminho.join(' / '), tipo: s.tipo },
    });
  });
})();
