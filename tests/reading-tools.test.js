'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const toolkit = require('../chatgpt-workflow-toolkit.user.js');
const storageKey = 'chatgptWorkflowToolkit.bookmarks.v1.https://chatgpt.com.reading-test';
const originalGlobals = new WeakMap();

async function settle(win, predicate) {
  const end = Date.now() + 2000;
  while (!predicate() && Date.now() < end) await new Promise((resolve) => win.setTimeout(resolve, 15));
  assert.ok(predicate(), 'expected UI/storage update');
}

async function setup(t, values = new Map(), options = {}) {
  const dom = new JSDOM(`<!doctype html><main>
    <div id="history" style="overflow-y:auto">
      <article data-testid="conversation-turn-1"><div data-message-author-role="assistant" data-message-id="message-one"><p id="passage">First lab instruction.</p><p>More information.</p></div><div><button data-testid="copy-turn-action-button">Copy</button><button aria-label="More actions">...</button></div></article>
      <article data-testid="conversation-turn-3"><div data-message-author-role="assistant" data-message-id="message-two"><p>Second answer.</p></div><button data-testid="copy-turn-action-button">Copy</button></article>
    </div>
    <button id="native-latest" aria-label="Scroll to bottom">↓</button>
    <form><textarea id="prompt-textarea">Do not change my draft.</textarea><button type="button" data-testid="send-button">Send</button></form>
    </main>`, { url: options.url || 'https://chatgpt.com/c/reading-test', pretendToBeVisual: true });
  const win = dom.window, doc = win.document;
  if (!originalGlobals.has(t)) {
    originalGlobals.set(t, globalThis.GM);
    t.after(() => {
      const previous = originalGlobals.get(t);
      if (previous === undefined) delete globalThis.GM; else globalThis.GM = previous;
    });
  }
  globalThis.GM = {
    async getValue(key, fallback) { if (options.failReads && key.startsWith('chatgptWorkflowToolkit.bookmarks')) throw Error('read unavailable'); return structuredClone(values.get(key) ?? fallback); },
    async setValue(key, value) { if (options.failWrites && key.startsWith('chatgptWorkflowToolkit.bookmarks')) throw Error('storage unavailable'); values.set(key, structuredClone(value)); },
    async deleteValue(key) { values.delete(key); },
  };
  const scroller = doc.querySelector('#history');
  Object.defineProperties(scroller, { scrollHeight: { value: 3000 }, clientHeight: { value: 500 } });
  let scrollTop = 200, growth = 0;
  Object.defineProperty(scroller, 'scrollTop', { get: () => scrollTop, set: (value) => { scrollTop = Math.max(0, Math.min(2500, value)); } });
  const rect = (top, height) => ({ top, bottom: top + height, left: 20, right: 600, width: 580, height });
  scroller.getBoundingClientRect = () => rect(80, 500);
  const turns = [...doc.querySelectorAll('article')];
  turns.forEach((turn, i) => { turn.getBoundingClientRect = () => rect(80 + i * 1200 + growth - scrollTop, 1000); });
  doc.querySelector('#passage').getBoundingClientRect = () => rect(380 + growth - scrollTop, 100);
  let sends = 0;
  doc.querySelector('[data-testid="send-button"]').addEventListener('click', () => { sends += 1; });
  win.open = () => { assert.fail('navigation tools must not open tabs'); };
  const fingerprint = toolkit.conversationContextFingerprint(doc);
  const app = await toolkit.install(doc, win);
  app.processRoot(doc.body);
  await settle(win, () => !app.state.readingTools.state.loading);
  const click = (action) => {
    const target = doc.querySelector(`[data-cgs-action="${action}"]`);
    assert.ok(target, action); target.click(); return target;
  };
  async function save(label = 'Lab instructions') {
    click('reading-add');
    doc.querySelector('#cgs-bookmark-label').value = label;
    click('reading-save');
    await app.state.readingTools.state.writes;
    await settle(win, () => !doc.querySelector('[data-cgs-action="reading-save"]').disabled);
  }
  t.after(() => {
    assert.equal(sends, 0, 'never send a message');
    assert.equal(doc.querySelector('#prompt-textarea').value, 'Do not change my draft.');
    app.state.observer.disconnect(); win.close();
  });
  return { doc, win, app, values, turns, scroller, click, save, fingerprint, grow: (amount) => { growth += amount; } };
}

