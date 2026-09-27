'use strict';

// A userscript global exposes browser APIs but need not be a native Window.
// Do not proxy Window's internal symbols: that would hide the UIEvent.view bug.
module.exports = function userscriptWindow(win) {
  const sandbox = {};
  for (const key of [
    'document', 'location', 'history', 'navigator', 'sessionStorage', 'screen',
    'innerWidth', 'innerHeight', 'visualViewport', 'console',
    'Event', 'InputEvent', 'KeyboardEvent', 'MouseEvent', 'PointerEvent',
    'MutationObserver', 'ResizeObserver',
  ]) sandbox[key] = win[key];
  for (const key of [
    'addEventListener', 'removeEventListener', 'setTimeout', 'clearTimeout',
    'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
    'requestIdleCallback', 'getSelection', 'getComputedStyle', 'open',
  ]) if (typeof win[key] === 'function') sandbox[key] = win[key].bind(win);
  sandbox.window = sandbox.self = sandbox.top = sandbox;
  return sandbox;
};
