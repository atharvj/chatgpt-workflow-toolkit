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

function createIfAvailableLockManager() {
  const heldNames = new Set();
  const requests = [];
  return {
    heldNames,
    requests,
    request(name, options, callback) {
      requests.push({ name: String(name), options: { ...options } });
      if (heldNames.has(name)) {
        assert.equal(options && options.ifAvailable, true, 'a second page must not wait and run the same job later');
        return Promise.resolve().then(() => callback(null));
      }
      heldNames.add(name);
      return Promise.resolve()
        .then(() => callback({ name: String(name), mode: 'exclusive' }))
        .finally(() => heldNames.delete(name));
    },
  };
}

function createDelayedLockManager() {
  const requests = [];
  const pending = [];
  return {
    requests,
    pending,
    request(name, options, callback) {
      requests.push({ name: String(name), options: { ...options } });
      return new Promise((resolve, reject) => {
        pending.push(async () => {
          try {
            resolve(await callback({ name: String(name), mode: 'exclusive' }));
          } catch (error) {
            reject(error);
          }
        });
      });
    },
    async grantNext() {
      const grant = pending.shift();
      assert.ok(grant, 'a delayed lock request is waiting to be granted');
      await grant();
    },
  };
}

test('app smoke: installs a single whole-chat, auto-send side-question flow', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <article data-testid="conversation-turn-0"><div data-message-author-role="user">Help with my lab</div></article>
    <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Follow these steps</div><div><button data-testid="copy-turn-action-button">Copy</button></div></article>
    <form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/smoke',
    pretendToBeVisual: true,
  });

  const { document } = dom.window;
  const app = await toolkit.install(document, dom.window);
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
  assert.equal(questionDialog.getAttribute('aria-modal'), 'false');
  assert.equal(document.querySelector('main').hasAttribute('inert'), false, 'the original chat stays interactive');
  assert.match(questionDialog.querySelector('p').textContent, /remember the whole conversation so far/iu);
  assert.match(questionDialog.querySelector('p').textContent, /keep reading or scrolling the original/iu);
  assert.equal(document.querySelector('#cgs-context-mode'), null);
  assert.equal(document.querySelector('#cgs-dialog-autosend'), null);
  assert.equal(document.querySelector('[data-cgs-setting="autoSend"]'), null);
  const questionDialogText = questionDialog.textContent.replace(/\s+/gu, ' ').trim();
  assert.doesNotMatch(questionDialogText, /Chat up to this answer|Send question right away|review it first/iu);
  assert.equal(document.querySelector('[data-cgs-action="submit-question"]').textContent, 'Ask in new chat');

  const recoveryDialog = document.querySelector('#cgs-recovery-backdrop .cgs-dialog');
  assert.match(recoveryDialog.textContent, /question was never added to the original conversation/iu);
  assert.equal(recoveryDialog.querySelector('[data-cgs-action="insert-recovery"]'), null);
  assert.doesNotMatch(recoveryDialog.textContent, /branch manually|I branched/iu);

  const styleText = document.querySelector('#cgs-style').textContent;
  assert.match(styleText, /#cgs-dialog-backdrop\s*\{[^}]*pointer-events:\s*none/su);
  assert.match(styleText, /#cgs-dialog-backdrop \.cgs-dialog\s*\{[^}]*pointer-events:\s*auto/su);
  assert.match(styleText, /@media \(max-width: 1100px\)[\s\S]*?#cgs-dialog-backdrop\s*\{[^}]*height:\s*min\(48dvh, 420px\)[^}]*overflow:\s*hidden/su);
  assert.match(styleText, /@media \(max-width: 1100px\)[\s\S]*?#cgs-dialog-backdrop \.cgs-dialog\s*\{[^}]*height:\s*100%[^}]*max-height:\s*none/su);
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

test('side question from an older answer targets the latest answer and always auto-sends in a child chat', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <article data-testid="conversation-turn-0"><div data-message-author-role="user">First question</div></article>
    <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Older answer</div><button data-testid="copy-turn-action-button">Copy</button></article>
    <article data-testid="conversation-turn-2"><div data-message-author-role="user">Later question</div></article>
    <article data-testid="conversation-turn-3"><div data-message-author-role="assistant">Newest answer</div><button data-testid="copy-turn-action-button">Copy</button></article>
    <form><textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/whole-chat-test',
    pretendToBeVisual: true,
  });
  const stored = new Map();
  const openCalls = [];
  const child = {
    closed: false,
    opener: {},
    location: {
      href: 'about:blank',
      replace(url) { this.href = String(url); },
    },
    focus() {},
    close() { this.closed = true; },
  };
  dom.window.open = (url, name, features) => {
    openCalls.push({ url: String(url), name, features });
    return child;
  };

  const previousGM = globalThis.GM;
  globalThis.GM = {
    async getValue(key, fallback) { return stored.has(key) ? stored.get(key) : fallback; },
    async setValue(key, value) { stored.set(key, value); },
    async deleteValue(key) { stored.delete(key); },
  };

  let app;
  try {
    app = toolkit.createApp(dom.window.document, dom.window);
    await app.start();
    await waitFor(() => dom.window.document.querySelectorAll('.cgs-turn-action').length === 2, dom.window);

    dom.window.document.querySelector('[data-testid="conversation-turn-1"] .cgs-turn-action').click();
    dom.window.document.querySelector('#cgs-question').value = 'Explain the newest answer in another way.';
    const submit = dom.window.document.querySelector('[data-cgs-action="submit-question"]');
    submit.click();
    submit.click();

    const saved = await waitFor(
      () => [...stored.values()].some((value) => value && value.kind === 'ask') && child.location.href !== 'about:blank',
      dom.window,
    );
    assert.equal(saved, true);
    const job = [...stored.values()].find((value) => value && value.kind === 'ask');
    assert.equal(job.locator.testId, 'conversation-turn-3');
    assert.equal(job.sourceConversation, 'whole-chat-test');
    assert.match(job.targetFingerprint, /Newest answer/u);
    assert.equal(job.question, 'Explain the newest answer in another way.');
    assert.equal(job.autoSend, true);
    assert.equal(openCalls.length, 1, 'a double submit reserves only one child window');
    assert.equal(openCalls[0].url, 'about:blank', 'the popup is reserved synchronously from the submit click');
    assert.match(child.location.href, /^https:\/\/chatgpt\.com\/c\/whole-chat-test#cwt-job=/u);
    assert.equal(dom.window.document.querySelector('#prompt-textarea').value, '');
    assert.equal(dom.window.document.querySelectorAll('article').length, 4, 'the source chat receives no side-question turn');
  } finally {
    if (app && app.state.observer) app.state.observer.disconnect();
    if (previousGM === undefined) delete globalThis.GM;
    else globalThis.GM = previousGM;
    dom.window.close();
  }
});

test('side question waits instead of silently omitting an unfinished latest response', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <article data-testid="conversation-turn-0"><div data-message-author-role="user">Question</div></article>
    <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Completed answer</div><button data-testid="copy-turn-action-button">Copy</button></article>
    <article data-testid="conversation-turn-2" data-is-streaming="true"><div data-message-author-role="assistant">Still writing</div></article>
    <button data-testid="stop-button">Stop</button>
    <form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/streaming-side-test',
    pretendToBeVisual: true,
  });
  let openCount = 0;
  dom.window.open = () => { openCount += 1; return null; };
  const app = toolkit.createApp(dom.window.document, dom.window);
  await app.start();
  await waitFor(() => dom.window.document.querySelector('.cgs-turn-action'), dom.window);

  dom.window.document.querySelector('.cgs-turn-action').click();
  dom.window.document.querySelector('#cgs-question').value = 'What about the unfinished part?';
  dom.window.document.querySelector('[data-cgs-action="submit-question"]').click();

  assert.equal(openCount, 0);
  assert.equal(dom.window.document.querySelector('#cgs-dialog-backdrop').hidden, false);
  assert.match(dom.window.document.querySelector('#cgs-toast').textContent, /finish the latest response/iu);

  app.state.observer.disconnect();
  dom.window.close();
});

