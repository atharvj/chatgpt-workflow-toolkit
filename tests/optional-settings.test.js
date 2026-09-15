'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const toolkit = require('../chatgpt-workflow-toolkit.user.js');

async function waitFor(win, predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => win.setTimeout(resolve, 20));
  assert.ok(predicate());
}

async function setup(t) {
  const dom = new JSDOM(`<!doctype html><body><main>
    <article data-testid="conversation-turn-0"><div data-message-author-role="assistant"><span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span id="math-text">x2</span></span></span></div><button data-testid="copy-turn-action-button">Copy</button></article>
    <button id="share-highlighted">Share highlighted</button>
    <button id="start-writing">Start writing</button>
    <form><textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button></form>
  </main></body>`, { url: 'https://chatgpt.com/c/settings-test', pretendToBeVisual: true });
  const values = new Map();
  const previousGM = globalThis.GM;
  globalThis.GM = {
    async getValue(key, fallback) { return values.get(key) ?? fallback; },
    async setValue(key, value) { values.set(key, structuredClone(value)); },
    async deleteValue(key) { values.delete(key); },
  };
  const app = await toolkit.install(dom.window.document, dom.window);
  t.after(() => {
    app.state.observer.disconnect();
    dom.window.close();
    if (previousGM === undefined) delete globalThis.GM;
    else globalThis.GM = previousGM;
  });
  const doc = dom.window.document;
  app.processRoot(doc.body);
  async function set(key, checked) {
    const input = doc.querySelector(`[data-cgs-setting="${key}"]`);
    assert.ok(input, key);
    input.checked = checked;
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await waitFor(dom.window, () => values.get('chatgptSidecar.settings.v1')?.[key] === checked);
  }
  async function highlight() {
    // Let the previous dialog's deferred focus settle before simulating a new drag.
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    const node = doc.querySelector('#math-text');
    const range = doc.createRange();
    range.setStart(node.firstChild, 0);
    range.setEnd(node.firstChild, 1);
    range.getBoundingClientRect = () => ({ left: 50, top: 50, right: 100, bottom: 80, width: 50, height: 30 });
    const selection = dom.window.getSelection();
    selection.removeAllRanges(); selection.addRange(range);
    node.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true }));
    await new Promise((resolve) => dom.window.requestAnimationFrame(resolve));
    return doc.querySelector('#cgs-selection-pill');
  }
  return { dom, doc, app, values, set, highlight };
}

test('every public setting is exposed; hidden native controls can be restored and hidden again', async (t) => {
  const { dom, doc, app, values, set } = await setup(t);
  for (const key of Object.keys(toolkit.DEFAULT_SETTINGS)) assert.ok(doc.querySelector(`[data-cgs-setting="${key}"]`), key);
  const share = doc.querySelector('#share-highlighted');
  const start = doc.querySelector('#start-writing');
  assert.equal(dom.window.getComputedStyle(share).display, 'none');
  assert.equal(dom.window.getComputedStyle(start).display, 'none');
  await set('hideShareHighlighted', false);
  await set('hideStartWriting', false);
  app.processRoot(doc.body);
  assert.notEqual(dom.window.getComputedStyle(share).display, 'none');
  assert.notEqual(dom.window.getComputedStyle(start).display, 'none');
  share.textContent = 'Share highlighted';
  app.processRoot(share);
  assert.notEqual(dom.window.getComputedStyle(share).display, 'none', 'later scans respect the restored preference');
  const restored = toolkit.sanitizeSettings(structuredClone(values.get('chatgptSidecar.settings.v1')));
  assert.equal(restored.hideShareHighlighted, false);
  assert.equal(restored.hideStartWriting, false);
  await set('hideShareHighlighted', true);
  await set('hideStartWriting', true);
  await waitFor(dom.window, () => share.classList.contains('cgs-hidden-share-highlighted') && start.classList.contains('cgs-hidden-start-writing'));
});

test('math copying remains enabled without math settings or extra notes', async (t) => {
  const { doc, highlight } = await setup(t);
  (await highlight()).click();
  const preview = doc.querySelector('#cgs-selected-context');
  const draft = doc.querySelector('#cgs-question');
  draft.value = 'Why?';
  assert.equal(doc.querySelector('#cgs-selection-note'), null);
  assert.equal(doc.querySelector('[data-cgs-setting="showMathNotices"]'), null);
  assert.equal(doc.querySelector('[data-cgs-setting="preserveMathFormatting"]'), null);
  assert.equal(preview.textContent, String.raw`\(x^2\)`);
  assert.equal(draft.value, 'Why?');
});

test('a fresh page restores saved preferences and reflects them in the settings controls', async (t) => {
  const { set, values } = await setup(t);
  await set('hideShareHighlighted', false);
  await set('hideStartWriting', false);
  await set('showTurnButtons', false);
  await set('showSelectionButton', true);
  const saved = structuredClone(values.get('chatgptSidecar.settings.v1'));
  values.set('chatgptSidecar.settings.v1', { ...saved, preserveMathFormatting: false, showMathNotices: true });
  const fresh = new JSDOM('<!doctype html><body><button id="share">Share highlighted</button><button id="start">Start writing</button></body>', {
    url: 'https://chatgpt.com/c/after-reload', pretendToBeVisual: true,
  });
  const app = await toolkit.install(fresh.window.document, fresh.window);
  t.after(() => { app.state.observer.disconnect(); fresh.window.close(); });
  app.processRoot(fresh.window.document.body);
  assert.deepEqual(app.state.settings, saved);
  for (const [key, value] of Object.entries(saved)) {
    const input = fresh.window.document.querySelector(`[data-cgs-setting="${key}"]`);
    assert.equal(input.type === 'checkbox' ? input.checked : input.value, value, key);
  }
  assert.notEqual(fresh.window.getComputedStyle(fresh.window.document.querySelector('#share')).display, 'none');
  assert.notEqual(fresh.window.getComputedStyle(fresh.window.document.querySelector('#start')).display, 'none');
});

test('response and highlight buttons are independent while math copying stays enabled', async (t) => {
  const { doc, app, set, highlight } = await setup(t);
  await set('showTurnButtons', false);
  assert.equal(doc.querySelector('.cgs-turn-action'), null);
  const pill = await highlight();
  assert.equal(pill.hidden, false);
  pill.click();
  const preview = doc.querySelector('#cgs-selected-context');
  assert.equal(preview.textContent, String.raw`\(x^2\)`);
  doc.querySelector('[data-cgs-action="cancel-question"]').click();
  await set('showTurnButtons', true);
  app.processRoot(doc.body);
  await set('showSelectionButton', false);
  assert.ok(doc.querySelector('.cgs-turn-action'));
  assert.equal((await highlight()).hidden, true);
  await set('showSelectionButton', true);
  (await highlight()).click();
  assert.equal(preview.textContent, String.raw`\(x^2\)`);
});
