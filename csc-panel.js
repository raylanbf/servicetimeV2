// Caminho CSC — tela 🎫 CSC do painel lateral (view-csc em popup.html).
// Busca o link direto de cada serviço do CSC (csc.pucminas.br) entre os
// serviços salvos (cscServicos) e os aprendidos navegando (cscCatalogo) pelos
// scripts csc-*.js. Só lê o que está guardado no Chrome: nenhuma requisição.
// O botão 🎫 do cabeçalho só aparece com a chave cscEnabled ligada (popup.js).
window.CscPanel = (() => {
  const BASE = 'https://csc.pucminas.br/Chamados/';
  const MAX_RESULTADOS = 60;

  // Listas de chamados que já abrem direto pela URL (com os filtros salvos na conta).
  const LISTAS = [
    ['Todos', 'TodosV2'],
    ['Pendentes', 'PendentesV2'],
    ['Minha responsabilidade', 'MinhaResponsabilidadeV2'],
    ['Meus chamados', 'UsuarioV2'],
  ];

  // Tela da árvore de serviços (é navegando nela que se aprendem os serviços).
  const PAGINA_ARVORE = `${BASE}IncidenteV2.aspx?origem=Incidente`;

  // Serviços já descobertos nas gravações (entram nos salvos na 1ª vez).
  const SEMENTES = [
    {
      id: '6548',
      origem: 'Incidente',
      nome: 'Atendimento de SUPORTE AO DOCENTE na Gestão do Ambiente Virtual (apenas para lançamento das horas)',
      caminho: 'CSC - Central de Serviços Compartilhados / Serviços do Núcleo de Educação Digital (NED)',
    },
    {
      id: '6420',
      origem: 'ChamadosGrupo',
      nome: 'Registro de Patentes (Solicitação)',
      caminho: 'CSC - Central de Serviços Compartilhados / Serviços de Pesquisa e Pós-graduação / NIT (Núcleo de inovação tecnológica)',
    },
  ];

  const el = (id) => document.getElementById(id);

  const montarLink = (id, origem) =>
    `${BASE}viewIncidenteDireto.aspx?id=${id}&origem=${encodeURIComponent(origem)}&width=1632&height=756&incidenteid=0&Userid=0`;

  function nomeOrigem(origem) {
    if (origem === 'ChamadosGrupo') return 'Atendente';
    if (origem === 'Incidente') return 'Solicitante';
    return origem;
  }

  const { normalizar } = globalThis.__svcCsc; // csc-comum.js

  async function lerTudo() {
    const dados = await chrome.storage.local.get(['cscServicos', 'cscSemeado', 'cscCatalogo']);
    const servicos = dados.cscServicos || {};
    if (!dados.cscSemeado) {
      const antigo = new Date(0).toISOString();
      for (const s of SEMENTES) {
        const chave = `${s.id}|${s.origem}`;
        if (!servicos[chave]) {
          servicos[chave] = { ...s, link: montarLink(s.id, s.origem), renomeado: false, primeiraVez: antigo, ultimaVez: antigo };
        }
      }
      await chrome.storage.local.set({ cscServicos: servicos, cscSemeado: true });
    }
    return { servicos, catalogo: dados.cscCatalogo || {} };
  }

  const salvarServicos = (servicos) => chrome.storage.local.set({ cscServicos: servicos });

  async function copiar(texto, botao) {
    const original = botao.textContent;
    try {
      await navigator.clipboard.writeText(texto);
      botao.textContent = 'Copiado!';
    } catch (e) {
      botao.textContent = 'Erro ao copiar';
    }
    setTimeout(() => (botao.textContent = original), 1500);
  }

  function criarBotao(texto, classe, aoClicar) {
    const b = document.createElement('button');
    b.textContent = texto;
    if (classe) b.className = classe;
    b.addEventListener('click', aoClicar);
    return b;
  }

  // Junta os serviços salvos com os do catálogo (sem repetir).
  function juntar(servicos, catalogo) {
    const todos = new Map();
    for (const origem of Object.keys(catalogo)) {
      for (const it of Object.values((catalogo[origem] && catalogo[origem].itens) || {})) {
        todos.set(`${it.id}|${origem}`, {
          id: it.id,
          origem,
          nome: it.nome,
          caminho: it.caminho || '',
          grupos: Array.isArray(it.grupos) ? it.grupos : [],
          link: montarLink(it.id, origem),
          salvo: false,
        });
      }
    }
    // O salvo manda no nome e no link; os grupos continuam vindo do catálogo.
    for (const [chave, s] of Object.entries(servicos)) {
      todos.set(chave, { ...todos.get(chave), ...s, salvo: true });
    }
    return todos;
  }

  function pontuar(item, termos, consulta) {
    const nome = normalizar(item.nome);
    const tudo = normalizar(`${item.nome} ${item.caminho} ${item.id} ${(item.grupos || []).join(' ')}`);
    if (!termos.every((t) => tudo.includes(t))) return -1;
    let pontos = termos.filter((t) => nome.includes(t)).length * 10;
    if (item.salvo) pontos += 5;
    // Caminho colado inteiro (ex.: o do cabeçalho do chamado) vai para o topo.
    if (normalizar(`${item.caminho} ${item.nome}`) === consulta) pontos += 1000;
    return pontos;
  }

  function desenharItem(ul, chave, s) {
    const li = document.createElement('li');
    li.className = 'csc-item';

    const nome = document.createElement('div');
    nome.className = 'csc-nome';
    nome.textContent = s.nome;

    const meta = document.createElement('div');
    meta.className = 'csc-meta';
    const tagId = document.createElement('span');
    tagId.className = 'csc-tag';
    tagId.textContent = `ID ${s.id}`;
    const tagOrigem = document.createElement('span');
    tagOrigem.className = 'csc-tag';
    tagOrigem.textContent = nomeOrigem(s.origem);
    meta.append(tagId, tagOrigem, document.createTextNode(s.caminho || ''));

    const acoes = document.createElement('div');
    acoes.className = 'csc-acoes';
    acoes.append(
      criarBotao('Abrir', 'csc-principal', () => chrome.tabs.create({ url: s.link })),
      criarBotao('Copiar link', '', (ev) => copiar(s.link, ev.currentTarget)),
    );
    if (s.salvo) {
      acoes.append(
        criarBotao('Renomear', '', () => renomear(chave, nome)),
        criarBotao('Remover', 'csc-perigo', (ev) => remover(chave, ev.currentTarget)),
      );
    } else {
      acoes.append(criarBotao('☆ Salvar', '', () => salvarDoCatalogo(chave, s)));
    }

    li.append(nome, meta);
    if (s.grupos && s.grupos.length) {
      const grupos = document.createElement('div');
      grupos.className = 'csc-meta';
      grupos.textContent = `Grupos vistos nos chamados: ${s.grupos.join(' · ')}`;
      li.append(grupos);
    }
    li.append(acoes);
    ul.appendChild(li);
  }

  let geracao = 0;      // descarta um desenho que ficou velho (digitação rápida)
  let editando = false; // não redesenha no meio de um "Renomear" (ele redesenha ao terminar)

  async function desenhar() {
    const minha = ++geracao;
    const { servicos, catalogo } = await lerTudo();
    if (minha !== geracao) return;
    // Aceita o cabeçalho do chamado colado inteiro: "Código 1028224 - Csc - central de .../suporte ao canvas".
    const consulta = normalizar(el('csc-busca').value).replace(/^codigo \d+ /, '');
    const termos = consulta.split(' ').filter(Boolean);
    const ul = el('csc-servicos');
    const aviso = el('csc-aviso');
    ul.innerHTML = '';
    aviso.textContent = '';
    desenharCatalogo(catalogo);

    const todos = [...juntar(servicos, catalogo).entries()];
    let lista;
    if (!termos.length) {
      el('csc-titulo').textContent = 'Serviços salvos';
      lista = todos
        .filter(([, s]) => s.salvo)
        .sort(([, a], [, b]) => (b.ultimaVez || '').localeCompare(a.ultimaVez || ''));
    } else {
      el('csc-titulo').textContent = 'Resultados da busca';
      lista = todos
        .map(([chave, s]) => [chave, s, pontuar(s, termos, consulta)])
        .filter(([, , p]) => p >= 0)
        .sort(([, a, pa], [, b, pb]) => pb - pa || a.nome.length - b.nome.length)
        .map(([chave, s]) => [chave, s]);
      if (lista.length > MAX_RESULTADOS) {
        aviso.textContent = `Mostrando ${MAX_RESULTADOS} de ${lista.length}. Digite mais palavras para refinar.`;
        lista = lista.slice(0, MAX_RESULTADOS);
      }
    }

    if (!lista.length) {
      const li = document.createElement('li');
      li.className = 'csc-vazio';
      li.textContent = termos.length
        ? 'Nenhum serviço encontrado. Tente outras palavras (sem acento também funciona). ' +
          'Se ainda não achar, abra na árvore do CSC a pasta onde o serviço fica, ou abra um chamado ' +
          'desse serviço: o Service Timer aprende na hora.'
        : 'Nenhum serviço salvo ainda.';
      ul.appendChild(li);
      return;
    }

    for (const [chave, s] of lista) desenharItem(ul, chave, s);
  }

  function desenharCatalogo(catalogo) {
    const partes = ['Incidente', 'ChamadosGrupo'].map((origem) => {
      const c = catalogo[origem];
      const total = c && c.itens ? Object.keys(c.itens).length : 0;
      return `${nomeOrigem(origem)}: ${total} serviço${total === 1 ? '' : 's'}`;
    });
    el('csc-status').textContent = `Conhecidos até agora: ${partes.join(' · ')}`;
  }

  async function salvarDoCatalogo(chave, s) {
    const { servicos } = await lerTudo();
    const agora = new Date().toISOString();
    servicos[chave] = {
      id: s.id,
      origem: s.origem,
      link: s.link,
      nome: s.nome,
      renomeado: false,
      caminho: s.caminho,
      primeiraVez: agora,
      ultimaVez: agora,
    };
    await salvarServicos(servicos);
  }

  function renomear(chave, divNome) {
    const atual = divNome.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = atual;
    divNome.textContent = '';
    divNome.appendChild(input);
    editando = true;
    input.focus();
    input.select();

    let terminou = false;
    async function concluir(salvar) {
      if (terminou) return;
      terminou = true;
      editando = false;
      const novo = input.value.trim();
      if (salvar && novo && novo !== atual) {
        const { servicos } = await lerTudo();
        if (servicos[chave]) {
          servicos[chave].nome = novo;
          servicos[chave].renomeado = true;
          await salvarServicos(servicos);
          return; // o onChanged redesenha
        }
      }
      desenhar();
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') concluir(true);
      if (e.key === 'Escape') concluir(false);
    });
    input.addEventListener('blur', () => concluir(true));
  }

  // Remover pede um segundo clique para confirmar.
  async function remover(chave, botao) {
    if (!botao.classList.contains('confirmar')) {
      botao.classList.add('confirmar');
      botao.textContent = 'Confirmar?';
      setTimeout(() => {
        botao.classList.remove('confirmar');
        botao.textContent = 'Remover';
      }, 3000);
      return;
    }
    const { servicos } = await lerTudo();
    delete servicos[chave];
    await salvarServicos(servicos);
  }

  function desenharListas() {
    const div = el('csc-listas');
    for (const [nome, pagina] of LISTAS) {
      const b = criarBotao(nome, 'csc-chip', () => chrome.tabs.create({ url: BASE + pagina }));
      b.title = BASE + pagina;
      div.appendChild(b);
    }
  }

  const visivel = () => el('view-csc').classList.contains('active');

  el('csc-busca').addEventListener('input', desenhar);
  el('btn-csc-arvore').addEventListener('click', () => chrome.tabs.create({ url: PAGINA_ARVORE }));
  el('btn-csc-copiar-todos').addEventListener('click', async (ev) => {
    const { servicos } = await lerTudo();
    const linhas = [
      'LISTAS DE CHAMADOS',
      ...LISTAS.map(([nome, pagina]) => `${nome}: ${BASE}${pagina}`),
      '',
      'SERVIÇOS',
      ...Object.values(servicos).map((s) => `${s.nome} (${nomeOrigem(s.origem)}): ${s.link}`),
    ];
    copiar(linhas.join('\n'), ev.currentTarget);
  });

  // Com o painel aberto ao lado do CSC, a lista se atualiza enquanto você navega.
  chrome.storage.onChanged.addListener((mudancas, area) => {
    if (area !== 'local' || !(mudancas.cscServicos || mudancas.cscCatalogo)) return;
    if (!visivel()) return;
    if (!editando) desenhar();
  });

  desenharListas();

  return {
    // Chamado pelo botão 🎫 do cabeçalho, antes de mostrar a tela.
    abrir() {
      desenhar();
      setTimeout(() => el('csc-busca').focus(), 0);
    },
  };
})();
