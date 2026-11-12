// Regressão da regra do "Inserir vídeos do Studio" (video-slots.js), em Node:
//   node .claude/skills/h5p-quiz/scripts/test-video-slots.js
// As páginas são as de pós "virgens" que a equipe usa (1 e 5 vídeos).
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '../../../..');
const ctx  = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'video-slots.js'), 'utf8'), ctx);
const VS = ctx.window.__svcVideoSlots;

const H4 = t => `<h4><strong><span style="font-size: 14pt; color: #464545; font-family: 'Aleo regular', Verdana, Arial;">${t}</span></strong></h4>`;
const SLOT = (t = '[videoaula]') => `<p style="text-align: center;"><strong>${t}</strong></p>`;
const BLOCK = (t, s) => `                    ${H4(t)}\n                    <p>&nbsp;</p>\n                    ${SLOT(s)}\n                    <p style="text-align: center;">&nbsp;</p>\n`;
const PAGE = blocks => `<div id="topo" class="content-box" style="margin-top: 0;">
    <div id="geral" class="col-xs-12 col-sm-12 col-md-12 col-lg-12 col-xl-12">
        <div id="banner"><img style="min-width: 100%;" src="https://pucminas.instructure.com/courses/238653/files/17034955/download?wrap=1" alt="" width="100%" height="272" data-decorative="true" /></div>
        <div class="grid-row">
            <div id="texto-box" class="col-xs-12 col-sm-12 col-md-12 col-lg-12 col-xl-12">
                <hr />
                <div style="background-color: #ececee; padding: 1%;">
                    <h4><span style="color: #3f9a91;"><strong><span style="font-size: 14pt; font-family: 'Aleo regular', Verdana, Arial;">OBJETIVOS DA AULA</span></strong></span></h4>
                    <p><span style="color: #464545;"><strong>Nesta aula, vamos abordar os seguintes t&oacute;picos:</strong></span></p>
                    <ul>
                        <li>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</li>
                    </ul>
                </div>
                <hr />
                <div style="text-align: justify;">
${blocks}                    <p>&nbsp;</p>
                </div>
            </div>
        </div>
    </div>
</div>`;

const VIDEOS = [
  { id: 'aaaa-1', title: 'ASSOC_01.mp4' },
  { id: 'bbbb-2', title: 'Associações – parte 2' },
  { id: 'cccc-3', title: 'Vídeo 1' },
  { id: 'dddd-4', title: 'Vídeo 10' },
  { id: 'eeee-5', title: 'Repetido' },
  { id: 'ffff-6', title: 'repetido' },
];
const base = { videos: VIDEOS, courseId: 238653, studioDomain: 'pucminas.instructuremedia.com', w: 620, h: 398 };
const row  = (title, video, line = 1) => ({ line, page: 'p', title, video });
// Arrays vêm de outro contexto (vm): compara pelo JSON.
const same = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('✓', name); };

// ── Espaços ─────────────────────────────────────────────────────────────
const one  = PAGE(BLOCK('Tema'));
const five = PAGE([1, 2, 3, 4, 5].map(() => BLOCK('Tema')).join(''));

ok('página com 1 vídeo: 1 espaço, título "Tema"', () => {
  const s = VS.findSlots(one);
  assert.strictEqual(s.length, 1);
  assert.strictEqual(s[0].text, '[videoaula]');
  assert.strictEqual(s[0].heading.text, 'Tema');
});

ok('página com 5 vídeos: 5 espaços, cada um com o seu título', () => {
  const s = VS.findSlots(five);
  assert.strictEqual(s.length, 5);
  assert.ok(s.every(x => x.heading && x.heading.text === 'Tema'));
  assert.strictEqual(new Set(s.map(x => x.heading.from)).size, 5);
});

ok('qualquer texto entre colchetes vale; o marcador do H5P não', () => {
  const html = PAGE(BLOCK('Tema', '[Vídeo 3 aqui]') + '<p>[iframe - Atividade de Fixa&ccedil;&atilde;o H5P]</p>');
  same(VS.findSlots(html).map(x => x.text), ['[Vídeo 3 aqui]']);
});

