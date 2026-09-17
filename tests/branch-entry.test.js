'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const toolkit = require('../chatgpt-workflow-toolkit.user.js');

// Same URL shapes reported by the user; synthetic IDs, no private chat data.
const sourceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const messageId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const webId = 'WEB:cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sourceUrl = `https://chatgpt.com/c/${sourceId}`;
const entryUrl = `https://chatgpt.com/branch/${sourceId}/${messageId}`;
const webUrl = `https://chatgpt.com/c/${webId}`;
const jobId = 'native_entry_job_12345';
const key = `chatgptSidecar.job.v1.${jobId}`;
const pendingKey = 'chatgptWorkflowToolkit.pendingBranch.v1';
const history = `<main>
  <article data-testid="conversation-turn-0"><div data-message-author-role="user">Use <a href="/files/lab.pdf">lab.pdf</a><img src="/files/chart.png" alt="Chart"></div></article>
  <article data-testid="conversation-turn-1"><div data-message-author-role="assistant" data-message-id="${messageId}">Keep the units consistent.</div>
    <button data-testid="branch-turn-action-button">Branch in new chat</button></article>
  <form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form>
</main>`;

function page(t, url, body = history) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { url, pretendToBeVisual: true });
  const win = dom.window;
  // Exercise install/consumeIncomingJob, including its real one-shot lock path.
  Object.defineProperty(win.navigator, 'locks', { value: { async request(_name, _options, callback) { return callback({}); } } });
  t.after(() => win.close());
  return { win, doc: win.document };
}

function storage(t) {
  const previous = globalThis.GM;
  const values = new Map();
  globalThis.GM = {
    async getValue(key, fallback) { return values.has(key) ? structuredClone(values.get(key)) : fallback; },
    async setValue(key, value) { values.set(key, structuredClone(value)); },
    async deleteValue(key) { values.delete(key); },
  };
  t.after(() => { if (previous === undefined) delete globalThis.GM; else globalThis.GM = previous; });
  return values;
}

test('native /branch/source/message is a launch URL, not a finished conversation', () => {
  assert.equal(toolkit.validatedBranchEntryUrl(entryUrl, sourceUrl), entryUrl);
  assert.equal(toolkit.validatedBranchEntryUrl(`/branch/${sourceId}/${messageId}`, sourceUrl), entryUrl);
  assert.equal(toolkit.conversationIdentity(entryUrl), '');
  assert.equal(toolkit.validatedBranchUrl(entryUrl, sourceUrl), '');
  for (const bad of [entryUrl.replace(sourceId, 'wrong-source'), entryUrl + '/extra',
    entryUrl.replace('chatgpt.com', 'evil.test'), entryUrl.replace('https://', 'https://user:pass@'),
    `https://chatgpt.com/branch/${sourceId}/%2Fother`]) {
    assert.equal(toolkit.validatedBranchEntryUrl(bad, sourceUrl), '', bad);
  }
});

test('WEB: conversation IDs survive URL decoding and job persistence without loosening other ID validation', () => {
  assert.equal(toolkit.conversationIdentity(webUrl), webId);
  assert.equal(toolkit.conversationIdentity(webUrl.replace('WEB:', 'WEB%3A')), webId);
  assert.equal(toolkit.validatedBranchUrl(webUrl, sourceUrl), webUrl);
  const job = toolkit.sanitizeJob({ createdAt: Date.now(), sourceUrl, kind: 'ask', branchConversation: webId, branchDestinationUrl: webUrl });
  assert.equal(job.branchConversation, webId);
  assert.equal(job.branchDestinationUrl, webUrl);
  for (const invalid of ['WEB:not-a-uuid', 'other:id', '%2Fsource', '%253A', 'WEB%ZZ']) {
    assert.equal(toolkit.conversationIdentity(`https://chatgpt.com/c/${invalid}`), '');
  }
});

