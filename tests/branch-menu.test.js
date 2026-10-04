'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const toolkit = require('../chatgpt-workflow-toolkit.user.js');
const userscriptWindow = require('./helpers/userscript-window');

for (const mode of [
  'pointer', 'click', 'remount', 'closed', 'missing-branch', 'route-change', 'history-change',
  'sandbox-pointer', 'sandbox-mouse', 'constructor-error', 'dispatch-error', 'pointerup-error',
]) {
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
    const scriptWindow = mode.startsWith('sandbox-') ? userscriptWindow(win) : win;
    if (mode === 'sandbox-mouse') scriptWindow.PointerEvent = undefined;
    if (mode === 'constructor-error') {
      const Pointer = win.PointerEvent;
      scriptWindow.PointerEvent = function (type, init) {
        if (type === 'pointerup') throw new TypeError('Private conversation details');
        return new Pointer(type, init);
      };
    }
    if (mode === 'dispatch-error' || mode === 'pointerup-error') {
      const dispatch = more.dispatchEvent.bind(more);
      more.dispatchEvent = (event) => {
        if (event.type === (mode === 'dispatch-error' ? 'pointerdown' : 'pointerup')) {
          throw new Error('Private conversation details');
        }
        return dispatch(event);
      };
    }
    if (mode.startsWith('sandbox-')) {
      const Pointer = scriptWindow.PointerEvent || scriptWindow.MouseEvent;
      assert.throws(() => new Pointer('pointerdown', { view: scriptWindow }), /Window/u,
        'fixture reproduces the old sandbox view type error without a mocked constructor');
    }
    let hovers = 0;
    turn.addEventListener('pointerover', () => { hovers++; });
    const app = toolkit.createApp(doc, scriptWindow, { pageWindow: win, branchActionTimeout: 100, branchNavigationTimeout: 600 });
    t.after(() => { app.state.observer?.disconnect(); win.close(); });
    await app.start();
    // The URL cleaner is permanent; only the temporary Branch hook is removed.
    const originalOpen = win.open;
    const scriptOpen = scriptWindow.open;
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
    assert.equal(scriptWindow.open, scriptOpen, 'restore userscript window as well as page window');
    assert.equal(clicks, 1);
    assert.equal(sends, 0, 'never send into the source page or unverified destination');
    assert.equal(doc.querySelector('#prompt-textarea').value, 'My existing draft');
    const reason = doc.querySelector('#cgs-recovery-reason').textContent;
    const succeeds = ['pointer', 'click', 'remount', 'sandbox-pointer', 'sandbox-mouse'].includes(mode);
    assert.equal(branches, succeeds ? 1 : 0, reason);
    assert.equal(pointers, ['pointer', 'remount', 'closed', 'sandbox-pointer', 'sandbox-mouse', 'pointerup-error'].includes(mode) ? 1 : 0);
    assert.ok(hovers > 0, 'hover events must also work through the userscript global');
    if (succeeds) assert.equal(win.location.pathname, '/c/new-branch');
    else {
      assert.equal(app.state.branchClickAttempted, false, 'safe retry remains available when Branch was never clicked');
      if (mode === 'closed') assert.match(reason, /three-dot menu did not open/u);
      if (mode === 'missing-branch') assert.match(reason, /menu opened, but .* could not identify/u);
      if (mode.endsWith('-change')) assert.match(reason, /could not re-verify the source chat/u);
      if (mode === 'route-change') assert.match(reason, /conversation changed/u);
      if (mode === 'history-change') assert.match(reason, /response display differs \(no native message ID\)/u);
      if (mode.endsWith('-error')) {
        assert.ok(reason.includes(`Details (v${toolkit.VERSION}):`));
        assert.doesNotMatch(reason, /Private conversation details/u);
        if (mode === 'constructor-error') assert.match(reason, /constructing pointer events; TypeError/u);
        if (mode === 'dispatch-error') assert.match(reason, /dispatching pointerdown; event error/u);
        if (mode === 'pointerup-error') assert.match(reason, /dispatching pointerup; event error/u);
      }
    }
  });
}