test('bookmarks save, rename, render labels as text, and remove without changing chat content', async (t) => {
  const { doc, app, values, click, save, fingerprint } = await setup(t);
  await save('<img src=x onerror=alert(1)>');
  assert.equal(values.get(storageKey).length, 1);
  assert.equal(values.get(storageKey)[0].messageId, 'message-one');
  assert.equal(doc.querySelector('#cgs-bookmark-list img'), null);
  click('reading-rename');
  doc.querySelector('#cgs-bookmark-label').value = 'Equations';
  doc.querySelector('#cgs-bookmark-label').dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await app.state.readingTools.state.writes;
  assert.equal(values.get(storageKey)[0].label, 'Equations');
  click('reading-delete');
  await app.state.readingTools.state.writes;
  assert.deepEqual(values.get(storageKey), []);
  assert.equal(toolkit.conversationContextFingerprint(doc), fingerprint, 'injected controls never enter conversation context');
});

test('bookmarks survive a fresh page and do not leak to other chats', async (t) => {
  const first = await setup(t);
  await first.save('Saved before reload');
  const second = await setup(t, first.values);
  second.click('reading-bookmarks');
  assert.match(second.doc.querySelector('#cgs-bookmark-list').textContent, /Saved before reload/u);
  const third = await setup(t, first.values, { url: 'https://chatgpt.com/c/another-chat' });
  third.click('reading-bookmarks');
  assert.equal(third.doc.querySelector('#cgs-bookmark-list').textContent, '');
});

test('highlight is captured before the label field takes focus and jumps to the passage', async (t) => {
  const { doc, win, click, app, values, scroller } = await setup(t);
  const range = doc.createRange(); range.selectNodeContents(doc.querySelector('#passage'));
  win.getSelection().removeAllRanges(); win.getSelection().addRange(range);
  const button = doc.querySelector('[data-cgs-action="reading-add"]');
  button.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true }));
  win.getSelection().removeAllRanges();
  button.click();
  assert.equal(doc.querySelector('#cgs-bookmark-preview').textContent, 'First lab instruction.');
  click('reading-save'); await app.state.readingTools.state.writes;
  assert.equal(values.get(storageKey)[0].quote, 'First lab instruction.');
  scroller.scrollTop = 1800;
  click('reading-jump');
  assert.equal(scroller.scrollTop, 276, 'align saved paragraph 24px below the scroll viewport top');
  assert.equal(doc.querySelector('#cgs-bookmarks-panel').hidden, true);
});

test('jump latest remembers nested scroller position; back compensates for content growth', async (t) => {
  const { doc, scroller, click, grow } = await setup(t);
  click('reading-latest');
  assert.equal(scroller.scrollTop, 2500);
  click('reading-latest'); // Repeated click at bottom must not overwrite the saved spot.
  grow(150);
  click('reading-back');
  assert.equal(scroller.scrollTop, 350);
  assert.equal(doc.querySelector('[data-cgs-action="reading-back"]').hidden, true);
});

test('native jump works once without interception; unrelated controls do not record a place', async (t) => {
  const { doc, scroller, app, click } = await setup(t);
  doc.querySelector('[data-testid="copy-turn-action-button"]').click();
  assert.equal(app.state.readingTools.state.back, null);
  let nativeClicks = 0;
  doc.querySelector('#native-latest').addEventListener('click', (event) => { assert.equal(event.defaultPrevented, false); nativeClicks++; scroller.scrollTop = 2500; });
  doc.querySelector('#native-latest').click();
  assert.equal(nativeClicks, 1);
  click('reading-back');
  assert.equal(scroller.scrollTop, 200);
});

test('missing or ambiguous answers never jump to a positional substitute', async (t) => {
  const { doc, turns, scroller, click, save } = await setup(t);
  await save();
  turns[0].remove(); scroller.scrollTop = 1200;
  click('reading-jump');
  assert.equal(scroller.scrollTop, 1200);
  assert.match(doc.querySelector('#cgs-toast').textContent, /not loaded or has changed/u);
  const anchor = toolkit.readingAnchor(turns[1]); anchor.messageId = '';
  turns[1].after(turns[1].cloneNode(true));
  assert.equal(toolkit.locateReadingAnchor(doc, anchor), null);
});

