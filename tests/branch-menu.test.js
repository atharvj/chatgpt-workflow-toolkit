'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const toolkit = require('../chatgpt-workflow-toolkit.user.js');

for (const mode of ['pointer', 'click', 'remount', 'closed', 'missing-branch', 'route-change', 'history-change']) {
  test(`native response menu: ${mode}`, async (t) => {
    const dom = new JSDOM(`<!doctype html><html><body><main>
      <article data-testid="conversation-turn-0"><div data-message-author-role="user">Original question</div></article>
      <article data-testid="conversation-turn-1" id="turn">
        <div data-message-author-role="assistant">Original answer</div>
        <div><button aria-label="Copy response"></button><button aria-label="Bad response"></button>
          <button id="more" aria-haspopup="menu" aria-expanded="false" data-state="closed" aria-controls="menu"><svg></svg></button>
        </div>
      </article>
      <div id="menu" role="menu" data-state="closed" aria-labelledby="more"><button role="menuitem" id="branch">Branch in new chat</button></div>
      <form><textarea id="prompt-textarea">My existing draft</textarea><button type="button" data-testid="send-button">Send</button></form>
    </main></body></html>`, { url: 'https://chatgpt.com/c/source-chat', pretendToBeVisual: true });
    const win = dom.window;
    const originalOpen = win.open;
    const doc = win.document;
    const turn = doc.querySelector('#turn');
    const menu = doc.querySelector('#menu');
    turn.scrollIntoView = () => {};
    let pointers = 0;
    let clicks = 0;
    let branches = 0;
    let sends = 0;
    const open = (trigger) => {
      trigger.dataset.state = 'open';
      trigger.setAttribute('aria-expanded', 'true');
      menu.dataset.state = 'open';
    };
    const onPointer = (event) => {
      pointers += 1;
      assert.equal(event.button, 0);
      assert.equal(event.ctrlKey, false);
      if (mode !== 'closed') open(event.currentTarget);
    };
    const more = doc.querySelector('#more');
    more.addEventListener('pointerdown', onPointer);
    more.addEventListener('click', () => {
      clicks += 1;
      if (mode === 'click' || mode === 'missing-branch') open(more);
      if (mode === 'remount') {
        const replacement = more.cloneNode(true);
        replacement.addEventListener('pointerdown', onPointer);
        more.replaceWith(replacement);
      }
      if (mode === 'route-change') win.history.pushState({}, '', '/c/unrelated');
      if (mode === 'history-change') turn.querySelector('[data-message-author-role]').textContent = 'An edited answer';
    });
    if (mode === 'missing-branch') doc.querySelector('#branch').textContent = 'Report';
    doc.querySelector('#branch').addEventListener('click', () => {
      branches += 1;
      win.history.pushState({}, '', '/c/new-branch');
    });
    doc.querySelector('[data-testid="send-button"]').addEventListener('click', () => { sends += 1; });
    const app = toolkit.createApp(doc, win, { branchActionTimeout: 100, branchNavigationTimeout: 600 });
    t.after(() => { app.state.observer?.disconnect(); win.close(); });
    await app.start();
    const job = toolkit.sanitizeJob({
      createdAt: Date.now(), sourceUrl: win.location.href, kind: 'ask', autoSend: true,
      locator: toolkit.getTurnLocator(turn, doc),
      targetFingerprint: toolkit.assistantTurnFingerprint(turn),
      contextFingerprint: toolkit.conversationContextFingerprint(doc, turn),
      question: toolkit.buildSelectedQuestion('Original answer', 'Explain this part.'),
    });
    // No transfer ID: stop after the branch route, before destination reload/send.
    assert.equal(await app.runIncomingJob(job), false);
    assert.equal(win.open, originalOpen, 'restore popup behavior on success, timeout, and source changes');
    assert.equal(clicks, 1);
    assert.equal(sends, 0, 'never send into the source page or unverified destination');
    assert.equal(doc.querySelector('#prompt-textarea').value, 'My existing draft');
    const succeeds = ['pointer', 'click', 'remount'].includes(mode);
    assert.equal(branches, succeeds ? 1 : 0);
    assert.equal(pointers, ['pointer', 'remount', 'closed'].includes(mode) ? 1 : 0);
    const reason = doc.querySelector('#cgs-recovery-reason').textContent;
    if (succeeds) assert.equal(win.location.pathname, '/c/new-branch');
    else {
      assert.equal(app.state.branchClickAttempted, false, 'safe retry remains available when Branch was never clicked');
      if (mode === 'closed') assert.match(reason, /three-dot menu did not open/u);
      if (mode === 'missing-branch') assert.match(reason, /menu opened, but .* could not identify/u);
      if (mode.endsWith('-change')) assert.match(reason, /source chat changed/u);
    }
  });
}
