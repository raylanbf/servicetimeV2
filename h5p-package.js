'use strict';

// Lê os .h5p de questões para o "📁 Pasta H5P" (canvas-h5p-folder.js): o quiz
// de cada tópico já nasce com a questão do arquivo, em vez da provisória.
// Feito para os arquivos do Extrator de Questões (projeto Machine-Learning),
// que converte o .docx das questões de fixação:
//   • um .h5p de Múltipla escolha por questão ("TÓPICO 1.h5p", …);
//   • o .zip com esses .h5p ("<documento> - questões H5P.zip");
//   • um .h5p de Question Set com todas, cada questão com o título "TÓPICO N".
// Cada questão vai para a página "Tópico N" de mesmo número. No
// Microfundamento (kind 'micro'), o Extrator lê o relatório da FIC e numera as
// questões pela página da sessão ("Questão 1.h5p", título "Questão 1"): a
// "Questão N" vai para a N-ª página marcada na confirmação, na ordem dos
// módulos — de início, as "UNIDADE N - Tema N" (conferido em 20/11/2026: as
// 11 sessões do "Inovação na Concepção de Negócios" são as 11 páginas do
// curso, na mesma ordem). Página que não vai ter quiz é desmarcada lá, e a
// pessoa pode trocar a questão de cada página à mão. Só entram
// questões de Múltipla escolha na versão do H5P.com da PUC (1.16) e sem
// imagem, áudio ou vídeo: o que vai para o H5P.com é o content.json, pelo
// mesmo formulário de criação do quiz provisório. As configurações da
// questão (Tentar novamente, Mostrar solução, pontuação…) ficam como vieram
// no arquivo.
//
// Questão com imagem no enunciado: o Extrator põe no .h5p só a pergunta fixa
// ("Assinale a alternativa correta."), as alternativas e as justificativas,
// e o enunciado (texto e imagens) vai no .zip, em "enunciados-canvas.json"
// (na raiz) e nos arquivos "<título> - imagem N.png", para ir à página do
// Canvas, logo acima do quiz (h5p-insert.js). Cada entrada do .json é ligada
// ao .h5p que ela nomeia, conferindo o número ("Tópico N" ou "Questão N"); o
// que não casar vai para "Fora". Uma questão cuja pergunta é só a frase fixa
// e que ficou sem enunciado também fica de fora: o quiz sairia sem a questão.
// Fica em globalThis.__svcH5pPackage.
// Regressão: .claude/skills/h5p-quiz/scripts/test-h5p-folder.js
globalThis.__svcH5pPackage = (() => {
  const LIBRARY   = 'H5P.MultiChoice 1.16';
  const MAX_BYTES = 10 * 1024 * 1024;   // cada .h5p e cada imagem
  const ZIP_BYTES = 50 * 1024 * 1024;   // o arquivo escolhido (o .zip com as imagens)
  const MANIFEST  = 'enunciados-canvas.json';
  const FORMAT    = 'extrator-questoes/enunciados-canvas';
  const ASK       = 'Assinale a alternativa correta.';
  const dec = new TextDecoder();
  const nfc = s => String(s ?? '').normalize('NFC');
  const baseName = p => String(p).split('/').pop();

  // "TÓPICO 1", "Tópico 01 – …", "topico_3.h5p" → '1', '1', '3'.
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[‐-―]/g, '-').toLowerCase();
  function topicNumber(s) {
    const m = fold(s).match(/topico[\s_.:-]*(\d+)/);
    return m ? String(Number(m[1])) : null;
  }
  // "Questão 3", "questao_03.h5p", "Questão 3.2" → '3' (Microfundamento).
  function questionNumber(s) {
    const m = fold(s).match(/\bquestao[\s_.:-]*(\d+)/);
    return m ? String(Number(m[1])) : null;
  }
  const NUMBER = { uda: topicNumber, micro: questionNumber };
  const NAME   = { uda: 'Tópico N', micro: 'Questão N' };

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

  const preview = text => plain(text).replace(/\s+/g, ' ').slice(0, 90);
  const askKey  = html => fold(plain(html)).replace(/\s+/g, ' ').trim();

  // out.kind: 'uda' ("Tópico N") ou 'micro' ("Questão N"). preview: o começo da
  // pergunta, para a pessoa conferir o par na confirmação. at: onde o .h5p
  // estava ({ zip, path }), para ligar o enunciado do .zip.
  function add(out, { title, fallback, params, source, at = null }) {
    const why = problemOf(params);
    if (why) return out.problems.push(`${source}: ${why}.`);
    const numberOf = NUMBER[out.kind];
    const number = numberOf(title) || numberOf(fallback);
    if (!number) {
      // O nome do outro tipo de disciplina: diz qual é a diferença.
      const other = out.kind === 'micro' ? 'uda' : 'micro';
      if (NUMBER[other](title) || NUMBER[other](fallback)) {
        return out.problems.push(out.kind === 'micro'
          ? `${source}: é "Tópico N" (questões do Word de uma disciplina comum), mas esta disciplina é Microfundamento, que liga pela "Questão N" (do relatório da FIC).`
          : `${source}: é "Questão N" (do relatório da FIC, Microfundamento), mas esta disciplina é comum, que liga pelo "Tópico N".`);
      }
      return out.problems.push(`${source}: sem "${NAME[out.kind]}" no título${fallback ? ' nem no nome do arquivo' : ''}.`);
    }
    out.quizzes.push({ number, params, source, preview: preview(params.question), ...(at ? { at } : {}) });
  }

  // Imagem pelo começo do arquivo (não pela extensão nem pelo "tipo" do .json):
  // só as que o navegador e o Canvas mostram.
  function imageType(b) {
    const s = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
    if (b.length > 8 && s(1, 3) === 'PNG' && b[0] === 0x89) return 'image/png';
    if (b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (b.length > 6 && s(0, 4) === 'GIF8') return 'image/gif';
    if (b.length > 12 && s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'image/webp';
    if (b.length > 2 && s(0, 2) === 'BM') return 'image/bmp';
    return null;
  }

  // Enunciados (enunciados-canvas.json) → statement de cada questão lida do
  // mesmo pacote (mine): { title, raw (enunciadoHtml), images: [{ path,
  // name, type, bytes, size }], problems }. O que não casar vai para "Fora".
  // pack: o .zip ({ label: 'x.zip › ', where: 'no .zip', manifest(), read(path) })
  // ou os arquivos tirados dele e escolhidos soltos (loose: casam pelo nome,
  // sem a pasta). → os nomes que o .json usa (o .json, as imagens e os .html).
  async function attachStatements(pack, out, mine) {
    const where = `${pack.label}${MANIFEST}`;
    let m = null;
    try { m = json(await pack.manifest()); }
    catch (e) { out.problems.push(`${where}: não consegui ler (${e.message}) — os enunciados ficam de fora.`); }
    if (m && (m.formato !== FORMAT || m.versao !== 1 || !Array.isArray(m.questoes))) {
      out.problems.push(`${where}: formato que não conheço (${m.formato || '?'} ${m.versao ?? ''}) — os enunciados ficam de fora.`);
      m = null;
    }
    for (const q of mine) q.ask = askKey(m?.perguntaNoH5P || ASK);
    const key = p => nfc(pack.loose ? baseName(p) : p);
    const used = new Set([key(MANIFEST)]);
    for (const e of m?.questoes || []) {
      if (e?.html) used.add(key(e.html));
      for (const im of Array.isArray(e?.imagens) ? e.imagens : []) if (im?.arquivo) used.add(key(im.arquivo));
    }
    const numberOf = NUMBER[out.kind];
    const taken = new Set();
    for (const e of m?.questoes || []) {
      const title = String(e?.titulo || '').trim();
      const src = `${pack.label}enunciado ${title || e?.h5p || '?'}`;
      const q = mine.find(x => key(x.at.path) === key(e?.h5p || ''));
      if (!q) { out.problems.push(`${src}: o .h5p "${e?.h5p || '?'}" não está ${pack.where} ou ficou de fora — o enunciado também.`); continue; }
      const n = numberOf(title);
      if (n !== q.number) { out.problems.push(`${src}: o título não é ${NAME[out.kind].replace('N', q.number)}, como o de ${q.source} — o enunciado fica de fora.`); continue; }
      if (taken.has(q)) { out.problems.push(`${src}: há dois enunciados para ${q.source} — deixe só um.`); q.conflict = true; continue; }
      taken.add(q);
      const raw = typeof e.enunciadoHtml === 'string' ? e.enunciadoHtml : '';
      if (!plain(raw) && !/<img\b/i.test(raw)) { out.problems.push(`${src}: enunciado vazio — fica de fora.`); continue; }
      const images = [], problems = [];
      for (const im of Array.isArray(e.imagens) ? e.imagens : []) {
        const path = nfc(im?.arquivo || ''), name = baseName(path);
        try {
          const bytes = path && await pack.read(path);
          if (!bytes) throw new Error(`não está ${pack.where}`);
          const type = imageType(bytes);
          if (!type) throw new Error('não é PNG, JPEG, GIF, WEBP nem BMP');
          images.push({ path, name, type, bytes, size: bytes.length });
        } catch (err) {
          problems.push(`a imagem "${name || '?'}" ${err.message} — no lugar dela vai o aviso para copiar a figura à mão.`);
        }
      }
      q.statement = { title, raw, images, problems };
      q.preview = preview(raw);
      problems.forEach(p => out.problems.push(`${src}: ${p}`));
    }
    return used;
  }

  // Um arquivo (.h5p, ou .zip com .h5p dentro) → questões em out.quizzes, motivos em out.problems.
  async function readFile(name, buf, out, depth = 0, at = null) {
    if (buf.byteLength > (depth ? MAX_BYTES : ZIP_BYTES)) return out.problems.push(`${name}: maior que ${depth ? 10 : 50} MB.`);
    const entries = entriesOf(buf);
    if (!entries) return out.problems.push(`${name}: não é um .h5p nem um .zip válido.`);
    try {
      if (!entries.has('h5p.json')) {
        const inner = [...entries.keys()].filter(n => /\.h5p$/i.test(n));
        if (!inner.length || depth) return out.problems.push(`${name}: não tem h5p.json nem arquivos .h5p dentro.`);
        const from = out.quizzes.length;
        for (const n of inner) {
          const bytes = await readEntry(buf, entries.get(n));
          await readFile(baseName(n), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), out, depth + 1, { zip: name, path: n });
        }
        if (entries.has(MANIFEST)) {
          const byPath = new Map([...entries].map(([k, v]) => [nfc(k), v]));
          await attachStatements({
            label: `${name} › `, where: 'no .zip',
            manifest: () => readEntry(buf, entries.get(MANIFEST)),
            read: async p => { const ent = byPath.get(nfc(p)); return ent ? (await readEntry(buf, ent)).slice() : null; },
          }, out, out.quizzes.slice(from).filter(q => q.at?.zip === name));
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
        add(out, { title: h5p.title, fallback: name.replace(/\.h5p$/i, ''), params, source: name, at });
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

  // Liga cada questão à sua página; na dúvida, nenhuma.
  //   uda:   "Tópico N" → a página "Tópico N" de mesmo número;
  //   micro: "Questão N" → a N-ª página da lista (as páginas marcadas, na
  //          ordem dos módulos).
  // why (opcional): Map(questão → motivo) das que ficaram sem página.
  function match(quizzes, topics, problems, kind, why = null) {
    const group = (list, key) => list.reduce((m, x) => { const k = key(x); if (k) m.set(k, [...(m.get(k) || []), x]); return m; }, new Map());
    const pagesOf = kind === 'micro'
      ? new Map(topics.map((t, i) => [String(i + 1), [t]]))
      : group(topics, t => topicNumber(t.title));
    const byTopic = new Map();
    const out = (qs, text) => { problems.push(text); qs.forEach(q => why?.set(q, text)); };
    for (const [n, qs] of group(quizzes, q => q.number)) {
      const pages = pagesOf.get(n) || [];
      if (qs.length > 1) out(qs, `${kind === 'micro' ? 'Questão' : 'Tópico'} ${n}: ${qs.length} questões (${qs.map(q => q.source).join('; ')}) — deixe só uma.`);
      else if (!pages.length) {
        out(qs, kind === 'micro'
          ? `${qs[0].source}: não há a ${n}ª página marcada nos módulos (são ${topics.length}).`
          : `${qs[0].source}: não há página "Tópico ${n}" marcada nos módulos.`);
      }
      else if (pages.length > 1) out(qs, `${qs[0].source}: há ${pages.length} páginas "Tópico ${n}" marcadas nos módulos.`);
      else byTopic.set(pages[0].title, qs[0]);
    }
    return byTopic;
  }

  // Só lê os arquivos: files: [{ name, buffer: ArrayBuffer }]; kind: 'uda'
  // (padrão) ou 'micro' (o número vem de "Tópico N" ou de "Questão N").
  // → { quizzes: [{ number, params, source, preview, statement? }], problems: [texto] }
  async function read(files, kind = 'uda') {
    const out = { quizzes: [], problems: [], kind: kind === 'micro' ? 'micro' : 'uda' };
    // O .zip do Extrator extraído e escolhido inteiro (os .h5p, o .json, as
    // imagens e os .html): lido como se fosse o .zip, casando pelo nome.
    const LOOSE = '\u0000soltos';
    const isManifest = f => nfc(baseName(f.name)).toLowerCase() === MANIFEST;
    const manifest = files.find(isManifest);
    const packs = manifest ? files.filter(f => /\.h5p$/i.test(f.name)) : files;
    for (const f of packs) await readFile(f.name, f.buffer, out, 0, manifest ? { zip: LOOSE, path: f.name } : null);
    if (manifest) {
      const rest = files.filter(f => !packs.includes(f) && f !== manifest);
      const byName = new Map(rest.map(f => [nfc(baseName(f.name)), f]));
      const used = await attachStatements({
        label: '', where: 'entre os arquivos escolhidos', loose: true,
        manifest: async () => new Uint8Array(manifest.buffer),
        read: async p => {
          const f = byName.get(nfc(baseName(p)));
          if (!f) return null;
          if (f.buffer.byteLength > MAX_BYTES) throw new Error('é maior que 10 MB');
          return new Uint8Array(f.buffer).slice();
        },
      }, out, out.quizzes.filter(q => q.at?.zip === LOOSE));
      // O que o .json não usa é lido como antes (um .zip com outro nome, por exemplo).
      for (const f of rest) if (!used.has(nfc(baseName(f.name)))) await readFile(f.name, f.buffer, out);
    }
    // Pergunta só com a frase fixa e sem o enunciado: o quiz sairia sem a questão.
    const quizzes = out.quizzes.filter(q => {
      if (q.conflict) delete q.statement;
      if (q.statement) return true;
      if (askKey(q.params.question) !== (q.ask || askKey(ASK))) return true;
      out.problems.push(q.ask
        ? `${q.source}: a pergunta é só "${plain(q.params.question)}" e o enunciado dela não veio (veja acima) — fica de fora.`
        : `${q.source}: a pergunta é só "${plain(q.params.question)}" — o enunciado (com a imagem) vem no .zip do Extrator: escolha o .zip.`);
      return false;
    });
    for (const q of quizzes) { delete q.at; delete q.ask; delete q.conflict; }
    return { quizzes, problems: out.problems };
  }

  // Lê e liga: topics: [{ title }] (na ordem dos módulos).
  // → { byTopic: Map(título da página → { number, params, source, preview }), problems: [texto] }
  async function load(files, topics, kind = 'uda') {
    const k = kind === 'micro' ? 'micro' : 'uda';
    const { quizzes, problems } = await read(files, k);
    return { byTopic: match(quizzes, topics, problems, k), problems };
  }

  return { LIBRARY, load, read, match, topicNumber, questionNumber, problemOf };
})();
