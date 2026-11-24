// Caminho CSC — formulário de abertura de um serviço (viewIncidenteDireto.aspx,
// a janelinha interna que o CSC abre no duplo clique da árvore, ou
// AberturaChamado.aspx). Salva o serviço em "Serviços salvos" (cscServicos) e
// mostra a barrinha "Copiar link direto" no canto da tela.
// Roda em todos os frames, porque o formulário abre dentro de um iframe.
(() => {
  const caminhoPagina = location.pathname.toLowerCase();
  const ehViewDireto = caminhoPagina.endsWith('/chamados/viewincidentedireto.aspx');
  const ehAberturaPagina = caminhoPagina.endsWith('/chamados/aberturachamado.aspx');
  if (!ehViewDireto && !ehAberturaPagina) return;

  const params = new URLSearchParams(location.search);
  const id = params.get('id') || '';
  const origem = params.get('origem') || 'Incidente';
  const incidenteid = params.get('incidenteid') || '0';

  // id 0 = botão "Novo chamado" genérico (sem serviço escolhido).
  // incidenteid diferente de 0 = chamado que já existe (não é abertura).
  if (!/^\d+$/.test(id) || id === '0' || incidenteid !== '0') return;

  const { acompanharChave, montarLink, copiar } = globalThis.__svcCsc;

  // Link "limpo", no mesmo formato que já foi testado e funcionou.
  const link = ehViewDireto
    ? montarLink(location.origin, id, origem)
    : `${location.origin}${location.pathname}?id=${id}&origem=${encodeURIComponent(origem)}&OrigemChamadaAbertura=Arvore`;

  const PREFIXO = 'abertura de chamado para o serviço';
  const HOST_ID = 'st-csc-barra';

  // Procura o título "Abertura de chamado para o serviço ..." e devolve o que vem depois.
  function lerCaminhoServico() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let no;
    while ((no = walker.nextNode())) {
      if (!no.nodeValue.toLowerCase().includes(PREFIXO)) continue;
      let el = no.parentElement;
      for (let i = 0; i < 3 && el; i++) {
        const texto = el.textContent.replace(/\s+/g, ' ').trim();
        const pos = texto.toLowerCase().indexOf(PREFIXO);
        const resto = texto.slice(pos + PREFIXO.length).replace(/^[\s:\-]+/, '').trim();
        if (resto) return resto;
        el = el.parentElement;
      }
    }
    return '';
  }

  const capitalizar = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

  async function salvar(caminhoServ) {
    const partes = caminhoServ.split('/').map((p) => capitalizar(p.trim())).filter(Boolean);
    const nomeLido = partes.length ? partes[partes.length - 1] : `Serviço ${id}`;
    const chave = `${id}|${origem}`;
    const agora = new Date().toISOString();

    const { cscServicos = {} } = await chrome.storage.local.get('cscServicos');
    const antigo = cscServicos[chave];
    cscServicos[chave] = {
      id,
      origem,
      link,
      nome: antigo && antigo.renomeado ? antigo.nome : nomeLido,
      renomeado: !!(antigo && antigo.renomeado),
      caminho: partes.length ? partes.join(' / ') : (antigo && antigo.caminho) || '',
      primeiraVez: (antigo && antigo.primeiraVez) || agora,
      ultimaVez: agora,
    };
    await chrome.storage.local.set({ cscServicos });
    return { novo: !antigo, nome: cscServicos[chave].nome };
  }

  // Barrinha flutuante. Fica num shadow DOM para o visual do site não
  // bagunçar o da extensão (e vice-versa).
  function mostrarBarra(nome, novo) {
    if (document.getElementById(HOST_ID)) return;
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;';
    const sombra = host.attachShadow({ mode: 'open' });
    sombra.innerHTML = `
      <style>
        .barra { font: 13px/1.35 Segoe UI, Arial, sans-serif; background: #1f2937; color: #f9fafb;
                 border-radius: 10px; padding: 10px 12px; box-shadow: 0 6px 20px rgba(0,0,0,.35);
                 max-width: 420px; display: flex; flex-direction: column; gap: 8px; }
        .topo { display: flex; align-items: flex-start; gap: 8px; }
        .nome { font-weight: 600; flex: 1; word-break: break-word; }
        .status { color: #86efac; font-size: 12px; }
        .acoes { display: flex; gap: 6px; }
        button { font: inherit; border: 0; border-radius: 6px; padding: 6px 10px; cursor: pointer; }
        .copiar { background: #3b82f6; color: #fff; }
        .copiar:hover { background: #2563eb; }
        .fechar { background: transparent; color: #9ca3af; padding: 0 4px; font-size: 16px; line-height: 1; }
        .fechar:hover { color: #fff; }
      </style>
      <div class="barra">
        <div class="topo">
          <span>🎫</span>
          <span class="nome"></span>
          <button class="fechar" title="Fechar">×</button>
        </div>
        <div class="status"></div>
        <div class="acoes"><button class="copiar">Copiar link direto</button></div>
      </div>`;
    sombra.querySelector('.nome').textContent = nome;
    sombra.querySelector('.status').textContent = novo
      ? 'Link novo descoberto e salvo no Service Timer (🎫 CSC).'
      : 'Este link já estava salvo no Service Timer (🎫 CSC).';
    sombra.querySelector('.fechar').addEventListener('click', () => host.remove());
    const btn = sombra.querySelector('.copiar');
    btn.addEventListener('click', async () => {
      const ok = await copiar(link);
      btn.textContent = ok ? 'Copiado!' : 'Não consegui copiar';
      setTimeout(() => (btn.textContent = 'Copiar link direto'), 2000);
    });
    document.documentElement.appendChild(host);
  }

  let ligado = false;
  let tentativas = 0;

  // O título às vezes demora um pouco para aparecer: tenta algumas vezes.
  function iniciar() {
    if (!ligado) return;
    const caminhoServ = lerCaminhoServico();
    if (!caminhoServ && tentativas < 4) {
      tentativas++;
      setTimeout(iniciar, 800);
      return;
    }
    salvar(caminhoServ)
      .then(({ novo, nome }) => { if (ligado) mostrarBarra(nome, novo); })
      .catch((e) => console.warn('[Service Timer · CSC] erro ao salvar o serviço:', e));
  }

  acompanharChave(
    () => { ligado = true; tentativas = 0; iniciar(); },
    () => { ligado = false; const host = document.getElementById(HOST_ID); if (host) host.remove(); },
  );
})();
