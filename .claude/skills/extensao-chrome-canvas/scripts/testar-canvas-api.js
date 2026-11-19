// Teste do modelo assets/canvas-api.js com um Canvas falso (Node puro, sem dependências).
// Uso: node scripts/testar-canvas-api.js   (de qualquer pasta)
// Rode de novo sempre que mexer no canvasMain.
'use strict';
const path = require('path');
const MODELO = path.join(__dirname, '..', 'assets', 'canvas-api.js');

// setTimeout instantâneo, registrando as esperas pedidas.
let esperas = [];
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms) => { esperas.push(ms || 0); return realSetTimeout(fn, 0); };

global.document = {
  cookie: 'foo=1; _csrf_token=abc%2B123%3D%3D; bar=2',
  querySelector: () => null,
};
global.location = { pathname: '/courses/111/pages/x' };

let calls = [];
let script = [];   // fila de respostas: (req) => resposta
function resp(status, body, headers = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return { status, ok: status >= 200 && status < 300, headers: { get: k => (h.has(k.toLowerCase()) ? h.get(k.toLowerCase()) : null) }, text: async () => body };
}
global.fetch = async (url, opts = {}) => {
  calls.push({ url, ...opts });
  const next = script.shift();
  if (!next) throw new Error('fetch inesperado: ' + url);
  return next({ url, ...opts });
};

