// Gera extrator.js (raiz da extensão) a partir do Extrator de Questões
// (projeto Machine-Learning): o mesmo leitor de .docx e o mesmo montador de
// questões que o Extrator usa, num script só, sem import, para injetar na
// página. Fica em globalThis.__svcExtrator = { lerWord, lerDocumento, lerDocx, extrairDeParagrafos }.
//
// uso: node .claude/skills/h5p-quiz/scripts/build-extrator.mjs
//   EXTRATOR_DIR = pasta do projeto Machine-Learning (padrão: ../Machine-Learning
//   ao lado deste repositório). Usa o rolldown que já vem com o Vite do Extrator
//   (extensao/node_modules), então não instala nada aqui.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const EXTRATOR = resolve(process.env.EXTRATOR_DIR || join(REPO, '..', 'Machine-Learning'));
const OUT = join(REPO, 'extrator.js');
const slash = p => p.replace(/\\/g, '/');

const { rolldown } = await import(pathToFileURL(join(EXTRATOR, 'extensao/node_modules/rolldown/dist/index.mjs')).href);

const git = (...args) => execFileSync('git', ['-C', EXTRATOR, ...args], { encoding: 'utf8' }).trim();
const commit = git('rev-parse', '--short', 'HEAD');
const dirty = git('status', '--porcelain', '--', 'src', 'modelo') ? ' (com mudanças não commitadas em src/ ou modelo/)' : '';

const tmp = mkdtempSync(join(tmpdir(), 'svc-extrator-'));
const entry = join(tmp, 'entrada.js');
writeFileSync(entry, `
import { lerDocx, lerHtml, paragrafosDoHtml, textoDoHtml, extrairDeParagrafos, Modelo } from '${slash(join(EXTRATOR, 'src/index.ts'))}';
import modeloJson from '${slash(join(EXTRATOR, 'modelo/modelo.json'))}';
let modelo = null;
const questoesDe = paragrafos => {
  modelo = modelo || Modelo.deJSON(modeloJson);
  return extrairDeParagrafos(paragrafos, modelo).questoes;
};
// bytes do .docx → { paragrafos: [{ texto, … }], questoes: [{ numero, paragrafos: [índices], … }] }
export function lerWord(bytes) {
  const paragrafos = lerDocx(bytes);
  return { paragrafos, questoes: questoesDe(paragrafos) };
}
// .docx ou .html (pelo nome) → { paragrafos, questoes, texto }. paragrafos e questoes como o
// Extrator lê (no relatório da FIC: só as células "Questão de Fixação", cada uma depois de um
// separador com p.secao = nome da sessão); texto: o documento inteiro, uma linha por parágrafo
// (no HTML, o corpo todo da página, para achar também o que não é questão).
export function lerDocumento(nome, bytes) {
  if (!/\\.html?$/i.test(nome)) {
    const r = lerWord(bytes);
    return { ...r, texto: r.paragrafos.map(p => p.texto).join('\\n') };
  }
  const html = textoDoHtml(bytes);
  const paragrafos = lerHtml(html);
  const corpo = /<body\\b[^>]*>([\\s\\S]*?)(?:<\\/body\\s*>|$)/i.exec(html)?.[1] ?? html;
  return { paragrafos, questoes: questoesDe(paragrafos), texto: paragrafosDoHtml(corpo).map(p => p.texto).join('\\n') };
}
export { lerDocx, extrairDeParagrafos };
`);

try {
  const bundle = await rolldown({ input: entry, platform: 'browser', logLevel: 'warn' });
  const { output } = await bundle.generate({ format: 'iife', name: '__svcExtrator', minify: true });
  await bundle.close();
  const header = [
    '// GERADO por .claude/skills/h5p-quiz/scripts/build-extrator.mjs: não editar à mão.',
    `// Fonte: Extrator de Questões (Machine-Learning) ${commit}${dirty}, src/ + modelo/modelo.json.`,
    '// globalThis.__svcExtrator = { lerWord(bytes), lerDocx(bytes), extrairDeParagrafos(paragrafos, modelo) }',
    '',
  ].join('\n');
  // var __svcExtrator = … → globalThis, para valer igual no mundo isolado e no service worker
  const code = output[0].code.replace(/^var __svcExtrator\s*=/m, 'globalThis.__svcExtrator =');
  if (code === output[0].code) throw new Error('não achei "var __svcExtrator =" na saída do rolldown');
  writeFileSync(OUT, header + code);
  console.log(`extrator.js: ${(Buffer.byteLength(header + code) / 1024).toFixed(0)} KB, Extrator ${commit}${dirty}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
