'use strict';

// Ponte do botão do quiz H5P. O botão (canvas-h5p.js) roda no mundo MAIN, sem
// chrome.*, e o popup do H5P é de outro domínio e recarrega a cada busca —
// então o pedido fica no chrome.storage (h5pPending), onde o h5p-search.js o
// lê, e o resultado (h5pResult) volta para a página por postMessage.
(() => {
  if (window.__svcH5pBridge) return;
  window.__svcH5pBridge = true;

  window.addEventListener('message', e => {
    const d = e.data;
    if (e.source !== window || !d || (d.__svc !== 'h5pRequest' && d.__svc !== 'h5pCancel')) return;
    try {
      if (d.__svc === 'h5pRequest') {
        chrome.storage.local.set({ h5pPending: { id: d.id, title: d.title, ts: Date.now() }, h5pResult: null });
      } else {
        chrome.storage.local.get('h5pPending').then(({ h5pPending }) => {
          if (h5pPending?.id === d.id) chrome.storage.local.remove('h5pPending');
        });
      }
    } catch (_) {
      // Extensão recarregada com a página aberta: o canal com ela morreu.
      window.postMessage({ __svc: 'h5pResult', id: d.id, status: 'reload' }, '*');
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    const r = area === 'local' && changes.h5pResult?.newValue;
    if (r) window.postMessage({ __svc: 'h5pResult', ...r }, '*');
  });
})();
