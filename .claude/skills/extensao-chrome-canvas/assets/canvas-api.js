'use strict';
/*
 * Modelo de acesso à API do Canvas pela sessão do usuário
 * Skill extensao-chrome-canvas · Autor: Raylan B. Fraga
 *
 * DUAS PARTES
 *   1. canvasMain(op, p)  — roda NA ABA do Canvas, injetada por
 *      chrome.scripting.executeScript. É SERIALIZADA: não enxerga nada de fora
 *      dela. Tudo entra por `p` e tudo sai como JSON.
 *   2. abaDoCurso() e execCanvas() — rodam no painel lateral (ou no service
 *      worker) e chamam a parte 1.
 *
 * O QUE O MODELO GARANTE
 *   • sessão de quem está logado (cookies) + X-CSRF-Token do cookie _csrf_token;
 *   • um pedido por vez, com pausa conforme X-Rate-Limit-Remaining;
 *   • nova tentativa, com espera crescente, quando o Canvas recusa por limite
 *     (403 "Rate Limit Exceeded" ou 429): ele recusa sem processar, então
 *     repetir não duplica nada;
 *   • erro de rede numa ESCRITA não é repetido às cegas (pode ter entrado);
 *   • listagens completas (cabeçalho Link) ou erro — nunca uma lista cortada;
 *   • escrita só pela porta write(): curso confirmado pelo número, que não
 *     seja somente leitura, com a aba ainda nele, e sem DELETE não autorizado;
 *   • erros legíveis, em português, devolvidos como { __error }.
 *
 * COMO ESTENDER
 *   Acrescente operações no bloco "Operações". Leituras: get/getAll.
 *   Escritas: SEMPRE write(). Operação que cria algo deve conferir antes se
 *   já existe (idempotência) — o painel pode repeti-la se a aba recarregar.
 */