ok('texto com colchetes no meio de um parágrafo não é espaço', () => {
  assert.strictEqual(VS.findSlots('<h4>T</h4><p>Veja [1] e [2].</p><p>[a] texto</p>').length, 0);
});

ok('título com conteúdo no meio não conta; "OBJETIVOS DA AULA" nunca é usado', () => {
  const s = VS.findSlots('<h4>OBJETIVOS</h4><p>texto</p><p>[videoaula]</p>');
  assert.strictEqual(s[0].heading, null);
  const s2 = VS.findSlots('<h4>Tema</h4><p>&nbsp;</p><p><br></p><p>[videoaula]</p><p>[videoaula]</p>');
  assert.strictEqual(s2[0].heading.text, 'Tema');
  assert.strictEqual(s2[1].heading, null);   // o 1º espaço está no meio
});

ok('espaço dentro de comentário é ignorado', () => {
  assert.strictEqual(VS.findSlots('<!-- <h4>T</h4><p>[videoaula]</p> --><p>x</p>').length, 0);
});

// ── Plano ───────────────────────────────────────────────────────────────
ok('preenche na ordem, troca só o texto do título e mantém o resto igual', () => {
  const p = VS.planPage({ ...base, body: five, rows: [row('Introdução & conceitos', 'assoc 01'), row('Parte 2', 'associacoes parte 2', 2)] });
  assert.ok(p.html);
  assert.strictEqual(p.left, 3);
  assert.ok(p.html.includes(H4('Introdução &amp; conceitos')));
  assert.ok(p.html.includes(H4('Parte 2')));
  assert.strictEqual(VS.findSlots(p.html).length, 3);
  assert.ok(p.html.indexOf('aaaa-1') < p.html.indexOf('bbbb-2'));
  assert.ok(p.html.includes('<p style="text-align: center;"><iframe class="lti-embed" style="width: 620px; height: 398px;'));
  assert.ok(p.html.includes('title="Introdução &amp; conceitos"'));
  assert.ok(p.html.includes('src="/courses/238653/external_tools/retrieve?display=borderless&amp;url=https%3A%2F%2Fpucminas.instructuremedia.com%2Flti%2Flaunch%3Fcustom_arc_launch_type%3Dbare_embed%26custom_arc_media_id%3Daaaa-1%26'));
  // Antes do 1º bloco e depois do 2º, nada mudou.
  const firstH = five.indexOf(H4('Tema'));
  assert.strictEqual(p.html.slice(0, firstH), five.slice(0, firstH));
  const third = five.split(H4('Tema')).slice(3).join(H4('Tema'));
  assert.ok(p.html.endsWith(third));
});

ok('título vazio na planilha: só o vídeo entra, o título fica', () => {
  const p = VS.planPage({ ...base, body: one, rows: [row('', 'Vídeo 1')] });
  assert.ok(p.html.includes(H4('Tema')));
  assert.ok(p.html.includes('title="Vídeo 1"'));
});

ok('mais linhas que espaços: bloqueia', () => {
  const p = VS.planPage({ ...base, body: one, rows: [row('a', 'Vídeo 1'), row('b', 'Vídeo 10', 2)] });
  assert.strictEqual(p.html, null);
  assert.match(p.items[1].problem, /só tem 1 espaço/);
});

ok('vídeo não achado, ambíguo ou "Vídeo 1" × "Vídeo 10": bloqueia sem chutar', () => {
  const p = VS.planPage({ ...base, body: five, rows: [row('a', 'Vídeo'), row('b', 'repetido', 2), row('c', 'Video 1', 3)] });
  assert.strictEqual(p.html, null);
  assert.match(p.items[0].problem, /não está na coleção.*parecido/);
  assert.match(p.items[1].problem, /2 vídeos com esse nome/);
  assert.strictEqual(p.items[2].studio.id, 'cccc-3');
});

