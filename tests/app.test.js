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

test('app smoke: installs simplified controls with self-explanatory side-question options', async () => {
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
  const questionBackdrop = document.querySelector('#cgs-dialog-backdrop');
  const questionDialog = questionBackdrop.querySelector('.cgs-dialog');
  assert.equal(questionBackdrop.hidden, false);
  assert.equal(document.querySelector('#cgs-context-mode').value, 'clicked');

  const autoSend = document.querySelector('#cgs-dialog-autosend');
  assert.match(autoSend.closest('label').textContent, /Send this question automatically/u);
  const questionDialogText = questionDialog.textContent.replace(/\s+/gu, ' ').trim();
  assert.match(
    questionDialogText,
    /checked[^.]*send[^.]*after[^.]*branch[^.]*ready/iu,
    'the dialog explains what happens when automatic sending is checked',
  );
  assert.match(
    questionDialogText,
    /unchecked[^.]*leave[^.]*question[^.]*composer[^.]*review/iu,
    'the dialog explains what happens when automatic sending is unchecked',
  );

  const contextOptions = [...document.querySelector('#cgs-context-mode').options]
    .map((option) => ({ value: option.value, label: option.textContent.trim() }));
  assert.deepEqual(contextOptions, [
    { value: 'latest', label: 'Through latest response (include later messages)' },
    { value: 'clicked', label: 'Only through this response (exclude later messages)' },
  ]);
  assert.match(
    questionDialogText,
    /Only through this response[^.]*clicked response[^.]*excludes? later (?:turns|messages)/iu,
    'the dialog explains that clicked-response context stops before later messages',
  );
  assert.match(
    questionDialogText,
    /Through latest response[^.]*includes?[^.]*later (?:turns|messages)/iu,
    'the dialog explains that latest-response context includes later messages',
  );
  document.querySelector('[data-cgs-action="cancel-question"]').click();

  document.querySelector('[data-cgs-action="open-handoff"]').click();
  const handoffBackdrop = document.querySelector('#cgs-handoff-backdrop');
  const handoffDialog = handoffBackdrop.querySelector('.cgs-dialog');
  assert.equal(handoffBackdrop.hidden, false);
  assert.equal(document.querySelector('#cgs-handoff-title').textContent, 'Are you sure you want to continue in fresh chat?');
  assert.equal(
    handoffDialog.textContent.replace(/\s+/gu, ' ').trim(),
    'Are you sure you want to continue in fresh chat? Cancel Yes',
    'the confirmation contains no workflow instructions beyond the question and its choices',
  );
  assert.deepEqual(
    [...handoffDialog.querySelectorAll('button')].map((button) => button.textContent.trim()),
    ['Cancel', 'Yes'],
  );
  assert.equal(handoffDialog.querySelector('[data-cgs-action="close-handoff"]').textContent.trim(), 'Cancel');
  assert.equal(handoffDialog.querySelector('[data-cgs-action="confirm-fresh-chat"]').textContent.trim(), 'Yes');
  assert.equal(handoffDialog.querySelector('[data-cgs-action="prepare-handoff"]'), null);
  assert.equal(handoffDialog.querySelector('[data-cgs-action="open-fresh-chat"]'), null);
  assert.equal(handoffDialog.querySelector('[data-cgs-action="full-branch-latest"]'), null);
  document.querySelector('[data-cgs-action="close-handoff"]').click();
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
