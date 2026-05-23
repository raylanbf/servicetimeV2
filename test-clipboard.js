'use strict';

const area   = document.getElementById('paste-area');
const output = document.getElementById('html-output');
const badge  = document.getElementById('badge');

function render() {
  const raw = area.innerHTML;
  if (!raw.trim() || raw === '<br>') {
    output.textContent = '';
    badge.textContent  = 'vazio';
    return;
  }

  const pretty = raw
    .replace(/>\s*</g, '>\n<')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  output.textContent = pretty;
  badge.textContent  = `${pretty.length} chars`;
}

area.addEventListener('input', render);

area.addEventListener('paste', () => {
  setTimeout(render, 50);
});

area.addEventListener('focus', () => {
  if (area.querySelector('p[style*="64748b"]')) area.innerHTML = '';
});

document.getElementById('btn-clear').addEventListener('click', () => {
  area.innerHTML     = '';
  output.textContent = '';
  badge.textContent  = 'aguardando...';
  area.focus();
});

document.getElementById('btn-copy').addEventListener('click', () => {
  const text = output.textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('btn-copy');
    btn.textContent = '✓ Copiado!';
    setTimeout(() => { btn.textContent = 'Copiar HTML'; }, 2000);
  });
});
