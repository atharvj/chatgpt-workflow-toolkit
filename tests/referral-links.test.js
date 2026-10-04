'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const toolkit = require('../chatgpt-workflow-toolkit.user.js');

test('referral cleaner removes only ChatGPT source parameters without reencoding the URL', () => {
  const base = 'https://chatgpt.com/c/test';
  for (const [before, after] of [
    ['https://example.com/?utm_source=chatgpt.com', 'https://example.com/'],
    ['https://example.com/?utm_source=chatgpt.com#section', 'https://example.com/#section'],
    ['https://example.com/?q=a%20b~&utm_source=chatgpt.com&x=1&x=2#part?foo', 'https://example.com/?q=a%20b~&x=1&x=2#part?foo'],
    ['https://example.com/?x=%2f&utm_source=chatgpt.com', 'https://example.com/?x=%2f'],
    ['https://example.com/?utm_source=other&utm_source=chatgpt.com&utm_source=chatgpt.com&utm_campaign=a+b', 'https://example.com/?utm_source=other&utm_campaign=a+b'],
    ['//example.com/?%75tm_source=chatgpt%2Ecom&x=+', '//example.com/?x=+'],
    ['http://example.com/?utm_source=CHATGPT.COM', 'http://example.com/'],
  ]) assert.equal(toolkit.cleanChatGPTReferralUrl(before, base), after, before);
});

test('referral cleaner leaves internal links, other sources, fragments and non-web URLs alone', () => {
  for (const href of [
    'https://example.com/?utm_source=other',
    'https://example.com/?utm_source=chatgpt.com.evil',
    'https://example.com/#?utm_source=chatgpt.com',
    'https://example.com/?next=https%3A%2F%2Fother.com%2F%3Futm_source%3Dchatgpt.com',
    'https://chatgpt.com/c/test?utm_source=chatgpt.com',
    'https://chat.openai.com/c/test?utm_source=chatgpt.com',
    '/branch/test/id?utm_source=chatgpt.com',
    'mailto:test@example.com?utm_source=chatgpt.com',
    'javascript:void(0)?utm_source=chatgpt.com',
    'https://[invalid/?utm_source=chatgpt.com',
    '',
  ]) assert.equal(toolkit.cleanChatGPTReferralUrl(href, 'https://chatgpt.com/c/test'), href);
});

test('DOM cleaning preserves link text and behavior, leaves drafts alone and is idempotent', (t) => {
  const dom = new JSDOM(`<body>
    <a id="link" target="_blank" rel="noopener" href="https://example.com/?utm_source=chatgpt.com"><span>Source</span></a>
    <div contenteditable="true"><a id="draft" href="https://example.com/?utm_source=chatgpt.com">Draft</a></div>
    <p>https://example.com/?utm_source=chatgpt.com</p>
  </body>`, { url: 'https://chatgpt.com/c/test' });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  assert.equal(toolkit.cleanReferralLinks(doc), 1);
  assert.equal(toolkit.cleanReferralLinks(doc), 0);
  const link = doc.getElementById('link');
  assert.equal(link.href, 'https://example.com/');
  assert.equal(link.textContent, 'Source');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener');
  assert.match(doc.getElementById('draft').href, /utm_source/);
  assert.match(doc.querySelector('p').textContent, /utm_source/);
});

test('installed app cleans initial, streamed and recycled links', async (t) => {
  const dom = new JSDOM('<body><a href="https://example.com/?utm_source=chatgpt.com">Source</a></body>', {
    url: 'https://chatgpt.com/c/test', pretendToBeVisual: true,
  });
  const { document: doc } = dom.window;
  const app = await toolkit.install(doc, dom.window);
  t.after(() => { app.state.observer.disconnect(); dom.window.close(); });
  assert.equal(doc.querySelector('a').href, 'https://example.com/');
  const link = doc.createElement('a');
  link.href = 'https://example.com/new?utm_source=chatgpt.com#part';
  doc.body.append(link);
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.equal(link.href, 'https://example.com/new#part');
  link.href = 'https://example.com/changed?utm_source=chatgpt.com&keep=yes';
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.equal(link.href, 'https://example.com/changed?keep=yes');
});

