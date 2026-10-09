// Carrega o background.js real num contexto isolado (chrome.* vira no-op) e
// exporta o código-fonte da função injetada h5pResizeMain. Segue importScripts
// (para quando a regra for para um h5p.js compartilhado), com os caminhos
// resolvidos a partir da raiz do repositório.
const vm   = require('vm');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../..');
const noop = new Proxy(function () {}, {
  get: (t, p) => (p === 'then' ? undefined : noop),
  apply: () => noop,
});

const ctx = {
  chrome: noop, self: noop, fetch: noop, console, URL, Date, Math, JSON,
  setTimeout, clearTimeout, setInterval, clearInterval,
};
ctx.importScripts = (...files) => files.forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), ctx, { filename: 'background.js' });

if (typeof ctx.h5pResizeMain !== 'function') throw new Error('h5pResizeMain não encontrada no background.js');
module.exports = ctx.h5pResizeMain.toString();
