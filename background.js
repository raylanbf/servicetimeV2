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

chrome.runtime.onInstalled.addListener(refreshIcon);
chrome.runtime.onStartup.addListener(refreshIcon);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('running' in changes || 'paused' in changes) refreshIcon();
});
