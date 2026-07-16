'use strict';

const assert = require('node:assert/strict');
const { join } = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const toolkit = require(join(__dirname, '..', 'chatgpt-workflow-toolkit.user.js'));

async function waitFor(predicate, win, timeout = 1_500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => win.setTimeout(resolve, 25));
  }
  return Boolean(predicate());
}

test('app smoke: installs simplified controls and prepares a fresh-chat handoff', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <article data-testid="conversation-turn-0"><div data-message-author-role="user">Help with my lab</div></article>
    <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Follow these steps</div><div><button data-testid="copy-turn-action-button">Copy</button></div></article>
    <form><textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/smoke',
    pretendToBeVisual: true,
  });

  const { document } = dom.window;
  const app = toolkit.createApp(document, dom.window);
  await app.start();
  await waitFor(() => document.querySelector('.cgs-turn-action') && !document.querySelector('#cgs-dock').hidden, dom.window);

  const turnButton = document.querySelector('.cgs-turn-action');
  assert.ok(turnButton, 'assistant response receives one Ask in new chat control');
  assert.equal(turnButton.textContent, '↗ Ask in new chat');
  assert.equal(document.querySelector('#cgs-dock').hidden, false);
  assert.equal(document.querySelector('[data-cgs-action="open-handoff"] .cgs-dock-label').textContent, 'Continue in fresh chat');
  assert.equal(document.querySelector('#cgs-selection-pill').textContent, 'Ask in new chat');
  assert.doesNotMatch(document.querySelector('#cgs-root').textContent, /Continue lightweight|Ask aside/u);

  turnButton.click();
  assert.equal(document.querySelector('#cgs-dialog-backdrop').hidden, false);
  assert.equal(document.querySelector('#cgs-context-mode').value, 'clicked');
  document.querySelector('[data-cgs-action="cancel-question"]').click();

  document.querySelector('[data-cgs-action="open-handoff"]').click();
  assert.equal(document.querySelector('#cgs-handoff-backdrop').hidden, false);
  assert.equal(document.querySelector('#cgs-handoff-title').textContent, 'Continue in fresh chat');
  const fullContextButtons = document.querySelectorAll('[data-cgs-action="full-branch-latest"]');
  assert.equal(fullContextButtons.length, 1);
  assert.equal(fullContextButtons[0].textContent, 'Branch with full context');
  assert.ok(fullContextButtons[0].closest('#cgs-handoff-backdrop'));
  document.querySelector('[data-cgs-action="prepare-handoff"]').click();
  assert.match(document.querySelector('#prompt-textarea').value, /^Create a compact, self-contained handoff/u);
  assert.equal(document.querySelector('#cgs-handoff-backdrop').hidden, true);

  app.state.observer.disconnect();
  dom.window.close();
});

test('settings opens as a persistent modal and closes only with explicit controls', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Done</div></article>
    <form><textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/settings',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const commands = [];
  const app = toolkit.createApp(document, dom.window, {
    registerMenuCommand: (label, callback) => commands.push({ label, callback }),
  });
  await app.start();
  const backdrop = document.querySelector('#cgs-settings-backdrop');
  const dialog = document.querySelector('#cgs-settings');

  assert.deepEqual(commands.map((command) => command.label), ['Open Workflow Toolkit settings…']);
  commands[0].callback();
  assert.equal(backdrop.hidden, false);
  assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  const closeButton = document.querySelector('[data-cgs-action="close-settings"]');
  const lastFocusable = dialog.querySelector('a[href]');
  assert.equal(document.activeElement, closeButton);
  closeButton.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'Tab', shiftKey: true, bubbles: true, cancelable: true,
  }));
  assert.equal(document.activeElement, lastFocusable);
  lastFocusable.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'Tab', bubbles: true, cancelable: true,
  }));
  assert.equal(document.activeElement, closeButton);

  document.querySelector('main').click();
  backdrop.click();
  assert.equal(backdrop.hidden, false, 'ordinary page and backdrop clicks do not instantly dismiss settings');

  closeButton.click();
  assert.equal(backdrop.hidden, true);

  document.querySelector('[data-cgs-action="toggle-settings"]').click();
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(backdrop.hidden, true);

  app.state.observer.disconnect();
  dom.window.close();
});

test('install refuses to run beside the earlier renamed userscript', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://chatgpt.com/',
    pretendToBeVisual: true,
  });
  dom.window.document.documentElement.dataset.chatgptSidecarInstalled = '1.1.0';
  let warning = '';
  dom.window.console.warn = (message) => { warning = String(message); };

  const app = await toolkit.install(dom.window.document, dom.window);

  assert.equal(app, null);
  assert.equal(dom.window.document.querySelector('#cgs-root'), null);
  assert.match(warning, /earlier ChatGPT Sidecar userscript is still enabled/u);
  dom.window.close();
});

test('install reserves the earlier build marker to prevent duplicate controls', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://chatgpt.com/',
    pretendToBeVisual: true,
  });

  const app = await toolkit.install(dom.window.document, dom.window);

  assert.ok(app);
  assert.equal(dom.window.document.documentElement.dataset.chatgptWorkflowToolkitInstalled, toolkit.VERSION);
  assert.equal(dom.window.document.documentElement.dataset.chatgptSidecarInstalled, '1.1.0');
  app.state.observer.disconnect();
  dom.window.close();
});
