'use strict';

// Motor de comparação de textos: enunciado, alternativas (mesmo embaralhadas),
// justificativa e busca de um trecho dentro de um texto maior. É a tradução
// do app/comparator.py do programa "Comparador de Questões" (Python), com as
// mesmas regras e os mesmos números: a semelhança é a do difflib do Python
// (SequenceMatcher.ratio, inclusive o "autojunk"), então 96,2% lá é 96,2% aqui.
//   • 100% = igual; a partir de 85% = parcial; abaixo = diferente.
//   • Antes de comparar: aspas curvas, travessões, reticências, espaços e ".."
//     são uniformizados; ponto final e maiúscula inicial podem ser tolerados.
//   • Diferenças palavra a palavra: 'actual' = só no texto conferido (vermelho),
//     'expected' = só na referência (verde, faltando no conferido).
// Sem DOM e sem APIs do Chrome: roda na página, no service worker e no Node
// (testes). Fica em globalThis.__svcCompare.
// Regressão: .claude/skills/h5p-quiz/scripts/test-compare.js
globalThis.__svcCompare = (() => {
  const PARTIAL = 85;

  // ── difflib.SequenceMatcher (sem isjunk), como no CPython ──────────────
  // a e b: arrays (de caracteres ou de palavras).
  function matcher(a, b, autojunk = true) {
    const b2j = new Map();
    b.forEach((x, j) => { const l = b2j.get(x); if (l) l.push(j); else b2j.set(x, [j]); });
    // "autojunk": em b com 200+ itens, os que aparecem em mais de 1% não iniciam casamento.
    if (autojunk && b.length >= 200) {
      const ntest = Math.floor(b.length / 100) + 1;
      for (const [x, l] of [...b2j]) if (l.length > ntest) b2j.delete(x);
    }

    function longest(alo, ahi, blo, bhi) {
      let bi = alo, bj = blo, size = 0, j2len = new Map();
      for (let i = alo; i < ahi; i++) {
        const next = new Map();
        for (const j of b2j.get(a[i]) || []) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) || 0) + 1;
          next.set(j, k);
          if (k > size) { bi = i - k + 1; bj = j - k + 1; size = k; }
        }
        j2len = next;
      }
      // Sem isjunk não há lixo: estende pelos dois lados enquanto for igual.
      while (bi > alo && bj > blo && a[bi - 1] === b[bj - 1]) { bi--; bj--; size++; }
      while (bi + size < ahi && bj + size < bhi && a[bi + size] === b[bj + size]) size++;
      return [bi, bj, size];
    }

    let blocks = null;
    function matchingBlocks() {
      if (blocks) return blocks;
      const queue = [[0, a.length, 0, b.length]], found = [];
      while (queue.length) {
        const [alo, ahi, blo, bhi] = queue.pop();
        const x = longest(alo, ahi, blo, bhi), [i, j, k] = x;
        if (!k) continue;
        found.push(x);
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
      found.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
      blocks = [];
      let [i1, j1, k1] = [0, 0, 0];
      for (const [i2, j2, k2] of found) {
        if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2;
        else { if (k1) blocks.push([i1, j1, k1]); [i1, j1, k1] = [i2, j2, k2]; }
      }
      if (k1) blocks.push([i1, j1, k1]);
      blocks.push([a.length, b.length, 0]);
      return blocks;
    }

    return {
      ratio() {
        const total = a.length + b.length;
        return total ? (2 * matchingBlocks().reduce((s, x) => s + x[2], 0)) / total : 1;
      },
      opcodes() {
        let i = 0, j = 0;
        const out = [];
        for (const [ai, bj, size] of matchingBlocks()) {
          const tag = i < ai && j < bj ? 'replace' : i < ai ? 'delete' : j < bj ? 'insert' : '';
          if (tag) out.push([tag, i, ai, j, bj]);
          i = ai + size; j = bj + size;
          if (size) out.push(['equal', ai, i, bj, j]);
        }
        return out;
      },
    };
  }
  // Por caractere (ponto de código, como a str do Python).
  const ratioOf = (x, y) => matcher(Array.from(x), Array.from(y)).ratio();

  // ── Normalização ───────────────────────────────────────────────────────
  const JUST_PREFIX = /^\s*(?:justificativa(?:\s+(?:da|de|sem|com|para)\s+alternativa\s+(?:assinalada|associada|correta|marcada|selecionada))?|feedback|coment[áa]rio|explica[çc][ãa]o)\s*[:\-–—]?\s*/i;
  const TYPO = [[/[“”«»]/g, '"'], [/[‘’]/g, "'"], [/[–—−]/g, '-'], [/…/g, '...']];
  // Textos de leitor de tela que o Canvas põe no meio dos links (e o H5P no topo).
  const PAGE_NOISE = [
    /\s*Links\s+para\s+um\s+site\s+externo\.?/gi,
    /\s*Links\s+to\s+an\s+external\s+site\.?/gi,
    /\s*\(abre\s+em\s+uma\s+nova\s+janela\)/gi,
  ];
  const stripPageNoise = s => PAGE_NOISE.reduce((t, re) => t.replace(re, ''), String(s || ''));

  function normalize(text, o = {}) {
    const { whitespace = true, typography = true, stripPrefix = false, trailingPeriod = false, initialCase = false } = o;
    let s = String(text || '').normalize('NFC').replace(/ /g, ' ').replace(/[​﻿]/g, '');
    if (stripPrefix) s = s.replace(JUST_PREFIX, '');
    if (typography) {
      for (const [re, to] of TYPO) s = s.replace(re, to);
      s = s.replace(/(?<!\.)\.\.(?!\.)/g, '.');     // ".." acidental (depois de link) vira "."
    }
    if (whitespace) s = s.replace(/\s+/g, ' ').trim().replace(/\s+([,.;:!?])/g, '$1');
    else s = s.trim();
    if (trailingPeriod && s.endsWith('.') && !s.endsWith('...')) s = s.slice(0, -1).trimEnd();
    if (initialCase && s) s = s[0].toLowerCase() + s.slice(1);
    return s;
  }

  // ── Comparação de dois textos ──────────────────────────────────────────
  const WORD = /[\p{L}\p{N}_]+/gu;
  const tokens = t => t.match(/[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]+|\s+/gu) || [];

  // expected = referência (Word/Extrator); actual = o que foi conferido (H5P/Canvas).
  // → { expected, actual, expectedNorm, actualNorm, equal, similarity (0–100), tokens: [{ kind, text }] }
  function compareTexts(expected, actual, o = {}) {
    const e = normalize(expected, o), a = normalize(actual, o);
    const base = { expected: String(expected || ''), actual: String(actual || ''), expectedNorm: e, actualNorm: a };
    if (e === a) return { ...base, equal: true, similarity: e ? 100 : 0, tokens: a ? [{ kind: 'equal', text: a }] : [] };
    const te = tokens(e), ta = tokens(a), out = [];
    for (const [tag, i1, i2, j1, j2] of matcher(te, ta, false).opcodes()) {
      const exp = te.slice(i1, i2).join(''), act = ta.slice(j1, j2).join('');
      if (tag === 'equal') out.push({ kind: 'equal', text: act });
      else if (tag === 'delete') out.push({ kind: 'expected', text: exp });
      else if (tag === 'insert') out.push({ kind: 'actual', text: act });
      else out.push({ kind: 'actual', text: act }, { kind: 'expected', text: exp });
    }
    return { ...base, equal: false, similarity: round1(ratioOf(e, a) * 100), tokens: out };
  }
  // round() do Python arredonda o meio para o par; com 1 casa a diferença é irrelevante aqui.
  const round1 = x => Math.round(x * 10) / 10;
  const verdictOf = c => (c.equal ? 'ok' : c.similarity >= PARTIAL ? 'partial' : 'err');

  // Semelhança 0–1 sem diferenciar maiúsculas (para escolher pares).
  function similarity(x, y) {
    const a = normalize(x).toLowerCase(), b = normalize(y).toLowerCase();
    if (!a || !b) return 0;
    return a === b ? 1 : ratioOf(a, b);
  }

  // Entre várias questões da referência, a que corresponde à conferida.
  // q: { enunciado, alternativas: [{ text }] }
  function matchBestQuestion(q, candidates) {
    if (!candidates?.length) return null;
    if (candidates.length === 1) return candidates[0];
    let best = candidates[0], bestScore = -1;
    for (const c of candidates) {
      let score = similarity(q.enunciado, c.enunciado) * 2;
      if (q.alternativas?.length && c.alternativas?.length) {
        const s = q.alternativas.map(x => Math.max(0, ...c.alternativas.map(y => similarity(x.text, y.text))));
        score += s.reduce((t, v) => t + v, 0) / s.length;
      }
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  // Todas as sequências de k índices distintos de 0..n-1, na ordem do itertools.permutations.
  function* permutations(n, k) {
    const used = new Array(n).fill(false), cur = [];
    function* go() {
      if (cur.length === k) { yield cur.slice(); return; }
      for (let i = 0; i < n; i++) {
        if (used[i]) continue;
        used[i] = true; cur.push(i);
        yield* go();
        cur.pop(); used[i] = false;
      }
    }
    yield* go();
  }

  // Pareia as alternativas da referência com as conferidas pela maior semelhança
  // somada (casamento ótimo até 7; guloso acima). Par com menos de 25% fica sem par.
  // → [{ expected: alt|null, actual: alt|null, comparison, correctInExpected }]
  function matchOptions(expected, actual, o = {}) {
    const ne = expected.length, nc = actual.length;
    if (!ne && !nc) return [];
    const m = expected.map(e => actual.map(c => similarity(e.text, c.text)));
    const pairs = [];
    if (ne && nc && Math.max(ne, nc) <= 7) {
      if (ne <= nc) {
        let best = null, bestVal = -1;
        for (const p of permutations(nc, ne)) {
          const v = p.reduce((s, c, i) => s + m[i][c], 0);
          if (v > bestVal) { bestVal = v; best = p; }
        }
        const used = new Set();
        for (let i = 0; i < ne; i++) {
          const c = best ? best[i] : i;
          if (m[i][c] >= 0.25) { pairs.push([i, c]); used.add(c); } else pairs.push([i, null]);
        }
        for (let c = 0; c < nc; c++) if (!used.has(c)) pairs.push([null, c]);
      } else {
        let best = null, bestVal = -1;
        for (const p of permutations(ne, nc)) {
          const v = p.reduce((s, e, j) => s + m[e][j], 0);
          if (v > bestVal) { bestVal = v; best = p; }
        }
        const matched = new Map();
        for (let j = 0; j < nc; j++) {
          const e = best ? best[j] : j;
          if (m[e][j] >= 0.25) matched.set(e, j);
        }
        for (let e = 0; e < ne; e++) pairs.push([e, matched.has(e) ? matched.get(e) : null]);
        const used = new Set(matched.values());
        for (let c = 0; c < nc; c++) if (!used.has(c)) pairs.push([null, c]);
      }
    } else {
      const used = new Set();
      for (let e = 0; e < ne; e++) {
        let bestC = null, bestS = 0.25;
        for (let c = 0; c < nc; c++) if (!used.has(c) && m[e][c] >= bestS) { bestS = m[e][c]; bestC = c; }
        if (bestC !== null) used.add(bestC);
        pairs.push([e, bestC]);
      }
      for (let c = 0; c < nc; c++) if (!used.has(c)) pairs.push([null, c]);
    }
    const tol = o.tolerate !== false;
    return pairs.map(([e, c]) => {
      const ex = e === null ? null : expected[e], ac = c === null ? null : actual[c];
      return {
        expected: ex, actual: ac,
        comparison: compareTexts(ex?.text || '', ac?.text || '', { ...o, trailingPeriod: tol, initialCase: tol }),
        correctInExpected: !!ex?.correct,
      };
    });
  }

  // Relatório de uma questão: referência (expected) × conferida (actual).
  // Questão: { label, enunciado, alternativas: [{ text, correct?, letter? }], justificativa? }
  // o.h5pStatus: 'correta' | 'errada' | 'desconhecido' | 'nao_verificado'
  // o.justificativa: a justificativa conferida (null = não lida).
  function buildReport(expected, actual, o = {}) {
    const { h5pStatus = 'nao_verificado', justificativa = null } = o;
    const tol = o.tolerate !== false;
    const warnings = [];
    const enunciado = compareTexts(expected.enunciado, actual.enunciado, o);
    const alternativas = matchOptions(expected.alternativas || [], actual.alternativas || [], o);
    const correctExpected = (expected.alternativas || []).find(x => x.correct) || null;
    let correctActual = null;
    if (correctExpected) correctActual = alternativas.find(p => p.expected === correctExpected && p.actual)?.actual || null;
    else warnings.push('Nenhuma alternativa correta na referência.');
    if ((expected.alternativas || []).length !== (actual.alternativas || []).length) {
      warnings.push(`Quantidade de alternativas diferente: a referência tem ${(expected.alternativas || []).length} e o conferido tem ${(actual.alternativas || []).length}.`);
    }
    let just = null;
    if (justificativa !== null) {
      just = compareTexts(expected.justificativa || '', justificativa, { ...o, stripPrefix: true, trailingPeriod: tol, initialCase: tol });
      if (!expected.justificativa) warnings.push('Justificativa não encontrada na referência.');
      if (!justificativa) warnings.push('Justificativa não encontrada no conferido.');
    }

    const paired = alternativas.length > 0 && alternativas.every(p => p.expected && p.actual);
    const altScore = p => (p.expected && p.actual ? p.comparison.similarity : 0);
    const alternativasOk = paired && alternativas.every(p => p.comparison.equal);
    const alternativasMin = alternativas.length ? Math.min(...alternativas.map(altScore)) : 0;
    const scores = [enunciado.similarity, alternativasMin, ...(just ? [just.similarity] : [])];
    const minSimilarity = round1(Math.min(...scores));
    const avg = [enunciado.similarity];
    if (alternativas.length) avg.push(alternativas.reduce((s, p) => s + altScore(p), 0) / alternativas.length);
    if (just) avg.push(just.similarity);
    const overallSimilarity = round1(avg.reduce((s, v) => s + v, 0) / avg.length);
    const allOk = enunciado.equal && alternativasOk && h5pStatus !== 'errada' && (!just || just.equal);
    const partial = !allOk && h5pStatus !== 'errada' && paired && minSimilarity >= PARTIAL;
    return {
      label: expected.label || 'Questão',
      enunciado, alternativas, correctExpected, correctActual, h5pStatus, justificativa: just, warnings,
      alternativasOk, alternativasMin, minSimilarity, overallSimilarity, allOk, partial,
      verdict: allOk ? 'ok' : partial ? 'partial' : 'err',
    };
  }

  // ── Busca de um trecho num texto maior ("Texto livre") ──────────────────
  const wordSpans = t => [...t.matchAll(WORD)].map(m => [m[0].toLowerCase(), m.index, m.index + m[0].length]);

  // Procura em target o trecho mais parecido com query. sections: [[rótulo, texto]]
  // (ex.: as questões do Word) para dizer onde achou.
  // → { comparison (expected = trecho achado, actual = query), found, verdict, location,
  //     context (o texto inteiro da seção onde achou, ou ''), queryChars, targetChars }
  //
  // Como o comparator.py: escolhe a seção que mais tem as palavras do trecho e
  // procura nela. Diferente dele, quando o texto tem mais do que as seções
  // (ex.: o relatório da FIC, com o conteúdo das sessões e as questões), o
  // trecho igual em outro lugar ganha, e uma busca na seção que nem chega a
  // parcial é refeita no texto inteiro (fica a melhor; empate fica com a seção).
  function findBestMatch(query, target, o = {}) {
    const { sections = null } = o;
    const tol = o.tolerate !== false;
    const qo = { ...o, trailingPeriod: tol, initialCase: tol };
    const q = normalize(query, qo), t = normalize(target, o);
    const result = (comparison, found, [location, context] = ['', '']) => ({
      comparison, found, location: found ? location : '', context: found ? context : '',
      verdict: found ? verdictOf(comparison) : 'err', queryChars: q.length, targetChars: t.length,
    });
    if (!q || !t) return result(compareTexts(t, q, qo), false);
    const qLower = q.toLowerCase();

    // 1) Com seções, primeiro a seção de melhor encaixe.
    const secs = (sections || []).map(([label, raw]) => [label, normalize(raw, o)]).filter(s => s[1]);
    let location = '', sectionText = '';
    if (secs.length) {
      let bestScore = -1, bestLabel = '', bestText = '';
      const qWords = new Set(wordSpans(q).map(w => w[0]));
      for (const [label, s] of secs) {
        if (s.toLowerCase().includes(qLower)) { bestScore = 2; bestLabel = label; bestText = s; break; }
        const sWords = new Set(wordSpans(s).map(w => w[0]));
        let common = 0;
        for (const w of qWords) if (sWords.has(w)) common++;
        const overlap = common / Math.max(1, qWords.size);
        if (overlap > bestScore) { bestScore = overlap; bestLabel = label; bestText = s; }
      }
      if (bestScore >= 0.35 && bestText) { location = bestLabel; sectionText = bestText; }
    }
    // Em que seção está um trecho achado no texto inteiro → [rótulo, texto] (['', ''] = fora delas).
    // Vale também o trecho que só começa ou só termina nela: no relatório da FIC, o
    // "Questão de Fixação:" do começo da célula fica fora do texto da questão.
    const lower = secs.map(([, x]) => x.toLowerCase());
    const sectionOf = slice => {
      const s = slice.toLowerCase(), head = s.slice(0, 60), tail = s.slice(-60);
      let i = lower.findIndex(x => x.includes(s));
      if (i === -1 && s.length > 80) i = lower.findIndex(x => x.includes(tail) || x.includes(head));
      return i === -1 ? ['', ''] : secs[i];
    };
    const inSectionAt = [location, sectionText];

    // 2) Igual (sem diferenciar maiúsculas): na hora — na seção e, se não, no texto inteiro.
    for (const [space, where] of [[sectionText, inSectionAt], [t, null]]) {
      const at = space ? space.toLowerCase().indexOf(qLower) : -1;
      if (at === -1) continue;
      const slice = space.slice(at, at + q.length);
      return result(compareTexts(slice, query, qo), true, where ?? sectionOf(slice));
    }

    // 3) Aproximado.
    if (sectionText) {
      const inSection = compareTexts(approxSlice(q, sectionText), query, qo);
      if (inSection.similarity >= PARTIAL) return result(inSection, true, inSectionAt);
      const whole = compareTexts(approxSlice(q, t), query, qo);
      if (whole.similarity > inSection.similarity) return result(whole, whole.similarity >= 45, sectionOf(whole.expected));
      return result(inSection, inSection.similarity >= 45, inSectionAt);
    }
    const comparison = compareTexts(approxSlice(q, t), query, qo);
    return result(comparison, comparison.similarity >= 45, sectionOf(comparison.expected));
  }

  // O recorte de space mais parecido com q (já normalizado): janela deslizante
  // de palavras e refinamento em volta das melhores, como no comparator.py.
  function approxSlice(q, space) {
    const qs = wordSpans(q), ts = wordSpans(space), m = qs.length, n = ts.length;
    let bestSlice = space, bestRatio = -1;
    const qLow = Array.from(q.toLowerCase());
    const step = Math.max(1, Math.trunc(m / 6));
    // Recortes que começam entre as palavras sMin e sMax, com o tamanho do trecho (±3 palavras).
    function refine(sMin, sMax) {
      for (let si = sMin; si <= sMax; si++) {
        for (const d of [-3, -1, 0, 1, 3]) {
          const ei = Math.min(n - 1, Math.max(si, si + m - 1 + d));
          const from = ts[si][1];
          let to = ts[ei][2];
          if (to < space.length && '.,;:!?)”"'.includes(space[to])) to++;
          const cand = space.slice(from, to);
          const r = matcher(qLow, Array.from(cand.toLowerCase())).ratio();
          if (r > bestRatio) { bestRatio = r; bestSlice = cand; }
        }
      }
    }
    if (!m || !n) bestSlice = space;
    else if (n <= Math.trunc(m * 1.3)) {
      // Texto só um pouco maior que o trecho (ex.: o iframe de um H5P). O
      // comparator.py compara com ele inteiro, e o que sobra em volta (botões,
      // alternativas) conta como diferença; aqui ele é só o primeiro candidato,
      // e um recorte que bata melhor fica no lugar.
      bestRatio = matcher(qLow, Array.from(space.toLowerCase())).ratio();
      refine(0, n - 1);
    } else {
      const qSet = new Set(qs.map(w => w[0]));
      let starts = [];
      for (let s = 0; s < Math.max(1, n - m + 1); s += step) {
        const win = new Set();
        for (let k = s; k < Math.min(n, s + m + 2); k++) win.add(ts[k][0]);
        let common = 0;
        for (const w of qSet) if (win.has(w)) common++;
        const score = common / Math.max(1, qSet.size);
        if (score >= 0.2) starts.push([score, s]);
      }
      starts.sort((x, y) => y[0] - x[0]);      // estável, como o sort do Python
      starts = starts.length ? starts.slice(0, 6) : [[0, 0]];
      bestSlice = space.slice(0, Math.min(space.length, q.length + 40));
      for (const [, approx] of starts) {
        refine(Math.max(0, approx - Math.max(3, step)), Math.min(n - 1, approx + Math.max(3, step)));
      }
    }
    return bestSlice;
  }

  return {
    PARTIAL, normalize, stripPageNoise, compareTexts, verdictOf, similarity, ratio: ratioOf,
    matchBestQuestion, matchOptions, buildReport, findBestMatch, matcher, tokens,
  };
})();