test('automatic Branch aborts if a newer turn appears while the response menu is opening', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <article data-testid="conversation-turn-0"><div data-message-author-role="user">Original question</div></article>
    <article data-testid="conversation-turn-1">
      <div data-message-author-role="assistant">Original latest answer</div>
      <button id="more" aria-label="More actions" aria-controls="turn-menu">More</button>
    </article>
    <div id="turn-menu" role="menu" hidden></div>
    <form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/source-chat',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const originalTurn = document.querySelector('[data-testid="conversation-turn-1"]');
  const menu = document.querySelector('#turn-menu');
  const form = document.querySelector('form');
  originalTurn.scrollIntoView = () => {};

  document.querySelector('#more').addEventListener('click', () => {
    dom.window.setTimeout(() => {
      form.insertAdjacentHTML('beforebegin', `
        <article data-testid="conversation-turn-2"><div data-message-author-role="user">A newer question</div></article>
        <article data-testid="conversation-turn-3"><div data-message-author-role="assistant">A newer answer</div></article>
      `);
    }, 25);
    dom.window.setTimeout(() => {
      menu.hidden = false;
      const branch = document.createElement('button');
      branch.setAttribute('role', 'menuitem');
      branch.id = 'branch';
      branch.textContent = 'Branch in new chat';
      menu.append(branch);
    }, 75);
  });
  let branchCount = 0;
  menu.addEventListener('click', (event) => {
    if (!event.target.closest('#branch')) return;
    branchCount += 1;
    dom.window.history.pushState({}, '', '/c/unsafe-branch');
  });

  const app = toolkit.createApp(document, dom.window, {
    branchNavigationTimeout: 300,
    reloadPage: () => true,
  });
  await app.start();
  const job = toolkit.sanitizeJob({
    createdAt: Date.now(),
    sourceUrl: 'https://chatgpt.com/c/source-chat',
    kind: 'ask',
    locator: toolkit.getTurnLocator(originalTurn, document),
    targetFingerprint: toolkit.assistantTurnFingerprint(originalTurn),
    contextFingerprint: toolkit.conversationContextFingerprint(document, originalTurn),
    question: 'Keep this question in a separate chat.',
    autoSend: true,
  });

  try {
    assert.equal(await app.runIncomingJob(job), false);
    assert.equal(branchCount, 0, 'a stale response must never be branched after a newer turn appears');
    assert.equal(toolkit.conversationIdentity(dom.window.location.href), 'source-chat');
    assert.equal(document.querySelector('#prompt-textarea').value, '');
  } finally {
    app.state.observer.disconnect();
    dom.window.close();
  }
});