const { canvasMain } = require(MODELO);
let falhas = 0, total = 0;
async function caso(nome, fn) {
  total++;
  calls = []; script = []; esperas = [];
  global.location.pathname = '/courses/111/pages/x';
  try { await fn(); console.log('ok   ', nome); }
  catch (e) { falhas++; console.log('FALHA', nome, '—', e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  await caso('GET com prefixo while(1); é lido', async () => {
    script.push(() => resp(200, 'while(1);{"body":"<p>oi</p>","updated_at":"2026-01-01T00:00:00Z","last_edited_by":{"display_name":"Ana"}}'));
    const r = await canvasMain('lerPagina', { courseId: '111', url: 'tópico 1' });
    assert(!r.__error, r.__error);
    assert(r.body === '<p>oi</p>' && r.editor === 'Ana', JSON.stringify(r));
    assert(calls[0].url === '/api/v1/courses/111/pages/t%C3%B3pico%201', calls[0].url);
    assert(!calls[0].headers['X-CSRF-Token'], 'GET não leva CSRF');
  });

  await caso('paginação pelo Link + módulo sem items busca à parte', async () => {
    script.push(() => resp(200, JSON.stringify([{ id: 1, name: 'M1', items: [{ type: 'Page', page_url: 'a', title: 'A' }] }]),
      { Link: '</api/v1/courses/111/modules?page=2>; rel="next", </x>; rel="last"' }));
    script.push(() => resp(200, JSON.stringify([{ id: 2, name: 'M2' }])));
    script.push(() => resp(200, JSON.stringify([{ type: 'Page', page_url: 'b', title: 'B' }, { type: 'Assignment', title: 'T' }])));
    const r = await canvasMain('modulos', { courseId: '111' });
    assert(!r.__error, r.__error);
    assert(r.length === 2 && r[1].paginas.length === 1 && r[1].paginas[0].url === 'b', JSON.stringify(r));
    assert(calls[1].url.includes('page=2') && calls[2].url.endsWith('/modules/2/items?per_page=100'), calls.map(c => c.url).join(' | '));
    assert(r[0].id === '1', 'id como texto');
  });

  await caso('403 Rate Limit Exceeded → espera e repete', async () => {
    script.push(() => resp(403, '403 Forbidden (Rate Limit Exceeded)'));
    script.push(() => resp(200, '{"body":"x"}'));
    const r = await canvasMain('lerPagina', { courseId: '111', url: 'x' });
    assert(!r.__error && r.body === 'x', JSON.stringify(r));
    assert(calls.length === 2, 'duas chamadas');
    assert(esperas.some(ms => ms >= 2000), 'esperou ≥ 2 s: ' + esperas);
  });

  await caso('429 persistente → desiste depois de 4 novas tentativas', async () => {
    for (let i = 0; i < 6; i++) script.push(() => resp(429, 'Too Many Requests'));
    const r = await canvasMain('lerPagina', { courseId: '111', url: 'x' });
    assert(r.__error && /limite de requisições/.test(r.__error), JSON.stringify(r));
    assert(calls.length === 5, 'chamadas: ' + calls.length);
    const longas = esperas.filter(ms => ms >= 2000);
    assert(longas.length === 4 && longas[3] >= 16000, 'esperas: ' + esperas);
  });

  await caso('Retry-After do servidor é respeitado (com teto)', async () => {
    script.push(() => resp(429, '', { 'Retry-After': '7' }));
    script.push(() => resp(200, '{"body":"x"}'));
    await canvasMain('lerPagina', { courseId: '111', url: 'x' });
    assert(esperas.some(ms => ms >= 7000 && ms < 7600), 'esperas: ' + esperas);
  });

  await caso('403 de permissão (não é limite) não é repetido', async () => {
    script.push(() => resp(403, '{"status":"unauthorized","errors":[{"message":"user not authorized to perform that action"}]}'));
    const r = await canvasMain('lerPagina', { courseId: '111', url: 'x' });
    assert(r.__error && /not authorized/.test(r.__error) && calls.length === 1, JSON.stringify(r));
  });

  await caso('balde quase vazio → pausa de 5 s depois do GET', async () => {
    script.push(() => resp(200, '{"body":"x"}', { 'X-Rate-Limit-Remaining': '40.5' }));
    await canvasMain('lerPagina', { courseId: '111', url: 'x' });
    assert(esperas.includes(5000), 'esperas: ' + esperas);
  });

  await caso('balde cheio → GET sem pausa', async () => {
    script.push(() => resp(200, '{"body":"x"}', { 'X-Rate-Limit-Remaining': '650' }));
    await canvasMain('lerPagina', { courseId: '111', url: 'x' });
    assert(esperas.length === 0, 'esperas: ' + esperas);
  });

  await caso('escrita sem confirmação é bloqueada sem chamar o Canvas', async () => {
    const r = await canvasMain('gravarPagina', { courseId: '111', url: 'x', body: '<p>novo</p>' });
    assert(r.__error && /não foi confirmado/.test(r.__error) && calls.length === 0, JSON.stringify(r));
  });

  await caso('escrita com número de outro curso é bloqueada', async () => {
    const r = await canvasMain('gravarPagina', { courseId: '111', confirmado: '112', url: 'x', body: 'y' });
    assert(r.__error && /não foi confirmado/.test(r.__error) && calls.length === 0, JSON.stringify(r));
  });

  await caso('escrita em curso somente leitura é bloqueada', async () => {
    const r = await canvasMain('gravarPagina', { courseId: '111', confirmado: '111', somenteLeitura: [111], url: 'x', body: 'y' });
    assert(r.__error && /somente leitura/.test(r.__error) && calls.length === 0, JSON.stringify(r));
  });

  await caso('escrita com a aba em outro curso é bloqueada', async () => {
    global.location.pathname = '/courses/999/modules';
    const r = await canvasMain('gravarPagina', { courseId: '111', confirmado: '111', url: 'x', body: 'y' });
    assert(r.__error && /a aba saiu do curso/.test(r.__error) && calls.length === 0, JSON.stringify(r));
  });

  await caso('escrita confirmada: PUT com CSRF decodificado, só o corpo, pausa mínima', async () => {
    script.push(req => resp(200, JSON.stringify({ body: JSON.parse(req.body).wiki_page.body + ' ' })));
    const r = await canvasMain('gravarPagina', { courseId: '111', confirmado: '111', url: 'tópico-1', body: '<p>novo</p>' });
    assert(!r.__error, r.__error);
    const c = calls[0];
    assert(c.method === 'PUT' && c.url === '/api/v1/courses/111/pages/t%C3%B3pico-1', c.method + ' ' + c.url);
    assert(c.headers['X-CSRF-Token'] === 'abc+123==', 'csrf: ' + c.headers['X-CSRF-Token']);
    assert(c.headers['Content-Type'] === 'application/json' && c.credentials === 'same-origin', 'cabeçalhos');
    assert(JSON.stringify(JSON.parse(c.body)) === '{"wiki_page":{"body":"<p>novo</p>"}}', c.body);
    assert(r.body === '<p>novo</p> ', 'devolve o que o Canvas guardou');
    assert(esperas.includes(400), 'pausa entre escritas: ' + esperas);
  });

  await caso('erro de rede numa escrita NÃO é repetido', async () => {
    script.push(() => { throw new TypeError('Failed to fetch'); });
    script.push(() => resp(200, '{}'));
    const r = await canvasMain('gravarPagina', { courseId: '111', confirmado: '111', url: 'x', body: 'y' });
    assert(r.__error && /confira se a mudança entrou/.test(r.__error) && calls.length === 1, JSON.stringify(r) + ' chamadas ' + calls.length);
  });

  await caso('erro de rede numa leitura é repetido', async () => {
    script.push(() => { throw new TypeError('Failed to fetch'); });
    script.push(() => resp(200, '{"body":"x"}'));
    const r = await canvasMain('lerPagina', { courseId: '111', url: 'x' });
    assert(!r.__error && calls.length === 2, JSON.stringify(r));
  });

  await caso('422 de CSRF vira mensagem legível', async () => {
    script.push(() => resp(422, "Can't verify CSRF token authenticity."));
    const r = await canvasMain('gravarPagina', { courseId: '111', confirmado: '111', url: 'x', body: 'y' });
    assert(r.__error && /CSRF/.test(r.__error), JSON.stringify(r));
  });

  await caso('listagem acima do teto → erro, nunca lista cortada', async () => {
    for (let i = 0; i < 60; i++) script.push(() => resp(200, '[{"id":1,"items":[]}]', { Link: '</next>; rel="next"' }));
    const r = await canvasMain('modulos', { courseId: '111' });
    assert(r.__error && /parei por segurança/.test(r.__error) && calls.length === 50, JSON.stringify(r) + ' ' + calls.length);
  });

  await caso('curso inválido e operação desconhecida', async () => {
    const a = await canvasMain('lerPagina', { courseId: '11a', url: 'x' });
    const b = await canvasMain('xyz', { courseId: '111' });
    assert(/curso não informado/.test(a.__error) && /desconhecida/.test(b.__error), JSON.stringify([a, b]));
  });

  await caso('a função é autocontida (serializada e reavaliada continua funcionando)', async () => {
    const recriada = eval('(' + canvasMain.toString() + ')');
    script.push(() => resp(200, '{"body":"z"}'));
    const r = await recriada('lerPagina', { courseId: '111', url: 'x' });
    assert(r.body === 'z', JSON.stringify(r));
  });

  console.log(`\n${total - falhas}/${total} casos OK${falhas ? '' : ' — TUDO OK'}`);
  process.exit(falhas ? 1 : 0);
})();
