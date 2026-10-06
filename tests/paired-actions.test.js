'use strict';

const highlightText = require('./helpers/highlight');

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const toolkit = require('../chatgpt-workflow-toolkit.user.js');
const userscriptWindow = require('./helpers/userscript-window');

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
  const app = toolkit.createApp(doc, options.sandbox ? userscriptWindow(win) : win,
    { pageWindow: win, branchActionTimeout: 150, branchNavigationTimeout: 400, ...options });
  await app.start(); app.processRoot(doc.body);
  t.after(() => { app.state.observer.disconnect(); win.close(); });
  const turns = toolkit.getAssistantTurns(doc);
  for (const turn of turns) turn.scrollIntoView = () => {};
  return { doc, win, app, turns };
}

// Reproduce the failure at the first click (before the pointer fallback), then
// exercise the submenu. These changes affect rendering, not the branch point.
for (const mode of [
  'unload-history', 'load-history', 'math-remount', 'citation', 'duplicate-prompt', 'reindex', 'plural-only',
  'save-remount', 'intent-remount', 'id-changed', 'id-missing', 'id-conflict', 'id-duplicate',
  'save-id-changed', 'intent-id-changed', 'submenu-id-changed', 'new-user', 'streaming', 'route-changed',
]) test(`native source identity through response menu and submenu: ${mode}`, async (t) => {
  let reloads = 0;
  const { doc, win, app, turns } = await fixture(t, { sandbox: true, reloadPage: () => { reloads++; return true; } });
  const latest = () => doc.querySelector('[data-turn-key="turn-2"]');
  const answer = () => latest().querySelector('[data-markdown-text-style="assistant-message"]').parentElement.parentElement;
  const content = () => answer().querySelector('[data-markdown-text-style="assistant-message"]');
  const message = () => answer().querySelector('[data-chatgpt-selection-message-id]');
  if (mode === 'plural-only') {
    answer().setAttribute('data-chatgpt-search-message-ids', 'assistant-2 assistant-2');
    message().removeAttribute('data-chatgpt-selection-message-id');
  }
  const before = toolkit.conversationContextFingerprint(doc, answer());
  const remount = () => {
    const replacement = latest().cloneNode(true);
    replacement.querySelector('[data-markdown-text-style="assistant-message"]').innerHTML =
      '<p>Answer 2 <span class="katex"><span aria-hidden="true">x squared</span><span>x²</span></span></p>';
    // A replacement node can already be masked by the native menu. This is not
    // the same node as the operation's pre-menu accessibility snapshot.
    replacement.querySelector('[data-markdown-text-style="assistant-message"]').setAttribute('aria-hidden', 'true');
    latest().replaceWith(replacement);
    doc.querySelector('[data-turn-key="turn-1"]')?.remove();
  };
  const changeIdentity = () => message().setAttribute('data-chatgpt-selection-message-id', 'different-answer');
  let mutated = false;
  const mutate = () => {
    assert.equal(mutated, false); mutated = true;
    if (mode === 'unload-history' || mode === 'plural-only') doc.querySelector('[data-turn-key="turn-1"]').remove();
    if (mode === 'load-history') doc.querySelector('main').insertAdjacentHTML('afterbegin', exchange(0));
    if (mode === 'math-remount' || mode.endsWith('-remount')) remount();
    if (mode === 'citation') content().insertAdjacentHTML('beforeend', '<a href="https://example.test/citation">Source</a>');
    if (mode === 'duplicate-prompt') {
      const prompt = latest().querySelector('[data-chatgpt-search-unit-key$=":user"]');
      prompt.after(prompt.cloneNode(true));
    }
    if (mode === 'reindex') for (const node of latest().querySelectorAll('[data-chatgpt-search-unit-key]')) {
      const key = node.getAttribute('data-chatgpt-search-unit-key').replace('fallback-turn-2:', 'fallback-turn-9:');
      node.setAttribute('data-chatgpt-search-unit-key', key);
      if (node.hasAttribute('data-content-search-unit-key')) node.setAttribute('data-content-search-unit-key', key);
    }
    if (mode.endsWith('id-changed')) changeIdentity();
    if (mode === 'id-missing') message().removeAttribute('data-chatgpt-selection-message-id');
    if (mode === 'id-conflict') answer().setAttribute('data-chatgpt-search-message-ids', 'assistant-2 different-answer');
    if (mode === 'id-duplicate') doc.querySelector('[data-turn-key="turn-1"] [data-chatgpt-selection-message-id="assistant-1"]')
      .setAttribute('data-chatgpt-selection-message-id', 'assistant-2');
    if (mode === 'new-user') latest().insertAdjacentHTML('afterend', '<div data-content-search-unit-key="fallback-turn-3:0:user"><div data-message-author-role="user">New question</div></div>');
    if (mode === 'streaming') {
      doc.querySelector('form').setAttribute('aria-hidden', 'true');
      doc.querySelector('form').insertAdjacentHTML('beforeend', '<button data-testid="stop-button">Stop generating</button>');
    }
    if (mode === 'route-changed') win.history.pushState({}, '', '/c/another-chat');
  };
  const values = new Map(), previousGM = globalThis.GM;
  globalThis.GM = {
    async getValue(key, fallback) { return structuredClone(values.get(key) ?? fallback); },
    async setValue(key, value) {
      if (!mutated && value.kind === 'ask' && (mode.startsWith('save-') || mode.startsWith('intent-') && value.branchClickAttempted)) mutate();
      values.set(key, structuredClone(value));
    },
    async deleteValue(key) { values.delete(key); },
  };
  t.after(() => { if (previousGM === undefined) delete globalThis.GM; else globalThis.GM = previousGM; });
  const menu = doc.querySelector('#menu'), branch = doc.querySelector('#branch');
  menu.innerHTML = '<button id="open-branch" role="menuitem" aria-haspopup="menu" aria-controls="submenu" data-state="closed">Open new branch</button>';
  const submenu = doc.createElement('div');
  submenu.id = 'submenu'; submenu.setAttribute('role', 'menu'); submenu.dataset.state = 'closed';
  submenu.setAttribute('aria-labelledby', 'open-branch');
  submenu.innerHTML = '<button id="work" role="menuitem">Branch into Work mode</button>';
  submenu.append(branch); doc.body.append(submenu);
  let clicks = 0, pointers = 0, branches = 0, sends = 0;
  doc.addEventListener('click', (event) => {
    if (event.target.id === 'more-2') {
      clicks++;
      if (!mutated && !mode.startsWith('submenu-')) mutate();
    }
  });
  doc.addEventListener('pointerdown', (event) => {
    if (event.target.id !== 'more-2') return;
    pointers++; event.target.dataset.state = 'open'; event.target.setAttribute('aria-expanded', 'true'); menu.dataset.state = 'open';
    content().setAttribute('aria-hidden', 'true');
  });
  doc.querySelector('#open-branch').onclick = (event) => {
    if (mode.startsWith('submenu-')) mutate();
    event.currentTarget.dataset.state = 'open'; submenu.dataset.state = 'open';
  };
  doc.querySelector('#work').onclick = () => assert.fail('must select normal Chat');
  branch.onclick = () => { branches++; win.history.pushState({}, '', '/c/new-branch'); };
  doc.querySelector('[data-testid="send-button"]').onclick = () => sends++;
  app.state.incomingJobId = 'identity_test_job_12345';
  const job = toolkit.sanitizeJob({ createdAt: Date.now(), sourceUrl: win.location.href, kind: 'ask',
    locator: toolkit.getTurnLocator(turns[1], doc), targetFingerprint: toolkit.assistantTurnFingerprint(turns[1]),
    contextFingerprint: before, question: toolkit.buildSelectedQuestion('Answer 1', 'Explain this part.') });
  const succeeds = ['unload-history', 'load-history', 'math-remount', 'citation', 'duplicate-prompt', 'reindex', 'plural-only', 'save-remount', 'intent-remount'].includes(mode);
  assert.equal(await app.runIncomingJob(job), false, 'transfer/reload must happen before any Send');
  const reason = doc.querySelector('#cgs-recovery-reason').textContent;
  assert.equal(mutated, true);
  assert.equal(branches, succeeds ? 1 : 0, reason);
  assert.equal(reloads, succeeds ? 1 : 0, reason);
  assert.equal(sends, 0); assert.equal(doc.querySelector('#prompt-textarea').value, 'Existing draft');
  if (succeeds) {
    assert.equal(clicks, 1); assert.equal(pointers, 1);
    assert.equal(win.location.pathname, '/c/new-branch');
    assert.notEqual(toolkit.conversationContextFingerprint(doc, answer()), before,
      'regression must exercise actual rendered-history drift, not just a stable DOM');
  } else {
    assert.equal(app.state.branchClickAttempted, false);
    assert.match(reason, /could not re-verify the source chat/u);
    assert.doesNotMatch(reason, /assistant-2|different-answer|Another question/u, 'diagnostics must not disclose message IDs or text');
  }
});

