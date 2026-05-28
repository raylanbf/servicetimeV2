// Marca-texto interativo — mantido ativo em todas as páginas
// Segurar A + selecionar texto → pinta | ESC → remove todos
(function () {
  if (window.__svcHighlighterInstalled) return;
  window.__svcHighlighterInstalled = true;

  const CLS   = '__svc-hl__';
  const COLOR = '#FFD60A';

  let aHeld = false;

  // ── Detecta se o foco está num campo editável ────────────────────────────
  function inEditable() {
    const el = document.activeElement;
    if (!el) return false;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ||
           el.isContentEditable ||
           el.getAttribute('contenteditable') === 'true';
  }

  // ── Tecla pressionada ────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'a' || e.key === 'A') && !e.ctrlKey && !e.metaKey && !inEditable()) {
      aHeld = true;
    }
    if (e.key === 'Escape') {
      removeAll();
    }
  }, true);

  document.addEventListener('keyup', (e) => {
    if (e.key === 'a' || e.key === 'A') aHeld = false;
  }, true);

  // ── Soltar o mouse com A pressionado → marca o texto selecionado ─────────
  document.addEventListener('mouseup', () => {
    if (!aHeld) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;

    for (let i = 0; i < sel.rangeCount; i++) {
      const range = sel.getRangeAt(i);

      // Não marcar dentro de inputs / campos editáveis
      if (inEditableRange(range)) continue;

      const mark = document.createElement('mark');
      mark.className = CLS;
      mark.style.cssText =
        `background:${COLOR}!important;color:#111!important;` +
        `border-radius:2px;padding:0 1px;cursor:pointer;`;

      // Clique no mark → remove só aquele destaque
      mark.addEventListener('click', (e) => {
        e.stopPropagation();
        removeSingle(mark);
      });

      try {
        range.surroundContents(mark);
      } catch {
        // Seleção cruza fronteiras de elementos — extrai e envolve
        mark.appendChild(range.extractContents());
        range.insertNode(mark);
      }
    }

    sel.removeAllRanges();
    toast('✓ Marcado — clique no destaque para remover | ESC remove todos');
  });

  // ── Remove um único destaque ─────────────────────────────────────────────
  function removeSingle(mark) {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }

  // ── Remove todos os destaques da página ─────────────────────────────────
  function removeAll() {
    const marks = document.querySelectorAll('.' + CLS);
    if (!marks.length) return;
    marks.forEach(removeSingle);
    toast('✗ Destaques removidos');
  }

  // ── Verifica se o range está dentro de campo editável ───────────────────
  function inEditableRange(range) {
    let node = range.commonAncestorContainer;
    while (node && node !== document.body) {
      if (node.nodeType === 1) {
        const tag = node.tagName;
        if (['INPUT','TEXTAREA','SELECT'].includes(tag)) return true;
        if (node.isContentEditable) return true;
      }
      node = node.parentNode;
    }
    return false;
  }

  // ── Toast ────────────────────────────────────────────────────────────────
  function toast(msg) {
    document.getElementById('__svc-hl-toast__')?.remove();
    const el = document.createElement('div');
    el.id = '__svc-hl-toast__';
    el.textContent = msg;
    Object.assign(el.style, {
      position:   'fixed',
      bottom:     '24px',
      left:       '50%',
      transform:  'translateX(-50%)',
      background: '#1e1e2e',
      color:      '#e2e8f0',
      padding:    '9px 16px',
      borderRadius: '8px',
      fontFamily: 'system-ui, sans-serif',
      fontSize:   '12px',
      zIndex:     '2147483647',
      boxShadow:  '0 2px 12px rgba(0,0,0,.45)',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
})();
