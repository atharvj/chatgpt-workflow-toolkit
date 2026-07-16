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

test('app smoke: installs controls, opens Ask aside, and prepares a lightweight handoff', async () => {
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
  assert.ok(turnButton, 'assistant response receives one Ask aside control');
  assert.equal(document.querySelector('#cgs-dock').hidden, false);

  turnButton.click();
  assert.equal(document.querySelector('#cgs-dialog-backdrop').hidden, false);
  assert.equal(document.querySelector('#cgs-context-mode').value, 'clicked');
  document.querySelector('[data-cgs-action="cancel-question"]').click();

  document.querySelector('[data-cgs-action="open-handoff"]').click();
  assert.equal(document.querySelector('#cgs-handoff-backdrop').hidden, false);
  document.querySelector('[data-cgs-action="prepare-handoff"]').click();
  assert.match(document.querySelector('#prompt-textarea').value, /^Create a compact, self-contained handoff/u);
  assert.equal(document.querySelector('#cgs-handoff-backdrop').hidden, true);

  app.state.observer.disconnect();
  dom.window.close();
});