for (const type of ['pointerdown', 'mousedown', 'click', 'auxclick', 'contextmenu', 'keydown']) {
  test(`fresh link is cleaned synchronously before native ${type} activation`, async (t) => {
    const dom = new JSDOM('<body></body>', { url: 'https://chatgpt.com/c/test', pretendToBeVisual: true });
    const { document: doc } = dom.window;
    const app = await toolkit.install(doc, dom.window);
    t.after(() => { app.state.observer.disconnect(); dom.window.close(); });
    const link = doc.createElement('a');
    link.href = 'https://example.com/?utm_source=chatgpt.com';
    link.innerHTML = '<span>Source</span>';
    doc.body.append(link);
    let observed = false;
    link.addEventListener(type, (event) => {
      observed = true;
      assert.equal(link.href, 'https://example.com/');
      assert.equal(event.defaultPrevented, false, 'toolkit does not intercept navigation');
      event.preventDefault(); // No actual navigation in the test.
    });
    link.firstChild.dispatchEvent(new dom.window.Event(type, { bubbles: true, cancelable: true }));
    assert.equal(observed, true, 'toolkit does not stop event propagation');
  });
}

test('page click handlers retaining the original URL and source buttons open clean URLs', async (t) => {
  const tagged = 'https://example.com/article?keep=a%20b&utm_source=chatgpt.com#section';
  const dom = new JSDOM(`<body><a target="_blank" href="${tagged}">Source</a><button>Source citation</button></body>`, {
    url: 'https://chatgpt.com/c/test', pretendToBeVisual: true,
  });
  const calls = [];
  const result = { closed: false };
  const page = { open(...args) { calls.push({ receiver: this, args }); return result; } };
  const { document: doc } = dom.window;
  const app = toolkit.createApp(doc, dom.window, { pageWindow: page });
  t.after(() => { app.state.observer.disconnect(); dom.window.close(); });
  // This models a handler reading its React prop rather than the live href.
  const link = doc.querySelector('a');
  link.addEventListener('click', (event) => { event.preventDefault(); assert.equal(page.open(tagged, '_blank', 'noopener,noreferrer'), result); });
  doc.querySelector('button').addEventListener('click', () => page.open(tagged, '_blank'));
  await app.start();
  assert.equal(link.href, 'https://example.com/article?keep=a%20b#section');
  link.click();
  doc.querySelector('button').click();
  assert.equal(calls.length, 2, 'one tab per click');
  assert.deepEqual(calls[0].args, ['https://example.com/article?keep=a%20b#section', '_blank', 'noopener,noreferrer']);
  assert.deepEqual(calls[1].args, ['https://example.com/article?keep=a%20b#section', '_blank']);
  assert.equal(calls[0].receiver, page);
});

test('open cleanup preserves internal Branch URLs, blank reservations and third-party hooks', (t) => {
  const dom = new JSDOM('', { url: 'https://chatgpt.com/c/source' });
  t.after(() => dom.window.close());
  const calls = [];
  const original = function (...args) { calls.push(args); return null; };
  const page = { open: original };
  dom.window.open = original;
  const cleanup = toolkit.installReferralOpenCleanup(dom.window.document, dom.window, page);
  page.open('about:blank', '_blank');
  dom.window.open(undefined, '_blank');
  page.open('/c/source?utm_source=chatgpt.com', '_self');
  const capture = toolkit.captureBranchNavigation(dom.window.document, dom.window, page, dom.window.location.href);
  capture.arm();
  assert.equal(page.open('/c/branch', '_blank'), dom.window);
  assert.equal(capture.getDestination(), 'https://chatgpt.com/c/branch');
  capture.dispose();
  page.open('https://example.com/?utm_source=chatgpt.com', '_blank');
  assert.deepEqual(calls, [
    ['about:blank', '_blank'], [undefined, '_blank'], ['/c/source?utm_source=chatgpt.com', '_self'],
    ['https://example.com/', '_blank'],
  ]);
  const unrelatedHook = () => null;
  page.open = unrelatedHook;
  cleanup.dispose();
  assert.equal(page.open, unrelatedHook);
  assert.equal(dom.window.open, original);
});
