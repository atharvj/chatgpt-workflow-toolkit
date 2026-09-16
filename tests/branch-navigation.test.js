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

test('persisted branch destination cannot change origin or mismatch the saved branch', () => {
  const base = { createdAt: Date.now(), kind: 'ask', sourceUrl: 'https://chatgpt.com/c/source', branchConversation: 'new' };
  assert.equal(toolkit.sanitizeJob({ ...base, branchDestinationUrl: '/c/new' }).branchDestinationUrl, 'https://chatgpt.com/c/new');
  for (const branchDestinationUrl of ['https://evil.test/c/new', '/c/wrong', '/c/source']) {
    assert.equal(toolkit.sanitizeJob({ ...base, branchDestinationUrl }).branchDestinationUrl, '');
  }
});
