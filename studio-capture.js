'use strict';

// Frame do Canvas Studio (*.instructuremedia.com), mundo ISOLATED. Recebe do
// studio-hook.js a lista de vídeos da coleção e grava em chrome.storage.local,
// na chave studioVideos:<curso do Canvas>, para o painel ("Inserir vídeos do
// Studio"), que acompanha a chave e mostra a contagem.
//
// O curso vem do lti_params da URL do frame — lido logo no início, antes de o
// Studio trocar o endereço. Desse token só se lê lti_course_id; e-mail, ids de
// usuário e chaves não são lidos nem gravados.
(() => {
  if (window.__svcStudioCapture) return;
  window.__svcStudioCapture = true;

  function readCourseId() {
    try {
      const raw = new URLSearchParams(location.search).get('lti_params');
      const payload = raw && raw.split('.')[1];
      if (!payload) return null;
      const b64  = payload.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((payload.length + 3) % 4);
      const json = new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
      const id   = JSON.parse(json).lti_course_id;
      return id != null && /^\d+$/.test(String(id)) ? String(id) : null;
    } catch {
      return null;
    }
  }

  const courseId = readCourseId();
  const lists    = new Map();   // assinatura da lista → última mensagem do hook

  // Lista que vale: a da coleção do curso ("course_wide"), se houver; entre as
  // candidatas, a maior (uma busca dentro da coleção traz menos vídeos).
  function best() {
    const all = [...lists.values()];
    const course = all.filter(l => l.collection && l.collection.type === 'course_wide');
    const pool = course.length ? course : all;
    const size = l => (l.total != null ? l.total : l.videos.length);
    return pool.sort((a, b) => size(b) - size(a))[0] || null;
  }

  window.addEventListener('message', ev => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__svcStudio !== true || d.type !== 'tiles' || !Array.isArray(d.videos)) return;
    if (!courseId) { console.warn('[Service Timer] Studio: frame sem lti_params — não sei de que curso é a lista.'); return; }
    lists.set(d.signature, d);
    const l = best();
    chrome.storage.local.set({
      ['studioVideos:' + courseId]: {
        courseId,
        studioDomain:   location.host,
        collectionId:   l.collection ? l.collection.id : null,
        collectionName: l.collection ? l.collection.name : '',
        collectionType: l.collection ? l.collection.type : '',
        videos:         l.videos.map(v => ({ id: String(v.id), title: String(v.title) })),
        total:          l.total,
        complete:       !!l.complete,
        capturedAt:     Date.now(),
      },
    }).catch(() => {});
  });
})();
