'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const toolkit = require('../chatgpt-workflow-toolkit.user.js');

test('branch URLs must be a different conversation on the same trusted origin', () => {
  const source = 'https://chatgpt.com/c/source';
  for (const url of ['', 'about:blank', 'javascript:alert(1)', '/c/source', '/c/source?q=other', '/share/other',
    'https://example.com/c/other', 'https://chat.openai.com/c/other', 'https://user:password@chatgpt.com/c/other']) {
    assert.equal(toolkit.validatedBranchUrl(url, source), '', url);
  }
  assert.equal(toolkit.validatedBranchUrl('/c/new#old', source), 'https://chatgpt.com/c/new');
  assert.equal(toolkit.validatedBranchUrl('/g/custom/c/new', source), 'https://chatgpt.com/g/custom/c/new');
});

test('capture only runs after Branch, catches the page realm, and restores both open functions', (t) => {
  const dom = new JSDOM('', { url: 'https://chatgpt.com/c/source' });
  t.after(() => dom.window.close());
  const calls = [];
  const originalOpen = function (...args) { calls.push({ receiver: this, args }); return null; };
  const page = { open: originalOpen };
  dom.window.open = originalOpen;
  const capture = toolkit.captureBranchNavigation(dom.window.document, dom.window, page, dom.window.location.href);
  page.open('/c/before', '_blank');
  assert.equal(capture.getDestination(), '');
  capture.arm();
  page.open('https://example.com/c/other', '_blank');
  page.open('/c/source', '_blank');
  assert.equal(capture.getDestination(), '');
  assert.equal(page.open('/c/new', '_blank', 'noopener'), dom.window);
  assert.equal(capture.getDestination(), 'https://chatgpt.com/c/new');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].receiver, page);
  capture.dispose();
  assert.equal(page.open, originalOpen);
  assert.equal(dom.window.open, originalOpen);
});

test('capture stops after source navigation and does not overwrite another window hook', (t) => {
  const dom = new JSDOM('', { url: 'https://chatgpt.com/c/source' });
  t.after(() => dom.window.close());
  let normalCalls = 0;
  dom.window.open = () => { normalCalls += 1; };
  const capture = toolkit.captureBranchNavigation(dom.window.document, dom.window, dom.window, dom.window.location.href);
  capture.arm();
  dom.window.history.pushState({}, '', '/c/unrelated');
  dom.window.open('/c/new', '_blank');
  assert.equal(normalCalls, 1);
  assert.equal(capture.getDestination(), '');
  const replacement = () => {};
  dom.window.open = replacement;
  capture.dispose();
  assert.equal(dom.window.open, replacement);
});

for (const blank of ['', 'about:blank', undefined]) {
  test(`Branch can reserve a blank window (${String(blank)}) before assigning its URL`, (t) => {
    const dom = new JSDOM('', { url: 'https://chatgpt.com/c/source' });
    t.after(() => dom.window.close());
    let popups = 0;
    const page = { open() { popups += 1; return null; } };
    const original = page.open;
    const capture = toolkit.captureBranchNavigation(dom.window.document, dom.window, page, dom.window.location.href);
    t.after(() => capture.dispose());
    capture.arm();
    const pending = page.open(blank, '_blank');
    assert.ok(pending, 'a blocked blank-window allocation must not abort the native branch action');
    assert.equal(popups, 0);
    assert.equal(capture.getDestination(), '', 'a blank window is not evidence of a branch');
    pending.opener = null;
    pending.focus();
    pending.location.href = '/c/created-branch';
    assert.equal(capture.getDestination(), 'https://chatgpt.com/c/created-branch');
    assert.equal(dom.window.location.pathname, '/c/source', 'save the job before navigating');
    capture.dispose();
    assert.equal(page.open, original);
  });
}

test('native branch links targeting a new tab reuse the captured destination', (t) => {
  const dom = new JSDOM('<a href="/c/new" target="_blank">Branch in new chat</a>', { url: 'https://chatgpt.com/c/source' });
  t.after(() => dom.window.close());
  const capture = toolkit.captureBranchNavigation(dom.window.document, dom.window, dom.window, dom.window.location.href);
  capture.arm();
  const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
  dom.window.document.querySelector('a').dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(capture.getDestination(), 'https://chatgpt.com/c/new');
  capture.dispose();
});

