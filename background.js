'use strict';

function makeIconData(state, size) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const colors = { inactive: '#ef4444', running: '#4ade80', paused: '#f97316' };
  const color = colors[state] || colors.inactive;
  const r = size / 2;

  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(r, r, r - 1, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.fillStyle = state === 'running' ? '#000' : '#fff';
  ctx.font = `bold ${Math.round(size * 0.55)}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('S', r, r + Math.round(size * 0.05));

  return ctx.getImageData(0, 0, size, size);
}

function applyIcon(state) {
  chrome.action.setIcon({
    imageData: {
      16:  makeIconData(state, 16),
      32:  makeIconData(state, 32),
      48:  makeIconData(state, 48),
      128: makeIconData(state, 128),
    }
  });
}

function refreshIcon() {
  chrome.storage.local.get(['running', 'paused'], (data) => {
    if (data.running && data.paused) applyIcon('paused');
    else if (data.running)           applyIcon('running');
    else                             applyIcon('inactive');
  });
}

chrome.runtime.onInstalled.addListener(() => {
  refreshIcon();
  chrome.contextMenus.create({
    id: 'uppercase-selection',
    title: 'Colocar em CAIXA ALTA',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'copy-clean',
    title: 'Copiar texto limpo (negrito, itálico e links)',
    contexts: ['selection'],
  });
});
chrome.runtime.onStartup.addListener(refreshIcon);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'uppercase-selection') {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || sel.isCollapsed) return;

        const ALLOWED = ['B', 'STRONG', 'I', 'EM', 'A'];

        function cleanUpper(node) {
          if (node.nodeType === 3) {
            const t = node.cloneNode();
            t.textContent = t.textContent.toUpperCase();
            return t;
          }
          if (node.nodeType !== 1) return document.createDocumentFragment();

          const frag = document.createDocumentFragment();
          node.childNodes.forEach(child => frag.appendChild(cleanUpper(child)));

          if (ALLOWED.includes(node.tagName)) {
            const el = document.createElement(node.tagName.toLowerCase());
            if (node.tagName === 'A') {
              const href = node.getAttribute('href');
              if (href) el.setAttribute('href', href);
            }
            el.appendChild(frag);
            return el;
          }
          return frag;
        }

        const fragment = sel.getRangeAt(0).cloneContents();
        const wrapper = document.createElement('div');
        fragment.childNodes.forEach(child => wrapper.appendChild(cleanUpper(child)));

        const cleanHtml = wrapper.innerHTML;
        const plainText = sel.toString().toUpperCase();

        const el = document.createElement('textarea');
        el.value = plainText;
        el.style.cssText = 'position:fixed;top:-9999px;opacity:0';
        document.body.appendChild(el);
        el.select();

        document.addEventListener('copy', function handler(e) {
          e.preventDefault();
          e.clipboardData.setData('text/html', cleanHtml);
          e.clipboardData.setData('text/plain', plainText);
          document.removeEventListener('copy', handler, true);
        }, true);

        document.execCommand('copy');
        el.remove();
      },
    });
  }

  if (info.menuItemId === 'copy-clean') {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || sel.isCollapsed) return;

        const ALLOWED = ['B', 'STRONG', 'I', 'EM', 'A'];

        function clean(node) {
          if (node.nodeType === 3) return node.cloneNode();
          if (node.nodeType !== 1) return document.createDocumentFragment();

          const frag = document.createDocumentFragment();
          node.childNodes.forEach(child => frag.appendChild(clean(child)));

          if (ALLOWED.includes(node.tagName)) {
            const el = document.createElement(node.tagName.toLowerCase());
            if (node.tagName === 'A') {
              const href = node.getAttribute('href');
              if (href) el.setAttribute('href', href);
            }
            el.appendChild(frag);
            return el;
          }
          return frag;
        }

        const fragment = sel.getRangeAt(0).cloneContents();
        const wrapper = document.createElement('div');
        fragment.childNodes.forEach(child => wrapper.appendChild(clean(child)));

        const cleanHtml = wrapper.innerHTML;
        const plainText = sel.toString();

        const el = document.createElement('textarea');
        el.value = plainText;
        el.style.cssText = 'position:fixed;top:-9999px;opacity:0';
        document.body.appendChild(el);
        el.select();

        document.addEventListener('copy', function handler(e) {
          e.preventDefault();
          e.clipboardData.setData('text/html', cleanHtml);
          e.clipboardData.setData('text/plain', plainText);
          document.removeEventListener('copy', handler, true);
        }, true);

        document.execCommand('copy');
        el.remove();
      },
    });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('running' in changes || 'paused' in changes) refreshIcon();
});
