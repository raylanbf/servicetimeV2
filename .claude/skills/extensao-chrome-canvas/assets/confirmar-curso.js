'use strict';
/*
 * Confirmação pelo número do curso
 * Skill extensao-chrome-canvas · Autor: Raylan B. Fraga
 *
 * Antes de gravar no Canvas, a pessoa DIGITA o número do curso. Só libera se
 * ele for igual (a) ao curso da aba ativa NESTE momento e (b) ao curso em que
 * a prévia foi feita. Assim, um clique sem querer, uma aba trocada no meio do
 * caminho ou uma prévia de outro curso não chegam ao Canvas.
 *
 * Funciona no painel lateral e em content script na página do Canvas: monta
 * o próprio DOM, com estilos inline. alert/confirm/prompt nativos não
 * aparecem direito no side panel e são confirmados sem ler.
 *
 * Por padrão o número NÃO é mostrado: a pessoa precisa olhar a aba para
 * saber em que curso está (o número fica no endereço: /courses/<número>).
 * Mostre o NOME do curso (opção nomeDoCurso) para ajudar a conferir.
 *
 *   const confirmado = await confirmarCurso({
 *     titulo:        'Gravar em 12 páginas?',
 *     resumo:        '34 vídeos em 12 páginas vão para 700×442. Grava direto no Canvas.',
 *     itens:         paginas.map(p => p.titulo),     // texto puro
 *     nomeDoCurso:   'Cálculo I — 2026/2',           // opcional
 *     cursoDaPrevia: previa.courseId,
 *     cursoAtual:    async () => (await abaDoCurso().catch(() => null))?.courseId || null,
 *     botao:         'Gravar',
 *   });
 *   if (!confirmado) return;                          // cancelou: nada muda
 *   await execCanvas(tabId, 'gravarPagina', { courseId: confirmado, confirmado, url, body });
 *
 * Devolve o número confirmado (texto) ou null (Cancelar, Esc, clique fora).
 */
function confirmarCurso(o) {
  return new Promise(resolve => {
    const ID = '__confirmar-curso__';
    document.getElementById(ID)?.remove();

    const el = (tag, style, text) => {
      const n = document.createElement(tag);
      if (style) Object.assign(n.style, style);
      if (text != null) n.textContent = text;   // sempre texto, nunca HTML
      return n;
    };

    const overlay = el('div', {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,.55)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: '2147483647',
      fontFamily: 'system-ui, sans-serif',
    });
    overlay.id = ID;

    const box = el('div', {
      background: '#1e1e2e', color: '#e2e8f0', padding: '18px 20px', borderRadius: '8px',
      width: '520px', maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
      boxSizing: 'border-box', boxShadow: '0 4px 24px rgba(0,0,0,.7)', fontSize: '13px', lineHeight: '1.45',
    });
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const h = el('h2', { margin: '0 0 8px', fontSize: '15px' }, o.titulo || 'Confirmar gravação no Canvas');
    h.id = ID + '-titulo';
    box.setAttribute('aria-labelledby', h.id);
    box.appendChild(h);

    if (o.resumo) box.appendChild(el('p', { margin: '0 0 10px', color: '#cbd5e1' }, o.resumo));
    if (o.nomeDoCurso) box.appendChild(el('p', { margin: '0 0 10px' }, `Curso da prévia: ${o.nomeDoCurso}`));

    const itens = [].concat(o.itens || []);
    if (itens.length) {
      box.appendChild(el('p', { margin: '0 0 4px', color: '#94a3b8', fontSize: '12px' }, `Vai mudar (${itens.length}):`));
      const ul = el('ul', { margin: '0 0 10px', padding: '0 0 0 20px', maxHeight: '160px', overflowY: 'auto', fontSize: '12px' });
      for (const t of itens) ul.appendChild(el('li', null, String(t)));
      box.appendChild(ul);
    }

    const label = el('label', { display: 'block', margin: '12px 0 6px' },
      'Para confirmar, digite o número do curso da aba aberta (está no endereço: /courses/número).');
    const input = el('input', {
      width: '100%', boxSizing: 'border-box', padding: '8px', borderRadius: '4px',
      border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: '14px',
    });
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.placeholder = 'número do curso';
    input.id = ID + '-numero';
    label.htmlFor = input.id;
    box.append(label, input);

    const alerta = el('p', { display: 'none', margin: '8px 0 0', color: '#fbbf24', fontSize: '12px' });
    alerta.setAttribute('role', 'alert');
    box.appendChild(alerta);

    const linha = el('div', { display: 'flex', gap: '8px', marginTop: '14px' });
    const botao = (texto, principal) => {
      const b = el('button', {
        flex: '1', padding: '8px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '13px',
        background: principal ? '#4ade80' : '#2a2a3e', color: principal ? '#0f172a' : '#e2e8f0',
        fontWeight: principal ? '700' : '400',
      }, texto);
      b.type = 'button';
      return b;
    };
    const cancelar = botao('Cancelar', false);
    const ok = botao(o.botao || 'Gravar', true);
    linha.append(cancelar, ok);
    box.appendChild(linha);

    let fechado = false, conferindo = false;
    function fechar(valor) {
      if (fechado) return;
      fechado = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(valor);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(null); }
    }
    const avisar = msg => {
      alerta.textContent = '⚠ ' + msg;
      alerta.style.display = 'block';
      input.focus();
      input.select();
    };

    async function tentar() {
      if (conferindo || fechado) return;
      const digitado = input.value.trim();
      if (!/^\d+$/.test(digitado)) return avisar('Digite o número do curso (só os algarismos).');
      conferindo = true;
      ok.disabled = true;
      try {
        // O curso da aba é lido AGORA, não quando a janela abriu.
        let atual = null;
        try { atual = await o.cursoAtual(); } catch { atual = null; }
        if (!atual) return avisar('A aba ativa não é de um curso do Canvas. Volte para a aba do curso — nada foi alterado.');
        if (digitado !== String(atual)) {
          return avisar(`O número digitado (${digitado}) não é o do curso da aba aberta. Confira a aba e o número — nada foi alterado.`);
        }
        if (String(atual) !== String(o.cursoDaPrevia)) {
          return avisar('A aba aberta é de outro curso, não do curso da prévia. Volte para a aba desse curso ou refaça a prévia — nada foi alterado.');
        }
        fechar(digitado);
      } finally {
        conferindo = false;
        ok.disabled = false;
      }
    }

    cancelar.onclick = () => fechar(null);
    ok.onclick = tentar;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); tentar(); } });
    document.addEventListener('keydown', onKey, true);

    // Clique fora fecha — só se o clique começou e terminou no fundo (soltar
    // o mouse fora depois de selecionar o texto do campo não cancela).
    let desceuNoFundo = false;
    overlay.addEventListener('mousedown', e => { desceuNoFundo = e.target === overlay; });
    overlay.addEventListener('click', e => { if (desceuNoFundo && e.target === overlay) fechar(null); });

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    input.focus();
  });
}

if (typeof module !== 'undefined') module.exports = { confirmarCurso };