ok('linha com título e espaço sem título acima: bloqueia', () => {
  const p = VS.planPage({ ...base, body: '<p>[videoaula]</p>', rows: [row('Título', 'Vídeo 1')] });
  assert.strictEqual(p.html, null);
  assert.match(p.items[0].problem, /não há título/);
});

ok('página sem espaços (já preenchida): bloqueia', () => {
  const p = VS.planPage({ ...base, body: '<h4>T</h4><p>texto</p>', rows: [row('a', 'Vídeo 1')] });
  assert.strictEqual(p.html, null);
  assert.match(p.items[0].problem, /nenhum texto entre colchetes/);
});

// ── Planilha ────────────────────────────────────────────────────────────
ok('colado do Excel (tab), com cabeçalho, linha vazia e célula com aspas', () => {
  const t = VS.parseTable('Página\tTítulo acima do vídeo\tVídeo no Studio\r\nAssociações contábeis\t"Intro ""geral"""\tASSOC_01\r\n\t\t\r\nAssociações contábeis\tParte 2\t\r\n');
  const { rows, problems } = VS.sheetRows(t);
  same(rows.map(r => [r.line, r.title, r.problem]), [[2, 'Intro "geral"', null], [4, 'Parte 2', 'falta o nome do vídeo na planilha']]);
  same(problems, []);
});

ok('célula de página vazia herda a de cima (mesclada), até uma linha em branco', () => {
  const { rows, problems } = VS.sheetRows(VS.parseTable('P1\tA\tv1\n\tB\tv2\n\t\t\n\tC\tv3\n'));
  same(rows.map(r => [r.line, r.page]), [[1, 'P1'], [2, 'P1']]);
  same(problems, [{ line: 4, msg: 'falta o nome da página' }]);
});

ok('linha sem vídeo bloqueia a página (os de baixo não sobem de espaço)', () => {
  const { rows } = VS.sheetRows(VS.parseTable('P\tA\t\nP\tB\tVídeo 1\n'));
  const p = VS.planPage({ ...base, body: five, rows });
  assert.strictEqual(p.html, null);
  assert.match(p.items[0].problem, /falta o nome do vídeo/);
  assert.strictEqual(p.items[1].problem, null);
});

ok('csv com ; (Excel em português) e com ,', () => {
  same(VS.parseTable('a;b, c;d\n'), [['a', 'b, c', 'd']]);
  same(VS.parseTable('a,b,c'), [['a', 'b', 'c']]);
  same(VS.parseTable('﻿a;"x\ny";c'), [['a', 'x\ny', 'c']]);
});

ok('agrupa por página na ordem da planilha', () => {
  const g = VS.groupByPage([
    { line: 1, page: 'Página', title: '', video: 'a' },
    { line: 2, page: 'Outra',  title: '', video: 'b' },
    { line: 3, page: 'pagina', title: '', video: 'c' },
  ]);
  same(g.map(x => [x.name, x.rows.map(r => r.line)]), [['Página', [1, 3]], ['Outra', [2]]]);
});

ok('página: igual, depois "contém"; duas candidatas = ambíguo', () => {
  const pages = [
    { url: 'u1', title: 'Unidade 1 - 2. Associações contábeis' },
    { url: 'u2', title: 'Unidade 1 - 3. Associações' },
    { url: 'u3', title: 'Introdução' },
    { url: 'u4', title: 'Unidade 2 - Introdução à prática' },
  ];
  assert.strictEqual(VS.matchPage('associacoes contabeis', pages).page.url, 'u1');
  assert.strictEqual(VS.matchPage('Introdução', pages).page.url, 'u3');
  assert.match(VS.matchPage('Associações', pages).error, /2 páginas/);
  assert.ok(VS.matchPage('Contábil', pages).notFound);
  assert.ok(!VS.matchPage('Associações', pages).notFound);
  assert.strictEqual(VS.matchPage('Unidade 1 - 2. Associações contábeis', [...pages, pages[0]]).page.url, 'u1');
});

console.log(`\n${n} verificações OK`);
