'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const toolkit = require('../chatgpt-workflow-toolkit.user.js');

const history = `<!doctype html><html><body><main>
  <article data-testid="conversation-turn-0"><div data-message-author-role="user">Use my lab notes <a href="/files/lab.pdf">lab.pdf</a><img src="/files/diagram.png" alt="Circuit diagram"></div></article>
  <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Step 1: prepare. <span id="highlight">Compare both groups.</span> Step 3: submit.</div><button data-testid="copy-turn-action-button">Copy</button></article>
  <article data-testid="conversation-turn-2"><div data-message-author-role="user">Also use my updated measurements.</div></article>
  <article data-testid="conversation-turn-3"><div data-message-author-role="assistant">Later unrelated instructions.</div><button data-testid="copy-turn-action-button">Copy</button><button data-testid="branch-turn-action-button" aria-label="Branch in new chat">Branch in new chat</button></article>
  <form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form>
</main></body></html>`;

async function fixture(t, url = 'https://chatgpt.com/c/source-chat', options = {}) {
  const dom = new JSDOM(history, { url, pretendToBeVisual: true });
  for (const turn of dom.window.document.querySelectorAll('article')) turn.scrollIntoView = () => {};
  const app = toolkit.createApp(dom.window.document, dom.window, options);
  t.after(() => {
    if (app.state.observer) app.state.observer.disconnect();
    dom.window.close();
  });
  await app.start();
  app.processRoot(dom.window.document.body);
  return { dom, app, doc: dom.window.document };
}

function storage(t) {
  const previous = globalThis.GM;
  const values = new Map();
  globalThis.GM = {
    async getValue(key, fallback) { return values.has(key) ? structuredClone(values.get(key)) : fallback; },
    async setValue(key, value) { values.set(key, structuredClone(value)); },
    async deleteValue(key) { values.delete(key); },
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.GM;
    else globalThis.GM = previous;
  });
  return values;
}

function openHighlight({ dom, doc, app }, text = 'Compare both groups.') {
  // Selection positioning is covered in app.test.js. Exercise its click handler
  // with a stored selection, which is cleared as soon as the pill is clicked.
  doc.querySelector('#highlight').textContent = text;
  app.state.selectedTurn = doc.querySelector('[data-testid="conversation-turn-1"]');
  app.state.selectedQuote = text;
  const pill = doc.querySelector('#cgs-selection-pill');
  pill.hidden = false;
  pill.click();
  dom.window.getSelection().removeAllRanges();
}

