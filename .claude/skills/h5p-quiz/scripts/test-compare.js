// Regressão do motor de comparação (text-compare.js) e do leitor de Word
// empacotado (extrator.js). Os primeiros casos são os do tests/test_comparator.py
// do Comparador de Questões (Python) que não dependem da tela: o motor daqui
// é a tradução do comparator.py e tem de dar os mesmos resultados.
// Só Node:  node .claude/skills/h5p-quiz/scripts/test-compare.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../../../..');
const ctx = { TextDecoder, TextEncoder, console, Uint8Array };
ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'text-compare.js'), 'utf8'), ctx);
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'extrator.js'), 'utf8'), ctx);
const C = ctx.__svcCompare;

let fails = 0;
function check(ok, label, extra = '') {
  console.log(`${ok ? '  ok  ' : '  FALHOU'} ${label}${ok || !extra ? '' : `\n         ${extra}`}`);
  if (!ok) fails++;
}
const alt = (text, correct = false) => ({ text, correct });

console.log('Casos do test_comparator.py:');
{
  // test_real_question_shuffled_options
  const enunciado = '"Inovação é a criação de uma nova oferta viável através de uma solução até então inexplorada. '
    + 'Para inovar, é preciso identificar um problema e se mover através dele sistematicamente até encontrar '
    + 'uma solução elegante" (Doblin Innovation Consulting). Sobre inovação é INCORRETO afirmar que:';
  const ref = {
    label: 'Questão 1', enunciado,
    alternativas: [
      alt('Promove a manutenção, sobrevivência e desenvolvimento do negócio.'),
      alt('Engloba formas de fazer negócio e dinheiro, novos sistemas e serviços.'),
      alt('Promove novas formas de relacionamento entre empresa e clientes.'),
      alt('Agrega valor ao produto e à imagem da empresa.'),
      alt('O seu foco é garantir resultados e vantagens competitivas a curto prazo.', true),
    ],
    justificativa: 'Justificativa da alternativa assinalada: A inovação como centro da estratégia é o que garante '
      + 'a perenidade das instituições, no longo prazo, inclusive garantindo força e competências para '
      + 'momentos de crise e instabilidade econômica.',
  };
  const got = {
    enunciado: enunciado.replace('"', '“').replace('"', '”'),
    alternativas: [ref.alternativas[0], ref.alternativas[3], ref.alternativas[2], ref.alternativas[4], ref.alternativas[1]].map(a => alt(a.text)),
  };
  const r = C.buildReport(ref, got, {
    h5pStatus: 'correta',
    justificativa: 'A inovação como centro da estratégia é o que garante a perenidade das instituições, '
      + 'no longo prazo, inclusive garantindo força e competências para momentos de crise e instabilidade econômica.',
  });
  check(r.allOk && r.verdict === 'ok', 'alternativas embaralhadas + aspas curvas + prefixo da justificativa → tudo OK');
  check(r.correctActual === got.alternativas[3], 'a correta (E) foi achada na 4ª posição do conferido');
}
{
  // test_detects_typo_in_justificativa_and_option
  const c = C.compareTexts('Justificativa da alternativa assinalada: A inovação garante a perenidade no longo prazo.',
    'A inovação garante a perenidade no curto prazo.', { stripPrefix: true });
  const kinds = new Set(c.tokens.map(t => t.kind));
  check(!c.equal && kinds.has('actual') && kinds.has('expected'), 'palavra trocada aparece no diff (vermelho e verde)');
}
{
  // test_match_best_question_among_multiple
  const q1 = { label: 'Questão 1', enunciado: 'Sobre inovação é INCORRETO afirmar que:' };
  const q2 = { label: 'Questão 2', enunciado: 'O tipo de inovação que promove melhoria em um produto:' };
  check(C.matchBestQuestion({ enunciado: 'O tipo de inovação que promove melhoria em um produto:' }, [q1, q2]) === q2, 'escolhe a questão certa entre várias');
}
{
  // test_question_2_trailing_period_and_initial_case
  const enun = 'O tipo de inovação que promove melhoria em um produto ou serviço, sem impactar modelos de negócio é a:';
  const r = C.buildReport(
    { label: 'Questão 2', enunciado: enun, alternativas: [alt('Inovação Radical'), alt('Inovação Incremental', true)],
      justificativa: 'Justificativa sem alternativa associada: a inovação incremental promove uma melhoria.' },
    { enunciado: enun, alternativas: [alt('Inovação Incremental.'), alt('Inovação Radical.')] },
    { h5pStatus: 'correta', justificativa: 'A inovação incremental promove uma melhoria.' });
  check(r.allOk, 'ponto final nas alternativas e maiúscula inicial na justificativa não contam');
}
{
  // test_question_5_external_link_and_show_more (parte do texto)
  const canvas = C.stripPageNoise('(Disponivel em: https://www.agenciaminas.mg.gov.br/noticia/governo-mapeia-ecossistema-de-inovacao '
    + 'Links para um site externo.. Pesquisa realizada em 19/05/2022) Faz parte de um Ecossistema de Inovação:');
  const extrator = '(Disponivel em: https://www.agenciaminas.mg.gov.br/noticia/governo-mapeia-ecossistema-de-inovacao. '
    + 'Pesquisa realizada em 19/05/2022) Faz parte de um Ecossistema de Inovação:';
  const c = C.compareTexts(extrator, canvas);
  check(c.equal, '"Links para um site externo." do Canvas não conta como diferença', c.actualNorm);
}
{
  // test_partially_correct_status_and_short_option_prefix
  const enun = 'A Big Data pode ser utilizada nas empresas de comércio varejista.';
  const ref = { label: 'Questão 11', enunciado: enun, alternativas: [alt('Certo', true), alt('Errado')],
    justificativa: 'Justificativa sem alternativa associada: a Big Data traz dados para análise de preferências o que proporciona um estudo de melhorias.' };
  const got = { enunciado: enun, alternativas: [alt('Certo.'), alt('Errado.')] };
  const p = C.buildReport(ref, got, { h5pStatus: 'correta', justificativa: 'A Big Data traz dados para análise de preferências, o que proporciona um estudo de melhorias.' });
  check(p.verdict === 'partial' && p.minSimilarity >= 85, `vírgula a mais na justificativa → PARCIAL (${p.minSimilarity}%)`);
  const w = C.buildReport(ref, got, { h5pStatus: 'errada', justificativa: 'A Big Data traz dados para análise de preferências o que proporciona um estudo de melhorias.' });
  check(w.verdict === 'err', 'gabarito do H5P errado nunca é parcial');
}
{
  // test_free_text_search_fic_vs_extrator
  const sections = [
    ['Questão 1', 'A empresa Beta S.A. deseja calcular o WACC usando CAPM de 20%.'],
    ['Questão 7', 'De acordo com a Teoria do Trade-Off, a estratégia de financiamento ótima é aquela em que...'],
    ['Questão 8', 'A "Companhia de Papel S.A." possui um WACC de 10% e opera em um setor maduro e de baixo risco. '
      + 'A diretoria está avaliando dois projetos mutuamente excludentes: '
      + 'Projeto ALFA: Uma nova máquina de secagem de celulose, de risco idêntico ao da empresa, com retorno esperado de 11%. '
      + 'Projeto BETA: A aquisição de uma startup de blockchain para logística (altíssimo risco), com retorno esperado de 13%.'],
    ['Questão 9', 'No processo de abertura de capital, qual documento é submetido à CVM?'],
  ];
  const full = sections.map(s => s[1]).join(' ');
  const ok = C.findBestMatch('A "Companhia de Papel S.A." possui um WACC de 10% e opera em um setor maduro e de baixo risco.', full, { sections });
  check(ok.found && ok.verdict === 'ok' && ok.location === 'Questão 8', 'texto livre: trecho igual achado na Questão 8');
  const typo = C.findBestMatch('A "Companhia de Papel S.A." possui um WACC de 12% e opera em um setor maduro e de baixo risco.', full, { sections });
  check(typo.found && typo.verdict === 'partial' && typo.location === 'Questão 8' && typo.comparison.similarity >= 90,
    `texto livre: "12%" no lugar de "10%" → PARCIAL na Questão 8 (${typo.comparison.similarity}%)`);
}