test('switching chats discards pending editor and return spot before a stale action can run', async (t) => {
  const { doc, win, app, values, click, scroller } = await setup(t);
  click('reading-latest'); click('reading-add');
  win.history.pushState({}, '', '/c/new-chat');
  click('reading-save');
  await app.state.readingTools.syncRoute();
  assert.equal(app.state.readingTools.state.back, null);
  assert.equal(app.state.readingTools.state.pending, null);
  assert.equal(values.has(storageKey), false);
  assert.equal(scroller.scrollTop, 2500);
  assert.equal(doc.querySelector('#cgs-bookmarks-panel').hidden, true);
});

test('both settings turn off independently without deleting saved bookmarks or existing side-chat controls', async (t) => {
  const { doc, win, app, values, click, save } = await setup(t);
  await save(); click('reading-latest');
  for (const key of ['bookmarks', 'returnToReading']) {
    const input = doc.querySelector(`[data-cgs-setting="${key}"]`); input.checked = false;
    input.dispatchEvent(new win.Event('change', { bubbles: true }));
  }
  assert.equal(doc.querySelector('.cgs-bookmark-action'), null);
  assert.ok(doc.querySelector('.cgs-turn-action'));
  assert.equal(app.state.readingTools.state.back, null);
  assert.equal(values.get(storageKey).length, 1);
  const input = doc.querySelector('[data-cgs-setting="bookmarks"]'); input.checked = true;
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.equal(doc.querySelectorAll('.cgs-bookmark-action').length, 2);
  app.processRoot(doc.body); app.processRoot(doc.body);
  assert.equal(doc.querySelectorAll('.cgs-bookmark-action').length, 2, 'no duplicates after rescans');
});

test('storage failure is reported and does not pretend a bookmark was saved', async (t) => {
  const { doc, values, save } = await setup(t, new Map(), { failWrites: true });
  await save();
  assert.equal(values.has(storageKey), false);
  assert.match(doc.querySelector('#cgs-toast').textContent, /Could not save bookmarks/u);
  assert.equal(doc.querySelector('#cgs-bookmark-editor').hidden, false);
});

test('failed reads cannot overwrite existing saved bookmarks with an empty list', async (t) => {
  const existing = [{ id: 'bookmark_existing_1234', label: 'Keep me', messageId: 'message-one' }];
  const values = new Map([[storageKey, existing]]);
  const { doc, save } = await setup(t, values, { failReads: true });
  await save('Must not overwrite');
  assert.deepEqual(values.get(storageKey), existing);
  assert.match(doc.querySelector('#cgs-bookmark-status').textContent, /Could not load bookmarks/u);
});

test('sanitization limits persisted data and rejects duplicate/invalid entries', () => {
  const item = { id: 'bookmark_id_12345', messageId: 'abc', label: 'x'.repeat(200), quote: 'y'.repeat(3000) };
  const result = toolkit.sanitizeBookmarks([null, {}, item, item]);
  assert.equal(result.length, 1); assert.equal(result[0].label.length, 80); assert.equal(result[0].quote.length, 2000);
  assert.equal(toolkit.sanitizeBookmarks('invalid').length, 0);
});

test('bookmark lookup follows message identity after turn indexes change', async (t) => {
  const { doc, turns } = await setup(t);
  const anchor = toolkit.readingAnchor(turns[0]);
  turns[0].dataset.testid = 'conversation-turn-999';
  turns[1].after(turns[0]);
  assert.equal(toolkit.locateReadingAnchor(doc, anchor), turns[0]);
});

test('a different message with identical text cannot impersonate a missing bookmarked ID', async (t) => {
  const { doc, turns } = await setup(t);
  const anchor = toolkit.readingAnchor(turns[0]);
  turns[0].querySelector('[data-message-id]').dataset.messageId = 'different-message';
  assert.equal(toolkit.locateReadingAnchor(doc, anchor), null);
});

test('return fails safely if its saved answer is no longer mounted', async (t) => {
  const { doc, turns, scroller, click } = await setup(t);
  click('reading-latest'); turns[0].remove();
  click('reading-back');
  assert.equal(scroller.scrollTop, 2500);
  assert.match(doc.querySelector('#cgs-toast').textContent, /earlier spot is not loaded/u);
});

test('a later jump records the new reading position instead of keeping an obsolete one', async (t) => {
  const { scroller, click } = await setup(t);
  click('reading-latest'); scroller.scrollTop = 1400;
  click('reading-latest'); click('reading-back');
  assert.equal(scroller.scrollTop, 1400);
});