for (const mode of ['redirect-after-start', 'redirect-before-start', 'WEB-to-server-on-send']) {
  test(`native launch → WEB branch → exactly one focused Send (${mode})`, async (t) => {
    const values = storage(t);
    const original = page(t, sourceUrl);
    const source = page(t, sourceUrl);
    let normalPopups = 0;
    const realPage = { open() { normalPopups += 1; return null; } };
    const originalOpen = realPage.open;
    let navigation = '';
    let reloads = 0;
    const app = toolkit.createApp(source.doc, source.win, {
      pageWindow: realPage, pageInstanceId: 'before_entry_page_12345', branchNavigationTimeout: 500,
      reloadPage() { reloads += 1; return true; },
      navigatePage(url) {
        navigation = url;
        assert.equal(values.get(key).branchEntryUrl, entryUrl);
        assert.equal(values.get(key).branchEntryStarted, true, 'persist before unloading the source copy');
        return true;
      },
    });
    t.after(() => app.state.observer?.disconnect());
    await app.start();
    const turn = source.doc.querySelectorAll('article')[1];
    const question = toolkit.buildSelectedQuestion('Keep the units consistent.', 'Why is this important?');
    const job = toolkit.sanitizeJob({
      createdAt: Date.now(), sourceUrl, kind: 'ask', question,
      locator: toolkit.getTurnLocator(turn, source.doc),
      targetFingerprint: toolkit.assistantTurnFingerprint(turn),
      contextFingerprint: toolkit.conversationContextFingerprint(source.doc, turn),
    });
    let branchClicks = 0;
    source.doc.querySelector('[data-testid="branch-turn-action-button"]').addEventListener('click', () => {
      branchClicks += 1;
      realPage.open(entryUrl, '_blank', 'noopener');
    });
    app.state.incomingJobId = jobId;
    assert.equal(await app.runIncomingJob(job), false);
    assert.equal(navigation, `${entryUrl}#cwt-job=${jobId}`);
    assert.equal(normalPopups, 0, 'the native entry URL must never reach the popup blocker');
    assert.equal(branchClicks, 1);
    assert.equal(realPage.open, originalOpen);
    assert.equal(values.get(key).branchConversation, '', '/branch is not yet a conversation');
    assert.equal(reloads, 0);
    assert.equal(source.doc.querySelector('#prompt-textarea').value, '');
    const marker = source.win.sessionStorage.getItem(pendingKey);
    assert.ok(marker);
    assert.equal(marker.includes(question), false, 'tab marker contains no conversation/question text');

    const startsAtEntry = mode === 'redirect-after-start';
    const branch = page(t, startsAtEntry ? navigation : webUrl, startsAtEntry ? '<p>Loading...</p>' : history);
    branch.win.sessionStorage.setItem(pendingKey, marker);
    let sends = 0;
    branch.doc.addEventListener('click', (event) => {
      if (!event.target.matches('[data-testid="send-button"]')) return;
      sends += 1;
      const composer = branch.doc.querySelector('#prompt-textarea');
      assert.equal(composer.value, toolkit.buildAccuracyGuardedPrompt(question));
      const sent = branch.doc.createElement('article');
      sent.dataset.testid = 'conversation-turn-2';
      const content = branch.doc.createElement('div');
      content.dataset.messageAuthorRole = 'user';
      content.textContent = composer.value;
      sent.append(content);
      branch.doc.querySelector('form').before(sent);
      composer.value = '';
      if (mode === 'WEB-to-server-on-send') branch.win.history.replaceState({}, '', '/c/persisted-server-branch');
    });
    if (startsAtEntry) branch.win.setTimeout(() => {
      assert.equal(sends, 0, 'never send on the branch launch/loading page');
      // React replaces the URL and drops the transfer fragment.
      branch.win.history.replaceState({}, '', webUrl);
      const main = branch.doc.createElement('div');
      main.innerHTML = history;
      branch.doc.body.append(...main.childNodes);
    }, 100);
    const installed = await toolkit.install(branch.doc, branch.win);
    t.after(() => installed?.state.observer?.disconnect());
    assert.equal(sends, 1);
    assert.equal(values.has(key), false, 'complete and delete the one-shot job');
    assert.equal(branch.win.sessionStorage.getItem(pendingKey), null);
    assert.equal(original.doc.querySelectorAll('article').length, 2);
    assert.equal(original.doc.querySelector('#prompt-textarea').value, '');
    assert.ok(branch.doc.querySelector('a[href="/files/lab.pdf"]'));
    assert.ok(branch.doc.querySelector('img[src="/files/chart.png"]'));
  });
}

