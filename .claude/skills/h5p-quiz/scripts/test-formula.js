// Fórmula do diário (popup.js › Analisar disciplina › "🧮 Fórmula do diário").
// 1) Lógica pura com fórmulas reais dos documentos da equipe (PDF 2º/2022,
//    ICEG, Mecânica Básica, 4467101): sugestão, MAX, reavaliação, pesos,
//    avisos, sobra/falta e o levantamento de quem perderia nota.
// 2) Painel real (popup.html) com chrome.* falso e um Canvas falso: a
//    Contabilidade Gerencial (17101, reavaliação de 100 + substitutiva → MAX),
//    edição de papel e de P, cópia, sobra sem MAX (impacto nos alunos), falta,
//    e o "Verificar tarefas" sem alarme para tarefa não publicada.
// Rodar com o playwright-core instalado numa pasta qualquer:
//   NODE_PATH=<pasta>/node_modules node .claude/skills/h5p-quiz/scripts/test-formula.js
// Usa o Chrome do sistema (CHROME_PATH). Não precisa de rede.
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT   = path.resolve(__dirname, '../../../..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HOST   = 'https://pucminas.instructure.com';

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ✔ ' : '  ✘ ') + msg); if (!cond) failures++; };

// ── 1) Lógica pura ─────────────────────────────────────────────────────
const popup = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const ini   = popup.indexOf('// ── Analisar disciplina ──');
const SRC   = popup.slice(ini, popup.indexOf('// ── Trocar banner dos cursos', ini));
const ctx   = vm.createContext({ console });
vm.runInContext(SRC, ctx);
const fn = name => vm.runInContext(name, ctx);
const [fdItems, fdSuggest, fdBuild, fdImpact] = ['fdItems', 'fdSuggest', 'fdBuild', 'fdImpact'].map(fn);

// Itens já numerados P1, P2… na ordem dada: [nome, valor].
const items = list => list.map(([name, value], i) => ({ id: 100 + i, p: i + 1, name, url: 'u' + i, value }));
const role  = (state, p, r) => { state.rows.find(x => x.p === p).role = r; };

console.log('Lógica — exemplos reais');
{
  // Mecânica Básica (4539100): sem reavaliação, soma 100.
  const s = fdSuggest(items([['Lista de Exercícios 1', 3], ['Lista de Exercícios 2', 3], ['Exercício Newton Raphson', 2],
    ['Lista de Exercícios 3', 2], ['Trabalho Pêndulo Duplo', 15], ['Primeira Prova', 25], ['Segunda Prova', 25], ['Terceira Prova', 25]]));
  const b = fdBuild(s);
  check(b.formula === 'P1+P2+P3+P4+P5+P6+P7+P8' && b.closes && !b.reav && b.pesos === null, 'Mecânica Básica: soma simples, fecha em 100 — ' + b.formula);
}
{
  // PDF 2º/2022: reavaliação de 30 cobre a Etapa 3 de 30 → Reav(p11;p10)+p1…p9, pesos 0.
  const s = fdSuggest(items([['Entrega da tarefa da etapa 1', 5], ['Entrega da tarefa da etapa 2', 10], ['Entrega da tarefa da etapa 3', 10],
    ['Entrega da tarefa da Etapa 4', 5], ['Entrega da tarefa da etapa 5', 10], ['Atitudes (eixo 2) Autoavaliação', 5],
    ['Atitudes (eixo 2) Avaliação por pares', 5], ['Avaliação dos microfundamentos - Etapa 1 (10 ponto', 10],
    ['Avaliação dos microfundamentos - Etapa 2 (10 ponto', 10], ['Avaliação dos microfundamentos - Etapa 3 (30 ponto', 30],
    ['Reavaliação (30 pontos)', 30]]));
  const b = fdBuild(s);
  check(b.formula === 'Reav(P11;P10)+P1+P2+P3+P4+P5+P6+P7+P8+P9', 'PDF 2022: ' + b.formula);
  check(b.closes && b.pesos === 0 && b.covered === 30 && b.outer === 70, 'PDF 2022: fecha, pesos 0, cobre 30 + 70 por fora');
}
{
  // ICEG eixo 4: reavaliação de 50 cobre P1+P2+P3 (20+10+20) — não há uma
  // avaliação de 50, então a sugestão pede para marcar; marcando, fecha.
  const s = fdSuggest(items([['Avaliação dos microfundamentos - Etapa 1 (20 ponto', 20], ['Simulado ENADE - ( 10 pontos)', 10],
    ['Avaliação dos microfundamentos - Etapa 2 (20 ponto', 20], ['Entrega da tarefa da etapa 2', 10], ['Entrega da tarefa da etapa 3', 10],
    ['Entrega da tarefa da etapa 4', 10], ['Entrega da tarefa da etapa 5', 10], ['Reavaliação (50 pontos)', 50],
    ['Atitudes (eixo 4) Autoavaliação', 5], ['Atitudes (eixo 4) Avaliação por pares', 5]]));
  let b = fdBuild(s);
  check(!b.closes && b.warnings.some(w => /Marque o que a reavaliação cobre.*50 pts/.test(w)), 'ICEG: sem avaliação de 50, pede para marcar o que a reavaliação cobre');
  [1, 2, 3].forEach(p => role(s, p, 'alvo'));
  b = fdBuild(s);
  check(b.formula === 'Reav(P8;P1+P2+P3)+P4+P5+P6+P7+P9+P10' && b.closes && b.pesos === 0, 'ICEG marcado: ' + b.formula);
}
{
  // 4467101 Aplicações Web: reav(P2;P1)+P3+P4 (avaliação e reavaliação de 40).
  const s = fdSuggest(items([['Avaliação', 40], ['Reavaliação', 40], ['Projeto parte 1', 30], ['Projeto parte 2', 30]]));
  const b = fdBuild(s);
  check(b.formula === 'Reav(P2;P1)+P3+P4' && b.closes && b.pesos === 0, '4467101: ' + b.formula);
}
{
  // Reavaliação de 100 sobre tudo → pesos 1, tudo dentro do Reav.
  const s = fdSuggest(items([['Atividade 1', 30], ['Atividade 2', 30], ['Prova', 40], ['Reavaliação', 100]]));
  const b = fdBuild(s);
  check(b.formula === 'Reav(P4;P1+P2+P3)' && b.closes && b.pesos === 1, 'reavaliação de 100: ' + b.formula + ', pesos 1');
}
{
  // Nome "REAV" também conta; a substitutiva não.
  const s = fdSuggest(items([['Prova Substitutiva', 30], ['Projeto', 70], ['REAV - Prova final', 30]]));
  check(s.rows[2].role === 'reav' && s.rows[0].role === 'alvo', 'reconhece "REAV - Prova final" e não a substitutiva');
}

console.log('Lógica — MAX');
{
  // Sobra de 10 num grupo de 5 pts sem substitutiva: descarta 2 (pega k−2).
  const s = fdSuggest(items([['Q1', 5], ['Q2', 5], ['Q3', 5], ['Q4', 5], ['Q5', 5], ['Q6', 5], ['Prova 1', 35], ['Prova 2', 45]]));
  const b = fdBuild(s);
  check(b.formula === 'P7+P8+Max(4;P1;P2;P3;P4;P5;P6)' && b.closes, 'sobra 10 em grupo de 5: ' + b.formula);
  s.maxN = 5;
  check(fdBuild(s).diff === 5, 'MAX editado para 5: sobra 5');
  s.maxN = null;
  check(fdBuild(s).n === 5, 'MAX em automático: k−1');
}
{
  // Dois grupos possíveis (sobra 6: 1 de 6 pts ou 2 de 3 pts): prefere o da
  // substitutiva; sem ela, o que descarta menos.
  const base = [['A1', 3], ['A2', 3], ['A3', 3], ['B1', 6], ['B2', 6], ['Prova', 85]];
  let b = fdBuild(fdSuggest(items(base)));
  check(b.formula === 'P1+P2+P3+P6+Max(1;P4;P5)', 'sem substitutiva: descarta menos notas — ' + b.formula);
  b = fdBuild(fdSuggest(items([...base.slice(0, 2), ['A3 - Substitutiva', 3], ...base.slice(3)])));
  check(b.formula === 'P4+P5+P6+Max(1;P1;P2;P3)', 'com substitutiva: usa o grupo dela — ' + b.formula);
}
{
  const s = fdSuggest(items([['A', 50], ['B', 50]]));
  role(s, 1, 'max');
  check(fdBuild(s).warnings.some(w => /uma atividade só/.test(w)), 'aviso: MAX com uma atividade só');
  role(s, 2, 'max');
  s.maxN = 2;
  check(fdBuild(s).warnings.some(w => /não descarta nenhuma/.test(w)), 'aviso: MAX que pega todas');
  const m = fdSuggest(items([['A', 1], ['B', 2], ['C', 97]]));
  role(m, 1, 'max'); role(m, 2, 'max');
  check(fdBuild(m).warnings.some(w => /mistura valores/.test(w)), 'aviso: MAX com valores diferentes');
}

console.log('Lógica — avisos, sobra e falta');
{
  const s = fdSuggest(items([['A', 50], ['B', 50]]));
  s.rows[1].p = 1;
  check(fdBuild(s).warnings.some(w => /P repetido: P1/.test(w)), 'aviso: P repetido');
  s.rows[1].role = 'fora';
  check(!fdBuild(s).warnings.some(w => /repetido/.test(w)), 'P de atividade fora da fórmula não conta como repetido');
}
{
  const s = fdSuggest(items([['Lista 1', 10], ['Lista 2', 20], ['Trabalho', 30], ['Prova', 41]]));
  const b = fdBuild(s);
  check(b.diff === 1 && !b.closes && !b.maxs.length, 'sobra 1 sem grupo de mesmo valor: não fecha, sem MAX');
  const grades = {
    names: new Map([[1, 'Ana'], [2, 'Bruno'], [3, 'Carla']]),
    subs: [
      { assignment_id: 100, user_id: 1, score: 10 }, { assignment_id: 100, user_id: 2, score: 9 }, { assignment_id: 100, user_id: 3, score: 8 },
      { assignment_id: 101, user_id: 1, score: 20, excused: true }, { assignment_id: 101, user_id: 2, score: 19 },
      { assignment_id: 102, user_id: 1, score: 29 }, { assignment_id: 102, user_id: 2, score: 28 },
      { assignment_id: 103, user_id: 1, score: 41 }, { assignment_id: 103, user_id: 2, score: 40.5 }, { assignment_id: 103, user_id: 3, score: null },
    ],
  };
  const list = fdImpact(s, b.diff, grades, false);
  check(list.map(i => `${i.row.name}:${i.hurt.length}`).join(' ') === 'Trabalho:0 Lista 2:0 Lista 1:1 Prova:2',
    'impacto, sem prejuízo primeiro (dispensado não conta): ' + list.map(i => `${i.row.name}:${i.hurt.length}`).join(' '));
  check(list[3].newMax === 40 && list[3].hurt.map(h => h.name).join(',') === 'Ana,Bruno', 'Prova 41 → 40: Ana (41) e Bruno (40,5) perdem nota');
}
{
  const b = fdBuild(fdSuggest(items([['Lista', 10], ['Trabalho', 20], ['Prova 1', 30], ['Prova 2', 39]])));
  check(b.diff === -1 && !b.closes, 'falta 1 ponto');
}
{
  // Reavaliação com o alvo marcado só em parte: não fecha e avisa.
  const s = fdSuggest(items([['Avaliação', 30], ['Trabalho', 70], ['Reavaliação', 30]]));
  role(s, 1, 'soma'); role(s, 2, 'alvo');
  check(fdBuild(s).warnings.some(w => /vale 30 pts, mas o que ela cobre soma 70/.test(w)), 'aviso: reavaliação e o que ela cobre com valores diferentes');
}
{
  // fdItems: só publicadas com SIS, na ordem grupo → posição.
  const list = fdItems([
    { id: 9, assignment_group_id: 2, position: 1, name: 'Prova', points_possible: 40, published: true, post_to_sis: true },
    { id: 3, assignment_group_id: 1, position: 2, name: 'B', points_possible: 30, published: true, post_to_sis: true },
    { id: 7, assignment_group_id: 1, position: 1, name: 'A', points_possible: 30, published: true, post_to_sis: true },
    { id: 4, assignment_group_id: 1, position: 3, name: 'Cópia', points_possible: 5, published: false, post_to_sis: true },
    { id: 5, assignment_group_id: 1, position: 4, name: 'Sem SIS', points_possible: 5, published: true, post_to_sis: false },
    { id: 6, assignment_group_id: 1, position: 5, name: 'Apagada', points_possible: 5, published: true, post_to_sis: true, workflow_state: 'deleted' },
  ], [{ id: 2, position: 2 }, { id: 1, position: 1 }]);
  check(list.map(i => `P${i.p}=${i.name}`).join(' ') === 'P1=A P2=B P3=Prova', 'P na ordem do Canvas, só publicadas com SIS: ' + list.map(i => `P${i.p}=${i.name}`).join(' '));
  // Critério do sincronizador: 0 pts, fora da nota final e nota em % não vão.
  const crit = fdItems([
    { id: 1, assignment_group_id: 1, position: 1, name: 'Vai', points_possible: 10, published: true, post_to_sis: true, grading_type: 'points', post_manually: true },
    { id: 2, assignment_group_id: 1, position: 2, name: 'Zero', points_possible: 0, published: true, post_to_sis: true },
    { id: 3, assignment_group_id: 1, position: 3, name: 'Não conta', points_possible: 10, published: true, post_to_sis: true, omit_from_final_grade: true },
    { id: 4, assignment_group_id: 1, position: 4, name: 'Percentual', points_possible: 10, published: true, post_to_sis: true, grading_type: 'percent' },
  ], [{ id: 1, position: 1 }]);
  check(crit.map(i => i.name).join(',') === 'Vai', 'só vira P o que o sincronizador manda (postagem manual vai; 0 pts, fora da nota e % não)');
}

console.log('Lógica — Sincronização SGA');
{
  const fdCanon = fn('fdCanon');
  check(fdCanon('reav(P17;(P1+P2+P3))+P5') === fdCanon('Reav(P17;P3+P1+P2)+P5'), 'comparação ignora parênteses, maiúsculas e ordem dos termos');
  check(fdCanon('reav(P15;P13+P7+max(5;P2;P1))') === fdCanon('Reav(P15;Max(5;P1;P2)+P7+P13)'), 'compara o MAX pelo conteúdo');
  check(fdCanon('reav(P15;P1+P2)+P3') !== fdCanon('Reav(P15;P1+P3)+P2'), 'termo dentro x fora do reav conta como diferente');
  check(fdCanon('Max(5;P1;P2)') !== fdCanon('Max(4;P1;P2)'), 'n do MAX conta como diferente');
}
{
  const sgaLiteral = fn('sgaLiteral'), sgaParse = fn('sgaParse');
  const lit = sgaLiteral(`x {'a': 'D\\'Ávila', "b": None, 'c': [1, 2.5, True], 'd': Decimal('5.00'), 'e': u'ok', 'f': (1, 2),}`, 2);
  check(lit.a === "D'Ávila" && lit.b === null && lit.c[1] === 2.5 && lit.c[2] === true && lit.d === '5.00' && lit.e === 'ok' && lit.f.length === 2,
    'lê dict do Python (aspas simples, None, True, Decimal, tupla, vírgula no fim)');
  const html = `<div>[[ disciplina['dsc_formula'] ]]</div><tr v-for="assignment in assignments"></tr><script>
    var vue_diario = new Vue({ el: '#panel_diario', delimiters: ['[[', ']]'], data: {
      disciplina: {'seq_turma': 1464103, 'nom_disciplina': 'PSICOLOGIA JURÍDICA', 'dsc_formula': 'reav(P10;P1+P2)', 'ind_diario_fechado': 1, 'ind_formula_grupo': 1},
      task: {'created_at': '2025-12-17 08:27:28', 'done_at': '2025-12-17 08:30:53', 'processed': 1} } });
    var vue_assignment_table = new Vue({ data: { assignments: [{"id": 1, "name": "F\\u00f3rum \\ud83d\\udce2", "points_possible": null, "published": false}] } });
    var vue_sga = new Vue({ data: { avaliacoes: [{'sigla_avaliacao': 'P1', 'dsc_avaliacao': 'Fórum', 'val_avaliacao': Decimal('10.00'), 'lancamentos': 3, 'consta_formula': 1, 'consta_canvas': 0}] } });
  </script>`;
  const d = sgaParse(html);
  check(d.disciplina.dsc_formula === 'reav(P10;P1+P2)' && d.disciplina.ind_diario_fechado === 1 && d.task.done_at === '2025-12-17 08:30:53',
    'tira a disciplina (fórmula, diário fechado) e a última sincronização do HTML');
  check(d.assignments[0].name === 'Fórum 📢' && d.assignments[0].points_possible === null, 'tira as tarefas (JSON com \\u e emoji)');
  check(d.avaliacoes[0].sigla_avaliacao === 'P1' && d.avaliacoes[0].val_avaliacao === '10.00', 'tira as avaliações do SGA (com Decimal)');
  let err = '';
  try { sgaParse('<html>login</html>'); } catch (e) { err = e.message; }
  check(/sem os dados da disciplina/.test(err), 'página sem os dados: erro claro');
}
{
  const sgaApplySiglas = fn('sgaApplySiglas');
  const its = items([['Fórum', 10], ['Avaliação dos microfundamentos - Etapa 1 (20 pontos) - turma B', 20], ['Trabalho', 30],
    ['Prova', 40], ['Reavaliação', 100], ['Desafio novo', 0], ['Prova 2', 15]]);
  const left = sgaApplySiglas(its, [
    { sigla_avaliacao: 'P1', dsc_avaliacao: 'Fórum', val_avaliacao: '10.00', consta_canvas: 1 },
    { sigla_avaliacao: 'P2', dsc_avaliacao: 'Lista antiga', val_avaliacao: '5.00', consta_canvas: 0, consta_formula: 1 },
    { sigla_avaliacao: 'P3', dsc_avaliacao: 'AVALIAÇÃO DOS MICROFUNDAMENTOS - ETAPA 1 (20 PONT', val_avaliacao: '20.00', consta_canvas: 1 },
    { sigla_avaliacao: 'P4', dsc_avaliacao: 'Prova', val_avaliacao: '40.00', consta_canvas: 1 },
    { sigla_avaliacao: 'P5', dsc_avaliacao: 'Trabalho', val_avaliacao: '25.00', consta_canvas: 1 },
    { sigla_avaliacao: 'P6', dsc_avaliacao: 'Reavaliação', val_avaliacao: '100.00', consta_canvas: 1 },
  ]);
  const got = its.map(i => `${i.name.slice(0, 12)}=P${i.p}${i.sigla ? '' : '?'}`).join(' ');
  check(got === 'Fórum=P1 Avaliação do=P3 Trabalho=P5 Prova=P4 Reavaliação=P6 Desafio novo=P7? Prova 2=P8?',
    'siglas do SGA: nome cortado, maiúsculas, valor diferente (só pelo nome); sem sigla depois do último P — ' + got);
  check(its[2].sgaValue === 25, 'Trabalho: avisa que no SGA vale 25');
  check(left.map(a => a.sigla).join(',') === 'P2' && left[0].formula && !left[0].canvas, 'sobra o P2, pendente de exclusão e na fórmula');
  check(its[6].p === 8 && its[6].sigla === '', '"Prova 2" não casa com "Prova" (nome curto só casa igual)');
}

// ── 2) Painel real ─────────────────────────────────────────────────────
const A = (course, id, group, position, name, points, o = {}) => ({
  id, assignment_group_id: group, position, name, points_possible: points, grading_type: o.grading || 'points',
  published: o.published ?? true, post_to_sis: o.sis ?? true, workflow_state: (o.published ?? true) ? 'published' : 'unpublished',
  omit_from_final_grade: !!o.omit, post_manually: !!o.manual,
  html_url: `${HOST}/courses/${course}/assignments/${id}`,
});

// ── Sincronização SGA falsa (ead05) ────────────────────────────────────
const SGA = 'https://ead05.virtual.pucminas.br';
// repr do Python, como a página embute a disciplina e as avaliações.
const py = v => v === null ? 'None' : v === true ? 'True' : v === false ? 'False'
  : typeof v === 'number' ? String(v)
  : typeof v === 'string' ? `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  : Array.isArray(v) ? `[${v.map(py).join(', ')}]`
  : v.$decimal ? `Decimal('${v.$decimal}')`
  : `{${Object.entries(v).map(([k, x]) => `${py(k)}: ${py(x)}`).join(', ')}}`;
const sgaIndex = (course, s) => `<!DOCTYPE html><html><body><div id="panel_diario"><h4>Fórmula: [[ disciplina['dsc_formula'] ]]</h4></div>
<table><tr v-for="assignment in assignments"></tr></table>
<script>
  var vue_diario = new Vue({ el: '#panel_diario', delimiters: ['[[', ']]'], data: {
    disciplina: ${py(s.disciplina)},
    task: {'created_at': '2025-12-10 10:00:00', 'done_at': '2025-12-10 10:03:00', 'processed': 1}
  } });
  var vue_assignment_table = new Vue({ el: '#assignments_table', delimiters: ['[[', ']]'], data: {
    assignments: ${JSON.stringify(COURSES[course].assignments.map(a => ({ id: a.id, name: a.name, points_possible: a.points_possible })))}
  } });
  var vue_sga = new Vue({ el: '#sgatbl', delimiters: ['[[', ']]'], data: { avaliacoes: ${py(s.avaliacoes || [])} } });
</script></body></html>`;
const toolPage = course => `<!DOCTYPE html><html><body>
<form action="${SGA}/sga_sync/launch" class="hide" method="POST" target="tool_content_548" id="tool_form_548" data-message-type="tool_launch">
  <input type="hidden" name="oauth_consumer_key" value="chave"><input type="hidden" name="oauth_signature" value="assinatura">
  <input type="hidden" name="custom_canvas_course_id" value="${course}"><input type="hidden" name="custom_canvas_user_id" value="99">
  <input type="hidden" name="context_title" value="Disciplina &amp; teste">
</form><iframe name="tool_content_548"></iframe></body></html>`;
const AV = (sigla, dsc, val, o = {}) => ({ sigla_avaliacao: sigla, dsc_avaliacao: dsc, val_avaliacao: { $decimal: val.toFixed(2) },
  lancamentos: 10, consta_formula: o.formula ? 1 : 0, consta_canvas: o.canvas === false ? 0 : 1 });
const COURSES = {
  // Contabilidade Gerencial (17101): 7 de 5 pts com a substitutiva, 5 de 6,
  // 2 provas de 20, reavaliação de 100; uma cópia não publicada e uma leitura
  // sem pontos no meio. Ids fora da ordem para testar a ordenação.
  101: {
    groups: [{ id: 11, position: 2, name: 'Provas' }, { id: 10, position: 1, name: 'Atividades' }, { id: 12, position: 3, name: 'Reavaliação' }],
    assignments: [
      A(101, 540, 12, 1, 'Reavaliação', 100),
      A(101, 501, 10, 1, 'Fórum 01', 5), A(101, 509, 10, 2, 'Objetiva 2', 5), A(101, 502, 10, 3, 'Objetiva 4', 5),
      A(101, 508, 10, 4, 'Objetiva 6', 5), A(101, 503, 10, 5, 'Objetiva 8', 5), A(101, 507, 10, 6, 'Objetiva 9', 5),
      A(101, 504, 10, 7, 'Objetiva 12 - Substitutiva', 5), A(101, 520, 10, 8, 'Aberta 3', 6),
      A(101, 521, 10, 9, 'Aberta 3 Copiar', 5, { published: false, sis: false }),
      A(101, 522, 10, 10, 'Aberta 5', 6), A(101, 523, 10, 11, 'Aberta 7', 6), A(101, 524, 10, 12, 'Aberta 10', 6),
      A(101, 525, 10, 13, 'Aberta 11', 6, { manual: true }), A(101, 526, 10, 14, 'Leitura complementar', 0, { sis: false }),
      A(101, 527, 10, 15, 'Bônus de participação', 5, { omit: true }), A(101, 528, 10, 16, 'Autoavaliação', 10, { grading: 'percent' }),
      A(101, 531, 11, 2, 'Segunda Prova ON LINE', 20), A(101, 530, 11, 1, 'Primeira Prova ON LINE', 20),
    ],
    // Diário fechado, sem as siglas (como o 251332): só a fórmula da equipe.
    sga: {
      disciplina: { seq_turma: 17101, nom_disciplina: 'CONTABILIDADE GERENCIAL', ind_formula: 0,
        dsc_formula: 'reav(P15;P13+P14+P7+P8+P9+P10+P11+P12+max(5;P1;P2;P3;P4;P5;P6))', ind_diario_fechado: 1, ind_formula_grupo: 1 },
    },
  },
  // Diário aberto com as siglas do SGA: P2 vago (pendente de exclusão), Prova
  // e Trabalho trocados em relação à ordem do Canvas, nome cortado no SGA.
  404: {
    groups: [{ id: 40, position: 1, name: 'Tarefas' }],
    assignments: [A(404, 901, 40, 1, 'Fórum', 10), A(404, 902, 40, 2, 'Avaliação dos microfundamentos - Etapa 1 (20 pontos) - turma B', 20),
      A(404, 903, 40, 3, 'Trabalho', 30), A(404, 904, 40, 4, 'Prova', 40), A(404, 905, 40, 5, 'Reavaliação', 100)],
    sga: {
      disciplina: { seq_turma: 404101, nom_disciplina: 'DISCIPLINA ABERTA', dsc_formula: 'Não há fórmula cadastrada', ind_diario_fechado: 0, ind_formula_grupo: 1 },
      avaliacoes: [AV('P1', 'Fórum', 10), AV('P2', 'Lista antiga', 5, { canvas: false, formula: true }),
        AV('P3', 'AVALIAÇÃO DOS MICROFUNDAMENTOS - ETAPA 1 (20 PONT', 20), AV('P4', 'Prova', 40), AV('P5', 'Trabalho', 30), AV('P6', 'Reavaliação', 100)],
    },
  },
  // Sobra de 1 sem grupo de mesmo valor: levantamento com as notas.
  202: {
    groups: [{ id: 20, position: 1, name: 'Tarefas' }],
    assignments: [A(202, 601, 20, 1, 'Lista 1', 10), A(202, 602, 20, 2, 'Lista 2', 20), A(202, 603, 20, 3, 'Trabalho', 30), A(202, 604, 20, 4, 'Prova', 41)],
    users: [{ id: 1, name: 'Ana' }, { id: 2, name: 'Bruno' }, { id: 3, name: 'Carla' }],
    subs: [
      [601, 1, 10], [601, 2, 9], [601, 3, 8], [602, 1, 20], [602, 2, 19], [602, 3, null],
      [603, 1, 25], [603, 2, 28], [603, 3, 29], [603, 4, 30],   // aluno 4: inativo, fica de fora
      [604, 1, 41], [604, 2, 40.5], [604, 3, 30],
    ].map(([assignment_id, user_id, score]) => ({ assignment_id, user_id, score })),
  },
  // Falta 1 ponto.
  303: {
    groups: [{ id: 30, position: 1, name: 'Tarefas' }],
    assignments: [A(303, 701, 30, 1, 'Lista', 10), A(303, 702, 30, 2, 'Trabalho', 20), A(303, 703, 30, 3, 'Prova 1', 30), A(303, 704, 30, 4, 'Prova 2', 39)],
  },
};

const FAKE_CHROME = `(() => {
  const noop = new Proxy(function () {}, { get: (t, p) => (p === 'then' ? undefined : noop), apply: () => noop });
  const wrap = o => new Proxy(o, { get: (t, p) => (p in t ? t[p] : noop) });
  const store = { usuario: 'Teste' };
  window.__tabUrl = ${JSON.stringify(`${HOST}/courses/101/assignments`)};
  const fake = wrap({
    storage: wrap({
      local: wrap({
        get: async k => {
          if (k == null) return { ...store };
          const keys = typeof k === 'string' ? [k] : Array.isArray(k) ? k : Object.keys(k);
          const out = Array.isArray(k) || typeof k === 'string' ? {} : { ...k };
          for (const key of keys) if (key in store) out[key] = store[key];
          return out;
        },
        set: async o => { Object.assign(store, o); },
        remove: async () => {},
      }),
      onChanged: wrap({ addListener() {} }),
    }),
    tabs: wrap({ query: async () => [{ id: 7, url: window.__tabUrl, active: true }] }),
    scripting: wrap({
      executeScript: ({ func, args }) => window.__exec({ func: func ? func.toString() : null, args: args || [] }),
    }),
    runtime: wrap({ getURL: p => 'https://ext.test/' + p, getManifest: () => ({ version: '0.0.0' }), id: 'teste' }),
  });
  Object.defineProperty(window, 'chrome', { value: fake, configurable: true, writable: true });
})();`;

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright-core'));
  } catch {
    console.log('\n(playwright-core não encontrado — parte do painel pulada)');
    finish();
    return;
  }
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 400, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://ext.test' });
  const requests = [];

  await context.route(HOST + '/**', route => {
    const u    = new URL(route.request().url());
    const json = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    const tool = u.pathname.match(/^\/courses\/(\d+)\/external_tools\/1187$/);
    if (tool) {
      requests.push(u.pathname);
      return COURSES[tool[1]].sga
        ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: toolPage(tool[1]) })
        : route.fulfill({ status: 404, contentType: 'text/html', body: 'Página não encontrada' });
    }
    const m    = u.pathname.match(/^\/api\/v1\/courses\/(\d+)\/(.+)$/);
    if (!m) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!DOCTYPE html><html><body>Canvas</body></html>' });
    requests.push(u.pathname + u.search);
    const c = COURSES[m[1]];
    if (m[2] === 'tabs') {
      return json([{ id: 'home', label: 'Página inicial', html_url: `/courses/${m[1]}` },
        ...(c.sga ? [{ id: 'context_external_tool_1187', label: 'Sincronização SGA', html_url: `/courses/${m[1]}/external_tools/1187` }] : [])]);
    }
    if (m[2] === 'assignment_groups') return json(c.groups);
    if (m[2] === 'assignments') return json(c.assignments);
    if (m[2] === 'users') return json(c.users || []);
    if (m[2] === 'students/submissions') return json(c.subs || []);
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"errors":[{"message":"not found"}]}' });
  });
  // Sincronização SGA: o painel faz o POST do formulário e segue para o index.
  const sgaRequests = [];
  // O painel do teste é uma página comum (ext.test), então aqui há CORS; na
  // extensão de verdade não, pela permissão de host. headers() esconde o Origin.
  await context.route(SGA + '/**', async route => {
    const req  = route.request();
    const u    = new URL(req.url());
    const cors = { 'Access-Control-Allow-Origin': (await req.allHeaders()).origin || '*', 'Access-Control-Allow-Credentials': 'true' };
    sgaRequests.push({ method: req.method(), path: u.pathname + u.search, body: req.postData() || '' });
    // O acesso real redireciona para o index; aqui (o Playwright não segue 302
    // entre domínios) o curso 101 recebe uma página sem os dados — o painel
    // então abre o index — e o 404 recebe o index direto.
    if (u.pathname === '/sga_sync/launch' && req.method() === 'POST') {
      const course = new URLSearchParams(req.postData()).get('custom_canvas_course_id');
      const body   = course === '404' ? sgaIndex(course, COURSES[course].sga) : '<html><body>Carregando...</body></html>';
      return route.fulfill({ status: 200, headers: cors, contentType: 'text/html; charset=utf-8', body });
    }
    if (u.pathname === '/sga_sync/index') {
      const course = u.searchParams.get('course_id');
      return route.fulfill({ status: 200, headers: cors, contentType: 'text/html; charset=utf-8', body: sgaIndex(course, COURSES[course].sga) });
    }
    return route.fulfill({ status: 500, headers: cors, body: 'não deveria ser chamado' });
  });

  const canvas = await context.newPage();
  canvas.on('pageerror', e => { console.log('[canvas pageerror]', e.message); failures++; });
  await canvas.goto(`${HOST}/courses/101/assignments`);

  await context.route('https://ext.test/**', route => {
    const f = path.join(ROOT, new URL(route.request().url()).pathname.slice(1));
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png' }[path.extname(f)] || 'application/octet-stream';
    return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(f) });
  });
  const panel = await context.newPage();
  panel.on('pageerror', e => { console.log('[painel pageerror]', e.message); failures++; });
  await panel.exposeBinding('__exec', async (_src, { func, args }) => {
    const result = await canvas.evaluate(([src, a]) => (0, eval)('(' + src + ')')(...a), [func, args]);
    return [{ result }];
  });
  await panel.addInitScript({ content: FAKE_CHROME });
  await panel.goto('https://ext.test/popup.html');
  await panel.waitForFunction(() => typeof S !== 'undefined' && S && S.usuario === 'Teste', null, { timeout: 10000 });

  const text   = sel => panel.locator(sel).first().innerText().catch(() => '');
  const setTab = course => panel.evaluate(u => { window.__tabUrl = u; }, `${HOST}/courses/${course}/assignments`);
  const formula = () => text('#fd-out code');
  const outText = () => text('#fd-out');
  const idle    = () => panel.waitForFunction(() => !document.getElementById('btn-an-diario').disabled
    && !document.getElementById('btn-an-tarefas').disabled, null, { timeout: 15000 });
  const run = async btn => { await panel.click(btn); await panel.waitForTimeout(50); await idle(); };
  // SHOT_DIR=<pasta> salva capturas do painel para conferir o visual.
  const shot = name => process.env.SHOT_DIR && panel.screenshot({ path: path.join(process.env.SHOT_DIR, name), fullPage: true });

  console.log('\nPainel — Contabilidade Gerencial (17101)');
  await panel.evaluate(() => show('main'));
  await panel.click('#btn-canvas');
  await panel.click('#btn-canvas-analise');
  check(await panel.locator('#view-canvas-analise').isVisible(), 'tela "Analisar disciplina" aberta');
  await run('#btn-an-diario');
  const f1 = await formula();
  check(f1 === 'Reav(P15;P8+P9+P10+P11+P12+P13+P14+Max(6;P1;P2;P3;P4;P5;P6;P7))',
    'fórmula com MAX das 7 de 5 pts (inclui a substitutiva) dentro do Reav: ' + f1);
  let out = await outText();
  check(/✓ Fecha em 100\./.test(out), 'fecha em 100');
  check(/Peso Nota Parcial: 1 · Peso Reavaliação: 1/.test(out) && /Não substituir reavaliação se o total for menor/.test(out), 'cadastro da reavaliação: pesos 1 e 1, "não substituir" marcado');
  check(/Max\(6; 7 atividades\) = 30 de 35 pts \(descarta 1\)/.test(out), 'conta do MAX: 30 de 35, descarta 1');
  const rows = await panel.$$eval('#an-card-diario .fd-row', els => els.map(e => e.querySelector('.fd-p').value + '=' + e.querySelector('.an-item-name').textContent));
  check(rows.length === 15 && rows[0] === '1=Fórum 01' && rows[7] === '8=Aberta 3' && rows[8] === '9=Aberta 5' && rows[14] === '15=Reavaliação',
    'P na ordem do Canvas, sem a cópia não publicada e sem a leitura sem SIS (15 P)');
  check(!requests.some(r => /students\/submissions/.test(r)), 'fechou: não leu as notas dos alunos');
  check(!rows.some(r => /Bônus|Autoavaliação/.test(r)) && rows.some(r => /Aberta 11/.test(r)),
    'fora da nota final e nota em % não viram P; postagem manual vira');

  // Sincronização SGA lida por trás: POST do formulário assinado e o index.
  const launch = sgaRequests.find(r => r.path === '/sga_sync/launch');
  const lbody  = new URLSearchParams(launch?.body || '');
  check(launch?.method === 'POST' && lbody.get('oauth_signature') === 'assinatura' && lbody.get('custom_canvas_course_id') === '101'
    && lbody.get('context_title') === 'Disciplina & teste', 'faz o POST do formulário da ferramenta, com todos os campos');
  check(sgaRequests.some(r => r.path === '/sga_sync/index?course_id=101&user_id=99'), 'o acesso não trouxe os dados: abre o index da Sincronização SGA');
  check(requests.includes('/api/v1/courses/101/tabs') && requests.includes('/courses/101/external_tools/1187'), 'acha a ferramenta pela aba "Sincronização SGA"');
  const card = await text('#an-card-diario');
  check(/Sincronização SGA\s*17101 - CONTABILIDADE GERENCIAL\s*Diário fechado · fechamento por grupo: sim · última sincronização: 2025-12-10 10:03:00/.test(card),
    'mostra a disciplina, o diário fechado e a última sincronização — ' + card.split('\n').slice(1, 4).join(' / '));
  check(/O SGA não mandou as siglas: os P seguem a ordem do Canvas/.test(card), 'sem siglas: avisa que os P são da ordem do Canvas');
  check(/Fórmula atual no SGA:\s*reav\(P15;P13\+P14\+P7\+P8\+P9\+P10\+P11\+P12\+max\(5;P1;P2;P3;P4;P5;P6\)\)\s*≠ Diferente da sugerida/.test(out),
    'mostra a fórmula atual do SGA e que ela é diferente da sugerida');
  await shot('formula-17101.png');

  // Substitutiva somada por fora (como a equipe fez): MAX volta ao automático
  // (5 de 6) e a reavaliação deixa de valer o mesmo que o que ela cobre.
  await panel.selectOption('#an-card-diario select[data-id="504"]', 'soma');
  check(await formula() === 'Reav(P15;P8+P9+P10+P11+P12+P13+P14+Max(5;P1;P2;P3;P4;P5;P6))+P7', 'substitutiva como soma: ' + await formula());
  out = await outText();
  check(/vale 100 pts, mas o que ela cobre soma 95/.test(out) && !/✓ Fecha/.test(out), 'avisa: reavaliação vale 100 e cobre 95');
  await panel.selectOption('#an-card-diario select[data-id="504"]', 'alvo');
  check(await formula() === 'Reav(P15;P7+P8+P9+P10+P11+P12+P13+P14+Max(5;P1;P2;P3;P4;P5;P6))' && /✓ Fecha em 100\./.test(await outText()),
    'substitutiva dentro do Reav (a fórmula que a equipe usou no 17101): ' + await formula());
  check(/✓ Igual à sugerida \(mesmos termos\)/.test(await outText()), 'agora é igual à fórmula atual do SGA (outra ordem, mesmos termos)');

  // MAX editado à mão e "dentro da reavaliação" desmarcado.
  await panel.fill('#fd-max-n', '4');
  check(/Faltam 5 pts: a nota máxima fica em 95/.test(await outText()), 'MAX pega 4: faltam 5 pts');
  await panel.fill('#fd-max-n', '5');
  await panel.uncheck('#fd-max-in');
  check(await formula() === 'Reav(P15;P7+P8+P9+P10+P11+P12+P13+P14)+Max(5;P1;P2;P3;P4;P5;P6)', 'MAX fora da reavaliação: ' + await formula());
  check(/Peso Nota Parcial: 0 · Peso Reavaliação: 0/.test(await outText()), 'com algo por fora, pesos 0 e 0');
  await panel.check('#fd-max-in');

  // P corrigido à mão (número vago de tarefa apagada) e P repetido.
  await panel.fill('#an-card-diario .fd-row:has(select[data-id="540"]) .fd-p', '18');
  check((await formula()).startsWith('Reav(P18;'), 'P da reavaliação corrigido para 18: ' + await formula());
  await panel.fill('#an-card-diario .fd-row:has(select[data-id="540"]) .fd-p', '14');
  check(/P repetido: P14/.test(await outText()), 'avisa P repetido');
  await panel.fill('#an-card-diario .fd-row:has(select[data-id="540"]) .fd-p', '15');

  // Reavaliação trocada de linha: a anterior volta a ser soma.
  await panel.selectOption('#an-card-diario select[data-id="531"]', 'reav');
  check(await panel.$eval('#an-card-diario select[data-id="540"]', s => s.value) === 'soma', 'só uma reavaliação: a anterior vira soma');
  await panel.click('#an-card-diario .fd-redo');
  check(await formula() === f1, '"Refazer a sugestão" volta à fórmula inicial');

  await panel.click('#fd-out .fd-formula .btn-link-sm');
  await panel.waitForTimeout(100);
  check(await panel.evaluate(() => navigator.clipboard.readText()) === f1, 'copiar põe a fórmula na área de transferência');

  console.log('\nPainel — Verificar tarefas com o critério do sincronizador');
  await run('#btn-an-tarefas');
  const sis = await text('#an-card-sis');
  check(/19\s*tarefas\s*15\s*vão ao SGA\s*2\s*com problema/.test(sis) && !/Com pontos, sem SIS/.test(sis), 'contagem: 19 tarefas, 15 vão ao SGA, 2 com problema, nenhuma sem SIS');
  check(/Com SIS, mas não vão para o SGA\s*2[\s\S]*Bônus de participação[\s\S]*não conta na nota final[\s\S]*Autoavaliação[\s\S]*"Exibir nota como" não está em Pontos/.test(sis),
    'com SIS mas fora do SGA: fora da nota final e nota em %');
  check(/Postagem de notas manual \(conferir\)\s*1[\s\S]*Aberta 11[\s\S]*notas podem estar ocultas/.test(sis), 'postagem manual em amarelo, para conferir');
  check(/Não publicadas \(não vão para o SGA\)\s*1/.test(sis), 'a cópia não publicada fica no grupo "Não publicadas", sem alarme');
  check(await panel.locator('#an-card-diario').count() === 1, 'o cartão da fórmula continua lá');

  console.log('\nPainel — cartões recolhem e abrem');
  const collapsed = id => panel.$eval('#' + id, c => c.classList.contains('collapsed'));
  check(await collapsed('an-card-diario') && !await collapsed('an-card-sis'), 'Verificar tarefas: a fórmula recolhe, o SIS fica aberto');
  await run('#btn-an-boletim');
  const boletim = ['an-card-missing', 'an-card-zeros', 'an-card-over'];
  const states = async ids => Promise.all(ids.map(collapsed));
  check((await states(boletim)).every(c => !c), 'Verificar boletim: os 3 cartões do boletim abertos');
  check(await collapsed('an-card-diario') && await collapsed('an-card-sis'), 'Verificar boletim: fórmula e SIS recolhidos');
  check(await text('#an-card-diario') === 'Fórmula do diário (SGA)', 'recolhido, só o título aparece');
  await run('#btn-an-diario');
  check(!await collapsed('an-card-diario') && (await states(boletim)).every(c => c) && await collapsed('an-card-sis'),
    'Fórmula do diário: a fórmula abre e os cartões do boletim e do SIS recolhem');
  await shot('cartoes-recolhidos.png');
  await panel.click('#an-card-missing .an-card-title');
  check(!await collapsed('an-card-missing') && !await collapsed('an-card-diario'), 'clicar no título abre o cartão recolhido (sem fechar os outros)');
  await panel.click('#an-card-diario .an-card-title');
  check(await collapsed('an-card-diario'), 'clicar no título de novo recolhe');
  await panel.click('#an-card-diario .an-card-title');
  check(!await collapsed('an-card-diario') && await formula() === f1, 'e abre de novo, com a fórmula');

  console.log('\nPainel — sobra sem MAX (impacto nos alunos)');
  await setTab(202);
  await run('#btn-an-diario');
  check(await panel.locator('#an-card-sis').count() === 0, 'outra disciplina: o diagnóstico anterior some');
  out = await outText();
  check(/⚠ Sobra 1 pt: a nota máxima fica em 101/.test(out) && /tirar 1 pt de uma atividade/.test(out), 'sobra 1 ponto');
  check(requests.some(r => /students\/submissions/.test(r)), 'leu as notas para o levantamento');
  check(/⚠ Não deu para ler a Sincronização SGA \(HTTP 404[^)]*\)\. Os P seguem a ordem do Canvas/.test(await text('#an-card-diario')),
    'sem a ferramenta no curso: avisa e segue com a ordem do Canvas');
  const imp = await panel.$$eval('#fd-out details.an-section', els => els.map(d => d.querySelector('.an-section-title').textContent + ' [' + d.querySelector('.an-badge').textContent + ']'));
  check(imp[0] === 'P3 · Trabalho: 30 → 29 pts [0]', 'sem prejuízo primeiro (o aluno inativo com 30 no Trabalho não conta): ' + imp[0]);
  check(imp.join(' | ') === 'P3 · Trabalho: 30 → 29 pts [0] | P2 · Lista 2: 20 → 19 pts [1] | P1 · Lista 1: 10 → 9 pts [1] | P4 · Prova: 41 → 40 pts [2]',
    'ordem: menos prejuízo, depois maior valor — ' + imp.join(' | '));
  await panel.click('#fd-out details.an-section:last-of-type summary');
  check(/Ana — nota 41[\s\S]*Bruno — nota 40,5/.test(await outText()), 'lista quem perderia nota, com a nota');
  await shot('formula-sobra.png');

  console.log('\nPainel — falta');
  await setTab(303);
  await run('#btn-an-diario');
  out = await outText();
  check(/⚠ Falta 1 pt: a nota máxima fica em 99/.test(out) && /Criar uma tarefa de 1 pt, com SIS, e lançar 1 pt para todos os alunos/.test(out), 'falta 1: sugere criar a tarefa de 1 ponto');

  console.log('\nPainel — diário aberto com as siglas do SGA');
  await setTab(404);
  await run('#btn-an-diario');
  out = await outText();
  check(await formula() === 'Reav(P6;P1+P3+P4+P5)' && /✓ Fecha em 100\./.test(out),
    'P pelas siglas do SGA (P2 vago, Prova e Trabalho fora da ordem do Canvas): ' + await formula());
  const card404 = await text('#an-card-diario');
  check(/Diário aberto/.test(card404) && /✓ P lidos do SGA para as 5 tarefas\./.test(card404), 'diário aberto, P lidos do SGA para todas as tarefas');
  check(/Siglas do SGA sem tarefa no Canvas\s*1/.test(card404), 'lista a sigla que sobrou');
  await panel.click('#an-card-diario details.an-section summary');
  check(/P2 · Lista antiga · 5 pts · pendente de exclusão · consta na fórmula/.test(await text('#an-card-diario')), 'P2: pendente de exclusão e na fórmula');
  check(/No SGA ainda não há fórmula cadastrada\./.test(out), 'sem fórmula no SGA ainda');
  const rows404 = await panel.$$eval('#an-card-diario .fd-row', els => els.map(e => e.querySelector('.fd-p').value + ' ' + e.querySelector('.an-item-sub').textContent));
  check(rows404.join(' | ') === '1 10 pts · P1 no SGA | 3 20 pts · P3 no SGA | 5 30 pts · P5 no SGA | 4 40 pts · P4 no SGA | 6 100 pts · P6 no SGA',
    'cada tarefa mostra a sigla do SGA — ' + rows404.join(' | '));
  await shot('formula-siglas.png');

  check(!sgaRequests.some(r => /\/sync\b/.test(r.path)), 'nunca chamou o "Sincronizar" (/sga_sync/sync)');
  check(sgaRequests.every(r => r.path === '/sga_sync/launch' || r.path.startsWith('/sga_sync/index?')), 'na Sincronização SGA, só o acesso e o index: ' + [...new Set(sgaRequests.map(r => r.path.split('?')[0]))].join(', '));

  await browser.close();
  finish();
})().catch(err => { console.error(err); process.exit(1); });

function finish() {
  console.log(failures ? `\n✘ ${failures} falha(s)` : '\n✔ tudo certo');
  process.exit(failures ? 1 : 0);
}
