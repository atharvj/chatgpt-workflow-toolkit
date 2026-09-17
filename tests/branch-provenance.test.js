'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const toolkit = require('../chatgpt-workflow-toolkit.user.js');

const sourceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const messageId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const webId = 'WEB:cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sourceUrl = `https://chatgpt.com/c/${sourceId}`;
const webUrl = `https://chatgpt.com/c/${webId}`;
const entryUrl = `https://chatgpt.com/branch/${sourceId}/${messageId}`;
const jobId = 'provenance_job_12345';
const jobKey = `chatgptSidecar.job.v1.${jobId}`;

// The user's actual native separator markup, with synthetic URL/title only.
function marker(href = `/c/${sourceId}`) {
  return `<p class="mx-3 shrink text-xs whitespace-nowrap text-gray-500">Branched from <a rel="noopener" class="cursor-pointer font-normal underline font-semibold" target="_self" href="${href}">Example lab</a></p>`;
}

function turn(index, role, text) {
  return `<article data-testid="conversation-turn-${index}"><div data-message-author-role="${role}">${text}</div></article>`;
}

const sourceHistory = turn(0, 'user', 'Explain the lab in the attached file.') +
  turn(1, 'assistant', 'Start by measuring the voltage.') +
  turn(2, 'user', 'How should I report the uncertainty?') +
  turn(3, 'assistant', '<p>Use the propagated uncertainty.</p>');
// A different mounted subset, different turn IDs, and an extra citation label.
// None of these rendering details determines whether native branching succeeded.
const branchHistory = turn(8, 'user', 'How should I report the uncertainty?') +
  turn(9, 'assistant', '<p>Use the propagated uncertainty.<span> [Source]</span></p>');
const composerHTML = '<form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form>';

