'use strict';

// Lê os .h5p de questões para o "📁 Pasta H5P" (canvas-h5p-folder.js): o quiz
// de cada tópico já nasce com a questão do arquivo, em vez da provisória.
// Feito para os arquivos do Extrator de Questões (projeto Machine-Learning),
// que converte o .docx das questões de fixação:
//   • um .h5p de Múltipla escolha por questão ("TÓPICO 1.h5p", …);
//   • o .zip com esses .h5p ("<documento> - questões H5P.zip");
//   • um .h5p de Question Set com todas, cada questão com o título "TÓPICO N".
// Cada questão vai para a página "Tópico N" de mesmo número. Só entram
// questões de Múltipla escolha na versão do H5P.com da PUC (1.16) e sem
// imagem, áudio ou vídeo: o que vai para o H5P.com é o content.json, pelo
// mesmo formulário de criação do quiz provisório. As configurações da
// questão (Tentar novamente, Mostrar solução, pontuação…) ficam como vieram
// no arquivo. Fica em globalThis.__svcH5pPackage.
// Regressão: .claude/skills/h5p-quiz/scripts/test-h5p-folder.js
globalThis.__svcH5pPackage = (() => {
  const LIBRARY   = 'H5P.MultiChoice 1.16';
  const MAX_BYTES = 10 * 1024 * 1024;
  const dec = new TextDecoder();

  // "TÓPICO 1", "Tópico 01 – …", "topico_3.h5p" → '1', '1', '3'.
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[‐-―]/g, '-').toLowerCase();
  function topicNumber(s) {
    const m = fold(s).match(/topico[\s_.:-]*(\d+)/);
    return m ? String(Number(m[1])) : null;
  }

  // ── ZIP (o .h5p é um ZIP) ─────────────────────────────────────────────
  // Entradas pelo diretório central: Map nome → { method, csize, size, local }; null se não é ZIP.
  function entriesOf(buf) {
    const v = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    const count = v.getUint16(eocd + 10, true);
    let p = v.getUint32(eocd + 16, true);
    const out = new Map();
    for (let n = 0; n < count; n++) {
      if (p + 46 > buf.byteLength || v.getUint32(p, true) !== 0x02014b50) return null;
      const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
      const name = dec.decode(new Uint8Array(buf, p + 46, nlen)).replace(/\\/g, '/');
      out.set(name, { method: v.getUint16(p + 10, true), csize: v.getUint32(p + 20, true), size: v.getUint32(p + 24, true), local: v.getUint32(p + 42, true) });
      p += 46 + nlen + xlen + clen;
    }
    return out;
  }

  async function readEntry(buf, e) {
    if (e.size > MAX_BYTES) throw new Error('arquivo interno grande demais');
    const v = new DataView(buf);
    const start = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
    const data = new Uint8Array(buf, start, e.csize);
    if (e.method === 0) return data;
    if (e.method !== 8) throw new Error('compactação não suportada');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  const json = bytes => JSON.parse(dec.decode(bytes).replace(/^﻿/, ''));
  const plain = html => String(html ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ').trim();

  // Por que a questão não serve (ou null).
  function problemOf(params) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) return 'sem o conteúdo da questão';
    if (!plain(params.question)) return 'questão sem enunciado';
    const answers = Array.isArray(params.answers) ? params.answers : [];
    if (answers.length < 2) return 'menos de 2 alternativas';
    if (answers.some(a => !plain(a?.text))) return 'alternativa sem texto';
    if (!answers.some(a => a?.correct === true)) return 'nenhuma alternativa marcada como correta';
    return null;
  }

  function add(out, { title, fallback, params, source }) {
    const why = problemOf(params);
    if (why) return out.problems.push(`${source}: ${why}.`);
    const number = topicNumber(title) || topicNumber(fallback);
    if (!number) return out.problems.push(`${source}: sem "Tópico N" no título${fallback ? ' nem no nome do arquivo' : ''}.`);
    out.quizzes.push({ number, params, source });
  }

  // Um arquivo (.h5p, ou .zip com .h5p dentro) → questões em out.quizzes, motivos em out.problems.
  async function readFile(name, buf, out, depth = 0) {
    if (buf.byteLength > MAX_BYTES) return out.problems.push(`${name}: maior que 10 MB.`);
    const entries = entriesOf(buf);
    if (!entries) return out.problems.push(`${name}: não é um .h5p nem um .zip válido.`);
    try {
      if (!entries.has('h5p.json')) {
        const inner = [...entries.keys()].filter(n => /\.h5p$/i.test(n));
        if (!inner.length || depth) return out.problems.push(`${name}: não tem h5p.json nem arquivos .h5p dentro.`);
        for (const n of inner) {
          const bytes = await readEntry(buf, entries.get(n));
          await readFile(n.split('/').pop(), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), out, depth + 1);
        }
        return;
      }
      const content = entries.get('content/content.json');
      if (!content) return out.problems.push(`${name}: sem content/content.json.`);
      // Imagem, áudio ou vídeo vão em content/…: o formulário só leva o texto.
      const media = [...entries.keys()].filter(n => n.startsWith('content/') && n !== 'content/content.json' && !n.endsWith('/'));
      if (media.length) return out.problems.push(`${name}: tem imagem, áudio ou vídeo — suba este pelo H5P.com.`);
      const h5p = json(await readEntry(buf, entries.get('h5p.json')));
      const params = json(await readEntry(buf, content));
      const main = String(h5p.mainLibrary || '');
      if (main === 'H5P.MultiChoice') {
        const dep = (h5p.preloadedDependencies || []).find(d => d?.machineName === main);
        const lib = dep ? `${main} ${dep.majorVersion}.${dep.minorVersion}` : main;
        if (lib !== LIBRARY) return out.problems.push(`${name}: é ${lib}; o H5P.com da PUC usa ${LIBRARY}.`);
        add(out, { title: h5p.title, fallback: name.replace(/\.h5p$/i, ''), params, source: name });
      } else if (main === 'H5P.QuestionSet') {
        const qs = Array.isArray(params.questions) ? params.questions : [];
        if (!qs.length) return out.problems.push(`${name}: Question Set sem questões.`);
        qs.forEach((q, i) => {
          const title = String(q?.metadata?.title || '');
          const source = `${name} › ${title || `questão ${i + 1}`}`;
          if (q?.library !== LIBRARY) return out.problems.push(`${source}: é ${q?.library || 'de tipo desconhecido'} — só entra Múltipla escolha (${LIBRARY}).`);
          add(out, { title, fallback: '', params: q.params, source });
        });
      } else {
        out.problems.push(`${name}: é ${main || 'de tipo desconhecido'} — só entram Múltipla escolha e Question Set de múltipla escolha.`);
      }
    } catch (e) {
      out.problems.push(`${name}: não consegui ler (${e.message}).`);
    }
  }

  // Liga cada questão à página "Tópico N" de mesmo número; na dúvida, nenhuma.
  function match(quizzes, topics, problems) {
    const group = (list, key) => list.reduce((m, x) => { const k = key(x); if (k) m.set(k, [...(m.get(k) || []), x]); return m; }, new Map());
    const pagesOf = group(topics, t => topicNumber(t.title));
    const byTopic = new Map();
    for (const [n, qs] of group(quizzes, q => q.number)) {
      const pages = pagesOf.get(n) || [];
      if (qs.length > 1) problems.push(`Tópico ${n}: ${qs.length} questões (${qs.map(q => q.source).join('; ')}) — deixe só uma.`);
      else if (!pages.length) problems.push(`${qs[0].source}: não há página "Tópico ${n}" nos módulos.`);
      else if (pages.length > 1) problems.push(`${qs[0].source}: há ${pages.length} páginas "Tópico ${n}" nos módulos.`);
      else byTopic.set(pages[0].title, qs[0]);
    }
    return byTopic;
  }

  // files: [{ name, buffer: ArrayBuffer }]; topics: [{ title }]
  // → { byTopic: Map(título da página → { number, params, source }), problems: [texto] }
  async function load(files, topics) {
    const out = { quizzes: [], problems: [] };
    for (const f of files) await readFile(f.name, f.buffer, out);
    const byTopic = match(out.quizzes, topics, out.problems);
    return { byTopic, problems: out.problems };
  }

  return { LIBRARY, load, topicNumber, problemOf };
})();