console.log('O caso real do ultimo_diagnostico.txt (Questão 11, 96,2%):');
{
  const query = 'Questão de Fixação: A Empresa Beta S.A. deseja calcular seu WACC. O mercado avalia seu capital próprio em R$ 200 milhões e sua dívida em R$ 50 milhões. O Custo do Capital Próprio (Ke) estimado via CAPM é de 20%, e o custo da dívida (Ki) antes dos impostos é de 10%. A alíquota de imposto de renda da empresa é de 34%.';
  // Na tela do Extrator a Questão 11 tinha também alternativas e justificativa:
  // com a seção bem maior que o trecho, a busca recorta só a parte parecida
  // (seção curta, até 1,3× o trecho, é comparada inteira — regra do comparator.py).
  const questao11 = 'A Empresa Beta S.A. deseja calcular seu WACC. O mercado avalia seu capital próprio em R$ 200 milhões e sua dívida em R$ 50 milhões. O Custo do Capital Próprio (Ke) estimado via CAPM é de 20%, e o custo da dívida (Ki) antes dos impostos é de 10%. A alíquota de imposto de renda da empresa é de 34%. Qual é o WACC da empresa?\n'
    + 'a) 15,2%\nb) 17,32%\nc) 18,5%\nd) 20%\n'
    + 'Justificativa: O WACC é a média ponderada dos custos de capital próprio e de terceiros, com o custo da dívida já descontado do imposto de renda.';
  const sections = [['Questão 10', 'O custo de capital próprio pode ser estimado pelo CAPM.'], ['Questão 11', questao11], ['Questão 12', 'Sobre a estrutura de capital, assinale a correta.']];
  const r = C.findBestMatch(query, sections.map(s => s[1]).join('\n'), { sections });
  check(r.found && r.location === 'Questão 11' && r.verdict === 'partial', `achou na Questão 11, parcial (${r.comparison.similarity}%)`);
  check(r.comparison.similarity === 96.2, 'mesma semelhança que o programa em Python mostrou: 96,2%', `deu ${r.comparison.similarity}%`);
  const extra = r.comparison.tokens.filter(t => t.kind === 'actual').map(t => t.text).join('|');
  // (com a tolerância de maiúscula inicial, o "Questão" sai em minúscula, como no Python)
  check(/quest[ãa]o de fixa[çc][ãa]o/i.test(extra), 'o "Questão de Fixação:" do H5P aparece como sobrando', extra);
}