for (const assignment of ['location', 'href', 'assign', 'replace']) {
  test(`reserved branch window supports ${assignment} and leaves the active document alone`, (t) => {
    const dom = new JSDOM('<p id="original">Keep this answer</p>', { url: 'https://chatgpt.com/c/source' });
    t.after(() => dom.window.close());
    const page = { open() { assert.fail('do not request another browser popup'); } };
    const capture = toolkit.captureBranchNavigation(dom.window.document, dom.window, page, dom.window.location.href);
    t.after(() => capture.dispose());
    capture.arm();
    const pending = page.open('about:blank', '_blank');
    pending.document.write('<p>Preparing branch</p>');
    assert.equal(dom.window.document.querySelector('#original').textContent, 'Keep this answer');
    assert.equal(pending.closed, false);
    if (assignment === 'location') pending.location = '/c/new';
    else if (assignment === 'href') pending.location.href = '/c/new';
    else pending.location[assignment]('/c/new');
    assert.equal(String(pending.location), 'https://chatgpt.com/c/new');
    assert.equal(capture.getDestination(), 'https://chatgpt.com/c/new');
    assert.equal(dom.window.location.pathname, '/c/source');
  });
}

test('reserved branch windows reject unrelated URLs and late writes after disposal or closure', (t) => {
  const dom = new JSDOM('', { url: 'https://chatgpt.com/c/source' });
  t.after(() => dom.window.close());
  const capture = toolkit.captureBranchNavigation(dom.window.document, dom.window, dom.window, dom.window.location.href);
  capture.arm();
  const pending = dom.window.open('', '_blank');
  for (const value of ['https://evil.test/c/new', '/c/source', 'javascript:alert(1)', '/share/new']) {
    pending.location = value;
    assert.equal(capture.getDestination(), '');
  }
  capture.dispose();
  pending.location = '/c/too-late';
  assert.equal(capture.getDestination(), '');
  assert.equal(pending.closed, true);
  const next = toolkit.captureBranchNavigation(dom.window.document, dom.window, dom.window, dom.window.location.href);
  next.arm();
  const closed = dom.window.open('', '_blank');
  closed.close();
  closed.location.href = '/c/closed';
  assert.equal(next.getDestination(), '');
  next.dispose();
  assert.equal(dom.window.location.pathname, '/c/source');
});

test('failure diagnostics distinguish missing page access from an unresolved blank window without leaking content', (t) => {
  const dom = new JSDOM('<div role="menu"><button>Branch in new chat</button></div>', { url: 'https://chatgpt.com/c/private-source-id' });
  t.after(() => dom.window.close());
  const page = {};
  Object.defineProperty(page, 'open', { value: () => null, writable: false });
  const capture = toolkit.captureBranchNavigation(dom.window.document, dom.window, page, dom.window.location.href);
  t.after(() => capture.dispose());
  capture.arm(dom.window.document.querySelector('button'));
  assert.match(capture.describe(), /page hook unavailable/u);
  dom.window.open('', '_blank');
  assert.match(capture.describe(), /window requests 1; blank requests 1; branch menu still open/u);
  dom.window.document.querySelector('[role="menu"]').hidden = true;
  assert.match(capture.describe(), /branch menu closed/u);
  assert.doesNotMatch(capture.describe(), /private-source-id|chatgpt.com|Branch in new chat/u);
});

test('persisted branch destination cannot change origin or mismatch the saved branch', () => {
  const base = { createdAt: Date.now(), kind: 'ask', sourceUrl: 'https://chatgpt.com/c/source', branchConversation: 'new' };
  assert.equal(toolkit.sanitizeJob({ ...base, branchDestinationUrl: '/c/new' }).branchDestinationUrl, 'https://chatgpt.com/c/new');
  for (const branchDestinationUrl of ['https://evil.test/c/new', '/c/wrong', '/c/source']) {
    assert.equal(toolkit.sanitizeJob({ ...base, branchDestinationUrl }).branchDestinationUrl, '');
  }
});