for (const { typedQuestion, pointerMenu } of ['Why is this necessary?', ''].flatMap((typedQuestion) =>
  [false, true].map((pointerMenu) => ({ typedQuestion, pointerMenu })))) {
  test(`highlight from an older answer survives typing and branches all history (${typedQuestion ? 'custom question' : 'default explanation'}, ${pointerMenu ? 'pointer menu' : 'direct action'})`, async (t) => {
    const values = storage(t);
    const source = await fixture(t);
    const child = { location: { replace(url) { this.href = url; } }, focus() {} };
    let opened = 0;
    source.dom.window.open = () => { opened += 1; return child; };
    openHighlight(source);
    assert.equal(source.app.state.selectedQuote, '', 'pill cleanup cannot erase the question selection');
    assert.equal(source.doc.querySelector('#cgs-selected-context').textContent, 'Compare both groups.');
    source.doc.querySelector('#cgs-question').value = typedQuestion;
    source.doc.querySelector('[data-cgs-action="submit-question"]').click();
    const launch = source.app.state.sideLaunchPromise;
    assert.ok(launch);
    assert.equal(await launch, true);
    assert.equal(opened, 1);
    const job = [...values.values()].find((value) => value.kind === 'ask');
    assert.equal(job.locator.testId, 'conversation-turn-3');
    assert.match(job.contextFingerprint, /^4:/u);
    assert.equal(job.question, toolkit.buildSelectedQuestion('Compare both groups.', typedQuestion));
    assert.match(job.question, /Use the rest of this branched conversation, including available files and images, only as background/u);
    assert.doesNotMatch(job.question, /Step 1:|Step 3:|Later unrelated instructions|PREVIOUS CONVERSATION/u);
    assert.equal('fallbackTranscript' in job, false);
    assert.equal(source.doc.querySelector('#prompt-textarea').value, '');
    assert.equal(source.doc.querySelectorAll('article').length, 4);
    assert.equal(source.dom.window.location.pathname, '/c/source-chat');
    assert.match(child.location.href, /^https:\/\/chatgpt.com\/c\/source-chat#cwt-job=/u);

    const jobId = toolkit.parseJobId(child.location.href);
    let reloads = 0;
    const copy = await fixture(t, 'https://chatgpt.com/c/source-chat', {
      pageInstanceId: 'source_copy_page_1234',
      reloadPage: () => { reloads += 1; return true; },
    });
    let branches = 0;
    const branchAction = copy.doc.querySelector('[data-testid="branch-turn-action-button"]');
    if (pointerMenu) {
      const trigger = copy.doc.createElement('button');
      trigger.dataset.testid = 'turn-actions-menu-button';
      trigger.dataset.state = 'closed';
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-controls', 'native-menu');
      branchAction.before(trigger);
      const menu = copy.doc.createElement('div');
      menu.id = 'native-menu';
      menu.setAttribute('role', 'menu');
      menu.dataset.state = 'closed';
      branchAction.removeAttribute('data-testid');
      branchAction.setAttribute('role', 'menuitem');
      menu.append(branchAction);
      copy.doc.body.append(menu);
      trigger.addEventListener('pointerdown', () => {
        trigger.dataset.state = 'open';
        trigger.setAttribute('aria-expanded', 'true');
        menu.dataset.state = 'open';
      });
    }
    branchAction.addEventListener('click', () => {
      branches += 1;
      copy.dom.window.history.pushState({}, '', '/c/native-branch');
    });
    copy.app.state.incomingJobId = jobId;
    assert.equal(await copy.app.runIncomingJob(job), false, 'native branch must reload before sending');
    assert.equal(branches, 1);
    assert.equal(reloads, 1);
    assert.equal(copy.doc.querySelector('#prompt-textarea').value, '');

    const saved = values.get(`chatgptSidecar.job.v1.${jobId}`);
    assert.equal(saved.branchConversation, 'native-branch');
    // This simulates ChatGPT's native inherited history, not server-side file access.
    const branch = await fixture(t, 'https://chatgpt.com/c/native-branch', { pageInstanceId: 'reloaded_branch_1234' });
    branch.app.state.incomingJobId = jobId;
    let sends = 0;
    let outgoing = '';
    branch.doc.querySelector('[data-testid="send-button"]').addEventListener('click', () => {
      sends += 1;
      outgoing = branch.doc.querySelector('#prompt-textarea').value;
      const sent = branch.doc.createElement('article');
      sent.dataset.testid = 'conversation-turn-4';
      const content = branch.doc.createElement('div');
      content.dataset.messageAuthorRole = 'user';
      content.textContent = outgoing;
      sent.append(content);
      branch.doc.querySelector('form').before(sent);
      branch.doc.querySelector('#prompt-textarea').value = '';
    });
    assert.equal(await branch.app.runIncomingJob(saved), true);
    assert.equal(sends, 1);
    assert.equal(outgoing, toolkit.buildAccuracyGuardedPrompt(job.question));
    assert.ok(branch.doc.querySelector('a[href="/files/lab.pdf"]'));
    assert.ok(branch.doc.querySelector('img[src="/files/diagram.png"]'));
    assert.equal(source.doc.querySelectorAll('article').length, 4, 'side question never appears in the original');
  });
}

test('selection preview is safe literal text and is cleared before an unselected question', async (t) => {
  const source = await fixture(t);
  const highlight = '<img src=x onerror=alert(1)>\nSecond line';
  openHighlight(source, highlight);
  const preview = source.doc.querySelector('#cgs-selected-context');
  assert.equal(preview.textContent, highlight);
  assert.equal(preview.children.length, 0);
  source.doc.querySelector('[data-cgs-action="cancel-question"]').click();
  source.doc.querySelector('.cgs-turn-action').click();
  assert.equal(source.app.state.questionSelection, '');
  assert.equal(preview.hidden, true);
  assert.equal(preview.textContent, '');
});

test('oversized highlights and combined questions are not silently truncated or sent', async (t) => {
  const source = await fixture(t);
  let opened = 0;
  source.dom.window.open = () => { opened += 1; return null; };
  openHighlight(source, 'x'.repeat(20_001));
  assert.equal(source.doc.querySelector('#cgs-dialog-backdrop').hidden, true);
  openHighlight(source, 'x'.repeat(19_000));
  assert.equal(source.doc.querySelector('#cgs-selected-context').textContent.length, 19_000);
  source.doc.querySelector('#cgs-question').value = 'y'.repeat(15_000);
  source.doc.querySelector('[data-cgs-action="submit-question"]').click();
  assert.equal(opened, 0);
  assert.equal(source.doc.querySelector('#cgs-dialog-backdrop').hidden, false);
  assert.equal(source.doc.querySelector('#prompt-textarea').value, '');
});

test('missing Branch never substitutes a text copy and can retry after the action returns', async (t) => {
  const values = storage(t);
  const source = await fixture(t, 'https://chatgpt.com/c/source-chat', {
    branchActionTimeout: 100,
    reloadPage: () => true,
  });
  const button = source.doc.querySelector('[data-testid="branch-turn-action-button"]');
  const turn = button.closest('article');
  button.remove();
  source.doc.querySelector('#prompt-textarea').value = 'Preserve my draft';
  let sends = 0;
  source.doc.querySelector('[data-testid="send-button"]').addEventListener('click', () => { sends += 1; });
  source.app.state.incomingJobId = 'missing_branch_job_1234';
  const job = toolkit.sanitizeJob({ createdAt: Date.now(), sourceUrl: source.dom.window.location.href, kind: 'ask', question: 'Explain the highlight' });
  assert.equal(await source.app.runIncomingJob(job), false);
  assert.equal(source.dom.window.location.pathname, '/c/source-chat');
  assert.equal(source.doc.querySelector('#prompt-textarea').value, 'Preserve my draft');
  assert.equal(sends, 0);
  assert.match(source.doc.querySelector('#cgs-recovery-reason').textContent, /No text-only copy was made/u);
  assert.equal(source.doc.querySelector('[data-cgs-action="retry-branch"]').hidden, false);
  const saved = values.get('chatgptSidecar.job.v1.missing_branch_job_1234');
  assert.equal(saved.branchClickAttempted, false);
  assert.equal('fallbackTranscript' in saved, false);
  turn.append(button);
  let branches = 0;
  button.addEventListener('click', () => {
    branches += 1;
    source.dom.window.history.pushState({}, '', '/c/native-branch');
  });
  assert.equal(await source.app.runIncomingJob(saved), false, 'retry requests a verified native reload');
  assert.equal(branches, 1);
  assert.equal(sends, 0);
});