// ═════════════════════════════════════════════════════════════════════════
// 1. NA ABA DO CANVAS
// ═════════════════════════════════════════════════════════════════════════
//
// p = {
//   courseId:        '123456'         curso alvo desta chamada (texto)
//   confirmado:      '123456'         número que a pessoa digitou na confirmação
//                                     (só exigido nas escritas)
//   somenteLeitura:  ['654321']       cursos em que nada pode ser gravado
//                                     (ex.: a origem de uma cópia)
//   exigirAba:       true             escrita só se a aba ainda estiver no curso
//                                     (false em operações com vários cursos)
//   permitirApagar:  false            DELETE só com true, e só se foi pedido
//   ...                               dados da operação
// }
function canvasMain(op, p) {
  return (async () => {
    try {
      p = p || {};
      const sleep = ms => new Promise(r => setTimeout(r, ms));

      // ── Ritmo ───────────────────────────────────────────────────────────
      const RITMO = {
        pausaEscritaMs:   400,   // mínimo entre uma escrita e a próxima
        tentativasLimite: 4,     // esperas de 2, 4, 8 e 16 s antes de desistir
        tentativasLeitura: 2,    // GET sem resposta ou com erro 5xx
        maxPaginas:       50,    // teto de uma listagem (50 × 100 = 5000 itens)
      };

      // Pausa depois de cada resposta, pelo que sobrou no balde do usuário.
      // O balde se recompõe devagar (ordem de 10 unidades/s): com pouco
      // sobrando, esperar alguns segundos evita a recusa no pedido seguinte.
      function pausaPelo(restante, metodo) {
        let ms = metodo === 'GET' ? 0 : RITMO.pausaEscritaMs;
        if (Number.isFinite(restante)) {
          if (restante < 50)       ms = Math.max(ms, 5000);
          else if (restante < 150) ms = Math.max(ms, 2000);
          else if (restante < 300) ms = Math.max(ms, 600);
        }
        return ms;
      }

      // ── Sessão ──────────────────────────────────────────────────────────
      // O cookie _csrf_token não é HttpOnly; vem URL-encoded. A meta
      // csrf-token é o plano B (algumas telas antigas).
      function csrfToken() {
        const raw = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('_csrf_token='));
        const val = raw ? raw.slice('_csrf_token='.length)
          : (document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '');
        try { return decodeURIComponent(val); } catch { return val; }
      }

      // Respostas JSON podem vir com o prefixo anti-sequestro "while(1);".
      const parse = text => {
        const t = String(text || '').replace(/^\s*while\(1\);/, '').trim();
        return t ? JSON.parse(t) : null;
      };
      const linkNext = res => (res.headers.get('Link') || '').match(/<([^>]+)>;\s*rel="next"/)?.[1] || null;

      // Mensagem legível a partir da resposta de erro do Canvas.
      function errorText(status, text) {
        let msg = '';
        try {
          const data = parse(text);
          const errs = data && data.errors;
          const list = Array.isArray(errs) ? errs
            : errs && typeof errs === 'object'
              ? Object.entries(errs).flatMap(([campo, v]) => [].concat(v).map(e => `${campo}: ${e?.message || e}`))
              : [];
          msg = list.map(e => (typeof e === 'string' ? e : e?.message || JSON.stringify(e))).join('; ')
             || (data && data.message) || '';
        } catch { /* resposta não é JSON */ }
        if (!msg && status === 401) msg = 'sem permissão — a sessão do Canvas pode ter expirado (recarregue a aba e entre de novo)';
        if (!msg && status === 403) msg = 'sem permissão para isso neste curso';
        if (!msg && status === 404) msg = 'não encontrado';
        if (!msg && status === 422 && /csrf|authenticity/i.test(text)) msg = 'token de segurança (CSRF) recusado — recarregue a aba';
        return `HTTP ${status}${msg ? ' — ' + String(msg).slice(0, 200) : ''}`;
      }

      // Todo pedido ao Canvas passa por aqui: um por vez (quem chama usa
      // await em sequência), com ritmo e novas tentativas seguras.
      async function request(method, url, body) {
        const escrita = method !== 'GET';
        for (let tentativa = 0; ; tentativa++) {
          let res, text;
          try {
            const headers = { Accept: 'application/json' };
            if (escrita) headers['X-CSRF-Token'] = csrfToken();
            if (body !== undefined) headers['Content-Type'] = 'application/json';
            res = await fetch(url, {
              method,
              credentials: 'same-origin',
              headers,
              body: body !== undefined ? JSON.stringify(body) : undefined,
            });
            text = await res.text();
          } catch (err) {
            // Sem resposta: numa leitura, repetir é seguro. Numa escrita, não
            // se sabe se o Canvas gravou — quem chamou tem de reler e conferir.
            if (!escrita && tentativa < RITMO.tentativasLeitura) { await sleep(1500 * (tentativa + 1)); continue; }
            throw new Error(`sem resposta do Canvas (${err && err.message})` +
              (escrita ? ' — confira se a mudança entrou antes de tentar de novo' : ''));
          }

          // Limite de requisições: recusado sem processar → repetir é seguro.
          const limitado = res.status === 429 || (res.status === 403 && /rate limit/i.test(text));
          if (limitado) {
            if (tentativa < RITMO.tentativasLimite) {
              const pedido = Number(res.headers.get('Retry-After')) * 1000;
              const espera = Math.min(pedido > 0 ? pedido : 2000 * 2 ** tentativa, 60000);
              await sleep(espera + Math.random() * 500);
              continue;
            }
            throw new Error('o Canvas continua recusando por limite de requisições — parei aqui; tente de novo em alguns minutos');
          }

          if (res.status >= 500 && !escrita && tentativa < RITMO.tentativasLeitura) {
            await sleep(2000 * (tentativa + 1));
            continue;
          }

          const pausa = pausaPelo(parseFloat(res.headers.get('X-Rate-Limit-Remaining')), method);
          if (pausa) await sleep(pausa);
          if (!res.ok) throw new Error(errorText(res.status, text));
          return { data: parse(text), next: linkNext(res) };
        }
      }

      const get = async url => (await request('GET', url)).data;

      // Todas as páginas de uma listagem, seguindo o cabeçalho Link. Passa do
      // teto → erro: decidir com uma lista cortada é pior do que parar.
      async function getAll(url) {
        const out = [];
        let next = url;
        for (let i = 0; next; i++) {
          if (i >= RITMO.maxPaginas) throw new Error(`a listagem passou de ${RITMO.maxPaginas} páginas — parei por segurança`);
          const pagina = await request('GET', next);
          if (Array.isArray(pagina.data)) out.push(...pagina.data);
          next = pagina.next;
        }
        return out;
      }

      // ── Curso ───────────────────────────────────────────────────────────
      const curso = String(p.courseId || '');
      if (!/^\d+$/.test(curso)) throw new Error('curso não informado');
      const api = `/api/v1/courses/${curso}`;
      const cursoDaAba = () => location.pathname.match(/^\/courses\/(\d+)/)?.[1] || null;

      // ── Única porta de escrita ──────────────────────────────────────────
      async function write(method, path, body) {
        if (method === 'GET') throw new Error('write() é só para escrita');
        if (String(p.confirmado || '') !== curso) {
          throw new Error(`bloqueado: o curso ${curso} não foi confirmado pelo número — nada foi gravado`);
        }
        if ([].concat(p.somenteLeitura || []).map(String).includes(curso)) {
          throw new Error(`bloqueado: o curso ${curso} é somente leitura nesta operação — nada foi gravado`);
        }
        if (p.exigirAba !== false && cursoDaAba() !== curso) {
          throw new Error(`bloqueado: a aba saiu do curso ${curso} — nada foi gravado`);
        }
        if (method === 'DELETE' && p.permitirApagar !== true) {
          throw new Error('bloqueado: apagar não faz parte desta operação');
        }
        return (await request(method, api + path, body)).data;
      }

      // ── Operações (exemplos; acrescente as suas) ────────────────────────

      // Módulos com as páginas de cada um. Módulo grande vem sem "items"
      // no include: a lista dele é buscada à parte.
      if (op === 'modulos') {
        const mods = await getAll(`${api}/modules?include[]=items&per_page=100`);
        const out = [];
        for (const m of mods) {
          const items = Array.isArray(m.items) ? m.items : await getAll(`${api}/modules/${m.id}/items?per_page=100`);
          out.push({
            id: String(m.id), nome: m.name, publicado: !!m.published,
            paginas: items.filter(i => i.type === 'Page' && i.page_url).map(i => ({ url: i.page_url, titulo: i.title })),
          });
        }
        return out;
      }

      if (op === 'lerPagina') {
        const pg = await get(`${api}/pages/${encodeURIComponent(p.url)}`);
        return {
          body: pg.body || '',
          atualizadaEm: pg.updated_at || null,
          editor: pg.last_edited_by?.display_name || '',
        };
      }

      // Grava só o corpo: título, publicação e o resto da página ficam como
      // estão. Devolve o corpo que o Canvas guardou, para a conferência.
      if (op === 'gravarPagina') {
        if (typeof p.body !== 'string') throw new Error('corpo da página não informado');
        const salvo = await write('PUT', `/pages/${encodeURIComponent(p.url)}`, { wiki_page: { body: p.body } });
        return { body: typeof salvo?.body === 'string' ? salvo.body : null };
      }

      return { __error: 'operação desconhecida: ' + op };
    } catch (err) {
      return { __error: (err && err.message) || String(err) };
    }
  })();
}

