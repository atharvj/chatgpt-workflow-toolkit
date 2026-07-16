'use strict';

const assert = require('node:assert/strict');
const { join } = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const toolkit = require(join(__dirname, '..', 'chatgpt-workflow-toolkit.user.js'));

async function waitFor(predicate, win, timeout = 1_500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => win.setTimeout(resolve, 10));
  }
  return predicate();
}

function storageAdapter(map) {
  return {
    storageGet: async (key, fallback) => map.has(key) ? map.get(key) : fallback,
    storageSet: async (key, value) => {
      map.set(key, value);
      return true;
    },
    storageDelete: async (key) => map.delete(key),
  };
}

test('fresh continuation generates one handoff and navigates the current tab with a one-time job', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <article data-testid="conversation-turn-0"><div data-message-author-role="user">Help with lab.pdf and setup.png</div></article>
    <article data-testid="conversation-turn-1"><div data-message-author-role="assistant"><div class="markdown">Original instructions</div></div></article>
    <form><textarea id="prompt-textarea"></textarea><button data-testid="send-button" type="button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/laggy-chat',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const saved = new Map();
  let navigatedTo = '';
  let popupCalls = 0;
  let sends = 0;
  let sentDraft = '';
  dom.window.open = () => {
    popupCalls += 1;
    return null;
  };
  document.querySelector('[data-testid="send-button"]').addEventListener('click', () => {
    sends += 1;
    const composer = document.querySelector('#prompt-textarea');
    sentDraft = composer.value;
    const userTurn = document.createElement('article');
    userTurn.dataset.testid = 'conversation-turn-2';
    userTurn.innerHTML = `<div data-message-author-role="user">${sentDraft}</div>`;
    const oldAssistant = document.querySelector('[data-testid="conversation-turn-1"]');
    oldAssistant.replaceWith(oldAssistant.cloneNode(true));
    document.querySelector('main').insertBefore(userTurn, document.querySelector('form'));
    composer.value = '';
    dom.window.setTimeout(() => {
      const assistantTurn = document.createElement('article');
      assistantTurn.dataset.testid = 'conversation-turn-3';
      assistantTurn.innerHTML = `<div data-message-author-role="assistant">
        <div class="markdown"><h2>Goal</h2><p>Continue the lab safely.</p><h2>Optional materials</h2>
        <p>In the first reply, ask once for lab.pdf and setup.png if available. It is okay if they are unavailable.</p></div>
        <button data-testid="copy-turn-action-button">Copy</button>
      </div>`;
      document.querySelector('main').insertBefore(assistantTurn, document.querySelector('form'));
    }, 60);
  });

  const app = toolkit.createApp(document, dom.window, {
    ...storageAdapter(saved),
    navigateTo: (url) => {
      navigatedTo = url;
      return true;
    },
    freshResponseTimeout: 1_000,
    freshStabilityMs: 20,
  });
  await app.start();
  await waitFor(() => !document.querySelector('#cgs-dock').hidden, dom.window);
  document.querySelector('[data-cgs-action="open-handoff"]').click();
  document.querySelector('[data-cgs-action="confirm-fresh-chat"]').click();
  const transfer = await waitFor(() => app.state.freshTransferPromise, dom.window);

  assert.ok(transfer, 'the confirmation starts one observable transfer');
  assert.equal(await transfer, true);
  assert.equal(sends, 1, 'the internal handoff request is sent exactly once');
  assert.equal(popupCalls, 0, 'fresh continuation never opens a popup or child tab');
  assert.match(sentDraft, /^Create a compact, self-contained handoff/u);
  assert.match(sentDraft, /Use each exact filename or name when known; do not invent names/u);
  assert.match(sentDraft, /still sufficient if the user cannot provide them again/u);
  assert.match(sentDraft, /provide or upload them in full if available/u);
  assert.match(sentDraft, /If no such materials exist[^\n]*do not ask the user/iu);
  assert.match(navigatedTo, /^https:\/\/chatgpt\.com\/#cwt-fresh=[a-z0-9_-]{8,80}$/iu);
  const stored = [...saved.values()][0];
  assert.ok(stored);
  assert.match(stored.handoff, /lab\.pdf and setup\.png/u);
  assert.doesNotMatch(stored.handoff, /Copy/u, 'assistant action labels are not transferred');

  app.state.observer.disconnect();
  dom.window.close();
});

