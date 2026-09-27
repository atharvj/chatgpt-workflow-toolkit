'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const toolkit = require('../chatgpt-workflow-toolkit.user.js');

// Structure and action labels from the user's September 27 inspection.
// Conversation content and identifiers are synthetic; generated style names
// and SVG geometry are not used for identifying a menu.
function exchange(id) {
  return `<div data-turn-key="turn-${id}"><div data-content-search-turn-key="fallback-turn-${id}"><div class="contents"><div class="contents">
    <div class="group flex flex-col pb-2 pt-2">
      <div class="flex flex-col gap-3 browser:gap-1">
        <div data-chatgpt-search-unit-key="fallback-turn-${id}:0:user"><div data-chatgpt-selection-message-id="user-${id}"><p>Question ${id}</p></div></div>
        <div><button aria-label="Copy message"></button><button aria-label="Share prompt"></button><button aria-label="Edit message"></button></div>
        <div class="block-BQZwFn"><div data-chatgpt-search-unit-key="fallback-turn-${id}:1:assistant" data-content-search-unit-key="fallback-turn-${id}:1:assistant">
          <div data-chatgpt-selection-message-id="assistant-${id}"><div data-markdown-text-style="assistant-message"><p>Answer ${id}</p></div></div>
        </div></div>
      </div>
      <div class="mt-1.5 flex turn-action-controls min-h-5 min-w-0 flex-wrap items-center">
        <div class="flex min-h-5 min-w-0 flex-wrap items-center gap-0.5 browser:gap-0">
          <button type="button" aria-label="Copy"></button><button type="button" aria-label="Rate response"></button>
          <button type="button" aria-label="Share"></button><button type="button" aria-label="Read aloud" aria-pressed="false"></button>
          <button type="button" aria-label="Regenerate response" data-state="closed" aria-haspopup="menu" aria-expanded="false"></button>
          <button type="button" class="Button-G93JGk outline-hidden cursor-interaction" data-color="secondary" data-variant="ghost" data-uniform="" data-size="xs" data-icon-size="sm" aria-label="More actions" id="more-${id}" aria-haspopup="menu" aria-expanded="false" data-state="closed"><span class="ButtonInner-l31On4"><svg aria-hidden="true" class="Icon-X4VkKC" height="16" width="16"></svg></span></button>
        </div>
      </div>
    </div>
  </div></div></div></div>`;
}

async function fixture(t, options = {}) {
  const dom = new JSDOM(`<!doctype html><main>${exchange(1)}${exchange(2)}
    <div id="menu" role="menu" data-state="closed" aria-labelledby="more-2"><button role="menuitem" id="branch">Branch in new chat</button></div>
    <form><textarea id="prompt-textarea">Existing draft</textarea><button type="button" data-testid="send-button">Send</button></form></main>`,
  { url: 'https://chatgpt.com/c/source-chat', pretendToBeVisual: true });
  const win = dom.window, doc = win.document;
  if (options.duplicatePrompt) {
    const prompt = doc.querySelector('[data-chatgpt-search-unit-key="fallback-turn-2:0:user"]');
    const duplicate = prompt.cloneNode(true);
    if (options.duplicatePrompt === 'nested') {
      duplicate.removeAttribute('data-chatgpt-search-unit-key');
      duplicate.setAttribute('data-content-search-unit-key', 'fallback-turn-2:0:user');
      prompt.replaceChildren(duplicate);
    } else prompt.after(duplicate);
    const answer = doc.querySelector('[data-chatgpt-search-unit-key="fallback-turn-2:1:assistant"]');
    answer.setAttribute('data-chatgpt-search-unit-key', 'fallback-turn-2:2:assistant');
    answer.setAttribute('data-content-search-unit-key', 'fallback-turn-2:2:assistant');
    const sources = doc.createElement('button'); sources.setAttribute('aria-label', 'Sources'); sources.dataset.state = 'closed';
    doc.querySelector('#more-2').after(sources);
  }
  const app = toolkit.createApp(doc, win, { branchActionTimeout: 150, branchNavigationTimeout: 400, ...options });
  await app.start(); app.processRoot(doc.body);
  t.after(() => { app.state.observer.disconnect(); win.close(); });
  const turns = toolkit.getAssistantTurns(doc);
  for (const turn of turns) turn.scrollIntoView = () => {};
  return { doc, win, app, turns };
}

