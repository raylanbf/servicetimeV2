'use strict';

// Injeta um botão "Justificar" real na toolbar do editor rico do Canvas
// (TinyMCE), já que o TinyMCE não expõe essa opção na barra — só em
// Formato → Alinhamento → Justificar. Roda em qualquer página, mas só
// age quando encontra um editor TinyMCE (.tox-tinymce) — inofensivo em
// qualquer outro site.
(function () {
  if (window.__svcJustifyBtnInstalled) return;
  window.__svcJustifyBtnInstalled = true;

  const ICON =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
    '<line x1="4" y1="6" x2="20" y2="6"/>' +
    '<line x1="4" y1="12" x2="20" y2="12"/>' +
    '<line x1="4" y1="18" x2="20" y2="18"/>' +
    '</svg>';

  // Encontra o editor TinyMCE correspondente a este container específico
  // (não apenas o "activeEditor" — necessário quando há múltiplos editores
  // na mesma página, ex: modais sobrepostos).
  function findEditorFor(container) {
    if (!window.tinymce) return null;
    const editors = window.tinymce.editors || [];
    return editors.find(ed => ed.getContainer && ed.getContainer() === container)
      || window.tinymce.activeEditor
      || null;
  }

  // Remove qualquer alinhamento herdado (inline style, atributo align
  // legado ou classes comuns de Word/Quill) — só deve sobrar o justificado.
  function clearAlignment(el) {
    el.style.removeProperty('text-align');
    if (!el.style.length) el.removeAttribute('style');
    el.removeAttribute('align');
    el.classList.remove(
      'text-left', 'text-center', 'text-right', 'text-justify',
      'ql-align-left', 'ql-align-center', 'ql-align-right', 'ql-align-justify'
    );
    if (!el.classList.length) el.removeAttribute('class');
  }

  function forceJustify(root, boundary) {
    clearAlignment(root);
    root.querySelectorAll('[style*="text-align"], [align]').forEach(clearAlignment);

    // Sobe por wrappers que envolvem SÓ este bloco (sem irmãos) e limpa o
    // alinhamento deles também, senão um <div style="text-align:right"> pai
    // deixa o Canvas com Direita + Justificado marcados ao mesmo tempo.
    let ancestor = root.parentElement;
    while (ancestor && ancestor !== boundary && ancestor.children.length === 1) {
      clearAlignment(ancestor);
      ancestor = ancestor.parentElement;
    }

    root.style.textAlign = 'justify';
  }

  function buildButton(container) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tox-tbtn __svc-justify-btn__';
    btn.title = 'Justificar texto (Ctrl+Shift+J)';
    btn.setAttribute('aria-label', 'Justificar texto');
    btn.innerHTML = `<span aria-hidden="true" class="tox-icon tox-tbtn__icon-wrap">${ICON}</span>`;

    // Sem isso, o clique tira o foco do editor e o comando perde a
    // posição do cursor/seleção antes de executar.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ed = findEditorFor(container);
      if (!ed) return;
      const body = ed.getBody();
      ed.execCommand('JustifyFull');
      ed.selection.getSelectedBlocks().forEach(block => forceJustify(block, body));
    });
    return btn;
  }

  function injectInto(toolbar) {
    if (toolbar.querySelector('.__svc-justify-btn__')) return;
    const container = toolbar.closest('.tox-tinymce');
    if (!container) return;
    const group = document.createElement('div');
    group.className = 'tox-toolbar__group';
    group.appendChild(buildButton(container));
    toolbar.appendChild(group);
  }

  function scan() {
    if (!document.querySelector('.tox-tinymce')) return;
    document.querySelectorAll('.tox-toolbar__primary').forEach(injectInto);
  }

  scan();

  // Canvas monta o RCE dinamicamente (ex: ao clicar em "Editar"), então
  // observa mudanças no DOM para reinserir o botão quando um novo editor
  // aparecer.
  let pending = false;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; scan(); }, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