test('pending redirect token expires and cannot resume in the source or on an unrelated origin', (t) => {
  const { win } = page(t, sourceUrl);
  const marker = { id: jobId, sourceUrl, entryUrl, createdAt: Date.now() };
  win.sessionStorage.setItem(pendingKey, JSON.stringify(marker));
  assert.equal(toolkit.pendingBranchJobId(win), '');
  win.history.replaceState({}, '', entryUrl);
  assert.equal(toolkit.pendingBranchJobId(win), jobId);
  win.history.replaceState({}, '', webUrl);
  assert.equal(toolkit.pendingBranchJobId(win), jobId);
  win.sessionStorage.setItem(pendingKey, JSON.stringify({ ...marker, createdAt: Date.now() - toolkit.JOB_MAX_AGE_MS - 1 }));
  assert.equal(toolkit.pendingBranchJobId(win), '');
  win.sessionStorage.setItem(pendingKey, JSON.stringify({ ...marker, entryUrl: 'https://evil.test/branch/source/message' }));
  assert.equal(toolkit.pendingBranchJobId(win), '');
});

for (const mode of ['stuck-loading', 'source-return', 'different-entry', 'wrong-history']) {
  test(`native entry never sends or branches again when ${mode}`, async (t) => {
    const values = storage(t);
    const original = page(t, sourceUrl);
    const turn = original.doc.querySelectorAll('article')[1];
    const job = toolkit.sanitizeJob({
      createdAt: Date.now(), kind: 'ask', sourceUrl, question: 'Explain the highlighted instruction.',
      branchEntryUrl: entryUrl, branchEntryStarted: true, branchClickAttempted: true,
      branchReloadFrom: 'before_entry_page_12345',
      locator: toolkit.getTurnLocator(turn, original.doc),
      targetFingerprint: toolkit.assistantTurnFingerprint(turn),
      contextFingerprint: toolkit.conversationContextFingerprint(original.doc, turn),
    });
    values.set(key, job);
    const pending = page(t, `${entryUrl}#cwt-job=${jobId}`);
    let sends = 0;
    let branches = 0;
    pending.doc.querySelector('[data-testid="send-button"]').addEventListener('click', () => { sends += 1; });
    pending.doc.querySelector('[data-testid="branch-turn-action-button"]').addEventListener('click', () => { branches += 1; });
    if (mode !== 'stuck-loading') pending.win.setTimeout(() => {
      const url = mode === 'source-return' ? sourceUrl : mode === 'different-entry' ? entryUrl.replace(messageId, 'another-message') : webUrl;
      pending.win.history.replaceState({}, '', url);
      if (mode === 'wrong-history') pending.doc.querySelector('[data-message-author-role="assistant"]').textContent = 'Unrelated answer';
    }, 40);
    const app = toolkit.createApp(pending.doc, pending.win, {
      branchComposerTimeout: 250, reloadPage() { assert.fail('do not reload an unresolved/WEB branch'); },
    });
    t.after(() => app.state.observer?.disconnect());
    await app.start();
    assert.equal(sends, 0);
    assert.equal(branches, 0);
    assert.equal(pending.doc.querySelector('#prompt-textarea').value, '');
    assert.equal(pending.doc.querySelector('#cgs-recovery-backdrop').hidden, false);
  });
}