test('paired prompt/answer footer: find More, put both controls beside it, and keep the answer owner', async (t) => {
  const { doc, win, app, turns } = await fixture(t);
  for (const [index, turn] of turns.entries()) {
    const more = doc.querySelector(`#more-${index + 1}`);
    assert.equal(toolkit.findMoreButton(turn), more);
    assert.equal(more.nextElementSibling?.dataset.cgsAction, 'ask-turn');
    assert.equal(more.nextElementSibling.nextElementSibling?.dataset.cgsAction, 'reading-add');
    more.nextElementSibling.click();
    assert.equal(app.state.activeTurn, turn);
    assert.equal(doc.querySelector('#cgs-selected-context').textContent, `Answer ${index + 1}`);
    doc.querySelector('[data-cgs-action="cancel-question"]').click();
  }
  assert.equal(doc.querySelector('.cgs-turn-fallback-row'), null);
  const row = doc.querySelector('#more-2').parentElement;
  const replacement = row.cloneNode(true); row.replaceWith(replacement);
  app.processRoot(replacement);
  assert.equal(doc.querySelectorAll('.cgs-turn-action').length, 2);
  assert.equal(doc.querySelectorAll('.cgs-bookmark-action').length, 2);
  assert.equal(toolkit.findMoreButton(turns[1]), doc.querySelector('#more-2'));
  await new Promise((resolve) => win.setTimeout(resolve, 200));
  const changes = [];
  const observer = new win.MutationObserver((records) => changes.push(...records));
  observer.observe(doc.querySelector('main'), { subtree: true, childList: true });
  app.processRoot(turns[1]); app.processRoot(replacement);
  await new Promise((resolve) => win.setTimeout(resolve, 150));
  observer.disconnect(); assert.equal(changes.length, 0);
});

for (const duplicatePrompt of ['', 'nested', 'sibling'])
for (const eventType of ['click', 'pointerdown']) test(`paired footer opens the native menu and branches exactly once: ${eventType}, ${duplicatePrompt || 'single'} prompt`, async (t) => {
  const { doc, win, app, turns } = await fixture(t, { duplicatePrompt });
  let opens = 0, branches = 0, wrong = 0, sends = 0;
  const more = doc.querySelector('#more-2');
  more.addEventListener(eventType, () => {
    opens++; more.dataset.state = 'open'; more.setAttribute('aria-expanded', 'true');
    doc.querySelector('#menu').dataset.state = 'open';
  });
  doc.querySelector('#more-1').onclick = () => wrong++;
  for (const button of doc.querySelectorAll('[aria-label="Regenerate response"]')) button.onclick = () => wrong++;
  doc.querySelector('#branch').onclick = () => { branches++; win.history.pushState({}, '', '/c/new-branch'); };
  doc.querySelector('[data-testid="send-button"]').onclick = () => sends++;
  const turn = turns[1];
  const job = toolkit.sanitizeJob({ createdAt: Date.now(), sourceUrl: win.location.href, kind: 'ask',
    locator: toolkit.getTurnLocator(turn, doc), targetFingerprint: toolkit.assistantTurnFingerprint(turn),
    contextFingerprint: toolkit.conversationContextFingerprint(doc, turn),
    question: toolkit.buildSelectedQuestion('Answer 1', 'Explain this part.') });
  // Stop before transfer: source-page Send must never run, even after navigation.
  await app.runIncomingJob(job);
  assert.equal(opens, 1); assert.equal(branches, 1); assert.equal(wrong, 0); assert.equal(sends, 0);
  assert.equal(win.location.pathname, '/c/new-branch');
  assert.equal(doc.querySelector('#prompt-textarea').value, 'Existing draft');
});

for (const duplicatePrompt of ['nested', 'sibling']) test(`duplicate ${duplicatePrompt} prompt key keeps stable footer controls owned by the answer`, async (t) => {
  const { doc, win, app, turns } = await fixture(t, { duplicatePrompt });
  const answer = turns[1], more = doc.querySelector('#more-2');
  assert.equal(toolkit.findMoreButton(answer), more);
  assert.equal(more.nextElementSibling?.dataset.cgsAction, 'ask-turn');
  assert.equal(more.nextElementSibling.nextElementSibling?.dataset.cgsAction, 'reading-add');
  more.nextElementSibling.click();
  assert.equal(app.state.activeTurn, answer);
  assert.equal(doc.querySelector('#cgs-selected-context').textContent, 'Answer 2');
  doc.querySelector('[data-cgs-action="cancel-question"]').click();
  app.processRoot(answer.closest('[data-content-search-turn-key]'));
  await new Promise((resolve) => win.setTimeout(resolve, 150));
  assert.equal(doc.querySelectorAll('.cgs-turn-action').length, 2);
  assert.equal(doc.querySelectorAll('.cgs-bookmark-action').length, 2);
  assert.equal(doc.querySelector('.cgs-turn-fallback-row'), null);
});

for (const conflict of ['different-key', 'different-message-id', 'conflicting-attributes', 'after-answer'])
test(`duplicate-prompt scope still refuses ${conflict}`, async (t) => {
  const { doc, turns } = await fixture(t, { duplicatePrompt: 'sibling' });
  const copies = doc.querySelectorAll('[data-chatgpt-search-unit-key="fallback-turn-2:0:user"]');
  if (conflict === 'different-key') copies[1].setAttribute('data-chatgpt-search-unit-key', 'fallback-turn-2:1:user');
  if (conflict === 'different-message-id') copies[1].querySelector('[data-chatgpt-selection-message-id]').setAttribute('data-chatgpt-selection-message-id', 'different-user');
  if (conflict === 'conflicting-attributes') copies[1].setAttribute('data-content-search-unit-key', 'fallback-turn-2:1:user');
  if (conflict === 'after-answer') turns[1].after(copies[1]);
  assert.equal(toolkit.findMoreButton(turns[1]), null);
});