function page(t, url, content) {
  const dom = new JSDOM(`<!doctype html><html><body><main>${content}${composerHTML}</main></body></html>`, {
    url, pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  return { win: dom.window, doc: dom.window.document };
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

async function fixture(t, content = branchHistory + marker(), overrides = {}, options = {}) {
  const values = storage(t);
  const original = page(t, sourceUrl, sourceHistory);
  const branch = page(t, webUrl, content);
  const target = toolkit.getTurns(original.doc).at(-1);
  const job = toolkit.sanitizeJob({
    createdAt: Date.now(), sourceUrl, kind: 'ask',
    question: toolkit.buildSelectedQuestion('Use the propagated uncertainty.', 'What does propagated mean here?'),
    locator: toolkit.getTurnLocator(target, original.doc),
    targetFingerprint: toolkit.assistantTurnFingerprint(target),
    contextFingerprint: toolkit.conversationContextFingerprint(original.doc, target),
    branchClickAttempted: true, branchConversation: webId,
    branchEntryUrl: entryUrl, branchEntryStarted: true,
    branchReloadFrom: 'previous_source_page_12345',
    ...overrides,
  });
  values.set(jobKey, job);
  const app = toolkit.createApp(branch.doc, branch.win, {
    pageInstanceId: 'new_branch_page_12345', branchComposerTimeout: 300,
    sideSendAckTimeout: 300, ...options,
  });
  t.after(() => app.state.observer?.disconnect());
  await app.start();
  app.state.incomingJobId = jobId;
  return { original, branch, app, job, values };
}

function observeSend(branch, values, { serverId = '' } = {}) {
  const sent = [];
  branch.doc.querySelector('[data-testid="send-button"]').addEventListener('click', () => {
    assert.equal(values.get(jobKey).sendAttempted, true, 'persist Send intent before clicking');
    const composer = branch.doc.querySelector('#prompt-textarea');
    sent.push(composer.value);
    const article = branch.doc.createElement('article');
    article.dataset.testid = 'conversation-turn-sent';
    const content = branch.doc.createElement('div');
    content.dataset.messageAuthorRole = 'user';
    content.textContent = composer.value;
    article.append(content);
    branch.doc.querySelector('form').before(article);
    composer.value = '';
    if (serverId) branch.win.history.replaceState({}, '', `/c/${serverId}`);
  });
  return sent;
}

test('native Branched from proof sends once despite different mounted history, IDs, and citation rendering', async (t) => {
  const { original, branch, app, job, values } = await fixture(t, undefined, {}, { branchComposerTimeout: 2_000 });
  assert.equal(toolkit.locateTurn(branch.doc, job.locator), null, 'old positional locator cannot identify the inherited response');
  const inherited = toolkit.getTurns(branch.doc).at(-1);
  assert.notEqual(toolkit.assistantTurnFingerprint(inherited), job.targetFingerprint);
  assert.notEqual(toolkit.conversationContextFingerprint(branch.doc, inherited), job.contextFingerprint);
  const sent = observeSend(branch, values);
  assert.equal(await app.runIncomingJob(job), true);
  assert.deepEqual(sent, [toolkit.buildAccuracyGuardedPrompt(job.question)]);
  assert.equal(values.has(jobKey), false);
  assert.equal(original.doc.querySelector('#prompt-textarea').value, '');
  assert.equal(toolkit.getTurns(original.doc).length, 4);
  assert.equal(branch.doc.querySelector('#cgs-recovery-backdrop').hidden, true);
});

test('native provenance works when the separator is a sibling of message content inside its turn', async (t) => {
  const content = turn(9, 'assistant', 'Use the propagated uncertainty.').replace('</article>', `${marker()}</article>`);
  const { branch, app, job, values } = await fixture(t, content, {}, { branchComposerTimeout: 2_000 });
  const sent = observeSend(branch, values);
  assert.equal(await app.runIncomingJob(job), true);
  assert.equal(sent.length, 1);
});

test('native provenance acknowledges WEB-to-server Send without requiring identical history', async (t) => {
  const { branch, app, job, values } = await fixture(t, undefined, {}, { branchComposerTimeout: 2_000 });
  const sent = observeSend(branch, values, { serverId: 'persisted-branch' });
  assert.equal(await app.runIncomingJob(job), true);
  assert.equal(sent.length, 1);
  assert.equal(values.has(jobKey), false);
});

test('wait for the inherited response to mount before sending from a native separator', async (t) => {
  const { branch, app, job, values } = await fixture(t, marker(), {}, { branchComposerTimeout: 2_000 });
  const sent = observeSend(branch, values);
  branch.win.setTimeout(() => {
    assert.equal(sent.length, 0);
    branch.doc.querySelector('main').insertAdjacentHTML('afterbegin', branchHistory);
  }, 700);
  assert.equal(await app.runIncomingJob(job), true);
  assert.equal(sent.length, 1);
});

for (const href of ['/c/another-source', `https://evil.test/c/${sourceId}`, `https://someone@chatgpt.com/c/${sourceId}`]) {
  test(`a conflicting native source link blocks even perfectly matching history: ${href}`, async (t) => {
    const { branch, app, job } = await fixture(t, sourceHistory + marker(href));
    const target = toolkit.getTurns(branch.doc).at(-1);
    assert.equal(toolkit.assistantTurnFingerprint(target), job.targetFingerprint);
    assert.equal(toolkit.conversationContextFingerprint(branch.doc, target), job.contextFingerprint);
    let sends = 0;
    branch.doc.querySelector('[data-testid="send-button"]').addEventListener('click', () => { sends += 1; });
    assert.equal(await app.runIncomingJob(job), false);
    assert.equal(sends, 0);
    assert.equal(branch.doc.querySelector('#prompt-textarea').value, '');
  });
}

for (const [name, wrapper] of [
  ['assistant content', (html) => turn(10, 'assistant', html)],
  ['user content', (html) => turn(10, 'user', html)],
  ['markdown', (html) => `<div class="markdown">${html}</div>`],
  ['code sample', (html) => `<pre>${html}</pre>`],
  ['sidebar', (html) => `<nav>${html}</nav>`],
  ['hidden wrapper', (html) => `<div style="display:none">${html}</div>`],
  ['inert wrapper', (html) => `<div inert>${html}</div>`],
  ['toolkit dialog', (html) => `<div id="cgs-root">${html}</div>`],
]) {
  test(`a Branched from link in ${name} is not native provenance`, (t) => {
    const { doc } = page(t, webUrl, branchHistory + wrapper(marker()));
    assert.equal(toolkit.nativeBranchContext(doc, sourceUrl), null);
  });
}

test('a quoted source link cannot authorize a Send', async (t) => {
  const { branch, app, job } = await fixture(t, branchHistory + turn(10, 'assistant', marker()));
  let sends = 0;
  branch.doc.querySelector('[data-testid="send-button"]').addEventListener('click', () => { sends += 1; });
  assert.equal(await app.runIncomingJob(job), false);
  assert.equal(sends, 0);
  assert.equal(branch.doc.querySelector('#prompt-textarea').value, '');
});

test('only the newest native source separator counts in a branch of a branch', (t) => {
  const wrong = marker('/c/another-source');
  const { doc } = page(t, webUrl, sourceHistory + marker() + branchHistory + wrong);
  assert.equal(toolkit.nativeBranchContext(doc, sourceUrl).sourceMatches, false);
  doc.querySelector('main').innerHTML = sourceHistory + wrong + branchHistory + marker() + composerHTML;
  const proof = toolkit.nativeBranchContext(doc, sourceUrl);
  assert.equal(proof.sourceMatches, true);
  assert.equal(proof.turn, toolkit.getTurns(doc).at(-1));
});

test('native proof does not overwrite an existing draft', async (t) => {
  const { branch, app, job } = await fixture(t, undefined, {}, { branchComposerTimeout: 2_000 });
  const composer = branch.doc.querySelector('#prompt-textarea');
  composer.value = 'Keep this draft.';
  let sends = 0;
  branch.doc.querySelector('[data-testid="send-button"]').addEventListener('click', () => { sends += 1; });
  assert.equal(await app.runIncomingJob(job), false);
  assert.equal(composer.value, 'Keep this draft.');
  assert.equal(sends, 0);
  assert.match(branch.doc.querySelector('#cgs-recovery-reason').textContent, /different draft/u);
});

for (const [name, overrides, content] of [
  ['no branch action', { branchClickAttempted: false }],
  ['no fresh-page transfer', { branchReloadFrom: '' }],
  ['same page instance', { branchReloadFrom: 'new_branch_page_12345' }],
  ['new user message already below the separator', {}, branchHistory + marker() + turn(11, 'user', 'An unrelated follow-up')],
  ['response not mounted', {}, marker()],
]) {
  test(`native source proof is insufficient with ${name}`, async (t) => {
    const { branch, app, job } = await fixture(t, content, overrides);
    let sends = 0;
    branch.doc.querySelector('[data-testid="send-button"]').addEventListener('click', () => { sends += 1; });
    assert.equal(await app.runIncomingJob(job), false);
    assert.equal(sends, 0);
    assert.equal(branch.doc.querySelector('#prompt-textarea').value, '');
  });
}

test('a previously attempted Send is observed, never clicked twice', async (t) => {
  const { branch, app, job, values } = await fixture(t, undefined, {
    questionInserted: true, sendAttempted: true, baselineUserCount: 1,
  }, { branchComposerTimeout: 2_000 });
  const sentTurn = branch.doc.createElement('article');
  sentTurn.dataset.testid = 'conversation-turn-11';
  const sentContent = branch.doc.createElement('div');
  sentContent.dataset.messageAuthorRole = 'user';
  sentContent.textContent = toolkit.buildAccuracyGuardedPrompt(job.question);
  sentTurn.append(sentContent);
  branch.doc.querySelector('form').before(sentTurn);
  let sends = 0;
  branch.doc.querySelector('[data-testid="send-button"]').addEventListener('click', () => { sends += 1; });
  assert.equal(await app.runIncomingJob(job), true);
  assert.equal(sends, 0);
  assert.equal(values.has(jobKey), false);
});

test('changing the source marker while staging prevents Send', async (t) => {
  const { branch, app, job } = await fixture(t, undefined, {}, { branchComposerTimeout: 2_000 });
  let sends = 0;
  branch.doc.querySelector('[data-testid="send-button"]').addEventListener('click', () => { sends += 1; });
  branch.doc.querySelector('#prompt-textarea').addEventListener('input', () => {
    branch.doc.querySelector('p > a').href = '/c/another-source';
  });
  assert.equal(await app.runIncomingJob(job), false);
  assert.equal(sends, 0);
  assert.match(branch.doc.querySelector('#cgs-recovery-reason').textContent, /branch confirmation changed/u);
});

test('returning to the original chat cannot use its native source marker to send', async (t) => {
  const { branch, app, job } = await fixture(t);
  branch.win.history.replaceState({}, '', sourceUrl);
  let sends = 0;
  branch.doc.querySelector('[data-testid="send-button"]').addEventListener('click', () => { sends += 1; });
  assert.equal(await app.runIncomingJob(job), false);
  assert.equal(sends, 0);
  assert.equal(branch.doc.querySelector('#prompt-textarea').value, '');
});

test('a verification failure explains the failed checks without including private text or IDs', async (t) => {
  const { branch, app, job } = await fixture(t, branchHistory);
  assert.equal(await app.runIncomingJob(job), false);
  const reason = branch.doc.querySelector('#cgs-recovery-reason').textContent;
  assert.match(reason, /native source marker not found; saved response not located/u);
  for (const privateValue of [sourceId, webId, messageId, job.question, 'propagated uncertainty']) {
    assert.equal(reason.includes(privateValue), false);
  }
});