test('WEB-to-server transition without the exact outgoing question is not acknowledged or resent', async (t) => {
  const values = storage(t);
  const branch = page(t, `${webUrl}#cwt-job=${jobId}`);
  const turn = branch.doc.querySelectorAll('article')[1];
  const job = toolkit.sanitizeJob({
    createdAt: Date.now(), kind: 'ask', sourceUrl, question: 'My exact side question',
    branchEntryUrl: entryUrl, branchEntryStarted: true, branchClickAttempted: true,
    branchReloadFrom: 'before_entry_page_12345', branchConversation: webId,
    locator: toolkit.getTurnLocator(turn, branch.doc),
    targetFingerprint: toolkit.assistantTurnFingerprint(turn),
    contextFingerprint: toolkit.conversationContextFingerprint(branch.doc, turn),
  });
  values.set(key, job);
  let sends = 0;
  branch.doc.querySelector('[data-testid="send-button"]').addEventListener('click', () => {
    sends += 1;
    branch.doc.querySelector('form').insertAdjacentHTML('beforebegin', '<article data-testid="conversation-turn-2"><div data-message-author-role="user">A different message</div></article>');
    branch.win.history.replaceState({}, '', '/c/unrelated-server-chat');
  });
  const app = toolkit.createApp(branch.doc, branch.win, { sideSendAckTimeout: 250 });
  t.after(() => app.state.observer?.disconnect());
  await app.start();
  assert.equal(sends, 1);
  assert.equal(branch.doc.querySelector('#cgs-recovery-backdrop').hidden, false);
  assert.equal(values.get(key).sendAttempted, true);
  assert.equal(await app.runIncomingJob(toolkit.sanitizeJob(values.get(key))), false);
  assert.equal(sends, 1);
});

test('saved branch entry must belong to the source and follow an attempted native action', () => {
  const base = { createdAt: Date.now(), kind: 'ask', sourceUrl, branchEntryUrl: entryUrl, branchEntryStarted: true };
  assert.equal(toolkit.sanitizeJob(base).branchEntryUrl, '');
  assert.equal(toolkit.sanitizeJob(base).branchEntryStarted, false);
  assert.equal(toolkit.sanitizeJob({ ...base, branchClickAttempted: true }).branchEntryUrl, entryUrl);
  assert.equal(toolkit.sanitizeJob({ ...base, branchClickAttempted: true, branchEntryUrl: entryUrl.replace(sourceId, 'wrong-source') }).branchEntryUrl, '');
});

test('a WEB URL without fresh-page transfer proof neither sends nor reloads', async (t) => {
  const values = storage(t);
  const branch = page(t, `${webUrl}#cwt-job=${jobId}`);
  const turn = branch.doc.querySelectorAll('article')[1];
  values.set(key, toolkit.sanitizeJob({
    createdAt: Date.now(), kind: 'ask', sourceUrl, question: 'Do not send in a stale composer',
    branchClickAttempted: true, branchConversation: webId,
    locator: toolkit.getTurnLocator(turn, branch.doc),
    targetFingerprint: toolkit.assistantTurnFingerprint(turn),
    contextFingerprint: toolkit.conversationContextFingerprint(branch.doc, turn),
  }));
  let sends = 0;
  branch.doc.querySelector('[data-testid="send-button"]').addEventListener('click', () => { sends += 1; });
  const app = toolkit.createApp(branch.doc, branch.win, { reloadPage() { assert.fail('never force-reload WEB state'); } });
  t.after(() => app.state.observer?.disconnect());
  await app.start();
  assert.equal(sends, 0);
  assert.equal(branch.doc.querySelector('#prompt-textarea').value, '');
  assert.match(branch.doc.querySelector('#cgs-recovery-reason').textContent, /no verified page transfer/u);
});