test('automatic Branch aborts if generation starts during branch-intent persistence', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <article data-testid="conversation-turn-0"><div data-message-author-role="user">Original question</div></article>
    <article data-testid="conversation-turn-1">
      <div data-message-author-role="assistant">Latest completed answer</div>
      <button id="more" aria-label="More actions" aria-controls="turn-menu">More</button>
    </article>
    <div id="turn-menu" role="menu" hidden><button role="menuitem" id="branch">Branch in new chat</button></div>
    <form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/source-chat',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const turn = document.querySelector('[data-testid="conversation-turn-1"]');
  turn.scrollIntoView = () => {};
  document.querySelector('#more').addEventListener('click', () => {
    document.querySelector('#turn-menu').hidden = false;
  });
  let branchCount = 0;
  document.querySelector('#branch').addEventListener('click', () => {
    branchCount += 1;
    dom.window.history.pushState({}, '', '/c/unsafe-branch');
  });

  const stored = new Map();
  let generationStartedDuringPersistence = false;
  const previousGM = globalThis.GM;
  globalThis.GM = {
    async getValue(key, fallback) { return stored.has(key) ? stored.get(key) : fallback; },
    async setValue(key, value) {
      if (value && value.branchClickAttempted && !generationStartedDuringPersistence) {
        generationStartedDuringPersistence = true;
        const stop = document.createElement('button');
        stop.dataset.testid = 'stop-button';
        stop.textContent = 'Stop generating';
        document.querySelector('main').append(stop);
        await new Promise((resolve) => dom.window.setTimeout(resolve, 75));
      }
      stored.set(key, value);
    },
    async deleteValue(key) { stored.delete(key); },
  };

  const app = toolkit.createApp(document, dom.window, {
    branchNavigationTimeout: 300,
    reloadPage: () => true,
  });
  await app.start();
  app.state.incomingJobId = 'generation_race_job';
  const job = toolkit.sanitizeJob({
    createdAt: Date.now(),
    sourceUrl: 'https://chatgpt.com/c/source-chat',
    kind: 'ask',
    locator: toolkit.getTurnLocator(turn, document),
    targetFingerprint: toolkit.assistantTurnFingerprint(turn),
    contextFingerprint: toolkit.conversationContextFingerprint(document, turn),
    question: 'Wait until generation is finished.',
    autoSend: true,
  });

  try {
    assert.equal(await app.runIncomingJob(job), false);
    assert.equal(generationStartedDuringPersistence, true, 'the test must create the race during write-ahead persistence');
    assert.equal(branchCount, 0, 'Branch must not be clicked after generation starts');
    assert.equal(toolkit.conversationIdentity(dom.window.location.href), 'source-chat');
    assert.equal(document.querySelector('#prompt-textarea').value, '');
  } finally {
    app.state.observer.disconnect();
    if (previousGM === undefined) delete globalThis.GM;
    else globalThis.GM = previousGM;
    dom.window.close();
  }
});

test('automatic Branch forces a persisted destination reload before any composer write', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <article data-testid="conversation-turn-1">
      <div data-message-author-role="assistant">Latest answer</div>
      <button id="more" aria-label="More actions" aria-controls="turn-menu">More</button>
    </article>
    <div id="turn-menu" role="menu" hidden><button role="menuitem" id="branch">Branch in new chat</button></div>
    <form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/source-chat',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const turn = document.querySelector('article');
  const composer = document.querySelector('#prompt-textarea');
  turn.scrollIntoView = () => {};
  document.querySelector('#more').addEventListener('click', () => {
    document.querySelector('#turn-menu').hidden = false;
  });
  document.querySelector('#branch').addEventListener('click', () => {
    dom.window.history.pushState({}, '', '/c/separate-side-chat');
    document.querySelector('#turn-menu').hidden = true;
  });
  let sendCount = 0;
  document.querySelector('[data-testid="send-button"]').addEventListener('click', () => {
    sendCount += 1;
  });
  const stored = new Map();
  const previousGM = globalThis.GM;
  globalThis.GM = {
    async getValue(key, fallback) { return stored.has(key) ? stored.get(key) : fallback; },
    async setValue(key, value) { stored.set(key, value); },
    async deleteValue(key) { stored.delete(key); },
  };
  let reloadCount = 0;
  const app = toolkit.createApp(document, dom.window, {
    pageInstanceId: 'source_page_1234',
    reloadPage: () => { reloadCount += 1; return true; },
  });
  await app.start();
  app.state.incomingJobId = 'incoming_job_1234';
  const job = toolkit.sanitizeJob({
    createdAt: Date.now(),
    sourceUrl: 'https://chatgpt.com/c/source-chat',
    kind: 'ask',
    locator: toolkit.getTurnLocator(turn, document),
    targetFingerprint: toolkit.assistantTurnFingerprint(turn),
    contextFingerprint: toolkit.conversationContextFingerprint(document, turn),
    question: 'What does that mean?',
    autoSend: true,
  });

  try {
    assert.equal(await app.runIncomingJob(job), false, 'the first page stops after requesting a full reload');
    assert.equal(toolkit.conversationIdentity(dom.window.location.href), 'separate-side-chat');
    assert.equal(reloadCount, 1);
    assert.equal(composer.value, '');
    assert.equal(sendCount, 0);
    const saved = stored.get('chatgptSidecar.job.v1.incoming_job_1234');
    assert.equal(saved.branchConversation, 'separate-side-chat');
    assert.equal(saved.branchReloadFrom, 'source_page_1234');
    assert.match(saved.contextFingerprint, /^1:/u);
    assert.match(dom.window.location.hash, /cwt-job=incoming_job_1234/u);
  } finally {
    app.state.observer.disconnect();
    if (previousGM === undefined) delete globalThis.GM;
    else globalThis.GM = previousGM;
    dom.window.close();
  }
});

test('freshly reloaded branch verifies context, inserts the question, and sends once', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Latest answer</div></article>
    <form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/separate-side-chat#cwt-job=incoming_job_1234',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const turn = document.querySelector('article');
  const composer = document.querySelector('#prompt-textarea');
  let sendCount = 0;
  let sendSawWriteAheadPhase = false;
  document.querySelector('[data-testid="send-button"]').addEventListener('click', () => {
    sendCount += 1;
    sendSawWriteAheadPhase = job.sendAttempted;
    composer.value = '';
    const userTurn = document.createElement('article');
    userTurn.dataset.testid = 'conversation-turn-2';
    userTurn.innerHTML = '<div data-message-author-role="user">What does that mean?</div>';
    document.querySelector('main').insertBefore(userTurn, document.querySelector('form'));
  });

  const app = toolkit.createApp(document, dom.window, { pageInstanceId: 'reloaded_page_1234' });
  await app.start();
  app.state.settings.adaptiveRouting = false;
  const job = toolkit.sanitizeJob({
    createdAt: Date.now(),
    sourceUrl: 'https://chatgpt.com/c/source-chat',
    kind: 'ask',
    locator: toolkit.getTurnLocator(turn, document),
    targetFingerprint: toolkit.assistantTurnFingerprint(turn),
    question: 'What does that mean?',
    autoSend: true,
    branchClickAttempted: true,
    branchConversation: 'separate-side-chat',
    branchReloadFrom: 'source_page_1234',
  });

  assert.equal(await app.runIncomingJob(job), true);
  assert.equal(toolkit.conversationIdentity(dom.window.location.href), 'separate-side-chat');
  assert.equal(composer.value, '');
  assert.equal(sendCount, 1);
  assert.equal(sendSawWriteAheadPhase, true);

  app.state.observer.disconnect();
  dom.window.close();
});

