// Caminho CSC — tela de um chamado que já existe (viewHistoricoChamado.aspx, a
// janelinha que abre pelas listas Pendentes, Todos, Meus chamados...).
// A página traz em campos escondidos o ID do serviço e o caminho dele:
//   hidCatalogoServicosId = "4952"
//   hidDesc               = "CSC - Central.../Serviços de TI/Rede Acadêmica/Acesso Canvas/Suporte ao Canvas"
// e, na aba Histórico, a coluna "Grupo" com as filas por onde o chamado passou.
// Este script lê SÓ isso e põe no catálogo (cscCatalogo), para a busca do
// painel achar o link pelo caminho ou pelo grupo. Não lê o conteúdo do chamado
// (descrição, solicitante etc.) e não faz nenhuma requisição.
(() => {
  if (!/\/chamados\/viewhistoricochamado\.aspx$/i.test(location.pathname)) return;

  // O link de abertura usa a árvore de solicitante ("Abertura de chamado").
  const ORIGEM = 'Incidente';

  const valor = (id) => {
    const el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  };

  // S = serviço final (o mesmo "S" do 2º campo do valor dos itens da árvore).
  const tipoItem = valor('hidTipoItem');
  if (tipoItem && tipoItem !== 'S') return;

  const id = valor('hidCatalogoServicosId') || valor('hidServicoID');
  const descricao = valor('hidDesc');
  if (!/^\d+$/.test(id) || id === '0' || !descricao) return;

  const partes = descricao.split('/').map((p) => p.trim()).filter(Boolean);
  const nome = partes.pop();
  const caminho = partes.join(' / ');

  // Texto comparável: sem acento, minúsculo, espaços simples.
  const simples = (t) =>
    String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

  // Grupos (filas) da coluna "Grupo" da aba Histórico. Só conta as linhas em que a coluna
  // "Serviço" é este mesmo serviço: se o chamado foi reclassificado, as linhas antigas
  // são de outro serviço.
  function lerGrupos() {
    const titulos = [...document.querySelectorAll('#gridHistorico th.rgHeader')].map((th) => simples(th.textContent));
    const colGrupo = titulos.indexOf('grupo');
    const colServico = titulos.indexOf('servico');
    if (colGrupo < 0) return [];

    const grupos = [];
    for (const tr of document.querySelectorAll('#gridHistorico_ctl00 > tbody > tr')) {
      const celulas = tr.children;
      if (celulas.length <= Math.max(colGrupo, colServico)) continue; // linha "nenhum registro"
      if (colServico >= 0 && simples(celulas[colServico].textContent) !== simples(descricao)) continue;
      const grupo = celulas[colGrupo].textContent.replace(/\s+/g, ' ').trim();
      if (grupo && !grupos.includes(grupo)) grupos.push(grupo);
    }
    return grupos;
  }

  async function guardar() {
    const grupos = lerGrupos();
    const { cscCatalogo = {} } = await chrome.storage.local.get('cscCatalogo');
    let conhecido = false;
    let mudou = false;

    // Acrescenta os grupos que o item ainda não tinha.
    const juntarGrupos = (it) => {
      const antes = Array.isArray(it.grupos) ? it.grupos : [];
      const novos = grupos.filter((g) => !antes.includes(g));
      if (novos.length) it.grupos = [...antes, ...novos];
      return novos.length > 0;
    };

    // O serviço já está no catálogo (em qualquer origem)?
    // Nome e caminho: o que veio da árvore manda; o que veio de um chamado é atualizado.
    // Grupos: sempre acrescenta os novos.
    for (const c of Object.values(cscCatalogo)) {
      for (const it of Object.values((c && c.itens) || {})) {
        if (!it || String(it.id) !== id) continue;
        conhecido = true;
        if (it.fonte === 'chamado' && (it.nome !== nome || it.caminho !== caminho)) {
          it.nome = nome;
          it.caminho = caminho;
          mudou = true;
        }
        if (juntarGrupos(it)) mudou = true;
      }
    }

    if (!conhecido) {
      const atual = globalThis.__svcCsc.normalizarCatalogo(cscCatalogo[ORIGEM]);
      atual.itens[id] = { id, nome, caminho, tipo: '', fonte: 'chamado', grupos };
      atual.atualizado = new Date().toISOString();
      cscCatalogo[ORIGEM] = atual;
      mudou = true;
    }

    if (mudou) await chrome.storage.local.set({ cscCatalogo });
  }

  // Lê uma vez só por página, quando a chave estiver ligada.
  let feito = false;
  globalThis.__svcCsc.acompanharChave(() => {
    if (feito) return;
    feito = true;
    guardar().catch((e) => console.warn('[Service Timer · CSC] erro ao salvar o serviço do chamado:', e));
  });
})();
