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

// Campos que um formulário de outra página enviaria, como o navegador monta
// (valores padrão, só checkbox/radio marcados, sem desabilitados nem arquivos)
// — usado pelo botão "📁 Pasta H5P" para criar quizzes com o formulário do
// H5P.com (h5p-folder.js). O formulário entra neste documento só para o
// FormData; scripts, imagens e frames saem antes, e nada é carregado.
function formEntries(html, formId) {
  const doc  = new DOMParser().parseFromString(html, 'text/html');
  const form = doc.getElementById(formId);
  if (!form || form.tagName !== 'FORM') return null;
  form.querySelectorAll('script, iframe, frame, img, picture, source, link, style, video, audio, object, embed').forEach(n => n.remove());
  const live = document.importNode(form, true);
  live.hidden = true;
  document.body.appendChild(live);
  try {
    const out = [];
    for (const [k, v] of new FormData(live)) if (typeof v === 'string') out.push([k, v]);
    return out;
  } finally {
    live.remove();
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action !== 'parse-form') return;
  try { sendResponse(formEntries(String(msg.html || ''), String(msg.formId || ''))); }
  catch (e) { console.warn('parse-form:', e); sendResponse(null); }
});