console.log('Word de verdade (fixtures/questoes-nosql.docx), lido pelo extrator.js:');
{
  const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures/questoes-nosql.docx')));
  const { paragrafos, questoes } = ctx.__svcExtrator.lerWord(bytes);
  check(questoes.length === 6 && questoes.every(q => q.paragrafos.length), `6 questões com os parágrafos de cada uma (${questoes.length})`);
  check(questoes.map(q => q.correta).join('') === 'ACAADA', `corretas como no Extrator: ${questoes.map(q => q.correta).join('')}`);
  // o mesmo jeito de montar o alvo que o painel usa (find-text-panel.js → wordTarget)
  const doc = { paragrafos: paragrafos.map(p => p.texto), questoes: questoes.map(q => ({ numero: q.numero, paragrafos: q.paragrafos })) };
  const text = doc.paragrafos.join('\n');
  const sections = doc.questoes.map(q => [`Questão ${q.numero}`, q.paragrafos.map(i => doc.paragrafos[i]).join('\n')]);
  const enun2 = doc.paragrafos[21];
  const same = C.findBestMatch(enun2, text, { sections });
  check(same.verdict === 'ok' && same.location === 'Questão 2', 'enunciado da Questão 2 → IGUAL, na Questão 2');
  const changed = enun2.replace('região', 'regiao').replace(/\.$/, '') + ' e isso é tudo.';
  const ch = C.findBestMatch(changed, text, { sections });
  check(ch.found && ch.verdict === 'partial' && ch.location === 'Questão 2', `acento tirado e texto a mais → PARCIAL na Questão 2 (${ch.comparison.similarity}%)`);
  const alt3 = 'Nesse caso, o campo recebe um valor do tipo';
  const a3 = C.findBestMatch(alt3, text, { sections });
  check(a3.found && a3.location === 'Questão 3', 'começo de alternativa → achado na Questão 3');
  const none = C.findBestMatch('Fotossíntese é o processo pelo qual as plantas produzem glicose usando luz solar.', text, { sections });
  check(!none.found, `texto que não está no Word → NÃO ENCONTRADO (${none.comparison.similarity}%)`);
  const t0 = Date.now();
  for (const p of doc.paragrafos.filter(p => p.length > 60).slice(0, 25)) C.findBestMatch(p.replace(/a/, 'á') + ' fim', text, { sections });
  const ms = Date.now() - t0;
  check(ms < 4000, `25 buscas aproximadas no Word inteiro em ${ms} ms`);
}

