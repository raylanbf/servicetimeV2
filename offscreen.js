'use strict';

// Documento offscreen: o service worker não tem DOM nem acesso à área de
// transferência, então a leitura acontece aqui — colando num <textarea>
// (requer a permissão clipboardRead). navigator.clipboard.readText() não
// serve: exige que o documento esteja em foco, e este nunca fica.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action !== 'read-clipboard') return;
  const sink = document.getElementById('sink');
  sink.value = '';
  sink.focus();
  document.execCommand('paste');
  sendResponse(sink.value);
});