test('two reloaded pages cannot consume the same incoming job concurrently when Web Locks are available', async () => {
  const jobId = 'incoming_job_lock_1234';
  const branchUrl = `https://chatgpt.com/c/separate-side-chat#cwt-job=${jobId}`;
  const makeDom = () => new JSDOM(`<!doctype html><html><body><main>
    <article data-testid="conversation-turn-0"><div data-message-author-role="user">Original question</div></article>
    <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Latest answer</div></article>
    <form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: branchUrl,
    pretendToBeVisual: true,
  });
  const firstDom = makeDom();
  const secondDom = makeDom();
  const locks = createIfAvailableLockManager();
  Object.defineProperty(firstDom.window.navigator, 'locks', { configurable: true, value: locks });
  Object.defineProperty(secondDom.window.navigator, 'locks', { configurable: true, value: locks });

  const firstTurn = firstDom.window.document.querySelector('[data-testid="conversation-turn-1"]');
  const stored = new Map();
  stored.set('chatgptSidecar.settings.v1', { ...toolkit.DEFAULT_SETTINGS, adaptiveRouting: false });
  stored.set(`chatgptSidecar.job.v1.${jobId}`, toolkit.sanitizeJob({
    createdAt: Date.now(),
    sourceUrl: 'https://chatgpt.com/c/source-chat',
    kind: 'ask',
    locator: toolkit.getTurnLocator(firstTurn, firstDom.window.document),
    targetFingerprint: toolkit.assistantTurnFingerprint(firstTurn),
    contextFingerprint: toolkit.conversationContextFingerprint(firstDom.window.document, firstTurn),
    question: 'Explain it in the side chat.',
    autoSend: true,
    branchClickAttempted: true,
    branchConversation: 'separate-side-chat',
    branchReloadFrom: 'source_page_1234',
  }));
  const previousGM = globalThis.GM;
  globalThis.GM = {
    async getValue(key, fallback) { return stored.has(key) ? stored.get(key) : fallback; },
    async setValue(key, value) { stored.set(key, value); },
    async deleteValue(key) { stored.delete(key); },
  };

  const sendCounts = [0, 0];
  for (const [index, dom] of [firstDom, secondDom].entries()) {
    const { document } = dom.window;
    document.querySelector('[data-testid="send-button"]').addEventListener('click', () => {
      sendCounts[index] += 1;
      const composer = document.querySelector('#prompt-textarea');
      const text = composer.value;
      composer.value = '';
      const userTurn = document.createElement('article');
      userTurn.dataset.testid = 'conversation-turn-2';
      userTurn.innerHTML = `<div data-message-author-role="user">${text}</div>`;
      document.querySelector('main').insertBefore(userTurn, document.querySelector('form'));
    });
  }

  const firstApp = toolkit.createApp(firstDom.window.document, firstDom.window, {
    initialJobId: jobId,
    pageInstanceId: 'reloaded_page_first_1234',
  });
  const secondApp = toolkit.createApp(secondDom.window.document, secondDom.window, {
    initialJobId: jobId,
    pageInstanceId: 'reloaded_page_second_1234',
  });

  try {
    const firstStart = firstApp.start();
    assert.equal(await waitFor(() => locks.heldNames.size === 1, firstDom.window), true, 'the first page acquires the job lock');
    await secondApp.start();
    await firstStart;

    assert.equal(locks.requests.length, 2, 'both page instances consult the same Web Lock');
    assert.equal(locks.requests[0].name, locks.requests[1].name, 'the lock is keyed by incoming job ID');
    assert.equal(locks.requests[0].options.ifAvailable, true);
    assert.deepEqual(sendCounts, [1, 0], 'only the lock owner may stage and send the side question');
    assert.equal(stored.has(`chatgptSidecar.job.v1.${jobId}`), false, 'the successful consumer removes the completed job');
  } finally {
    if (firstApp.state.observer) firstApp.state.observer.disconnect();
    if (secondApp.state.observer) secondApp.state.observer.disconnect();
    if (previousGM === undefined) delete globalThis.GM;
    else globalThis.GM = previousGM;
    firstDom.window.close();
    secondDom.window.close();
  }
});

test('recovery retry and close honor an existing incoming-job lock', async () => {
  const jobId = 'recovery_lock_job_1234';
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <article data-testid="conversation-turn-0"><div data-message-author-role="user">Original question</div></article>
    <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Latest answer</div></article>
    <form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/separate-side-chat',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const turn = document.querySelector('[data-testid="conversation-turn-1"]');
  const composer = document.querySelector('#prompt-textarea');
  const locks = createIfAvailableLockManager();
  Object.defineProperty(dom.window.navigator, 'locks', { configurable: true, value: locks });
  const stored = new Map();
  const storageKey = `chatgptSidecar.job.v1.${jobId}`;
  stored.set(storageKey, toolkit.sanitizeJob({
    createdAt: Date.now(),
    sourceUrl: 'https://chatgpt.com/c/source-chat',
    kind: 'ask',
    locator: toolkit.getTurnLocator(turn, document),
    targetFingerprint: toolkit.assistantTurnFingerprint(turn),
    contextFingerprint: toolkit.conversationContextFingerprint(document, turn),
    question: 'Do not run this unlocked.',
    autoSend: true,
    branchClickAttempted: true,
    branchConversation: 'separate-side-chat',
    branchReloadFrom: 'source_page_1234',
  }));
  const previousGM = globalThis.GM;
  globalThis.GM = {
    async getValue(key, fallback) { return stored.has(key) ? stored.get(key) : fallback; },
    async setValue(key, value) { stored.set(key, value); },
    async deleteValue(key) { stored.delete(key); },
  };
  let sends = 0;
  document.querySelector('[data-testid="send-button"]').addEventListener('click', () => { sends += 1; });
  const app = toolkit.createApp(document, dom.window);
  let releaseOwner;
  let ownerRequest;

  try {
    await app.start();
    app.state.incomingJobId = jobId;
    document.querySelector('#cgs-recovery-backdrop').hidden = false;
    ownerRequest = locks.request(
      `chatgptWorkflowToolkit.sideJob.v1.${jobId}`,
      { mode: 'exclusive', ifAvailable: true },
      () => new Promise((resolve) => { releaseOwner = resolve; }),
    );
    assert.equal(await waitFor(() => locks.heldNames.size === 1, dom.window), true);

    document.querySelector('[data-cgs-action="retry-branch"]').click();
    assert.equal(await waitFor(() => locks.requests.length === 2, dom.window), true);
    assert.equal(locks.requests[1].name, locks.requests[0].name);
    assert.equal(locks.requests[1].options.ifAvailable, true);
    assert.equal(app.state.incomingJobId, jobId, 'a busy retry keeps this page attached for a later explicit choice');
    assert.equal(document.querySelector('#cgs-recovery-backdrop').hidden, false);
    assert.equal(stored.has(storageKey), true);
    assert.equal(composer.value, '');
    assert.equal(sends, 0);
    assert.match(document.querySelector('#cgs-toast').textContent, /another window is already finishing/iu);
    assert.equal(await waitFor(() => app.state.incomingRecoveryAction === false, dom.window), true);

    document.querySelector('[data-cgs-action="close-recovery"]').click();
    assert.equal(await waitFor(
      () => app.state.incomingJobId === '' && document.querySelector('#cgs-recovery-backdrop').hidden,
      dom.window,
    ), true);
    assert.equal(locks.requests.length, 3);
    assert.equal(locks.requests[2].name, locks.requests[0].name);
    assert.equal(locks.requests[2].options.ifAvailable, true);
    assert.equal(document.querySelector('#cgs-recovery-backdrop').hidden, true);
    assert.equal(app.state.incomingJobId, '', 'closing a stale copy detaches only this page');
    assert.equal(stored.has(storageKey), true, 'a non-owner must never delete the shared job');
    assert.equal(composer.value, '');
    assert.equal(sends, 0);
  } finally {
    if (releaseOwner) releaseOwner();
    if (ownerRequest) await ownerRequest;
    if (app.state.observer) app.state.observer.disconnect();
    if (previousGM === undefined) delete globalThis.GM;
    else globalThis.GM = previousGM;
    dom.window.close();
  }
});

test('immediate Close and Escape cannot detach a retry awaiting its job lock', async () => {
  const jobId = 'delayed_recovery_job_1234';
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <article data-testid="conversation-turn-0"><div data-message-author-role="user">Original question</div></article>
    <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Latest answer</div></article>
    <form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/separate-side-chat',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const turn = document.querySelector('[data-testid="conversation-turn-1"]');
  const composer = document.querySelector('#prompt-textarea');
  const locks = createDelayedLockManager();
  Object.defineProperty(dom.window.navigator, 'locks', { configurable: true, value: locks });
  const stored = new Map();
  const storageKey = `chatgptSidecar.job.v1.${jobId}`;
  stored.set('chatgptSidecar.settings.v1', { ...toolkit.DEFAULT_SETTINGS, adaptiveRouting: false });
  stored.set(storageKey, toolkit.sanitizeJob({
    createdAt: Date.now(),
    sourceUrl: 'https://chatgpt.com/c/source-chat',
    kind: 'ask',
    locator: toolkit.getTurnLocator(turn, document),
    targetFingerprint: toolkit.assistantTurnFingerprint(turn),
    contextFingerprint: toolkit.conversationContextFingerprint(document, turn),
    question: 'Retry only while still attached.',
    autoSend: true,
    branchClickAttempted: true,
    branchConversation: 'separate-side-chat',
    branchReloadFrom: 'source_page_1234',
  }));
  const previousGM = globalThis.GM;
  globalThis.GM = {
    async getValue(key, fallback) { return stored.has(key) ? stored.get(key) : fallback; },
    async setValue(key, value) { stored.set(key, value); },
    async deleteValue(key) { stored.delete(key); },
  };
  let sends = 0;
  let sendSawAttachedJob = false;
  let sendSawWriteAhead = false;
  let app;
  document.querySelector('[data-testid="send-button"]').addEventListener('click', () => {
    sends += 1;
    sendSawAttachedJob = app.state.incomingJobId === jobId;
    sendSawWriteAhead = Boolean(stored.get(storageKey) && stored.get(storageKey).sendAttempted);
    const text = composer.value;
    composer.value = '';
    const userTurn = document.createElement('article');
    userTurn.dataset.testid = 'conversation-turn-2';
    userTurn.innerHTML = `<div data-message-author-role="user">${text}</div>`;
    document.querySelector('main').insertBefore(userTurn, document.querySelector('form'));
  });
  app = toolkit.createApp(document, dom.window, { pageInstanceId: 'retry_page_1234' });

  try {
    await app.start();
    app.state.incomingJobId = jobId;
    document.querySelector('#cgs-recovery-backdrop').hidden = false;

    document.querySelector('[data-cgs-action="retry-branch"]').click();
    assert.equal(locks.requests.length, 1);
    assert.equal(locks.pending.length, 1, 'the retry is paused before the Web Lock callback');
    assert.equal(app.state.incomingRecoveryAction, true);

    document.querySelector('[data-cgs-action="close-recovery"]').click();
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(locks.requests.length, 1, 'Close and Escape do not start competing lock requests');
    assert.equal(app.state.incomingJobId, jobId, 'the pending retry remains attached');
    assert.equal(document.querySelector('#cgs-recovery-backdrop').hidden, false);
    assert.equal(stored.has(storageKey), true);
    assert.equal(composer.value, '');
    assert.equal(sends, 0);
    assert.match(document.querySelector('#cgs-toast').textContent, /already running.*wait for it to finish/iu);

    await locks.grantNext();
    assert.equal(await waitFor(() => sends === 1 && app.state.incomingRecoveryAction === false, dom.window, 3_000), true);
    assert.equal(sendSawAttachedJob, true, 'the acquired retry revalidates its original job before sending');
    assert.equal(sendSawWriteAhead, true, 'the acquired retry persists Send intent before replay');
    assert.equal(app.state.incomingJobId, '');
    assert.equal(stored.has(storageKey), false);
  } finally {
    if (app && app.state.observer) app.state.observer.disconnect();
    if (previousGM === undefined) delete globalThis.GM;
    else globalThis.GM = previousGM;
    dom.window.close();
  }
});

test('side automation blocks manual click, Enter, and submit while allowing its replayed Send', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <form><textarea id="prompt-textarea">Send from automation.</textarea><button type="button" data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/separate-side-chat',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const composer = document.querySelector('#prompt-textarea');
  const form = composer.closest('form');
  const sendButton = document.querySelector('[data-testid="send-button"]');
  let nativeClicks = 0;
  let nativeEnters = 0;
  let nativeSubmits = 0;
  sendButton.addEventListener('click', () => { nativeClicks += 1; });
  form.addEventListener('keydown', () => { nativeEnters += 1; });
  form.addEventListener('submit', (event) => {
    nativeSubmits += 1;
    event.preventDefault();
  });

  const app = toolkit.createApp(document, dom.window);
  await app.start();
  app.state.settings.adaptiveRouting = false;
  app.state.sideAutomationActive = true;

  try {
    sendButton.click();
    const enter = new dom.window.KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    const submit = new dom.window.Event('submit', { bubbles: true, cancelable: true });
    assert.equal(composer.dispatchEvent(enter), false);
    assert.equal(form.dispatchEvent(submit), false);
    assert.equal(enter.defaultPrevented, true);
    assert.equal(submit.defaultPrevented, true);
    assert.deepEqual(
      { nativeClicks, nativeEnters, nativeSubmits },
      { nativeClicks: 0, nativeEnters: 0, nativeSubmits: 0 },
      'manual send paths never reach ChatGPT while the side question is being staged',
    );

    assert.equal(await app.smartRouteAndSend({ composer, silent: true }), true);
    assert.deepEqual(
      { nativeClicks, nativeEnters, nativeSubmits },
      { nativeClicks: 1, nativeEnters: 0, nativeSubmits: 0 },
      'the userscript replay bypasses its staging guard exactly once',
    );
  } finally {
    app.state.sideAutomationActive = false;
    app.state.observer.disconnect();
    dom.window.close();
  }
});

test('side automation allows one delayed framework submit from its replay permit', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <form><textarea id="prompt-textarea">Send from automation.</textarea><button type="button" data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/separate-side-chat',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const composer = document.querySelector('#prompt-textarea');
  const form = composer.closest('form');
  const sendButton = document.querySelector('[data-testid="send-button"]');
  let nativeClicks = 0;
  let nativeSubmits = 0;
  sendButton.addEventListener('click', () => {
    nativeClicks += 1;
    dom.window.setTimeout(() => {
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    }, 5);
  });
  form.addEventListener('submit', (event) => {
    nativeSubmits += 1;
    event.preventDefault();
  });

  const app = toolkit.createApp(document, dom.window);
  await app.start();
  app.state.settings.adaptiveRouting = false;
  app.state.sideAutomationActive = true;

  try {
    assert.equal(await app.smartRouteAndSend({ composer, silent: true }), true);
    assert.equal(await waitFor(() => nativeSubmits === 1, dom.window), true);
    assert.deepEqual({ nativeClicks, nativeSubmits }, { nativeClicks: 1, nativeSubmits: 1 });

    const extraSubmit = new dom.window.Event('submit', { bubbles: true, cancelable: true });
    assert.equal(form.dispatchEvent(extraSubmit), false, 'the one-shot replay permit is consumed');
    assert.equal(extraSubmit.defaultPrevented, true);
    assert.equal(nativeSubmits, 1, 'a later manual submit remains blocked during staging');
  } finally {
    app.state.sideAutomationActive = false;
    app.state.observer.disconnect();
    dom.window.close();
  }
});

test('fresh continuation refuses an active side job without changing or sending its composer', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <article data-testid="conversation-turn-0"><div data-message-author-role="user">Original question</div></article>
    <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Latest answer</div></article>
    <form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/separate-side-chat',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const composer = document.querySelector('#prompt-textarea');
  let sends = 0;
  document.querySelector('[data-testid="send-button"]').addEventListener('click', () => { sends += 1; });
  const app = toolkit.createApp(document, dom.window);
  await app.start();
  app.state.incomingJobId = 'active_side_job_1234';

  try {
    const handoffBackdrop = document.querySelector('#cgs-handoff-backdrop');
    document.querySelector('[data-cgs-action="open-handoff"]').click();
    assert.equal(handoffBackdrop.hidden, true, 'the fresh-continuation dialog does not open during a side job');
    assert.equal(composer.value, '');
    assert.equal(sends, 0);

    handoffBackdrop.hidden = false;
    document.querySelector('[data-cgs-action="confirm-fresh-chat"]').click();
    assert.equal(await waitFor(() => handoffBackdrop.hidden, dom.window), true);
    assert.equal(composer.value, '', 'even a stale open dialog cannot insert the handoff prompt');
    assert.equal(sends, 0);
    assert.equal(app.state.freshContinuationPromise, null);
    assert.match(document.querySelector('#cgs-toast').textContent, /finish the separate-chat question/iu);
  } finally {
    app.state.incomingJobId = '';
    app.state.observer.disconnect();
    dom.window.close();
  }
});

test('a native Send during staging is observed and never followed by a duplicate send', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Latest answer</div></article>
    <form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/separate-side-chat',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const turn = document.querySelector('article');
  const composer = document.querySelector('#prompt-textarea');
  const sendButton = document.querySelector('[data-testid="send-button"]');
  let sendCount = 0;
  sendButton.addEventListener('click', () => {
    sendCount += 1;
    composer.value = '';
    const userTurn = document.createElement('article');
    userTurn.dataset.testid = `conversation-turn-${sendCount + 1}`;
    userTurn.innerHTML = '<div data-message-author-role="user">Send only once.</div>';
    document.querySelector('main').insertBefore(userTurn, document.querySelector('form'));
  });
  composer.addEventListener('input', () => {
    if (composer.value === 'Send only once.') dom.window.setTimeout(() => sendButton.click(), 50);
  }, { once: true });

  const app = toolkit.createApp(document, dom.window, { pageInstanceId: 'reloaded_page_1234' });
  await app.start();
  app.state.settings.adaptiveRouting = false;
  const job = toolkit.sanitizeJob({
    createdAt: Date.now(),
    sourceUrl: 'https://chatgpt.com/c/source-chat',
    kind: 'ask',
    locator: toolkit.getTurnLocator(turn, document),
    targetFingerprint: toolkit.assistantTurnFingerprint(turn),
    contextFingerprint: toolkit.conversationContextFingerprint(document, turn),
    question: 'Send only once.',
    autoSend: true,
    branchClickAttempted: true,
    branchConversation: 'separate-side-chat',
    branchReloadFrom: 'source_page_1234',
  });

  assert.equal(await app.runIncomingJob(job), true);
  assert.equal(sendCount, 1);
  assert.equal(job.sendAttempted, true);

  app.state.observer.disconnect();
  dom.window.close();
});

test('unacknowledged Send is never reported complete or clicked twice', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Latest answer</div></article>
    <form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/separate-side-chat',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const turn = document.querySelector('article');
  let sendCount = 0;
  document.querySelector('[data-testid="send-button"]').addEventListener('click', () => {
    sendCount += 1;
  });

  const app = toolkit.createApp(document, dom.window, {
    branchComposerTimeout: 1_000,
    sideSendAckTimeout: 300,
    pageInstanceId: 'reloaded_page_1234',
  });
  await app.start();
  app.state.settings.adaptiveRouting = false;
  const job = toolkit.sanitizeJob({
    createdAt: Date.now(),
    sourceUrl: 'https://chatgpt.com/c/source-chat',
    kind: 'ask',
    locator: toolkit.getTurnLocator(turn, document),
    targetFingerprint: toolkit.assistantTurnFingerprint(turn),
    contextFingerprint: toolkit.conversationContextFingerprint(document, turn),
    question: 'Send exactly once.',
    autoSend: true,
    branchClickAttempted: true,
    branchConversation: 'separate-side-chat',
    branchReloadFrom: 'source_page_1234',
  });

  assert.equal(await app.runIncomingJob(job), false);
  assert.equal(sendCount, 1);
  assert.match(document.querySelector('#cgs-recovery-reason').textContent, /did not show the question as a new message/iu);
  assert.equal(document.querySelector('[data-cgs-action="retry-branch"]').hidden, true);

  assert.equal(await app.runIncomingJob(job), false, 'a direct retry also fails closed after an ambiguous send');
  assert.equal(sendCount, 1);

  app.state.observer.disconnect();
  dom.window.close();
});

test('query-only navigation never inserts or sends a side question in the source chat', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <article data-testid="conversation-turn-1">
      <div data-message-author-role="assistant">Latest answer</div>
      <button id="more" aria-label="More actions" aria-controls="turn-menu">More</button>
    </article>
    <div id="turn-menu" role="menu" hidden><button role="menuitem" id="branch">Branch in new chat</button></div>
    <form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/source-chat?model=high',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const turn = document.querySelector('article');
  const composer = document.querySelector('#prompt-textarea');
  turn.scrollIntoView = () => {};
  document.querySelector('#more').addEventListener('click', () => {
    document.querySelector('#turn-menu').hidden = false;
  });
  document.querySelector('#branch').addEventListener('click', () => {
    dom.window.history.pushState({}, '', '/c/source-chat?model=instant');
    document.querySelector('#turn-menu').hidden = true;
  });
  let sendCount = 0;
  document.querySelector('[data-testid="send-button"]').addEventListener('click', () => {
    sendCount += 1;
  });

  const app = toolkit.createApp(document, dom.window, { branchNavigationTimeout: 300 });
  await app.start();
  const job = toolkit.sanitizeJob({
    createdAt: Date.now(),
    sourceUrl: 'https://chatgpt.com/c/source-chat?model=high',
    kind: 'ask',
    locator: toolkit.getTurnLocator(turn, document),
    targetFingerprint: toolkit.assistantTurnFingerprint(turn),
    question: 'Keep this out of the original chat.',
    autoSend: true,
  });

  assert.equal(await app.runIncomingJob(job), false);
  assert.equal(toolkit.conversationIdentity(dom.window.location.href), 'source-chat');
  assert.equal(composer.value, '');
  assert.equal(sendCount, 0);
  assert.equal(document.querySelector('#cgs-recovery-backdrop').hidden, false);
  assert.match(document.querySelector('#cgs-recovery-reason').textContent, /did not confirm a separate conversation/iu);

  app.state.observer.disconnect();
  dom.window.close();
});

test('retry after an ambiguous Branch click never clicks Branch a second time', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <article data-testid="conversation-turn-1">
      <div data-message-author-role="assistant">Latest answer</div>
      <button id="more" aria-label="More actions" aria-controls="turn-menu">More</button>
    </article>
    <div id="turn-menu" role="menu" hidden><button role="menuitem" id="branch">Branch in new chat</button></div>
    <form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/source-chat',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const turn = document.querySelector('article');
  const composer = document.querySelector('#prompt-textarea');
  turn.scrollIntoView = () => {};
  document.querySelector('#more').addEventListener('click', () => {
    document.querySelector('#turn-menu').hidden = false;
  });
  let branchCount = 0;
  document.querySelector('#branch').addEventListener('click', () => {
    branchCount += 1;
    document.querySelector('#turn-menu').hidden = true;
  });

  const app = toolkit.createApp(document, dom.window, { branchNavigationTimeout: 250 });
  await app.start();
  const job = toolkit.sanitizeJob({
    createdAt: Date.now(),
    sourceUrl: 'https://chatgpt.com/c/source-chat',
    kind: 'ask',
    locator: toolkit.getTurnLocator(turn, document),
    targetFingerprint: toolkit.assistantTurnFingerprint(turn),
    question: 'Do not create duplicate branches.',
    autoSend: true,
  });

  const concurrentResults = await Promise.all([
    app.runIncomingJob(job),
    app.runIncomingJob(job),
  ]);
  assert.deepEqual(concurrentResults, [false, false], 'concurrent retries share one automatic branch attempt');
  assert.equal(await app.runIncomingJob(job), false);
  assert.equal(branchCount, 1);
  assert.equal(composer.value, '');
  assert.match(document.querySelector('#cgs-recovery-reason').textContent, /will not click Branch twice/iu);

  app.state.observer.disconnect();
  dom.window.close();
});

test('route reverting to the source during branch setup aborts before any composer write', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <article data-testid="conversation-turn-1">
      <div data-message-author-role="assistant">Latest answer</div>
      <button id="more" aria-label="More actions" aria-controls="turn-menu">More</button>
    </article>
    <div id="turn-menu" role="menu" hidden><button role="menuitem" id="branch">Branch in new chat</button></div>
    <form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/source-chat',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const turn = document.querySelector('article');
  const composer = document.querySelector('#prompt-textarea');
  turn.scrollIntoView = () => {};
  document.querySelector('#more').addEventListener('click', () => {
    document.querySelector('#turn-menu').hidden = false;
  });
  document.querySelector('#branch').addEventListener('click', () => {
    dom.window.history.pushState({}, '', '/c/temporary-branch');
    document.querySelector('#turn-menu').hidden = true;
    dom.window.setTimeout(() => {
      dom.window.history.pushState({}, '', '/c/source-chat');
    }, 200);
  });
  let sendCount = 0;
  document.querySelector('[data-testid="send-button"]').addEventListener('click', () => {
    sendCount += 1;
  });

  const app = toolkit.createApp(document, dom.window, {
    branchNavigationTimeout: 400,
    branchComposerTimeout: 1_200,
  });
  await app.start();
  const job = toolkit.sanitizeJob({
    createdAt: Date.now(),
    sourceUrl: 'https://chatgpt.com/c/source-chat',
    kind: 'ask',
    locator: toolkit.getTurnLocator(turn, document),
    targetFingerprint: toolkit.assistantTurnFingerprint(turn),
    question: 'Never put this in the source.',
    autoSend: true,
  });

  assert.equal(await app.runIncomingJob(job), false);
  assert.equal(toolkit.conversationIdentity(dom.window.location.href), 'source-chat');
  assert.equal(composer.value, '');
  assert.equal(sendCount, 0);
  assert.match(document.querySelector('#cgs-recovery-reason').textContent, /did not confirm a separate conversation/iu);

  app.state.observer.disconnect();
  dom.window.close();
});

test('a different chat with the wrong inherited response is never used as the side-chat destination', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <article data-testid="conversation-turn-1">
      <div data-message-author-role="assistant" id="answer">Expected answer</div>
    </article>
    <form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/unrelated-chat',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const turn = document.querySelector('article');
  const composer = document.querySelector('#prompt-textarea');
  const fingerprint = toolkit.assistantTurnFingerprint(turn);
  const contextFingerprint = toolkit.conversationContextFingerprint(document, turn);
  document.querySelector('#answer').textContent = 'Unrelated answer';
  let sendCount = 0;
  document.querySelector('[data-testid="send-button"]').addEventListener('click', () => {
    sendCount += 1;
  });

  const app = toolkit.createApp(document, dom.window, {
    branchComposerTimeout: 400,
    pageInstanceId: 'reloaded_page_1234',
  });
  await app.start();
  const job = toolkit.sanitizeJob({
    createdAt: Date.now(),
    sourceUrl: 'https://chatgpt.com/c/source-chat',
    kind: 'ask',
    locator: toolkit.getTurnLocator(turn, document),
    targetFingerprint: fingerprint,
    contextFingerprint,
    question: 'Do not send this to an unrelated chat.',
    autoSend: true,
    branchClickAttempted: true,
    branchConversation: 'unrelated-chat',
    branchReloadFrom: 'source_page_1234',
  });

  assert.equal(await app.runIncomingJob(job), false);
  assert.equal(composer.value, '');
  assert.equal(sendCount, 0);
  assert.match(document.querySelector('#cgs-recovery-reason').textContent, /inherited conversation context could not be verified/iu);

  app.state.observer.disconnect();
  dom.window.close();
});

test('an existing destination draft is preserved and never auto-sent', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <article data-testid="conversation-turn-1">
      <div data-message-author-role="assistant">Latest answer</div>
    </article>
    <form><textarea id="prompt-textarea">Keep my existing draft.</textarea><button type="button" data-testid="send-button">Send</button></form>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/separate-side-chat',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const turn = document.querySelector('article');
  const composer = document.querySelector('#prompt-textarea');
  let sendCount = 0;
  document.querySelector('[data-testid="send-button"]').addEventListener('click', () => {
    sendCount += 1;
  });

  const app = toolkit.createApp(document, dom.window, {
    branchComposerTimeout: 1_000,
    pageInstanceId: 'reloaded_page_1234',
  });
  await app.start();
  const job = toolkit.sanitizeJob({
    createdAt: Date.now(),
    sourceUrl: 'https://chatgpt.com/c/source-chat',
    kind: 'ask',
    locator: toolkit.getTurnLocator(turn, document),
    targetFingerprint: toolkit.assistantTurnFingerprint(turn),
    contextFingerprint: toolkit.conversationContextFingerprint(document, turn),
    question: 'This must not overwrite anything.',
    autoSend: true,
    branchClickAttempted: true,
    branchConversation: 'separate-side-chat',
    branchReloadFrom: 'source_page_1234',
  });

  assert.equal(await app.runIncomingJob(job), false);
  assert.equal(composer.value, 'Keep my existing draft.');
  assert.equal(sendCount, 0);
  assert.match(document.querySelector('#cgs-recovery-reason').textContent, /already has a different draft/iu);
  assert.equal(document.querySelector('[data-cgs-action="retry-branch"]').hidden, true);

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
