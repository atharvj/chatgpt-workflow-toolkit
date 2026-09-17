'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const { schema } = require('prosemirror-schema-basic');
const { EditorState } = require('prosemirror-state');
const toolkit = require('../chatgpt-workflow-toolkit.user.js');

// Real ProseMirror model, view, and DOM-observer updates in an isolated DOM.
// No ChatGPT/browser account is opened or contacted by these tests.
async function fixture(t, mode) {
  const sourceId = 'source-lab';
  const jobId = 'rich_editor_job_12345';
  const jobKey = `chatgptSidecar.job.v1.${jobId}`;
  const dom = new JSDOM(`<!doctype html><main>
    <article data-testid="conversation-turn-0"><div data-message-author-role="user">Explain the lab.</div></article>
    <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Methods: follow these steps.</div></article>
    <p>Branched from <a href="/c/${sourceId}" target="_self" rel="noopener">Example lab</a></p>
    <form><div data-editor-host></div><button type="button" data-testid="send-button" disabled>Send</button></form>
    </main>`, { url: 'https://chatgpt.com/c/WEB:dddddddd-dddd-4ddd-8ddd-dddddddddddd', pretendToBeVisual: true });
  const { window: win } = dom;
  const doc = win.document;
  const storage = new Map();
  const previous = new Map();
  const globals = { window: win, document: doc, navigator: win.navigator,
    getComputedStyle: win.getComputedStyle.bind(win), MutationObserver: win.MutationObserver,
    GM: {
      async getValue(key, fallback) { return storage.has(key) ? structuredClone(storage.get(key)) : fallback; },
      async setValue(key, value) { storage.set(key, structuredClone(value)); },
      async deleteValue(key) { storage.delete(key); },
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  // jsdom has no layout; these stubs support ProseMirror selection scrolling.
  win.Range.prototype.getClientRects = () => [];
  win.Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
  const { EditorView } = require('prosemirror-view');
  const sendButton = doc.querySelector('[data-testid="send-button"]');
  let view;
  const mountEditor = (state) => new EditorView(doc.querySelector('[data-editor-host]'), {
    state,
    attributes: { id: 'prompt-textarea', role: 'textbox', style: 'white-space: pre-wrap;' },
    dispatchTransaction(transaction) {
      this.updateState(this.state.apply(transaction));
      sendButton.disabled = !this.state.doc.textContent;
    },
    handleScrollToSelection() { return true; },
  });
  view = mountEditor(EditorState.create({ schema }));
  if (mode === 'native-paste') doc.execCommand = (command, _ui, text) => {
    assert.equal(command, 'insertText');
    return view.pasteText(text);
  };
  if (mode === 'native-raw-newlines') doc.execCommand = (_command, _ui, text) => {
    // A command can report success while leaving raw newlines in a text node.
    view.dom.textContent = text;
    return true;
  };
  if (mode === 'remount') view.dom.addEventListener('input', () => {
    win.setTimeout(() => {
      view.domObserver.flush();
      const state = view.state;
      view.destroy();
      view = mountEditor(state);
    }, 20);
  }, { once: true });
  if (mode === 'edited-after-insertion') view.dom.addEventListener('input', () => {
    win.setTimeout(() => {
      view.domObserver.flush();
      view.dispatch(view.state.tr.insertText('Different user draft', 0, view.state.doc.content.size));
    }, 20);
  }, { once: true });
  if (mode === 'existing-draft') {
    view.dispatch(view.state.tr.insertText('Do not overwrite this draft.'));
  }
  const quote = mode === 'native-paste' ? 'Methods:' : 'Methods:\n```python\nif ready:\n  send()\n```\nUse θ₁, a*b, <tag>, and 👩‍🔬.';
  const question = toolkit.buildSelectedQuestion(quote, 'what does this word mean');
  const job = toolkit.sanitizeJob({ createdAt: Date.now(), sourceUrl: `https://chatgpt.com/c/${sourceId}`,
    kind: 'ask', question, branchClickAttempted: true,
    branchConversation: toolkit.conversationIdentity(win.location.href), branchReloadFrom: 'source_page_12345',
  });
  storage.set(jobKey, job);
  const sent = [];
  sendButton.addEventListener('click', () => {
    assert.equal(storage.get(jobKey).sendAttempted, true);
    const actualModelText = view.state.doc.textBetween(0, view.state.doc.content.size, '\n', '\n');
    sent.push(actualModelText);
    if (mode === 'unacknowledged') return;
    const article = doc.createElement('article');
    article.dataset.testid = 'conversation-turn-2';
    const message = doc.createElement('div');
    message.dataset.messageAuthorRole = 'user';
    message.textContent = actualModelText;
    article.append(message);
    doc.querySelector('form').before(article);
    view.dispatch(view.state.tr.delete(0, view.state.doc.content.size));
  });
  const app = toolkit.createApp(doc, win, { branchComposerTimeout: 2_000, sideSendAckTimeout: 300 });
  t.after(() => {
    app.state.observer?.disconnect();
    view.destroy();
    win.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  await app.start();
  app.state.incomingJobId = jobId;
  return { app, doc, job, storage, jobKey, sent, modelText: () => view.state.doc.textBetween(0, view.state.doc.content.size, '\n', '\n') };
}

for (const mode of ['native-paste', 'native-raw-newlines', 'fallback-paragraphs', 'remount']) {
  test(`a verified native branch inserts and sends exactly once through real ProseMirror: ${mode}`, async (t) => {
    const { app, doc, job, storage, jobKey, sent } = await fixture(t, mode);
    assert.equal(await app.runIncomingJob(job), true, doc.querySelector('#cgs-recovery-reason').textContent);
    assert.deepEqual(sent, [toolkit.buildAccuracyGuardedPrompt(job.question)]);
    assert.equal(storage.has(jobKey), false);
    assert.equal(doc.querySelector('#cgs-recovery-backdrop').hidden, true);
  });
}

for (const mode of ['existing-draft', 'edited-after-insertion']) {
  test(`real ProseMirror ${mode} remains unsent and is not overwritten`, async (t) => {
    const { app, doc, job, sent, modelText } = await fixture(t, mode);
    assert.equal(await app.runIncomingJob(job), false);
    assert.equal(sent.length, 0);
    assert.equal(modelText(), mode === 'existing-draft' ? 'Do not overwrite this draft.' : 'Different user draft');
    assert.match(doc.querySelector('#cgs-recovery-reason').textContent, /different draft/u);
  });
}

test('an unacknowledged real-editor Send is never clicked again on retry', async (t) => {
  const { app, job, sent } = await fixture(t, 'unacknowledged');
  assert.equal(await app.runIncomingJob(job), false);
  assert.equal(sent.length, 1);
  assert.equal(await app.runIncomingJob(job), false);
  assert.equal(sent.length, 1);
});
