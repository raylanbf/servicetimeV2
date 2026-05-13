'use strict';

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'UPPERCASE_COPY') return;
  navigator.clipboard.writeText(msg.text);
});
