'use strict';

// Acesso ao editor de página do Canvas, compartilhado pelos menus
// "Redimensionar H5P" e "Redimensionar vídeos da página" (o background.js
// injeta este arquivo antes do h5pResizeMain / videoResizeMain). Roda no mundo
// MAIN — o editor HTML do Canvas é um CodeMirror e o visual é o TinyMCE, e as
// instâncias dos dois só existem para o JS da própria página. Fica em
// window.__svcEditor. Regressão: .claude/skills/h5p-quiz/scripts/test-h5p.js
// e test-video.js
window.__svcEditor = (() => {
  function toast(text, bg, ms = 3500) {
    document.getElementById('__svc-toast__')?.remove();
    const el = document.createElement('div');
    el.id = '__svc-toast__';
    el.textContent = text;
    Object.assign(el.style, {
      position: 'fixed', bottom: '24px', right: '24px', maxWidth: '420px',
      background: bg, color: '#fff',
      padding: '10px 16px', borderRadius: '6px',
      fontFamily: 'system-ui', fontSize: '13px', lineHeight: '1.4',
      zIndex: '2147483647', boxShadow: '0 2px 8px rgba(0,0,0,.4)',
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function applyEdits(text, edits) {
    let out = text;
    for (const e of [...edits].reverse()) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
    return out;
  }

  function isVisible(el) {
    return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  }

  // Mesmo acesso ao CodeMirror 6 do localizar e substituir.
  function cm6ViewOf(editorEl) {
    const content = editorEl.querySelector('.cm-content');
    const isView  = v => v && v.state && v.state.doc && typeof v.dispatch === 'function';
    for (const key of Object.keys(content || {})) {
      const node = content[key];
      const view = [node?.root?.view, node?.rootView?.view, node?.view].find(isView);
      if (view) return view;
    }
    return null;
  }

  // Editores abertos na tela: { get() → texto, apply(edits, texto) }, com as
  // edições { from, to, insert } aplicadas num passo só de Ctrl+Z. Com o editor
  // HTML aberto, o visual fica escondido e desatualizado — então, havendo
  // editor HTML, só ele é alterado. A textarea escondida que o Canvas guarda
  // atrás do editor visual nunca é tocada: ele a ignora e a mudança se perderia.
  function targets() {
    const list = [];
    let unreachable = false;

    document.querySelectorAll('.cm-editor').forEach(el => {
      if (!isVisible(el)) return;
      const view = cm6ViewOf(el);
      if (!view) { unreachable = true; return; }
      list.push({
        get:   () => view.state.doc.toString(),
        apply: edits => view.dispatch({ changes: edits }),
      });
    });

    document.querySelectorAll('.CodeMirror').forEach(el => {
      const cm = el.CodeMirror;
      if (!cm || !isVisible(el)) return;
      list.push({
        get:   () => cm.getValue(),
        apply: edits => cm.operation(() => {
          for (const e of [...edits].reverse()) {
            cm.replaceRange(e.insert, cm.posFromIndex(e.from), cm.posFromIndex(e.to));
          }
        }),
      });
    });

    document.querySelectorAll('textarea').forEach(ta => {
      if (!isVisible(ta) || ta.closest('.cm-editor, .CodeMirror')) return;
      list.push({
        get:   () => ta.value,
        apply: (edits, text) => {
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
            .set.call(ta, applyEdits(text, edits));
          ta.dispatchEvent(new Event('input',  { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
        },
      });
    });

    // Sem editor HTML na tela: o editor visual (TinyMCE). O conteúdo é lido,
    // ajustado e regravado num passo só de Ctrl+Z.
    if (!list.length && !unreachable && window.tinymce) {
      const tm  = window.tinymce;
      const all = [].concat((typeof tm.get === 'function' ? tm.get() : tm.editors) || []);
      all.forEach(ed => {
        if (!ed || ed.removed || !ed.getBody?.() || !isVisible(ed.getContainer?.() || ed.getBody())) return;
        list.push({
          get:   () => ed.getContent(),
          apply: (edits, text) => {
            const win = ed.getWin();
            const y   = win.scrollY;
            // Garante o estado atual na pilha do Ctrl+Z (não duplica se já
            // estiver lá) — senão o transact só registra o estado novo.
            ed.undoManager.add();
            ed.undoManager.transact(() => ed.setContent(applyEdits(text, edits)));
            ed.setDirty(true);
            ed.nodeChanged();
            win.scrollTo(0, y);
          },
        });
      });
    }

    return { targets: list, unreachable };
  }

  return { targets, toast };
})();
