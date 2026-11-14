'use strict';

// Liga e desliga a gravação por site: registra o gravador.js (mundo MAIN,
// início da página) só para o site da aba atual e recarrega a aba. Nada fica
// gravando sem você mandar, e a gravação some ao fechar o Chrome.

const $ = id => document.getElementById(id);
const PREFIX = 'grav:';

const idOf = host => PREFIX + host;
const patternOf = u => `${u.protocol}//${u.hostname}/*`;

async function registered() {
  const all = await chrome.scripting.getRegisteredContentScripts();
  return all.filter(s => s.id.startsWith(PREFIX));
}

async function start(tab, url) {
  await chrome.scripting.registerContentScripts([{
    id: idOf(url.hostname), matches: [patternOf(url)], js: ['gravador.js'],
    runAt: 'document_start', world: 'MAIN', allFrames: false, persistAcrossSessions: false,
  }]);
  await chrome.tabs.reload(tab.id);
  window.close();
}

async function stop(id, tabToReload) {
  await chrome.scripting.unregisterContentScripts({ ids: [id] });
  if (tabToReload) await chrome.tabs.reload(tabToReload.id);
  render();
}

async function render() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url = null;
  try { url = new URL(tab.url); } catch { /* aba sem endereço */ }
  const ok = url && /^https?:$/.test(url.protocol);
  const active = await registered();
  const mine = ok && active.find(s => s.id === idOf(url.hostname));

  $('site').textContent = ok ? url.hostname : 'Esta aba não é um site (http/https).';
  const btn = $('toggle');
  btn.hidden = !ok;
  if (ok) {
    btn.className = mine ? 'stop' : 'start';
    btn.textContent = mine ? '■ Parar de gravar neste site' : '● Gravar neste site';
    btn.onclick = () => (mine ? stop(mine.id, tab) : start(tab, url));
  }
  $('hint').textContent = mine
    ? 'Use o site normalmente. No quadro escuro do canto da página: "Salvar arquivo" baixa a gravação (.json) em Downloads.'
    : 'A aba recarrega e um quadro escuro aparece no canto da página enquanto grava.';

  const others = active.filter(s => !mine || s.id !== mine.id);
  $('others-title').hidden = !others.length;
  $('others').replaceChildren(...others.map(s => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = s.id.slice(PREFIX.length);
    const b = document.createElement('button');
    b.className = 'small'; b.textContent = 'Parar';
    b.onclick = () => stop(s.id, null);
    li.append(name, b);
    return li;
  }));
}

render();