console.log('HTML (fixtures/fic-mini.html, relatório da FIC), lido pelo extrator.js:');
{
  const r = ctx.__svcExtrator.lerDocumento('fic-mini.html', new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures/fic-mini.html'))));
  const seps = r.paragrafos.filter(p => p.secao !== undefined).map(p => p.secao);
  check(seps.join(' | ') === 'Inovação: conceito | Tipologias de Inovação: Radical x Incremental', `as duas sessões viram separadores: ${seps.join(' | ')}`);
  check(r.questoes.length === 2 && r.questoes.map(q => q.correta).join('') === 'CB', `2 questões, corretas C e B (pelo realce): ${r.questoes.map(q => q.correta).join('')}`);
  check(/rompe com o que existe/.test(r.texto) && !/rompe com o que existe/.test(r.paragrafos.map(p => p.texto).join(' ')),
    'o texto inteiro tem o conteúdo das sessões; as questões, só as células "Questão de Fixação"');
  check(!/Questão de Fixação/.test(r.paragrafos.map(p => p.texto).join(' ')), 'o rótulo "Questão de Fixação:" não entra no texto da questão');

  // Texto da sessão (fora das questões) com muitas palavras em comum com a Questão 2:
  // o comparator.py procuraria só na questão; aqui o igual no texto inteiro ganha.
  const sections = r.questoes.map(q => [`Questão ${q.numero}`, q.paragrafos.map(i => r.paragrafos[i].texto).join('\n')]);
  const fora = 'A inovação radical rompe com o que existe; a incremental melhora o que já existe, passo a passo.';
  const f1 = C.findBestMatch(fora, r.texto, { sections });
  check(f1.verdict === 'ok' && f1.location === '', `trecho igual fora das questões → IGUAL, sem questão (${f1.comparison.similarity}%)`);
  const f2 = C.findBestMatch(fora.replace('passo a passo', 'aos poucos'), r.texto, { sections });
  check(f2.verdict === 'partial' && f2.location === '', `parecido fora das questões → refeito no texto inteiro: ${f2.verdict} ${f2.comparison.similarity}%`);
  const f3 = C.findBestMatch('O tipo de inovação que promove melhoria em um produto ou serviço, sem impactar modelos de negócio é a:', r.texto, { sections });
  check(f3.verdict === 'partial' && f3.location === 'Questão 2', `enunciado sem a vírgula → PARCIAL na Questão 2 (${f3.comparison.similarity}%)`);
}

console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