test('paired prompt/answer footer remains native and highlights keep the answer owner', async (t) => {
  const { doc, win, app, turns } = await fixture(t);
  for (const [index, turn] of turns.entries()) {
    const more = doc.querySelector(`#more-${index + 1}`);
    assert.equal(toolkit.findMoreButton(turn), more);
    assert.equal(more.parentElement.querySelector('[data-cgs-injected]'), null);
    (await highlightText(doc, turn.querySelector('[data-markdown-text-style]') || turn)).click();
    assert.equal(app.state.activeTurn, turn);
    assert.equal(doc.querySelector('#cgs-selected-context').textContent, `Answer ${index + 1}`);
    doc.querySelector('[data-cgs-action="cancel-question"]').click();
  }
  assert.equal(doc.querySelector('.cgs-turn-fallback-row'), null);
  const row = doc.querySelector('#more-2').parentElement;
  const replacement = row.cloneNode(true); row.replaceWith(replacement);
  app.processRoot(replacement);
  assert.equal(doc.querySelectorAll('.cgs-turn-action').length, 0);
  assert.equal(doc.querySelectorAll('.cgs-bookmark-action').length, 0);
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
for (const eventType of ['click', 'pointerdown', 'sandbox-pointer', 'submenu']) test(`paired footer opens the native menu and branches exactly once: ${eventType}, ${duplicatePrompt || 'single'} prompt`, async (t) => {
  const { doc, win, app, turns } = await fixture(t, { duplicatePrompt, sandbox: ['sandbox-pointer', 'submenu'].includes(eventType) });
  let opens = 0, branches = 0, wrong = 0, sends = 0;
  const more = doc.querySelector('#more-2');
  more.addEventListener(['sandbox-pointer', 'submenu'].includes(eventType) ? 'pointerdown' : eventType, () => {
    opens++; more.dataset.state = 'open'; more.setAttribute('aria-expanded', 'true');
    doc.querySelector('#menu').dataset.state = 'open';
  });
  if (eventType === 'submenu') {
    const branch = doc.querySelector('#branch');
    const menu = doc.querySelector('#menu');
    menu.innerHTML = '<div id="open-branch" role="menuitem" aria-haspopup="menu" data-state="closed">Open new branch</div>';
    const submenu = doc.createElement('div');
    submenu.setAttribute('role', 'menu'); submenu.setAttribute('aria-labelledby', 'open-branch'); submenu.dataset.state = 'closed';
    submenu.innerHTML = '<button id="work-branch" role="menuitem">Branch into Work mode</button>';
    submenu.append(branch); doc.body.append(submenu);
    doc.querySelector('#work-branch').onclick = () => wrong++;
    doc.querySelector('#open-branch').onclick = (event) => {
      event.currentTarget.dataset.state = 'open'; submenu.dataset.state = 'open';
    };
  }
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

for (const duplicatePrompt of ['nested', 'sibling']) test(`duplicate ${duplicatePrompt} prompt key keeps native footers and the selected answer`, async (t) => {
  const { doc, win, app, turns } = await fixture(t, { duplicatePrompt });
  const answer = turns[1], more = doc.querySelector('#more-2');
  assert.equal(toolkit.findMoreButton(answer), more);
  assert.equal(more.parentElement.querySelector('[data-cgs-injected]'), null);
  (await highlightText(doc, answer.querySelector('[data-markdown-text-style]') || answer)).click();
  assert.equal(app.state.activeTurn, answer);
  assert.equal(doc.querySelector('#cgs-selected-context').textContent, 'Answer 2');
  doc.querySelector('[data-cgs-action="cancel-question"]').click();
  app.processRoot(answer.closest('[data-content-search-turn-key]'));
  await new Promise((resolve) => win.setTimeout(resolve, 150));
  assert.equal(doc.querySelectorAll('.cgs-turn-action').length, 0);
  assert.equal(doc.querySelectorAll('.cgs-bookmark-action').length, 0);
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