// ═════════════════════════════════════════════════════════════════════════
// 2. NO PAINEL LATERAL (ou no service worker)
// ═════════════════════════════════════════════════════════════════════════

// Domínios do Canvas da instituição. Sem isto, qualquer site com "/courses/"
// no endereço seria tratado como Canvas.
const CANVAS_HOSTS = [/\.instructure\.com$/i /* , /^canvas\.minhainstituicao\.br$/i */];

// Aba ativa, se for um curso do Canvas: { tabId, courseId, origin }.
async function abaDoCurso() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url = null;
  try { url = new URL(tab?.url || ''); } catch { /* aba sem endereço */ }
  const m = url && url.protocol === 'https:' && CANVAS_HOSTS.some(re => re.test(url.hostname))
    ? url.pathname.match(/^\/courses\/(\d+)/) : null;
  if (!m) throw new Error('Abra uma aba de um curso no Canvas para usar esta ferramenta.');
  return { tabId: tab.id, courseId: m[1], origin: url.origin };
}

// Roda uma operação de canvasMain na aba. Se a aba estiver recarregando (a
// injeção falha ou volta vazia), espera e tenta de novo. Só é seguro para
// operações idempotentes (leituras, PUT do corpo inteiro, criação que confere
// antes se já existe); para as outras, passe { repetir: false }.
async function execCanvas(tabId, op, p, { repetir = true } = {}) {
  const limite = repetir ? 2 : 0;
  for (let tentativa = 0; ; tentativa++) {
    let out;
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: canvasMain, args: [op, p || {}] });
      out = res?.result;
    } catch (err) {
      if (tentativa >= limite) throw new Error('não consegui falar com a aba do Canvas — ' + err.message);
      await new Promise(r => setTimeout(r, 1500));
      continue;
    }
    if (out == null) {
      if (tentativa >= limite) throw new Error('a aba do Canvas não respondeu — ela foi fechada ou saiu do Canvas?');
      await new Promise(r => setTimeout(r, 1500));
      continue;
    }
    if (out.__error) throw new Error(out.__error);
    return out;
  }
}

// Para os testes em Node (a extensão carrega o arquivo como script comum).
if (typeof module !== 'undefined') module.exports = { canvasMain, abaDoCurso, execCanvas, CANVAS_HOSTS };