test('paired footer never substitutes Regenerate or an older answer menu for missing More', async (t) => {
  const { doc, turns } = await fixture(t);
  doc.querySelector('#more-2').remove();
  assert.equal(toolkit.findMoreButton(turns[1]), null);
  const fake = doc.createElement('div'); fake.className = 'turn-action-controls';
  fake.innerHTML = '<button aria-label="Copy"></button><button aria-label="Rate response"></button><button aria-label="More actions" aria-haspopup="menu"></button>';
  turns[1].querySelector('[data-markdown-text-style]').append(fake);
  assert.equal(toolkit.findMoreButton(turns[1]), null, 'quoted action controls are not the native footer');
});

test('an exchange containing multiple answers or a following user message is not a safe shared scope', async (t) => {
  const { doc, turns } = await fixture(t);
  const pair = turns[1].closest('[data-content-search-turn-key]');
  const extra = turns[0].cloneNode(true); pair.append(extra);
  assert.equal(toolkit.findMoreButton(turns[1]), null);
  extra.remove();
  const user = doc.createElement('div'); user.setAttribute('data-chatgpt-search-unit-key', 'fallback-turn-2:2:user'); pair.append(user);
  assert.equal(toolkit.findMoreButton(turns[1]), null);
});

test('Rate response alone identifies the action row; hidden, disabled and ambiguous More are rejected', async (t) => {
  const { doc, turns } = await fixture(t);
  const more = doc.querySelector('#more-2');
  const row = more.parentElement;
  row.querySelector('[aria-label="Regenerate response"]').remove();
  assert.equal(toolkit.findMoreButton(turns[1]), more, 'Rate response is a native feedback control');
  more.disabled = true; assert.equal(toolkit.findMoreButton(turns[1]), null);
  more.disabled = false; more.hidden = true; assert.equal(toolkit.findMoreButton(turns[1]), null);
  more.hidden = false;
  row.append(more.cloneNode(true));
  assert.equal(toolkit.findMoreButton(turns[1]), null, 'do not guess between duplicate menus');
});

for (const duplicatePrompt of ['nested', 'sibling']) test(`verified separate chat auto-sends once with ${duplicatePrompt} prompt markup`, async (t) => {
  const values = new Map(), previous = globalThis.GM;
  globalThis.GM = {
    async getValue(key, fallback) { return structuredClone(values.get(key) ?? fallback); },
    async setValue(key, value) { values.set(key, structuredClone(value)); },
    async deleteValue(key) { values.delete(key); },
  };
  t.after(() => { if (previous === undefined) delete globalThis.GM; else globalThis.GM = previous; });
  const { doc, win, app, turns } = await fixture(t, { duplicatePrompt, pageInstanceId: 'destination_page_12345', branchComposerTimeout: 1000, sideSendAckTimeout: 1000 });
  const jobId = 'duplicate_prompt_send_12345', key = `chatgptSidecar.job.v1.${jobId}`;
  const job = toolkit.sanitizeJob({ createdAt: Date.now(), sourceUrl: win.location.href, kind: 'ask',
    locator: toolkit.getTurnLocator(turns[1], doc), targetFingerprint: toolkit.assistantTurnFingerprint(turns[1]),
    contextFingerprint: toolkit.conversationContextFingerprint(doc, turns[1]),
    question: toolkit.buildSelectedQuestion('Answer 1', 'Explain this part.'),
    branchClickAttempted: true, branchConversation: 'separate-branch', branchReloadFrom: 'source_page_12345' });
  values.set(key, job); app.state.incomingJobId = jobId;
  win.history.replaceState({}, '', '/c/separate-branch');
  const composer = doc.querySelector('#prompt-textarea'); composer.value = '';
  const sent = [];
  doc.querySelector('[data-testid="send-button"]').onclick = () => {
    assert.equal(values.get(key).sendAttempted, true);
    sent.push(composer.value);
    const user = doc.createElement('div'); user.setAttribute('data-chatgpt-search-unit-key', 'fallback-turn-3:0:user');
    user.textContent = composer.value; doc.querySelector('form').before(user); composer.value = '';
  };
  assert.equal(await app.runIncomingJob(job), true);
  assert.deepEqual(sent, [toolkit.buildAccuracyGuardedPrompt(job.question)]);
  assert.equal(values.has(key), false);
  assert.equal(doc.querySelector('#cgs-recovery-backdrop').hidden, true);
});
