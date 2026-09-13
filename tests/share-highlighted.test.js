'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const toolkit = require('../chatgpt-workflow-toolkit.user.js');

const hiddenClass = 'cgs-hidden-share-highlighted';

test('only exact Share highlighted controls are hidden; content and other actions remain', (t) => {
  const dom = new JSDOM(`<!doctype html><body>
    <button id="text"><span> Share   highlighted </span></button>
    <button id="aria" aria-label="Share highlighted"><svg></svg></button>
    <div id="title" role="button" title="Share highlighted"></div>
    <div id="menu" role="menuitem">Share highlighted</div>
    <button id="share">Share</button><button id="ask">Ask ChatGPT</button>
    <button id="partial">Share highlighted text with your class</button>
    <p id="paragraph">Share highlighted</p>
    <div data-message-author-role="assistant"><button id="answer">Share highlighted</button></div>
    <div contenteditable="true"><button id="draft">Share highlighted</button></div>
    <div id="cgs-root"><button id="toolkit">Share highlighted</button></div>
  </body>`);
  t.after(() => dom.window.close());
  const { document } = dom.window;
  assert.equal(toolkit.cleanShareHighlighted(document), 4);
  for (const id of ['text', 'aria', 'title', 'menu']) {
    assert.equal(document.getElementById(id).classList.contains(hiddenClass), true, id);
  }
  for (const id of ['share', 'ask', 'partial', 'paragraph', 'answer', 'draft', 'toolkit']) {
    assert.equal(document.getElementById(id).classList.contains(hiddenClass), false, id);
  }
  assert.equal(toolkit.cleanShareHighlighted(document), 0, 'repeat scans cause no extra mutations');
  const text = document.getElementById('text');
  text.firstChild.textContent = 'Share';
  assert.equal(toolkit.cleanShareHighlighted(text.firstChild), 1, 'a recycled button is restored from a nested mutation');
  assert.equal(text.classList.contains(hiddenClass), false);
});

async function waitFor(predicate, win) {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => win.setTimeout(resolve, 25));
  assert.ok(predicate());
}

test('late selection toolbars and changing labels are cleaned automatically, even with Start writing disabled', async (t) => {
  const dom = new JSDOM('<!doctype html><body><main></main></body>', {
    url: 'https://chatgpt.com/c/test', pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const app = await toolkit.install(document, dom.window);
  t.after(() => { app.state.observer.disconnect(); dom.window.close(); });
  app.state.settings.hideStartWriting = false;
  const toolbar = document.createElement('div');
  toolbar.innerHTML = '<button><span>Share highlighted</span></button><button>Ask ChatGPT</button>';
  document.body.append(toolbar);
  const button = toolbar.firstChild;
  await waitFor(() => button.classList.contains(hiddenClass), dom.window);
  assert.equal(dom.window.getComputedStyle(button).display, 'none');
  assert.notEqual(dom.window.getComputedStyle(toolbar.lastChild).display, 'none');
  button.firstChild.firstChild.data = 'Share';
  await waitFor(() => !button.classList.contains(hiddenClass), dom.window);
  button.firstChild.firstChild.data = 'Share highlighted';
  await waitFor(() => button.classList.contains(hiddenClass), dom.window);
  button.firstChild.textContent = 'Other action';
  await waitFor(() => !button.classList.contains(hiddenClass), dom.window);
  button.title = 'Share highlighted';
  await waitFor(() => button.classList.contains(hiddenClass), dom.window);
  button.removeAttribute('title');
  await waitFor(() => !button.classList.contains(hiddenClass), dom.window);
});

for (const scenario of [
  { platform: 'Win32', width: 1920, mode: 'popup', popup: true },
  { platform: 'MacIntel', width: 1440, mode: 'popup', popup: true },
  { platform: 'Win32', width: 1920, mode: 'tab', popup: false },
  { platform: 'Win32', width: 800, mode: 'popup', popup: false },
]) {
  test(`side-window request is platform-independent: ${scenario.platform}, ${scenario.width}px, ${scenario.mode}`, async (t) => {
    const dom = new JSDOM(`<!doctype html><body><main>
      <article data-testid="conversation-turn-0"><div data-message-author-role="assistant">Answer</div><button data-testid="copy-turn-action-button">Copy</button></article>
      <form><textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button></form>
    </main></body>`, { url: 'https://chatgpt.com/c/test', pretendToBeVisual: true });
    const { document } = dom.window;
    Object.defineProperty(dom.window.navigator, 'platform', { value: scenario.platform });
    Object.defineProperty(dom.window, 'screen', { value: { availWidth: scenario.width, availHeight: 1040 } });
    const values = new Map();
    const previousGM = globalThis.GM;
    globalThis.GM = {
      async getValue(key, fallback) { return values.get(key) ?? fallback; },
      async setValue(key, value) { values.set(key, value); },
      async deleteValue(key) { values.delete(key); },
    };
    const app = toolkit.createApp(document, dom.window);
    t.after(() => {
      if (app.state.observer) app.state.observer.disconnect();
      dom.window.close();
      if (previousGM === undefined) delete globalThis.GM;
      else globalThis.GM = previousGM;
    });
    await app.start();
    app.state.settings.openMode = scenario.mode;
    app.processRoot(document.body);
    const calls = [];
    const child = { location: { replace(url) { this.href = url; } }, focus() {} };
    dom.window.open = (url, name, features) => { calls.push({ url, name, features }); return child; };
    document.querySelector('.cgs-turn-action').click();
    document.querySelector('#cgs-question').value = 'Explain this';
    document.querySelector('[data-cgs-action="submit-question"]').click();
    assert.equal(calls.length, 1, 'the popup is reserved synchronously before async storage work');
    assert.equal(calls[0].url, 'about:blank');
    assert.equal(await app.state.sideLaunchPromise, true);
    assert.equal(calls[0].features.includes('popup=yes'), scenario.popup);
    if (scenario.popup) assert.match(calls[0].features, /resizable=yes,scrollbars=yes,width=\d+,height=\d+,left=\d+,top=\d+/u);
    assert.match(child.location.href, /^https:\/\/chatgpt.com\/c\/test#cwt-job=/u);
    assert.equal(document.querySelector('#prompt-textarea').value, '');
  });
}