test('window scrolling is supported when no nested scroll container is present', async (t) => {
  const { doc, turns, scroller, click } = await setup(t);
  scroller.style.overflowY = 'visible';
  const root = doc.documentElement;
  Object.defineProperties(root, { scrollHeight: { value: 3000 }, clientHeight: { value: 500 } });
  root.scrollTop = 200;
  turns[0].getBoundingClientRect = () => ({ top: -root.scrollTop, bottom: 1000 - root.scrollTop, height: 1000 });
  click('reading-latest'); assert.equal(root.scrollTop, 3000);
  click('reading-back'); assert.equal(root.scrollTop, 200);
});

test('disabling Ask buttons leaves bookmarks working independently', async (t) => {
  const { doc, win, app, save, values } = await setup(t);
  const input = doc.querySelector('[data-cgs-setting="showTurnButtons"]'); input.checked = false;
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.equal(doc.querySelector('.cgs-turn-action'), null);
  await save();
  assert.equal(values.get(storageKey).length, 1);
  app.processRoot(doc.body);
  assert.equal(doc.querySelectorAll('.cgs-bookmark-action').length, 2);
});

test('bookmarks are unavailable on unsaved or shared chats', async (t) => {
  for (const url of ['https://chatgpt.com/', 'https://chatgpt.com/share/example']) {
    const { doc, click, values } = await setup(t, new Map(), { url });
    assert.equal(doc.querySelector('.cgs-bookmark-action'), null);
    assert.equal(doc.querySelector('[data-cgs-action="reading-bookmarks"]').hidden, true);
    click('reading-bookmarks');
    assert.equal(doc.querySelector('#cgs-bookmarks-panel').hidden, true);
    assert.equal(values.has(storageKey), false);
  }
});

test('old async bookmark loads cannot replace a different chat’s list', async (t) => {
  const { doc, win, app, click } = await setup(t);
  const originalGet = globalThis.GM.getValue;
  let release;
  globalThis.GM.getValue = (key, fallback) => key.endsWith('.slow-chat')
    ? new Promise((resolve) => { release = resolve; }) : originalGet(key, fallback);
  win.history.pushState({}, '', '/c/slow-chat');
  const slow = app.state.readingTools.syncRoute();
  win.history.pushState({}, '', '/c/empty-chat');
  await app.state.readingTools.syncRoute();
  release([{ id: 'bookmark_old_12345', label: 'Wrong chat bookmark', messageId: 'message-one' }]);
  await slow; click('reading-bookmarks');
  assert.equal(doc.querySelector('#cgs-bookmark-list').textContent, '');
});

test('a slow stale list read cannot hide a bookmark saved in the meantime', async (t) => {
  const { win, app, click, save } = await setup(t);
  const originalGet = globalThis.GM.getValue;
  let release;
  globalThis.GM.getValue = (key, fallback) => {
    if (key === storageKey && !release) return new Promise((resolve) => { release = resolve; });
    return originalGet(key, fallback);
  };
  click('reading-bookmarks');
  await save('Fresh bookmark');
  release([]);
  await new Promise((resolve) => win.setTimeout(resolve, 10));
  assert.equal(app.state.readingTools.state.bookmarks[0].label, 'Fresh bookmark');
});

test('bookmark capacity is bounded without discarding existing entries', async (t) => {
  const values = new Map([[storageKey, Array.from({ length: 100 }, (_, i) => ({ id: `bookmark_12345_${i}`, label: `Saved ${i}`, messageId: `message-${i}` }))]]);
  const { doc, save } = await setup(t, values);
  await save('Over limit');
  assert.equal(values.get(storageKey).length, 100);
  assert.match(doc.querySelector('#cgs-toast').textContent, /already has 100 bookmarks/u);
});

test('Web Locks guard saved-list updates when available', async (t) => {
  const { win, save, values } = await setup(t);
  const locks = [];
  Object.defineProperty(win.navigator, 'locks', { value: { async request(name, options, callback) {
    locks.push([name, options.mode]); return callback({});
  } } });
  await save('One'); await save('Two');
  assert.deepEqual(locks, [[`${storageKey}.lock`, 'exclusive'], [`${storageKey}.lock`, 'exclusive']]);
  assert.equal(values.get(storageKey).length, 2);
});