test('fresh destination consumes the handoff, fills it, and sends exactly once', async () => {
  const id = 'fresh_job-1234';
  const targetUrl = toolkit.urlWithFreshLaunch('https://chatgpt.com/c/old', id);
  const saved = new Map();
  const adapter = storageAdapter(saved);
  await adapter.storageSet(toolkit.freshHandoffStorageKey(id), {
    version: 1,
    id,
    createdAt: Date.now(),
    handoff: 'Goal: finish the lab.\n\nOptional materials: Ask once for lab.pdf if available; it is okay if unavailable.',
  });
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <form><textarea id="prompt-textarea"></textarea><button data-testid="send-button" type="button">Send</button></form>
  </main></body></html>`, {
    url: targetUrl,
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  let sends = 0;
  let sentDraft = '';
  document.querySelector('[data-testid="send-button"]').addEventListener('click', () => {
    sends += 1;
    const composer = document.querySelector('#prompt-textarea');
    sentDraft = composer.value;
    composer.value = '';
  });

  const app = toolkit.createApp(document, dom.window, {
    ...adapter,
    initialFreshJobId: toolkit.parseFreshJobId(targetUrl),
  });
  await app.start();

  assert.equal(sends, 1, 'the carried handoff is sent exactly once');
  assert.match(sentDraft, /^Continue the previous conversation from the handoff below/u);
  assert.match(sentDraft, /follow any “Optional materials” instruction in your first response/u);
  assert.match(sentDraft, /Goal: finish the lab/u);
  assert.match(sentDraft, /lab\.pdf/u);
  assert.equal(saved.size, 0, 'the one-time handoff is deleted before it can be replayed');
  assert.equal(toolkit.parseFreshJobId(dom.window.location.href), '');

  app.state.observer.disconnect();
  dom.window.close();
});

test('fresh destination preserves a one-time handoff when an unrelated draft would be overwritten', async () => {
  const id = 'fresh_job-draft';
  const targetUrl = toolkit.urlWithFreshLaunch('https://chatgpt.com/c/old', id);
  const saved = new Map();
  const adapter = storageAdapter(saved);
  const storageKey = toolkit.freshHandoffStorageKey(id);
  await adapter.storageSet(storageKey, {
    version: 1,
    id,
    createdAt: Date.now(),
    handoff: 'Goal: keep this handoff safe.',
  });
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <form><textarea id="prompt-textarea">my unrelated draft</textarea><button data-testid="send-button" type="button">Send</button></form>
  </main></body></html>`, { url: targetUrl, pretendToBeVisual: true });
  let sends = 0;
  dom.window.document.querySelector('[data-testid="send-button"]').addEventListener('click', () => { sends += 1; });

  const app = toolkit.createApp(dom.window.document, dom.window, {
    ...adapter,
    initialFreshJobId: id,
  });
  await app.start();

  assert.equal(dom.window.document.querySelector('#prompt-textarea').value, 'my unrelated draft');
  assert.equal(sends, 0);
  assert.equal(saved.has(storageKey), true, 'the handoff remains available for a safe retry');
  assert.equal(toolkit.parseFreshJobId(dom.window.location.href), id, 'the retry marker is retained');

  app.state.observer.disconnect();
  dom.window.close();
});

test('a missing fresh job never deletes another tab’s per-ID handoff', async () => {
  const requestedId = 'fresh_job-first';
  const otherId = 'fresh_job-second';
  const targetUrl = toolkit.urlWithFreshLaunch('https://chatgpt.com/c/old', requestedId);
  const saved = new Map();
  const adapter = storageAdapter(saved);
  const otherKey = toolkit.freshHandoffStorageKey(otherId);
  await adapter.storageSet(otherKey, {
    version: 1,
    id: otherId,
    createdAt: Date.now(),
    handoff: 'Another tab owns this handoff.',
  });
  const dom = new JSDOM('<!doctype html><html><body><main></main></body></html>', {
    url: targetUrl,
    pretendToBeVisual: true,
  });

  const app = toolkit.createApp(dom.window.document, dom.window, {
    ...adapter,
    initialFreshJobId: requestedId,
  });
  await app.start();

  assert.equal(saved.has(otherKey), true);
  assert.equal(saved.get(otherKey).handoff, 'Another tab owns this handoff.');
  assert.equal(toolkit.parseFreshJobId(dom.window.location.href), '');

  app.state.observer.disconnect();
  dom.window.close();
});
