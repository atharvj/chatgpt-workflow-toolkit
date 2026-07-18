'use strict';

const assert = require('node:assert/strict');
const { join } = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const toolkit = require(join(__dirname, '..', 'chatgpt-workflow-toolkit.user.js'));

async function createHarness(options = {}) {
  const {
    prompt = 'Thanks!',
    pickerLevel = 'High',
    includePicker = true,
    modelLevels = ['Instant', 'Medium', 'High', 'Extra High', 'Pro'],
    menuDelay = 0,
    activeTool = '',
    delayedSubmitAfterClick = null,
    disableSendOnOptionClick = false,
    reflectOptionSelection = true,
    attachmentMarkup = '',
    conversationMarkup = '',
  } = options;
  const pickerMarkup = includePicker
    ? `<button type="button" data-testid="model-switcher" aria-controls="model-menu" aria-expanded="false">${pickerLevel}</button>`
    : '';
  const toolMarkup = activeTool
    ? `<button type="button" aria-pressed="true">${activeTool}</button>`
    : '';
  const dom = new JSDOM(`<!doctype html><html><body><main>
    ${conversationMarkup}
    <form>
      ${pickerMarkup}
      ${toolMarkup}
      ${attachmentMarkup}
      <textarea id="prompt-textarea"></textarea>
      <button type="button" data-testid="send-button">Send</button>
    </form>
    <div id="model-menu" role="menu" hidden></div>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/adaptive-send',
    pretendToBeVisual: true,
  });

  const { document } = dom.window;
  const composer = document.querySelector('#prompt-textarea');
  const sendButton = document.querySelector('[data-testid="send-button"]');
  const picker = document.querySelector('[data-testid="model-switcher"]');
  const menu = document.querySelector('#model-menu');
  const form = composer.closest('form');
  const counters = {
    sends: 0,
    submits: 0,
    requestSubmits: 0,
    pickerOpens: 0,
    pickerCloses: 0,
    optionClicks: 0,
  };

  composer.value = prompt;
  form.requestSubmit = () => {
    counters.requestSubmits += 1;
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  };
  form.addEventListener('submit', (event) => {
    counters.submits += 1;
    event.preventDefault();
  });
  sendButton.addEventListener('click', () => {
    counters.sends += 1;
    if (delayedSubmitAfterClick != null) {
      dom.window.setTimeout(() => {
        form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
      }, delayedSubmitAfterClick);
    }
  });

  const closeMenu = () => {
    if (!picker) return;
    menu.hidden = true;
    picker.setAttribute('aria-expanded', 'false');
  };
  const openMenu = () => {
    if (!picker || !picker.isConnected) return;
    menu.replaceChildren();
    for (const label of modelLevels) {
      const option = document.createElement('button');
      option.type = 'button';
      option.setAttribute('role', 'menuitem');
      option.textContent = label;
      option.addEventListener('click', () => {
        counters.optionClicks += 1;
        if (reflectOptionSelection) picker.textContent = label;
        if (disableSendOnOptionClick) sendButton.disabled = true;
        closeMenu();
      });
      menu.append(option);
    }
    menu.hidden = false;
    picker.setAttribute('aria-expanded', 'true');
  };

  if (picker) {
    picker.addEventListener('click', () => {
      if (picker.getAttribute('aria-expanded') === 'true') {
        counters.pickerCloses += 1;
        closeMenu();
        return;
      }
      counters.pickerOpens += 1;
      if (menuDelay > 0) dom.window.setTimeout(openMenu, menuDelay);
      else openMenu();
    });
  }

  const app = toolkit.createApp(document, dom.window);
  await app.start();

  return {
    app,
    composer,
    counters,
    document,
    dom,
    menu,
    picker,
    sendButton,
    window: dom.window,
    cleanup() {
      if (app.state.observer) app.state.observer.disconnect();
      dom.window.close();
    },
  };
}

async function createProductionIntelligenceHarness(options = {}) {
  const {
    prompt = 'what is 2+2',
    sourceLevel = 'Extra High',
    activation = 'pointer-sync',
    duplicateLevel = '',
    radixRows = false,
    zeroRectRows = false,
  } = options;
  const dom = new JSDOM(`<!doctype html><html><body>
    <div role="menu" data-state="open" id="unrelated-intelligence-menu">
      <div data-testid="composer-intelligence-picker-content" role="group">
        <div role="group"><div id="unrelated-instant" role="menuitemradio">Instant</div></div>
      </div>
    </div>
    <main><div data-composer-surface="true"><form>
      <textarea id="prompt-textarea"></textarea>
      <button type="button" class="__composer-pill" id="production-intelligence-trigger" aria-haspopup="menu" aria-expanded="false" data-state="closed"></button>
      <button type="button" data-testid="send-button">Send</button>
    </form></div></main>
  </body></html>`, {
    url: 'https://chatgpt.com/c/production-intelligence-harness',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const composer = document.querySelector('#prompt-textarea');
  const picker = document.querySelector('#production-intelligence-trigger');
  const sendButton = document.querySelector('[data-testid="send-button"]');
  const levels = [
    ['Instant', '5.5'],
    ['Medium', '5.6'],
    ['High', '5.6'],
    ['Extra High', '5.6'],
    ['Pro', '5.6'],
  ];
  const counters = {
    clicks: 0,
    decoyClicks: 0,
    keydowns: 0,
    optionClicks: 0,
    pointerdowns: 0,
    sends: 0,
  };
  const timers = new Set();
  let currentLevel = sourceLevel;
  let internalOpen = false;

  const setPickerLabel = () => {
    const version = levels.find(([level]) => level === currentLevel)?.[1] || '5.6';
    picker.innerHTML = `<span>${currentLevel}</span><span>${version}</span>`;
  };
  const closeMenu = () => {
    internalOpen = false;
    document.querySelector('#production-intelligence-menu')?.remove();
    picker.removeAttribute('aria-controls');
    picker.setAttribute('aria-expanded', 'false');
    picker.dataset.state = 'closed';
  };
  const renderState = () => {
    if (!internalOpen) {
      closeMenu();
      return;
    }
    if (document.querySelector('#production-intelligence-menu')) return;
    const menu = document.createElement('div');
    menu.id = 'production-intelligence-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-labelledby', picker.id);
    menu.setAttribute('data-radix-menu-content', '');
    menu.dataset.state = 'open';
    const content = document.createElement('div');
    content.dataset.testid = 'composer-intelligence-picker-content';
    content.setAttribute('role', 'group');
    if (zeroRectRows) content.style.display = 'contents';
    const singletonGroup = document.createElement('div');
    singletonGroup.setAttribute('role', 'group');
    const singleton = document.createElement('div');
    singleton.setAttribute('role', 'menuitemradio');
    singleton.textContent = 'Instant';
    singleton.addEventListener('click', () => { counters.decoyClicks += 1; });
    singletonGroup.append(singleton);
    content.append(singletonGroup);
    const radioGroup = document.createElement('div');
    radioGroup.setAttribute('role', 'group');
    for (const [label, version] of levels) {
      const option = document.createElement('div');
      option.setAttribute('role', 'menuitemradio');
      if (radixRows) option.setAttribute('data-radix-collection-item', '');
      option.setAttribute('aria-checked', String(label === currentLevel));
      option.innerHTML = `<span>${label}</span><span>${version}</span>`;
      if (zeroRectRows) option.style.display = 'contents';
      option.addEventListener('click', () => {
        counters.optionClicks += 1;
        currentLevel = label;
        setPickerLabel();
        closeMenu();
      });
      radioGroup.append(option);
    }
    if (duplicateLevel) {
      const duplicate = document.createElement('div');
      duplicate.setAttribute('role', 'menuitemradio');
      duplicate.textContent = duplicateLevel;
      duplicate.addEventListener('click', () => { counters.optionClicks += 1; });
      radioGroup.append(duplicate);
    }
    content.append(radioGroup);
    menu.append(content);
    document.body.append(menu);
    picker.setAttribute('aria-controls', menu.id);
    picker.setAttribute('aria-expanded', 'true');
    picker.dataset.state = 'open';
  };
  const scheduleRender = () => {
    const timer = dom.window.setTimeout(() => {
      timers.delete(timer);
      renderState();
    }, 40);
    timers.add(timer);
  };

  composer.value = prompt;
  setPickerLabel();
  document.querySelector('#unrelated-instant').addEventListener('click', () => { counters.decoyClicks += 1; });
  picker.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    counters.pointerdowns += 1;
    if (activation === 'keyboard') return;
    internalOpen = true;
    if (activation === 'pointer-async') scheduleRender();
    else renderState();
  });
  picker.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown') return;
    counters.keydowns += 1;
    internalOpen = true;
    if (activation === 'pointer-sync') renderState();
    else scheduleRender();
  });
  picker.addEventListener('click', (event) => {
    event.preventDefault();
    counters.clicks += 1;
    if (activation === 'pointer-async') {
      internalOpen = !internalOpen;
      scheduleRender();
    }
  });
  sendButton.addEventListener('click', () => { counters.sends += 1; });

  if (zeroRectRows) {
    Object.defineProperty(dom.window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 Chrome/149.0.0.0 Safari/537.36',
    });
    const rect = { x: 0, y: 0, top: 0, left: 0, right: 120, bottom: 32, width: 120, height: 32 };
    for (const element of [composer, picker, sendButton]) {
      element.getClientRects = () => [rect];
      element.getBoundingClientRect = () => rect;
    }
  }

  const app = toolkit.createApp(document, dom.window);
  await app.start();
  return {
    app,
    composer,
    counters,
    document,
    dom,
    picker,
    sendButton,
    cleanup() {
      for (const timer of timers) dom.window.clearTimeout(timer);
      if (app.state.observer) app.state.observer.disconnect();
      dom.window.close();
    },
  };
}

async function finishAdaptiveSend(harness) {
  let pending = harness.app.state.adaptiveSendPromise;
  if (!pending) {
    await Promise.resolve();
    pending = harness.app.state.adaptiveSendPromise;
  }
  assert.ok(pending, 'a captured send starts one adaptive routing task');
  await pending;
  await Promise.resolve();
}

function wait(win, milliseconds) {
  return new Promise((resolve) => win.setTimeout(resolve, milliseconds));
}

test('simple prompt switches High to Instant and replays Send exactly once', async (t) => {
  const harness = await createHarness({ prompt: 'Thanks!', pickerLevel: 'High' });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(toolkit.extractModelLevel(toolkit.accessibleText(harness.picker)), 'instant');
  assert.equal(harness.counters.pickerOpens, 1);
  assert.equal(harness.counters.optionClicks, 1);
  assert.equal(harness.counters.sends, 1, 'the captured click itself must not reach ChatGPT');
  assert.equal(harness.app.state.lastRouteDecision.level, 'instant');
});

test('composer attachment profiling counts logical files instead of nested controls', async (t) => {
  const harness = await createHarness({
    attachmentMarkup: `
      <button type="button" data-testid="attachment-button" aria-label="Attach files">Attach files</button>
      <div data-testid="attachment-card" data-file-id="file-1" data-file-name="lab.pdf">
        <span data-testid="attachment-preview">lab.pdf</span>
        <button type="button" aria-label="Remove file lab.pdf">Remove</button>
      </div>
      <div data-testid="attachment-card" data-file-id="file-2" data-file-name="results.xlsx">
        <button type="button" aria-label="Remove attachment results.xlsx">Remove</button>
      </div>`,
  });
  t.after(() => harness.cleanup());

  const snapshot = harness.app.captureSendSnapshot(harness.composer);
  assert.equal(snapshot.attachmentCount, 2);
  assert.deepEqual(snapshot.attachmentProfile.kinds, ['document', 'structured-data']);
  assert.match(snapshot.attachmentSignature, /lab\.pdf/iu);
  assert.match(snapshot.attachmentSignature, /results\.xlsx/iu);
  assert.doesNotMatch(snapshot.attachmentSignature, /Attach files/iu);
});

test('attachment DOM profiling preserves distinct files and rejects nested UI containers', async (t) => {
  const harness = await createHarness({
    attachmentMarkup: `
      <button type="button" data-testid="attachment-button" aria-label="Attach files"><img alt="attachment icon"></button>
      <div data-testid="attachment-tray"><img alt="attachment icon"></div>
      <div data-testid="attachment-tray">
        <div data-testid="attachment-card" data-file-id="file-3" data-file-name="nested.pdf">
          <button type="button" aria-label="Remove file nested.pdf">Remove</button>
        </div>
      </div>
      <div data-testid="attachment-card" data-file-id="file-1" data-file-name="same.pdf">
        <span data-testid="attachment-preview">same.pdf</span>
      </div>
      <div data-testid="attachment-card" data-file-id="file-2" data-file-name="same.pdf">
        <span data-testid="attachment-preview">same.pdf</span>
      </div>
      <div data-testid="attachment-card">
        <div data-file-id="file-4" data-file-name="wrapped.pdf"><img alt="wrapped.pdf"></div>
      </div>
      <div data-testid="attachment-card"><div data-testid="attachment-preview"><img alt="page preview"></div></div>`,
  });
  t.after(() => harness.cleanup());

  const snapshot = harness.app.captureSendSnapshot(harness.composer);
  assert.equal(snapshot.attachmentCount, 5, 'four stable files plus one nameless card, without counting wrappers or trays');
  assert.equal(snapshot.attachmentProfile.items.filter((item) => item.name === 'same.pdf').length, 2);
  assert.doesNotMatch(snapshot.attachmentSignature, /attachment-(?:button|tray)/iu);
});

test('stale file input entries do not resurrect a removed composer attachment', async (t) => {
  const harness = await createHarness({
    attachmentMarkup: `
      <input id="file-input" type="file" multiple>
      <div data-file-id="current-file" data-file-name="current.pdf">
        <button type="button" aria-label="Remove file current.pdf">Remove</button>
      </div>`,
  });
  t.after(() => harness.cleanup());
  const fileInput = harness.document.querySelector('#file-input');
  Object.defineProperty(fileInput, 'files', {
    configurable: true,
    value: [{ name: 'removed.pdf', type: 'application/pdf', size: 1000 }],
  });

  const snapshot = harness.app.captureSendSnapshot(harness.composer);
  assert.equal(snapshot.attachmentCount, 1);
  assert.match(snapshot.attachmentSignature, /current\.pdf/iu);
  assert.doesNotMatch(snapshot.attachmentSignature, /removed\.pdf/iu);
});

test('a stale file input cannot resurrect the last removed attachment', async (t) => {
  const harness = await createHarness({
    attachmentMarkup: '<input id="file-input" type="file" multiple>',
  });
  t.after(() => harness.cleanup());
  const fileInput = harness.document.querySelector('#file-input');
  Object.defineProperty(fileInput, 'files', {
    configurable: true,
    value: [{ name: 'removed.xlsx', type: 'application/vnd.ms-excel', size: 1000 }],
  });

  const snapshot = harness.app.captureSendSnapshot(harness.composer);
  assert.equal(snapshot.attachmentCount, 0);
  assert.doesNotMatch(snapshot.attachmentSignature, /removed\.xlsx/iu);
});

test('upload progress text does not make an unchanged attachment look replaced', async (t) => {
  const harness = await createHarness({
    attachmentMarkup: `
      <div data-file-id="file-1" data-file-name="notes.pdf">
        <span id="progress">Uploading 10%</span>
        <button type="button" aria-label="Remove file notes.pdf">Remove</button>
      </div>`,
  });
  t.after(() => harness.cleanup());
  const before = harness.app.captureSendSnapshot(harness.composer);
  harness.document.querySelector('#progress').textContent = 'Uploading 90%';
  const after = harness.app.captureSendSnapshot(harness.composer);
  assert.equal(after.attachmentSignature, before.attachmentSignature);
});

test('attachment-only send switches to the level required by the file profile', async (t) => {
  const harness = await createHarness({
    prompt: '',
    pickerLevel: 'High',
    attachmentMarkup: `
      <div data-file-id="file-1" data-file-name="worksheet.pdf">
        <button type="button" aria-label="Remove file worksheet.pdf">Remove</button>
      </div>`,
  });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(harness.picker.textContent, 'Medium');
  assert.equal(harness.counters.optionClicks, 1);
  assert.equal(harness.counters.sends, 1);
  assert.equal(harness.app.state.lastRouteDecision.target, 'medium');
});

test('same-count attachment replacement cancels a captured send safely', async (t) => {
  const harness = await createHarness({
    prompt: 'Summarize this file.',
    pickerLevel: 'High',
    attachmentMarkup: `
      <div id="attachment-card" data-file-id="file-1" data-file-name="first.pdf">
        <button type="button" aria-label="Remove file first.pdf">Remove</button>
      </div>`,
  });
  t.after(() => harness.cleanup());
  const snapshot = harness.app.captureSendSnapshot(harness.composer);
  const card = harness.document.querySelector('#attachment-card');
  card.dataset.fileId = 'file-2';
  card.dataset.fileName = 'replacement.xlsx';
  card.querySelector('button').setAttribute('aria-label', 'Remove file replacement.xlsx');

  const sent = await harness.app.smartRouteAndSend({ composer: harness.composer, snapshot, silent: true });

  assert.equal(sent, false);
  assert.equal(harness.counters.pickerOpens, 0);
  assert.equal(harness.counters.sends, 0);
  assert.equal(harness.app.state.lastRouteDecision, null);
});

test('recent conversation difficulty is inherited only by a referential follow-up', async (t) => {
  const conversationMarkup = `
    <article data-testid="conversation-turn-0"><div data-message-author-role="user">Prove rigorously that this concurrent algorithm is correct.</div></article>
    <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Proof with invariants and a race-condition analysis.</div></article>`;
  const followUp = await createHarness({
    prompt: 'Explain section 4.',
    pickerLevel: 'Instant',
    conversationMarkup,
  });
  t.after(() => followUp.cleanup());

  followUp.sendButton.click();
  await finishAdaptiveSend(followUp);
  assert.equal(followUp.picker.textContent, 'Extra High');
  assert.equal(followUp.app.state.lastRouteDecision.target, 'extra-high');

  const standalone = await createHarness({
    prompt: 'what is 2+2',
    pickerLevel: 'High',
    conversationMarkup,
  });
  t.after(() => standalone.cleanup());
  standalone.sendButton.click();
  await finishAdaptiveSend(standalone);
  assert.equal(standalone.picker.textContent, 'Instant');
  assert.equal(standalone.app.state.lastRouteDecision.target, 'instant');
});

test('conversation routing is cached until a conversation turn changes', async (t) => {
  const harness = await createHarness({
    conversationMarkup: `
      <article data-testid="conversation-turn-0"><div data-message-author-role="user">Explain this equation.</div></article>
      <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Here is the calculation.</div></article>`,
  });
  t.after(() => harness.cleanup());

  harness.app.captureSendSnapshot(harness.composer);
  const firstBuilds = harness.app.state.conversationRoutingBuilds;
  harness.app.captureSendSnapshot(harness.composer);
  assert.equal(harness.app.state.conversationRoutingBuilds, firstBuilds);

  const unrelated = harness.document.createElement('div');
  unrelated.setAttribute('role', 'menu');
  unrelated.textContent = 'Unrelated menu';
  harness.document.body.append(unrelated);
  await wait(harness.window, 0);
  harness.app.captureSendSnapshot(harness.composer);
  assert.equal(harness.app.state.conversationRoutingBuilds, firstBuilds, 'unrelated UI must not invalidate the cache');

  harness.document.querySelector('[data-message-author-role="user"]').textContent = 'Prove this equation rigorously.';
  await wait(harness.window, 0);
  harness.app.captureSendSnapshot(harness.composer);
  assert.equal(harness.app.state.conversationRoutingBuilds, firstBuilds + 1);
});

test('acknowledgments do not evict the last meaningful hard task from routing context', async (t) => {
  const hardTask = 'Design and implement a production compiler end to end with a parser, type checker, optimizer, concurrency model, migration plan, exhaustive tests, security review, benchmarks, and a formal correctness argument.';
  const conversationMarkup = [
    `<article data-testid="conversation-turn-0"><div data-message-author-role="user">${hardTask}</div></article>`,
    '<article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Here is the compiler architecture and formal proof.</div></article>',
    ...Array.from({ length: 7 }, (_value, index) =>
      `<article data-testid="conversation-turn-${index + 2}"><div data-message-author-role="user">Thanks!</div></article>`),
    '<article data-testid="conversation-turn-9"><div data-message-author-role="assistant">You’re welcome!</div></article>',
  ].join('');
  const harness = await createHarness({
    prompt: 'Continue and finish it.',
    pickerLevel: 'Instant',
    conversationMarkup,
  });
  t.after(() => harness.cleanup());

  const snapshot = harness.app.captureSendSnapshot(harness.composer);
  assert.equal(snapshot.conversationLevel, 'pro');
  harness.sendButton.click();
  await finishAdaptiveSend(harness);
  assert.equal(harness.picker.textContent, 'Pro');
  assert.equal(harness.app.state.lastRouteDecision.target, 'pro');
});

test('two nameless attachments in separate turns remain two archived attachments', async (t) => {
  const conversationMarkup = [0, 1].map((index) => `
    <article data-testid="conversation-turn-${index}">
      <div data-message-author-role="user">See this image.
        <div data-testid="attachment-card"><img alt="page preview"></div>
      </div>
    </article>`).join('');
  const harness = await createHarness({ conversationMarkup });
  t.after(() => harness.cleanup());

  const snapshot = harness.app.captureSendSnapshot(harness.composer);
  assert.equal(snapshot.archivedAttachmentProfile.count, 2);
});

test('removing a fallback turn role invalidates the conversation cache', async (t) => {
  const harness = await createHarness({
    conversationMarkup: '<article><div id="role-node" data-message-author-role="user">Question</div></article>',
  });
  t.after(() => harness.cleanup());
  const before = harness.app.captureSendSnapshot(harness.composer);
  assert.equal(before.hasPriorConversation, true);
  const builds = harness.app.state.conversationRoutingBuilds;

  harness.document.querySelector('#role-node').removeAttribute('data-message-author-role');
  await wait(harness.window, 0);
  const after = harness.app.captureSendSnapshot(harness.composer);
  assert.equal(after.hasPriorConversation, false);
  assert.equal(harness.app.state.conversationRoutingBuilds, builds + 1);
});

test('a conversation mutation cancels a previously captured routing snapshot', async (t) => {
  const harness = await createHarness({
    conversationMarkup: `
      <article data-testid="conversation-turn-0"><div data-message-author-role="user">Explain this equation.</div></article>
      <article data-testid="conversation-turn-1"><div id="answer" data-message-author-role="assistant">Here is the answer.</div></article>`,
  });
  t.after(() => harness.cleanup());
  const snapshot = harness.app.captureSendSnapshot(harness.composer);
  harness.document.querySelector('#answer').textContent = 'A changed answer.';
  await wait(harness.window, 0);

  const sent = await harness.app.smartRouteAndSend({ composer: harness.composer, snapshot, silent: true });
  assert.equal(sent, false);
  assert.equal(harness.counters.pickerOpens, 0);
  assert.equal(harness.counters.sends, 0);
});

test('an explicitly referenced old attachment survives beyond the recent-turn window', async (t) => {
  const olderTurns = Array.from({ length: 8 }, (_value, index) => index === 0
    ? `<article data-testid="conversation-turn-${index}"><div data-message-author-role="user">Use the attached spreadsheet.<div data-file-id="sheet-1" data-file-name="results.xlsx"><button aria-label="Remove file results.xlsx">Remove</button></div></div></article>`
    : `<article data-testid="conversation-turn-${index}"><div data-message-author-role="user">Unrelated question ${index}.</div></article>`)
    .join('');
  const harness = await createHarness({
    prompt: 'What does the table in results.xlsx mean?',
    pickerLevel: 'Instant',
    conversationMarkup: olderTurns,
  });
  t.after(() => harness.cleanup());

  const snapshot = harness.app.captureSendSnapshot(harness.composer);
  assert.equal(snapshot.historicalAttachmentProfile.count, 0);
  assert.equal(snapshot.archivedAttachmentProfile.count, 1);
  assert.equal(snapshot.archivedAttachmentProfile.items[0].name, 'results.xlsx');

  harness.sendButton.click();
  await finishAdaptiveSend(harness);
  assert.equal(harness.picker.textContent, 'High');
  assert.equal(harness.app.state.lastRouteDecision.target, 'high');
});

test('uncertain boundary prompt switches Instant to the safer Medium level and sends once', async (t) => {
  const harness = await createHarness({ prompt: 'Write a short poem about rain.', pickerLevel: 'Instant' });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(harness.counters.optionClicks, 1);
  assert.equal(harness.counters.sends, 1);
  assert.equal(harness.picker.textContent, 'Medium');
  assert.equal(harness.app.state.lastRouteDecision.target, 'medium');
  assert.match(harness.app.state.lastRouteDecision.reason, /uncertainty safety margin/iu);
});

test('fallback-owned draft may be reformatted while its model menu opens and still sends once', async (t) => {
  const jobId = 'fallback_route_hydration_job_1234';
  const expected = toolkit.buildSideFallbackPrompt(
    'USER:\nWhat is mediation?\n\nASSISTANT:\nMediation helps resolve disagreements.',
    'what is mediation in simple terms',
    'ask',
    jobId,
  );
  const initiallyHydrated = expected.replace(/\n{2,}/gu, (breaks) => `${breaks}\n`);
  const harness = await createHarness({ prompt: initiallyHydrated, pickerLevel: 'High' });
  t.after(() => harness.cleanup());

  harness.picker.addEventListener('click', () => {
    harness.composer.value = expected.replace(/\n/gu, '\n\n');
  }, { once: true });

  const sent = await harness.app.smartRouteAndSend({
    composer: harness.composer,
    routingText: 'what is mediation in simple terms',
    silent: true,
    draftValidator: (composer) => toolkit.fallbackDraftTextMatches(composer.value, expected, jobId),
  });

  assert.equal(sent, true);
  assert.equal(harness.counters.optionClicks, 1);
  assert.equal(harness.counters.sends, 1);
  assert.equal(harness.picker.textContent, 'Instant');
});

test('fallback transcript supplies difficulty for a context-dependent side question', async (t) => {
  const jobId = 'fallback_context_route_job_1234';
  const expected = toolkit.buildSideFallbackPrompt(
    'USER:\nProve rigorously that this concurrent algorithm is correct.\n\nASSISTANT:\nHere is the proof, including invariants and a race-condition analysis.',
    'Explain section 4.',
    'ask',
    jobId,
  );
  const harness = await createHarness({ prompt: expected, pickerLevel: 'Instant' });
  t.after(() => harness.cleanup());

  const sent = await harness.app.smartRouteAndSend({
    composer: harness.composer,
    routingText: 'Explain section 4.',
    silent: true,
    draftValidator: (composer) => toolkit.fallbackDraftTextMatches(composer.value, expected, jobId),
  });

  assert.equal(sent, true);
  assert.equal(harness.picker.textContent, 'Extra High');
  assert.equal(harness.counters.sends, 1);
  assert.equal(harness.app.state.lastRouteDecision.target, 'extra-high');
});

test('fallback transcript retains an explicitly referenced attachment older than six user turns', async (t) => {
  const jobId = 'fallback_archived_attachment_job_1234';
  const transcript = [
    'USER:\nAttached file: results.xlsx',
    ...Array.from({ length: 7 }, (_value, index) => `USER:\nUnrelated question ${index + 1}.`),
    'ASSISTANT:\nOkay.',
  ].join('\n\n');
  const expected = toolkit.buildSideFallbackPrompt(
    transcript,
    'What does the table in results.xlsx mean?',
    'ask',
    jobId,
  );
  const harness = await createHarness({ prompt: expected, pickerLevel: 'Instant' });
  t.after(() => harness.cleanup());

  const sent = await harness.app.smartRouteAndSend({
    composer: harness.composer,
    routingText: 'What does the table in results.xlsx mean?',
    silent: true,
    draftValidator: (composer) => toolkit.fallbackDraftTextMatches(composer.value, expected, jobId),
  });

  assert.equal(sent, true);
  assert.equal(harness.picker.textContent, 'High');
  assert.equal(harness.app.state.lastRouteDecision.target, 'high');
});

test('fallback text attachment parsing requires real attachment evidence and keeps the basename', async (t) => {
  const harness = await createHarness();
  t.after(() => harness.cleanup());
  assert.equal(harness.app.attachmentProfileFromText('Create report.pdf').count, 0);
  assert.equal(harness.app.attachmentProfileFromText('report.pdf').items[0].name, 'report.pdf');
  for (const text of [
    'Attached file: results.xlsx',
    'I attached results.xlsx',
    'The file I uploaded is results.xlsx',
    'Use data from results.xlsx',
  ]) {
    const profile = harness.app.attachmentProfileFromText(text);
    assert.equal(profile.count, 1, text);
    assert.equal(profile.items[0].name, 'results.xlsx', text);
  }
});

test('fallback attachment evidence keeps the exact trailing filename', async (t) => {
  for (const [index, evidence] of [
    'I attached results.xlsx',
    'The file I uploaded is results.xlsx',
    'Use data from results.xlsx',
  ].entries()) {
    const jobId = `fallback_filename_evidence_${index}_1234`;
    const transcript = [
      `USER:\n${evidence}`,
      ...Array.from({ length: 7 }, (_value, turn) => `USER:\nUnrelated question ${turn + 1}.`),
      'ASSISTANT:\nOkay.',
    ].join('\n\n');
    const expected = toolkit.buildSideFallbackPrompt(
      transcript,
      'What does results.xlsx show?',
      'ask',
      jobId,
    );
    const harness = await createHarness({ prompt: expected, pickerLevel: 'Instant' });
    t.after(() => harness.cleanup());

    const sent = await harness.app.smartRouteAndSend({
      composer: harness.composer,
      routingText: 'What does results.xlsx show?',
      silent: true,
      draftValidator: (composer) => toolkit.fallbackDraftTextMatches(composer.value, expected, jobId),
    });
    assert.equal(sent, true, evidence);
    assert.equal(harness.picker.textContent, 'High', evidence);
  }
});

test('fallback acknowledgments preserve the last meaningful hard task', async (t) => {
  const jobId = 'fallback_meaningful_context_job_1234';
  const hardTask = 'Design and implement a production compiler end to end with a parser, type checker, optimizer, concurrency model, migration plan, exhaustive tests, security review, benchmarks, and a formal correctness argument.';
  const transcript = [
    `USER:\n${hardTask}`,
    'ASSISTANT:\nHere is the compiler architecture and formal proof.',
    ...Array.from({ length: 7 }, () => 'USER:\nThanks!\n\nASSISTANT:\nYou’re welcome!'),
  ].join('\n\n');
  const expected = toolkit.buildSideFallbackPrompt(transcript, 'Continue and finish it.', 'ask', jobId);
  const harness = await createHarness({ prompt: expected, pickerLevel: 'Instant' });
  t.after(() => harness.cleanup());

  const sent = await harness.app.smartRouteAndSend({
    composer: harness.composer,
    routingText: 'Continue and finish it.',
    silent: true,
    draftValidator: (composer) => toolkit.fallbackDraftTextMatches(composer.value, expected, jobId),
  });
  assert.equal(sent, true);
  assert.equal(harness.picker.textContent, 'Pro');
});

test('fallback-owned composer remount after persistence refreshes the send snapshot', async (t) => {
  const jobId = 'fallback_persist_remount_job_1234';
  const expected = toolkit.buildSideFallbackPrompt(
    'USER:\nQuestion\n\nASSISTANT:\nAnswer',
    'explain that answer simply',
    'ask',
    jobId,
  );
  const harness = await createHarness({ prompt: expected, pickerLevel: 'Instant' });
  t.after(() => harness.cleanup());

  const sent = await harness.app.smartRouteAndSend({
    composer: harness.composer,
    routingText: 'explain that answer simply',
    silent: true,
    draftValidator: (composer) => toolkit.fallbackDraftTextMatches(composer.value, expected, jobId),
    beforeReplay: async () => {
      const replacement = harness.document.createElement('textarea');
      replacement.id = 'prompt-textarea';
      replacement.value = expected.replace(/\n/gu, '\n\n');
      harness.composer.replaceWith(replacement);
      return { refreshSnapshot: true, composer: replacement };
    },
  });

  assert.equal(sent, true);
  assert.equal(harness.counters.sends, 1);
});

test('fallback-owned formatting change does not block the delayed native submit permit', async (t) => {
  const jobId = 'fallback_delayed_submit_job_1234';
  const expected = toolkit.buildSideFallbackPrompt('USER:\nQuestion', 'answer simply', 'ask', jobId);
  const harness = await createHarness({
    prompt: expected,
    pickerLevel: 'Instant',
    delayedSubmitAfterClick: 15,
  });
  t.after(() => harness.cleanup());
  harness.sendButton.addEventListener('click', () => {
    harness.composer.value = expected.replace(/\n/gu, '\n\n');
  });

  const sent = await harness.app.smartRouteAndSend({
    composer: harness.composer,
    routingText: 'answer simply',
    silent: true,
    draftValidator: (composer) => toolkit.fallbackDraftTextMatches(composer.value, expected, jobId),
  });
  await new Promise((resolve) => harness.window.setTimeout(resolve, 45));

  assert.equal(sent, true);
  assert.equal(harness.counters.sends, 1);
  assert.equal(harness.counters.submits, 1);
});

test('claimed-answer challenge switches Instant to High, verifies the premise, and sends once', async (t) => {
  const prompt = "I don't get why the answer is 12V and 4V.";
  const harness = await createHarness({ prompt, pickerLevel: 'Instant' });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(toolkit.extractModelLevel(toolkit.accessibleText(harness.picker)), 'high');
  assert.equal(harness.counters.optionClicks, 1);
  assert.equal(harness.counters.sends, 1);
  assert.ok(harness.composer.value.startsWith(prompt));
  assert.match(harness.composer.value, /independently verify the stated answer or result/iu);
  assert.equal(harness.app.state.lastRouteDecision.target, 'high');
  assert.equal(harness.app.state.lastRouteDecision.level, 'high');
});

test('uncertain answer recheck prefers the inherited higher level but accepts the High safety floor', async (t) => {
  const harness = await createHarness({
    prompt: 'Are you sure?',
    pickerLevel: 'High',
    modelLevels: ['Instant', 'Medium', 'High'],
  });
  t.after(() => harness.cleanup());
  harness.app.state.lastRouteDecision = {
    path: '/c/adaptive-send',
    level: 'extra-high',
    target: 'extra-high',
    timestamp: Date.now(),
    manual: false,
    reason: 'previous complex task',
  };

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(harness.counters.sends, 1);
  assert.equal(harness.app.state.lastRouteDecision.target, 'extra-high');
  assert.equal(harness.app.state.lastRouteDecision.level, 'high');
  assert.match(harness.composer.value, /independently verify the stated answer or result/iu);
});

test('claimed-answer challenge never downgrades below High when only weaker levels exist', async (t) => {
  const prompt = 'How did you get 12V and 4V?';
  const harness = await createHarness({
    prompt,
    pickerLevel: 'Instant',
    modelLevels: ['Instant', 'Medium'],
  });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(toolkit.extractModelLevel(toolkit.accessibleText(harness.picker)), 'instant');
  assert.equal(harness.counters.optionClicks, 0);
  assert.equal(harness.counters.sends, 0);
  assert.equal(harness.counters.requestSubmits, 0);
  assert.equal(harness.composer.value, prompt, 'the verification suffix is added only after a safe model is confirmed');
  assert.equal(harness.app.state.lastRouteDecision, null);
});

test('claimed-answer challenge stays unsent when the model control is unavailable', async (t) => {
  const prompt = "I don't get why the answer is 12V and 4V.";
  const harness = await createHarness({ prompt, includePicker: false });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(harness.counters.sends, 0);
  assert.equal(harness.counters.requestSubmits, 0);
  assert.equal(harness.composer.value, prompt);
  assert.equal(harness.app.state.lastRouteDecision, null);
  assert.match(harness.document.querySelector('#cgs-toast').textContent, /requested High level.+not sent/iu);
});

test('claimed-answer challenge may use a confirmed stronger level when High is unavailable', async (t) => {
  const harness = await createHarness({
    prompt: 'How did you get 12V and 4V?',
    pickerLevel: 'Instant',
    modelLevels: ['Instant', 'Medium', 'Extra High', 'Pro'],
  });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(toolkit.extractModelLevel(toolkit.accessibleText(harness.picker)), 'extra-high');
  assert.equal(harness.counters.optionClicks, 1);
  assert.equal(harness.counters.sends, 1);
  assert.equal(harness.app.state.lastRouteDecision.target, 'high');
  assert.equal(harness.app.state.lastRouteDecision.level, 'extra-high');
});

test('claimed-answer challenge stays unsent when ChatGPT does not confirm High', async (t) => {
  const prompt = 'Explain why 12V is correct.';
  const harness = await createHarness({
    prompt,
    pickerLevel: 'Instant',
    reflectOptionSelection: false,
  });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.ok(harness.counters.optionClicks >= 1);
  assert.equal(harness.counters.sends, 0);
  assert.equal(harness.counters.requestSubmits, 0);
  assert.equal(harness.composer.value, prompt);
  assert.equal(harness.app.state.lastRouteDecision, null);
  assert.match(harness.document.querySelector('#cgs-toast').textContent, /did not confirm High|draft was not sent/iu);
});

test('claimed-answer challenge never sends after the composer remounts during accuracy staging', async (t) => {
  const prompt = "I don't get why the answer is 12V and 4V.";
  const harness = await createHarness({ prompt, pickerLevel: 'Instant' });
  t.after(() => harness.cleanup());
  harness.composer.addEventListener('input', () => {
    const form = harness.document.querySelector('form');
    form.innerHTML = '<textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button>';
    form.querySelector('#prompt-textarea').value = prompt;
  }, { once: true });

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(harness.counters.sends, 0);
  assert.equal(harness.counters.requestSubmits, 0);
  assert.equal(harness.document.querySelector('#prompt-textarea').value, prompt);
  assert.equal(harness.app.state.lastRouteDecision, null);
  assert.match(harness.document.querySelector('#cgs-toast').textContent, /message box changed.+not sent/iu);
});

test('current intelligence-level popover switches High to Instant', async (t) => {
  const dom = new JSDOM(`<!doctype html><html><body><main><form>
    <button type="button" data-testid="intelligence-picker" aria-label="Intelligence level: High" aria-expanded="false">High</button>
    <textarea id="prompt-textarea">what is 2+2</textarea>
    <button type="button" data-testid="send-button">Send</button>
  </form></main></body></html>`, {
    url: 'https://chatgpt.com/c/current-intelligence-picker',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const picker = document.querySelector('[data-testid="intelligence-picker"]');
  const sendButton = document.querySelector('[data-testid="send-button"]');
  let sends = 0;
  let optionClicks = 0;

  picker.addEventListener('click', () => {
    if (picker.getAttribute('aria-expanded') === 'true') return;
    const portal = document.createElement('div');
    portal.dataset.slot = 'popover-content';
    portal.dataset.state = 'open';
    const group = document.createElement('div');
    group.setAttribute('role', 'radiogroup');
    for (const label of ['Instant', 'Medium', 'High']) {
      const option = document.createElement('div');
      option.setAttribute('role', 'radio');
      option.tabIndex = 0;
      option.textContent = label;
      option.addEventListener('click', () => {
        optionClicks += 1;
        picker.textContent = label;
        picker.setAttribute('aria-label', `Intelligence level: ${label}`);
        picker.setAttribute('aria-expanded', 'false');
        portal.remove();
      });
      group.append(option);
    }
    portal.append(group);
    document.body.append(portal);
    picker.setAttribute('aria-expanded', 'true');
  });
  sendButton.addEventListener('click', () => { sends += 1; });

  const app = toolkit.createApp(document, dom.window);
  await app.start();
  t.after(() => {
    if (app.state.observer) app.state.observer.disconnect();
    dom.window.close();
  });

  sendButton.click();
  await finishAdaptiveSend({ app });

  assert.equal(toolkit.extractModelLevel(toolkit.accessibleText(picker)), 'instant');
  assert.equal(optionClicks, 1);
  assert.equal(sends, 1);
  assert.equal(app.state.lastRouteDecision.target, 'instant');
  assert.equal(app.state.lastRouteDecision.level, 'instant');
});

test('current pointerdown Radix picker switches High5.6 to Instant5.5', async (t) => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="unrelated-intelligence-menu" role="menu" data-state="open">
      <div data-testid="composer-intelligence-picker-content" role="group">
        <div id="unrelated-instant" role="menuitemradio" data-radix-collection-item>Instant</div>
      </div>
    </div>
    <main>
    <div data-composer-surface="true"><form>
      <textarea id="prompt-textarea">what is 2+2</textarea>
      <button type="button" class="__composer-pill" id="radix-current-trigger" aria-controls="current-intelligence-menu" aria-haspopup="menu" data-state="closed"><span>High</span><span>5.6</span></button>
      <button type="button" data-testid="send-button">Send</button>
    </form></div>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/version-badged-intelligence-picker',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const picker = document.querySelector('button.__composer-pill[aria-haspopup="menu"]');
  const sendButton = document.querySelector('[data-testid="send-button"]');
  let sends = 0;
  let optionClicks = 0;
  let optionPointerDowns = 0;
  let pointerDowns = 0;
  let triggerClicks = 0;
  let nestedDecoyClicks = 0;
  let unrelatedDecoyClicks = 0;
  document.querySelector('#unrelated-instant').addEventListener('click', () => { unrelatedDecoyClicks += 1; });

  // Radix DropdownMenu.Trigger opens on pointerdown. A bare
  // HTMLElement.click() intentionally does nothing in this fixture.
  picker.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    pointerDowns += 1;
    const existing = document.querySelector('[data-radix-menu-content]');
    if (existing) {
      existing.remove();
      picker.dataset.state = 'closed';
      return;
    }
    const portal = document.createElement('div');
    portal.id = 'current-intelligence-menu';
    portal.setAttribute('role', 'menu');
    portal.setAttribute('aria-labelledby', picker.id);
    portal.dataset.state = 'open';
    portal.setAttribute('data-radix-menu-content', '');
    const content = document.createElement('div');
    content.dataset.testid = 'composer-intelligence-picker-content';
    content.setAttribute('role', 'group');
    const nestedGroup = document.createElement('div');
    nestedGroup.setAttribute('role', 'group');
    const nestedDecoy = document.createElement('div');
    nestedDecoy.setAttribute('role', 'menuitemradio');
    nestedDecoy.setAttribute('data-radix-collection-item', '');
    nestedDecoy.textContent = 'Instant';
    nestedDecoy.addEventListener('click', () => { nestedDecoyClicks += 1; });
    nestedGroup.append(nestedDecoy);
    content.append(nestedGroup);
    const productionRadioGroup = document.createElement('div');
    productionRadioGroup.setAttribute('role', 'group');
    for (const [level, version] of [['Instant', '5.5'], ['Medium', '5.6'], ['High', '5.6']]) {
      const option = document.createElement('div');
      option.setAttribute('role', 'menuitemradio');
      option.setAttribute('data-radix-collection-item', '');
      option.title = 'Choose intelligence level';
      option.innerHTML = `<span>${level}</span><span>${version}</span>`;
      option.addEventListener('pointerdown', () => { optionPointerDowns += 1; });
      option.addEventListener('click', () => {
        optionClicks += 1;
        picker.innerHTML = `<span>${level}</span><span>${version}</span>`;
        picker.dataset.state = 'closed';
        portal.remove();
      });
      productionRadioGroup.append(option);
    }
    content.append(productionRadioGroup);
    portal.append(content);
    document.body.append(portal);
    picker.dataset.state = 'open';
  });
  picker.addEventListener('click', () => { triggerClicks += 1; });
  sendButton.addEventListener('click', () => { sends += 1; });

  const app = toolkit.createApp(document, dom.window);
  await app.start();
  t.after(() => {
    if (app.state.observer) app.state.observer.disconnect();
    dom.window.close();
  });

  assert.equal(toolkit.extractModelLevel(picker.textContent), 'high');
  sendButton.click();
  await finishAdaptiveSend({ app });

  assert.equal(picker.textContent, 'Instant5.5');
  assert.equal(toolkit.extractModelLevel(picker.textContent), 'instant');
  assert.equal(pointerDowns, 1, 'the current Radix trigger must receive primary pointerdown');
  assert.equal(triggerClicks, 0, 'a successful pointerdown toggle must not be undone by a fallback click');
  assert.equal(optionPointerDowns, 0, 'current Radix menu items should use their normal click selection path');
  assert.equal(unrelatedDecoyClicks, 0, 'an unassociated Intelligence root must not receive the selection');
  assert.equal(nestedDecoyClicks, 0, 'nested radio groups must not override the direct Intelligence choices');
  assert.equal(optionClicks, 1);
  assert.equal(sends, 1);
  assert.equal(app.state.lastRouteDecision.target, 'instant');
  assert.equal(app.state.lastRouteDecision.level, 'instant');
  assert.doesNotMatch(document.querySelector('#cgs-toast').textContent, /no compatible auto level/iu);
});

test('production BasicTrigger waits for async open and accepts zero-rect direct rows', async (t) => {
  const harness = await createProductionIntelligenceHarness({
    prompt: 'what is 2+2',
    sourceLevel: 'Extra High',
    activation: 'pointer-async',
    radixRows: false,
    zeroRectRows: true,
  });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(harness.counters.pointerdowns, 1);
  assert.equal(harness.counters.keydowns, 1, 'ArrowDown may safely reinforce an asynchronously opening BasicTrigger');
  assert.equal(harness.counters.clicks, 0, 'the no-op BasicTrigger click fallback must not toggle an async open closed');
  assert.equal(harness.counters.decoyClicks, 0);
  assert.equal(harness.counters.optionClicks, 1);
  assert.equal(toolkit.extractModelLevel(toolkit.accessibleText(harness.picker)), 'instant');
  assert.equal(harness.counters.sends, 1);
  assert.equal(harness.app.state.lastRouteDecision.level, 'instant');
});

test('production BasicTrigger uses ArrowDown when synthetic pointerdown is ignored', async (t) => {
  const harness = await createProductionIntelligenceHarness({
    prompt: 'what is 2+2',
    sourceLevel: 'Extra High',
    activation: 'keyboard',
    radixRows: false,
  });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(harness.counters.pointerdowns, 1);
  assert.equal(harness.counters.keydowns, 1);
  assert.equal(harness.counters.clicks, 0, 'the current BasicTrigger must open without relying on click');
  assert.equal(harness.counters.decoyClicks, 0);
  assert.equal(harness.counters.optionClicks, 1);
  assert.equal(toolkit.extractModelLevel(toolkit.accessibleText(harness.picker)), 'instant');
  assert.equal(harness.counters.sends, 1);
});

test('ambiguous duplicate target rows are never clicked or sent', async (t) => {
  const prompt = 'what is 2+2';
  const harness = await createProductionIntelligenceHarness({
    prompt,
    sourceLevel: 'Extra High',
    activation: 'pointer-sync',
    duplicateLevel: 'Instant',
  });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(harness.counters.optionClicks, 0);
  assert.equal(harness.counters.sends, 0);
  assert.equal(harness.composer.value, prompt);
  assert.equal(harness.app.state.lastRouteDecision, null);
  assert.match(harness.document.querySelector('#cgs-toast').textContent, /more than one Instant control.*draft was not sent/iu);
});

test('automatic routing selects every available direct Intelligence level', async (t) => {
  const cases = [
    {
      expected: 'instant',
      prompt: 'what is 2+2',
      sourceLevel: 'Extra High',
    },
    {
      expected: 'medium',
      prompt: 'Compare TCP and UDP for a beginner.',
      sourceLevel: 'Instant',
    },
    {
      expected: 'high',
      prompt: 'Debug this failing test:\nTypeError: cannot read property of undefined',
      sourceLevel: 'Medium',
    },
    {
      expected: 'extra-high',
      prompt: 'Design a production API architecture with concurrency risks, migration, rollback, tests, and security tradeoffs.',
      sourceLevel: 'High',
    },
    {
      expected: 'pro',
      prompt: 'Design and implement a production compiler end to end. Specify the parser, type checker, optimizer, concurrency model, migration plan, exhaustive tests, security review, benchmarks, and a formal correctness argument for every optimization.',
      sourceLevel: 'Extra High',
    },
  ];

  for (const [index, scenario] of cases.entries()) {
    await t.test(scenario.expected, async () => {
      const harness = await createProductionIntelligenceHarness({
        prompt: scenario.prompt,
        sourceLevel: scenario.sourceLevel,
        activation: 'pointer-sync',
        radixRows: index % 2 === 0,
      });
      try {
        harness.sendButton.click();
        await finishAdaptiveSend(harness);

        assert.equal(harness.counters.decoyClicks, 0);
        assert.equal(harness.counters.optionClicks, 1);
        assert.equal(toolkit.extractModelLevel(toolkit.accessibleText(harness.picker)), scenario.expected);
        assert.equal(harness.counters.sends, 1);
        assert.equal(harness.app.state.lastRouteDecision.level, scenario.expected);
      } finally {
        harness.cleanup();
      }
    });
  }
});

test('Power slider moves Extra High through High and Medium to Instant before sending', async (t) => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <button id="stale-power-trigger" aria-controls="stale-power-menu">Other picker</button>
    <div id="stale-power-menu" role="menu" data-state="open" aria-labelledby="stale-power-trigger">
      <div data-testid="composer-model-picker-slider-simple-view" data-active="true">
        <span id="stale-power-status">5.6 Extra High, 4 of 5.</span>
        <div id="stale-power-control" role="menuitem" aria-label="Power" aria-keyshortcuts="ArrowLeft ArrowRight" aria-describedby="stale-power-status"></div>
      </div>
    </div>
    <main><form>
    <textarea id="prompt-textarea">what is 2+2</textarea>
    <button type="button" class="__composer-pill" id="power-trigger" aria-controls="power-menu" aria-haspopup="menu" data-state="closed"><span>Extra High</span><span>5.6</span></button>
    <button type="button" data-testid="send-button">Send</button>
  </form></main></body></html>`, {
    url: 'https://chatgpt.com/c/power-slider-routing',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const picker = document.querySelector('#power-trigger');
  const sendButton = document.querySelector('[data-testid="send-button"]');
  const presets = [
    ['Instant', '5.5'],
    ['Medium', '5.6'],
    ['High', '5.6'],
    ['Extra High', '5.6'],
    ['Pro', '5.6'],
  ];
  let index = 3;
  let sends = 0;
  let transitionPending = false;
  let overlappingKeys = 0;
  let staleSliderKeys = 0;
  const keys = [];
  document.querySelector('#stale-power-control').addEventListener('keydown', () => { staleSliderKeys += 1; });

  const renderControl = (simpleView, status, instructions) => {
    const renderedIndex = index;
    const control = document.createElement('div');
    control.setAttribute('role', 'menuitem');
    control.tabIndex = 0;
    control.setAttribute('aria-label', 'Power');
    control.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight');
    control.setAttribute('aria-describedby', `${status.id} ${instructions.id}`);
    control.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      event.stopPropagation();
      if (transitionPending) overlappingKeys += 1;
      transitionPending = true;
      keys.push(event.key);
      const nextIndex = Math.max(0, Math.min(presets.length - 1, renderedIndex + (event.key === 'ArrowLeft' ? -1 : 1)));
      control.dataset.keyboardInteractionActive = 'true';
      control.replaceWith(renderControl(simpleView, status, instructions));
      dom.window.setTimeout(() => {
        index = nextIndex;
        const [level, version] = presets[index];
        status.textContent = `${version} ${level}, ${index + 1} of ${presets.length}.`;
        picker.innerHTML = `<span>${level}</span><span>${version}</span>`;
        transitionPending = false;
        const liveControl = simpleView.querySelector('[aria-keyshortcuts]');
        if (liveControl) liveControl.replaceWith(renderControl(simpleView, status, instructions));
      }, 40);
    });
    return control;
  };

  picker.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const existing = document.querySelector('#power-menu');
    if (existing) {
      existing.remove();
      picker.dataset.state = 'closed';
      return;
    }
    const menu = document.createElement('div');
    menu.id = 'power-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('data-radix-menu-content', '');
    menu.setAttribute('aria-labelledby', picker.id);
    menu.dataset.state = 'open';
    const simpleView = document.createElement('div');
    simpleView.dataset.testid = 'composer-model-picker-slider-simple-view';
    simpleView.dataset.active = 'true';
    const status = document.createElement('span');
    status.id = 'power-status';
    status.textContent = '5.6 Extra High, 4 of 5.';
    const instructions = document.createElement('span');
    instructions.id = 'power-instructions';
    instructions.textContent = 'Use ArrowLeft and ArrowRight to change power.';
    simpleView.append(status, instructions, renderControl(simpleView, status, instructions));
    menu.append(simpleView);
    document.body.append(menu);
    picker.dataset.state = 'open';
  });
  sendButton.addEventListener('click', () => { sends += 1; });

  const app = toolkit.createApp(document, dom.window);
  await app.start();
  t.after(() => {
    if (app.state.observer) app.state.observer.disconnect();
    dom.window.close();
  });

  sendButton.click();
  await finishAdaptiveSend({ app });

  assert.deepEqual(keys, ['ArrowLeft', 'ArrowLeft', 'ArrowLeft']);
  assert.equal(overlappingKeys, 0, 'each ArrowLeft must wait for the described level to change');
  assert.equal(staleSliderKeys, 0, 'an active slider associated with another trigger must remain untouched');
  assert.equal(picker.textContent, 'Instant5.5');
  assert.equal(picker.dataset.state, 'closed');
  assert.equal(document.querySelector('#power-menu'), null, 'the slider menu must close before replaying Send');
  assert.equal(sends, 1);
  assert.equal(app.state.lastRouteDecision.target, 'instant');
  assert.equal(app.state.lastRouteDecision.level, 'instant');
  assert.equal(document.querySelector('[data-cgs-auto-badge]').textContent, 'Auto → Instant');
  assert.doesNotMatch(document.querySelector('#cgs-toast').textContent, /no compatible|used the current model/iu);
});

test('current Intelligence picker reopens and retries an unreflected first selection', async (t) => {
  const dom = new JSDOM(`<!doctype html><html><body><main><form>
    <textarea id="prompt-textarea">what is 2+2</textarea>
    <button type="button" class="__composer-pill" aria-haspopup="menu" data-state="closed"><span>High</span><span>5.6</span></button>
    <button type="button" data-testid="send-button">Send</button>
  </form></main></body></html>`, {
    url: 'https://chatgpt.com/c/retry-current-intelligence-picker',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const picker = document.querySelector('button.__composer-pill');
  const sendButton = document.querySelector('[data-testid="send-button"]');
  let menuOpens = 0;
  let instantClicks = 0;
  let sends = 0;

  picker.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const existing = document.querySelector('[data-radix-menu-content]');
    if (existing) {
      existing.remove();
      picker.dataset.state = 'closed';
      return;
    }
    menuOpens += 1;
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('data-radix-menu-content', '');
    menu.dataset.state = 'open';
    const content = document.createElement('div');
    content.dataset.testid = 'composer-intelligence-picker-content';
    content.setAttribute('role', 'group');
    for (const [level, version] of [['Instant', '5.5'], ['Medium', '5.6'], ['High', '5.6']]) {
      const option = document.createElement('div');
      option.setAttribute('role', 'menuitemradio');
      option.setAttribute('data-radix-collection-item', '');
      option.setAttribute('aria-checked', String(picker.textContent.startsWith(level)));
      option.dataset.state = picker.textContent.startsWith(level) ? 'checked' : 'unchecked';
      option.innerHTML = `<span>${level}</span><span>${version}</span>`;
      option.addEventListener('click', () => {
        if (level === 'Instant') instantClicks += 1;
        if (level === 'Instant' && instantClicks > 1) {
          picker.innerHTML = `<span>${level}</span><span>${version}</span>`;
          return;
        }
        if (level !== 'Instant') picker.innerHTML = `<span>${level}</span><span>${version}</span>`;
        picker.dataset.state = 'closed';
        menu.remove();
      });
      content.append(option);
    }
    menu.append(content);
    document.body.append(menu);
    picker.dataset.state = 'open';
  });
  sendButton.addEventListener('click', () => { sends += 1; });

  const app = toolkit.createApp(document, dom.window);
  await app.start();
  t.after(() => {
    if (app.state.observer) app.state.observer.disconnect();
    dom.window.close();
  });

  sendButton.click();
  await finishAdaptiveSend({ app });

  assert.equal(menuOpens, 2, 'an unreflected first click should be verified in a newly opened menu');
  assert.equal(instantClicks, 2, 'the still-unchecked exact Instant row should be retried once');
  assert.equal(picker.textContent, 'Instant5.5');
  assert.equal(picker.dataset.state, 'closed');
  assert.equal(document.querySelector('[data-radix-menu-content]'), null, 'verification menu should close after retry success');
  assert.equal(sends, 1);
  assert.equal(app.state.lastRouteDecision.target, 'instant');
  assert.equal(app.state.lastRouteDecision.level, 'instant');
  assert.equal(document.querySelector('[data-cgs-auto-badge]').textContent, 'Auto → Instant');
});

test('generic Tools pill is never opened while simple math switches High to Instant', async (t) => {
  const dom = new JSDOM(`<!doctype html><html><body><main><div data-composer-surface="true"><form>
    <button type="button" class="__composer-pill" id="radix-model-tools-decoy" data-testid="model-switcher" aria-haspopup="menu" aria-expanded="false">High</button>
    <textarea id="prompt-textarea">what is 2+2</textarea>
    <button type="button" class="__composer-pill" id="radix-tools-decoy" aria-haspopup="menu" aria-expanded="false">Tools</button>
    <button type="button" class="__composer-pill" id="radix-temporary-decoy" aria-haspopup="menu" aria-expanded="false">Temporary</button>
    <button type="button" data-testid="send-button">Send</button>
  </form></div>
  <button type="button" id="model-feedback-decoy" aria-label="Model response feedback" aria-haspopup="menu" aria-expanded="false">Feedback</button>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/tools-pill-decoy',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const picker = document.querySelector('#radix-model-tools-decoy');
  const toolsButton = document.querySelector('#radix-tools-decoy');
  const temporaryButton = document.querySelector('#radix-temporary-decoy');
  const feedbackButton = document.querySelector('#model-feedback-decoy');
  const sendButton = document.querySelector('[data-testid="send-button"]');
  let pickerClicks = 0;
  let toolsClicks = 0;
  let temporaryClicks = 0;
  let feedbackClicks = 0;
  let optionClicks = 0;
  let sends = 0;

  picker.addEventListener('click', () => {
    pickerClicks += 1;
    const existing = document.querySelector('#tools-decoy-model-menu');
    if (existing) {
      existing.remove();
      picker.setAttribute('aria-expanded', 'false');
      return;
    }
    const menu = document.createElement('div');
    menu.id = 'tools-decoy-model-menu';
    menu.setAttribute('role', 'menu');
    for (const label of ['Instant', 'High']) {
      const option = document.createElement('button');
      option.type = 'button';
      option.setAttribute('role', 'menuitem');
      option.textContent = label;
      option.addEventListener('click', () => {
        optionClicks += 1;
        picker.textContent = label;
        picker.setAttribute('aria-expanded', 'false');
        menu.remove();
      });
      menu.append(option);
    }
    document.body.append(menu);
    picker.setAttribute('aria-expanded', 'true');
  });
  toolsButton.addEventListener('click', () => {
    toolsClicks += 1;
    toolsButton.setAttribute('aria-expanded', toolsButton.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
  });
  temporaryButton.addEventListener('click', () => {
    temporaryClicks += 1;
    temporaryButton.setAttribute('aria-expanded', temporaryButton.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
  });
  feedbackButton.addEventListener('click', () => {
    feedbackClicks += 1;
    feedbackButton.setAttribute('aria-expanded', feedbackButton.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
  });
  sendButton.addEventListener('click', () => { sends += 1; });

  const app = toolkit.createApp(document, dom.window, { routingDiscoveryTimeout: 120 });
  await app.start();
  t.after(() => {
    if (app.state.observer) app.state.observer.disconnect();
    dom.window.close();
  });

  const startedAt = Date.now();
  sendButton.click();
  await finishAdaptiveSend({ app });
  const elapsed = Date.now() - startedAt;

  assert.equal(toolsClicks, 0, 'a non-level Tools pill must never be probed as a reasoning picker');
  assert.equal(temporaryClicks, 0, 'an unrelated composer pill must never be probed as a reasoning picker');
  assert.equal(feedbackClicks, 0, 'a popup that merely mentions model feedback must never be probed');
  assert.equal(pickerClicks, 1);
  assert.equal(optionClicks, 1);
  assert.equal(toolkit.extractModelLevel(toolkit.accessibleText(picker)), 'instant');
  assert.equal(sends, 1);
  assert.ok(elapsed < 500, `simple routing should not wait on Tools, received ${elapsed}ms`);
  assert.equal(app.state.lastRouteDecision.level, 'instant');
});

test('unannotated portaled intelligence rows switch High to Instant', async (t) => {
  const dom = new JSDOM(`<!doctype html><html><body><main><form>
    <button type="button" data-testid="composer-intelligence-level" aria-label="Intelligence level: High" aria-expanded="false">High</button>
    <textarea id="prompt-textarea">what is 2+2</textarea>
    <button type="button" data-testid="send-button">Send</button>
  </form></main></body></html>`, {
    url: 'https://chatgpt.com/c/plain-portaled-intelligence-picker',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const picker = document.querySelector('[data-testid="composer-intelligence-level"]');
  const sendButton = document.querySelector('[data-testid="send-button"]');
  let sends = 0;
  let optionClicks = 0;
  let unrelatedClicks = 0;

  picker.addEventListener('click', () => {
    if (picker.getAttribute('aria-expanded') === 'true') {
      document.querySelector('.unannotated-intelligence-portal')?.remove();
      document.querySelector('.concurrent-intelligence-status')?.remove();
      picker.setAttribute('aria-expanded', 'false');
      return;
    }
    const unrelated = document.createElement('div');
    unrelated.className = 'concurrent-intelligence-status';
    unrelated.setAttribute('aria-label', 'Intelligence status');
    const loneLevel = document.createElement('span');
    loneLevel.textContent = 'Instant';
    loneLevel.addEventListener('click', () => { unrelatedClicks += 1; });
    unrelated.append(loneLevel);
    document.body.append(unrelated);

    const portal = document.createElement('div');
    portal.className = 'unannotated-intelligence-portal';
    const items = document.createElement('div');
    items.className = 'items';
    for (const [level, description] of [
      ['Instant', 'Fast for everyday questions'],
      ['Medium', 'Balances speed and reasoning'],
      ['High', 'Uses deeper reasoning'],
    ]) {
      const option = document.createElement('div');
      option.className = 'plain-intelligence-row';
      option.innerHTML = `<span>${level}</span><small>${description}</small>`;
      option.addEventListener('click', () => {
        optionClicks += 1;
        picker.textContent = level;
        picker.setAttribute('aria-label', `Intelligence level: ${level}`);
        picker.setAttribute('aria-expanded', 'false');
        portal.remove();
        unrelated.remove();
      });
      items.append(option);
    }
    portal.append(items);
    document.body.append(portal);
    picker.setAttribute('aria-expanded', 'true');
  });
  sendButton.addEventListener('click', () => { sends += 1; });

  const app = toolkit.createApp(document, dom.window);
  await app.start();
  t.after(() => {
    if (app.state.observer) app.state.observer.disconnect();
    dom.window.close();
  });

  sendButton.click();
  await finishAdaptiveSend({ app });

  assert.equal(toolkit.extractModelLevel(toolkit.accessibleText(picker)), 'instant');
  assert.equal(optionClicks, 1);
  assert.equal(unrelatedClicks, 0, 'a concurrent subtree with only one level label must never be clicked');
  assert.equal(sends, 1);
  assert.equal(app.state.lastRouteDecision.target, 'instant');
  assert.equal(app.state.lastRouteDecision.level, 'instant');
  assert.doesNotMatch(document.querySelector('#cgs-toast').textContent, /no compatible auto level/iu);
});

test('simple math falls back from a High-only Intelligence menu to the base-model Instant option', async (t) => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <div data-composer-surface="true">
    <form>
      <button type="button" class="__composer-pill" id="radix-model" data-testid="model-switcher" aria-haspopup="menu" aria-label="Model: GPT-5.5" aria-expanded="false">GPT-5.5</button>
      <textarea id="prompt-textarea">what is 2+2</textarea>
      <button type="button" data-testid="send-button">Send</button>
    </form>
    <button type="button" class="__composer-pill" id="radix-intelligence" data-testid="composer-intelligence-level" aria-haspopup="menu" aria-label="Intelligence level: High" aria-expanded="false">High</button>
    </div>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/split-model-and-intelligence-menus',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const basePicker = document.querySelector('[data-testid="model-switcher"]');
  const intelligencePicker = document.querySelector('[data-testid="composer-intelligence-level"]');
  const sendButton = document.querySelector('[data-testid="send-button"]');
  let basePickerClicks = 0;
  let intelligencePickerClicks = 0;
  let baseOptionClicks = 0;
  let intelligenceOptionClicks = 0;
  let sends = 0;

  const installMenu = (picker, menuId, labels, onChoice) => {
    const existing = document.querySelector(`#${menuId}`);
    if (existing) {
      existing.remove();
      picker.setAttribute('aria-expanded', 'false');
      return;
    }
    const menu = document.createElement('div');
    menu.id = menuId;
    menu.setAttribute('role', 'menu');
    for (const label of labels) {
      const option = document.createElement('button');
      option.type = 'button';
      option.setAttribute('role', 'menuitem');
      option.textContent = label;
      option.addEventListener('click', () => {
        onChoice(label);
        picker.setAttribute('aria-expanded', 'false');
        menu.remove();
      });
      menu.append(option);
    }
    document.body.append(menu);
    picker.setAttribute('aria-expanded', 'true');
  };

  basePicker.addEventListener('click', () => {
    basePickerClicks += 1;
    installMenu(basePicker, 'base-model-menu', ['Instant', 'Thinking', 'Pro'], (label) => {
      baseOptionClicks += 1;
      basePicker.textContent = label;
      basePicker.setAttribute('aria-label', `Model: ${label}`);
    });
  });
  intelligencePicker.addEventListener('click', () => {
    intelligencePickerClicks += 1;
    installMenu(intelligencePicker, 'intelligence-menu', ['Standard', 'High', 'Extra High'], (label) => {
      intelligenceOptionClicks += 1;
      intelligencePicker.textContent = label;
      intelligencePicker.setAttribute('aria-label', `Intelligence level: ${label}`);
    });
  });
  sendButton.addEventListener('click', () => { sends += 1; });

  const app = toolkit.createApp(document, dom.window);
  await app.start();
  t.after(() => {
    if (app.state.observer) app.state.observer.disconnect();
    dom.window.close();
  });

  sendButton.click();
  await finishAdaptiveSend({ app });

  assert.ok(intelligencePickerClicks <= 2, 'the Intelligence menu may be probed once and then closed');
  assert.equal(intelligenceOptionClicks, 0, 'a harder Intelligence level must not substitute for Instant');
  assert.equal(basePickerClicks, 1);
  assert.equal(baseOptionClicks, 1);
  assert.equal(toolkit.extractModelLevel(toolkit.accessibleText(basePicker)), 'instant');
  assert.equal(sends, 1);
  assert.equal(app.state.lastRouteDecision.target, 'instant');
  assert.equal(app.state.lastRouteDecision.level, 'instant');
});

test('alternate picker probes share one budget and keep the draft when Instant cannot be activated', async (t) => {
  const dom = new JSDOM(`<!doctype html><html><body><main><div data-composer-surface="true">
    <form>
      <button type="button" class="__composer-pill" id="radix-model-timeout" data-testid="model-switcher" aria-haspopup="menu" aria-expanded="false">GPT-5.5</button>
      <textarea id="prompt-textarea">what is 2+2</textarea>
      <button type="button" data-testid="send-button">Send</button>
    </form>
    <button type="button" class="__composer-pill" id="radix-intelligence-timeout" data-testid="composer-intelligence-level" aria-haspopup="menu" aria-label="Intelligence level: High" aria-expanded="false">High</button>
  </div></main></body></html>`, {
    url: 'https://chatgpt.com/c/shared-routing-timeout',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const composer = document.querySelector('#prompt-textarea');
  const sendButton = document.querySelector('[data-testid="send-button"]');
  const composerInputValues = [];
  let sends = 0;
  composer.addEventListener('input', (event) => {
    composerInputValues.push({ data: event.data, value: composer.value });
  });
  for (const picker of document.querySelectorAll('button[aria-expanded]')) {
    picker.addEventListener('click', () => {
      picker.setAttribute('aria-expanded', picker.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
    });
  }
  sendButton.addEventListener('click', () => { sends += 1; });

  const app = toolkit.createApp(document, dom.window, { routingDiscoveryTimeout: 160 });
  await app.start();
  t.after(() => {
    if (app.state.observer) app.state.observer.disconnect();
    dom.window.close();
  });

  const startedAt = Date.now();
  sendButton.click();
  await finishAdaptiveSend({ app });
  const elapsed = Date.now() - startedAt;

  assert.ok(elapsed < 300, `both picker probes must share one 160ms discovery budget, received ${elapsed}ms`);
  assert.equal(sends, 0, 'Auto must not silently send with High after choosing Instant');
  assert.equal(app.state.lastRouteDecision, null);
  const warning = 'Adaptive Auto chose Instant but could not activate it. Your draft was not sent.';
  const toast = document.querySelector('#cgs-toast');
  assert.equal(toast.textContent, warning);
  assert.equal(composer.value, 'what is 2+2');
  assert.deepEqual(composerInputValues, [], 'showing the warning must not dispatch input or alter the draft');
  assert.equal(composer.contains(toast), false, 'the warning toast must remain outside the native composer');
  const warningTextParents = [];
  const walker = document.createTreeWalker(document.body, dom.window.NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue.includes(warning)) warningTextParents.push(walker.currentNode.parentElement.id);
  }
  assert.deepEqual(warningTextParents, ['cgs-toast'], 'the warning text must exist only in the injected toast');
});

test('alternate picker gets an immediate scan after the shared wait budget is exhausted', async (t) => {
  const dom = new JSDOM(`<!doctype html><html><body><main><div data-composer-surface="true">
    <form>
      <button type="button" class="__composer-pill" id="radix-model-immediate" data-testid="model-switcher" aria-haspopup="menu" aria-expanded="false">GPT-5.5</button>
      <textarea id="prompt-textarea">what is 2+2</textarea>
      <button type="button" data-testid="send-button">Send</button>
    </form>
    <button type="button" class="__composer-pill" id="radix-intelligence-immediate" data-testid="composer-intelligence-level" aria-haspopup="menu" aria-label="Intelligence level: High" aria-expanded="false">High</button>
  </div></main></body></html>`, {
    url: 'https://chatgpt.com/c/immediate-alternate-picker',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const basePicker = document.querySelector('[data-testid="model-switcher"]');
  const intelligencePicker = document.querySelector('[data-testid="composer-intelligence-level"]');
  const sendButton = document.querySelector('[data-testid="send-button"]');
  let instantClicks = 0;
  let sends = 0;

  intelligencePicker.addEventListener('click', () => {
    intelligencePicker.setAttribute('aria-expanded', intelligencePicker.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
  });
  basePicker.addEventListener('click', () => {
    const existing = document.querySelector('#immediate-base-menu');
    if (existing) {
      existing.remove();
      basePicker.setAttribute('aria-expanded', 'false');
      return;
    }
    const menu = document.createElement('div');
    menu.id = 'immediate-base-menu';
    menu.setAttribute('role', 'menu');
    const instant = document.createElement('button');
    instant.type = 'button';
    instant.setAttribute('role', 'menuitem');
    instant.textContent = 'Instant';
    instant.addEventListener('click', () => {
      instantClicks += 1;
      basePicker.textContent = 'Instant';
      basePicker.setAttribute('aria-label', 'Model: Instant');
      basePicker.setAttribute('aria-expanded', 'false');
      menu.remove();
    });
    menu.append(instant);
    document.body.append(menu);
    basePicker.setAttribute('aria-expanded', 'true');
  });
  sendButton.addEventListener('click', () => { sends += 1; });

  const app = toolkit.createApp(document, dom.window, { routingDiscoveryTimeout: 80 });
  await app.start();
  t.after(() => {
    if (app.state.observer) app.state.observer.disconnect();
    dom.window.close();
  });

  sendButton.click();
  await finishAdaptiveSend({ app });

  assert.equal(instantClicks, 1, 'the synchronously visible alternate option must still be selected');
  assert.equal(toolkit.extractModelLevel(toolkit.accessibleText(basePicker)), 'instant');
  assert.equal(sends, 1);
  assert.equal(app.state.lastRouteDecision.level, 'instant');
});

test('rerendered base picker confirms Instant after alternate-picker fallback', async (t) => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <form>
      <button type="button" data-testid="model-switcher" aria-label="Model: GPT-5.5" aria-expanded="false">GPT-5.5</button>
      <textarea id="prompt-textarea">what is 2+2</textarea>
      <button type="button" data-testid="send-button">Send</button>
    </form>
    <button type="button" data-testid="composer-intelligence-level" aria-label="Intelligence level: High" aria-expanded="false">High</button>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/rerendered-alternate-picker',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  let basePicker = document.querySelector('[data-testid="model-switcher"]');
  const intelligencePicker = document.querySelector('[data-testid="composer-intelligence-level"]');
  const sendButton = document.querySelector('[data-testid="send-button"]');
  let baseOptionClicks = 0;
  let sends = 0;

  const toggleMenu = (picker, menuId, labels, onChoice) => {
    const existing = document.querySelector(`#${menuId}`);
    if (existing) {
      existing.remove();
      picker.setAttribute('aria-expanded', 'false');
      return;
    }
    const menu = document.createElement('div');
    menu.id = menuId;
    menu.setAttribute('role', 'menu');
    for (const label of labels) {
      const option = document.createElement('button');
      option.type = 'button';
      option.setAttribute('role', 'menuitem');
      option.textContent = label;
      option.addEventListener('click', () => {
        menu.remove();
        onChoice(label);
      });
      menu.append(option);
    }
    document.body.append(menu);
    picker.setAttribute('aria-expanded', 'true');
  };

  intelligencePicker.addEventListener('click', () => {
    toggleMenu(intelligencePicker, 'rerender-effort-menu', ['Standard', 'High', 'Extra High'], () => {});
  });
  basePicker.addEventListener('click', () => {
    toggleMenu(basePicker, 'rerender-base-menu', ['Instant', 'Thinking', 'Pro'], (label) => {
      if (label !== 'Instant') return;
      baseOptionClicks += 1;
      const replacement = document.createElement('button');
      replacement.type = 'button';
      replacement.dataset.testid = 'model-switcher';
      replacement.setAttribute('aria-label', 'Model: Instant');
      replacement.innerHTML = '<span>Instant</span><span>5.5</span>';
      basePicker.replaceWith(replacement);
      intelligencePicker.remove();
      basePicker = replacement;
    });
  });
  sendButton.addEventListener('click', () => { sends += 1; });

  const app = toolkit.createApp(document, dom.window);
  await app.start();
  t.after(() => {
    if (app.state.observer) app.state.observer.disconnect();
    dom.window.close();
  });

  sendButton.click();
  await finishAdaptiveSend({ app });

  assert.equal(baseOptionClicks, 1);
  assert.equal(basePicker.textContent, 'Instant5.5');
  assert.equal(toolkit.extractModelLevel(toolkit.accessibleText(basePicker)), 'instant');
  assert.equal(sends, 1);
  assert.equal(app.state.lastRouteDecision.target, 'instant');
  assert.equal(app.state.lastRouteDecision.level, 'instant');
  assert.doesNotMatch(document.querySelector('#cgs-toast').textContent, /did not confirm|no compatible/iu);
});

test('simple math uses the local Intelligence control instead of a separate base-model picker', async (t) => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <form>
      <button type="button" data-testid="model-switcher" aria-label="Model: GPT-5.5" aria-expanded="false">GPT-5.5</button>
      <textarea id="prompt-textarea">what is 2+2</textarea>
      <button type="button" data-testid="send-button">Send</button>
    </form>
    <button type="button" data-testid="composer-intelligence-level" aria-label="Intelligence level: High" aria-expanded="false">High</button>
    <div data-radix-popper-content-wrapper data-state="closed">
      <div data-slot="dropdown-menu-content" data-state="closed" role="menu">
        <div role="menuitemradio" tabindex="-1">Instant</div>
        <div role="menuitemradio" tabindex="-1">Medium</div>
        <div role="menuitemradio" tabindex="-1">High</div>
      </div>
    </div>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/separate-intelligence-picker',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const basePicker = document.querySelector('[data-testid="model-switcher"]');
  const intelligencePicker = document.querySelector('[data-testid="composer-intelligence-level"]');
  const popper = document.querySelector('[data-radix-popper-content-wrapper]');
  const menu = document.querySelector('[data-slot="dropdown-menu-content"]');
  const options = [...menu.querySelectorAll('[role="menuitemradio"]')];
  const sendButton = document.querySelector('[data-testid="send-button"]');
  let basePickerClicks = 0;
  let intelligencePickerClicks = 0;
  let optionClicks = 0;
  let decoyClicks = 0;
  let sends = 0;

  basePicker.addEventListener('click', () => { basePickerClicks += 1; });
  intelligencePicker.addEventListener('click', () => {
    intelligencePickerClicks += 1;
    const decoy = document.createElement('div');
    decoy.setAttribute('role', 'radiogroup');
    decoy.setAttribute('aria-label', 'Unrelated display setting');
    decoy.innerHTML = '<div role="radio" id="decoy-instant">Instant</div>';
    decoy.querySelector('#decoy-instant').addEventListener('click', () => { decoyClicks += 1; });
    document.body.append(decoy);
    popper.dataset.state = 'open';
    menu.dataset.state = 'open';
    intelligencePicker.setAttribute('aria-expanded', 'true');
  });
  for (const option of options) {
    option.addEventListener('click', () => {
      optionClicks += 1;
      const label = option.textContent.trim();
      intelligencePicker.textContent = label;
      intelligencePicker.setAttribute('aria-label', `Intelligence level: ${label}`);
      intelligencePicker.setAttribute('aria-expanded', 'false');
      menu.dataset.state = 'closed';
      popper.dataset.state = 'closed';
    });
  }
  sendButton.addEventListener('click', () => { sends += 1; });

  const app = toolkit.createApp(document, dom.window);
  await app.start();
  t.after(() => {
    if (app.state.observer) app.state.observer.disconnect();
    dom.window.close();
  });

  sendButton.click();
  await finishAdaptiveSend({ app });

  assert.equal(basePickerClicks, 0, 'the base-model control must not be used for an Intelligence-level change');
  assert.equal(intelligencePickerClicks, 1);
  assert.equal(optionClicks, 1);
  assert.equal(decoyClicks, 0, 'a concurrently mounted unrelated radio group must not be used as the Intelligence menu');
  assert.equal(toolkit.extractModelLevel(toolkit.accessibleText(intelligencePicker)), 'instant');
  assert.equal(sends, 1);
  assert.equal(app.state.lastRouteDecision.target, 'instant');
  assert.equal(app.state.lastRouteDecision.level, 'instant');
});

test('already-correct picker sends without opening the model menu', async (t) => {
  const harness = await createHarness({ prompt: 'Thanks!', pickerLevel: 'Instant' });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(harness.counters.pickerOpens, 0);
  assert.equal(harness.counters.optionClicks, 0);
  assert.equal(harness.counters.sends, 1);
});

test('ordinary prompt with no picker fails open and sends exactly once', async (t) => {
  const harness = await createHarness({
    prompt: 'Compare TCP and UDP for a beginner.',
    includePicker: false,
  });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(harness.counters.sends, 1);
  assert.match(harness.app.state.lastRouteDecision.reason, /model control unavailable/iu);
});

test('simple math with no picker stays unsent instead of silently using the current level', async (t) => {
  const prompt = 'what is 2+2';
  const harness = await createHarness({ prompt, includePicker: false });
  t.after(() => harness.cleanup());
  const feedbackButton = harness.document.createElement('button');
  feedbackButton.type = 'button';
  feedbackButton.setAttribute('aria-label', 'Model response feedback');
  feedbackButton.setAttribute('aria-haspopup', 'menu');
  feedbackButton.textContent = 'Feedback';
  let feedbackClicks = 0;
  feedbackButton.addEventListener('click', () => { feedbackClicks += 1; });
  harness.document.querySelector('main').append(feedbackButton);

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(feedbackClicks, 0, 'a popup that merely mentions model feedback must not be treated as a picker');
  assert.equal(harness.counters.sends, 0);
  assert.equal(harness.counters.requestSubmits, 0);
  assert.equal(harness.composer.value, prompt);
  assert.equal(harness.app.state.lastRouteDecision, null);
  assert.match(harness.document.querySelector('#cgs-toast').textContent, /could not find.*model control.*draft was not sent/iu);
});

test('explicit override with no picker fails closed and keeps the draft unsent', async (t) => {
  const prompt = '!route:pro\nSay hello.';
  const harness = await createHarness({ prompt, includePicker: false });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(harness.counters.sends, 0);
  assert.equal(harness.composer.value, prompt);
  assert.equal(harness.app.state.lastRouteDecision, null);
  assert.match(harness.document.querySelector('#cgs-toast').textContent, /could not find.*model control/iu);
});

test('plain Enter is captured, while Shift+Enter and IME Enter are untouched', async (t) => {
  const harness = await createHarness({ prompt: 'Thanks!', pickerLevel: 'Instant' });
  t.after(() => harness.cleanup());

  let bubbledPlainEnter = 0;
  harness.composer.closest('form').addEventListener('keydown', () => { bubbledPlainEnter += 1; });
  const plainEnter = new harness.window.KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
  });
  const plainDispatched = harness.composer.dispatchEvent(plainEnter);

  assert.equal(plainDispatched, false);
  assert.equal(plainEnter.defaultPrevented, true);
  assert.equal(bubbledPlainEnter, 0, 'the captured Enter must not reach ChatGPT before replay');
  await finishAdaptiveSend(harness);
  assert.equal(harness.counters.sends, 1);

  const shiftEnter = new harness.window.KeyboardEvent('keydown', {
    key: 'Enter',
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  assert.equal(harness.composer.dispatchEvent(shiftEnter), true);
  assert.equal(shiftEnter.defaultPrevented, false);
  assert.equal(harness.app.state.adaptiveSendPromise, null);

  harness.composer.dispatchEvent(new harness.window.CompositionEvent('compositionstart', { bubbles: true }));
  const imeEnter = new harness.window.KeyboardEvent('keydown', {
    key: 'Enter',
    keyCode: 229,
    isComposing: true,
    bubbles: true,
    cancelable: true,
  });
  assert.equal(harness.composer.dispatchEvent(imeEnter), true);
  assert.equal(imeEnter.defaultPrevented, false);
  assert.equal(harness.app.state.adaptiveSendPromise, null);
  harness.composer.dispatchEvent(new harness.window.CompositionEvent('compositionend', { bubbles: true }));
  assert.equal(harness.counters.sends, 1);
});

test('draft mutation before model activation cancels replay without opening the picker', async (t) => {
  const harness = await createHarness({
    prompt: 'Thanks!',
    pickerLevel: 'High',
    menuDelay: 40,
  });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  harness.composer.value = 'Changed while the menu was opening';
  await finishAdaptiveSend(harness);

  assert.equal(harness.counters.pickerOpens, 0);
  assert.equal(harness.counters.optionClicks, 0);
  assert.equal(harness.counters.sends, 0);
  assert.equal(harness.composer.value, 'Changed while the menu was opening');
  assert.match(harness.document.querySelector('#cgs-toast').textContent, /draft changed/iu);
});

test('active Deep Research bypasses model switching and sends once', async (t) => {
  const harness = await createHarness({
    prompt: 'Thanks!',
    pickerLevel: 'High',
    activeTool: 'Deep Research',
  });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(toolkit.extractModelLevel(toolkit.accessibleText(harness.picker)), 'high');
  assert.equal(harness.counters.pickerOpens, 0);
  assert.equal(harness.counters.optionClicks, 0);
  assert.equal(harness.counters.sends, 1);
  assert.match(harness.app.state.lastRouteDecision.reason, /kept current for Deep Research/iu);
});

test('active special mode cannot bypass the High minimum for a claimed-answer challenge', async (t) => {
  const prompt = "I don't get why the answer is 12V and 4V.";
  const harness = await createHarness({
    prompt,
    pickerLevel: 'Instant',
    activeTool: 'Deep Research',
  });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(harness.counters.pickerOpens, 0);
  assert.equal(harness.counters.optionClicks, 0);
  assert.equal(harness.counters.sends, 0);
  assert.equal(harness.composer.value, prompt);
  assert.equal(harness.app.state.lastRouteDecision, null);
  assert.match(harness.document.querySelector('#cgs-toast').textContent, /did not expose a confirmed High-or-stronger level.+not sent/iu);
});

test('a delayed native submit after replay consumes its permit without routing again', async (t) => {
  const harness = await createHarness({
    prompt: 'Thanks!',
    pickerLevel: 'Instant',
    delayedSubmitAfterClick: 5,
  });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);
  await wait(harness.window, 35);

  assert.equal(harness.counters.sends, 1, 'only the replayed click reaches the target');
  assert.equal(harness.counters.submits, 1, 'the framework-style delayed submit still occurs');
  assert.equal(harness.counters.pickerOpens, 0);
  assert.equal(harness.app.state.adaptiveSendPromise, null);
  assert.equal(harness.app.state.lastRouteDecision.level, 'instant');
});

test('Alt-click permits a later modifier-less submit to bypass Adaptive Auto', async (t) => {
  const harness = await createHarness({
    prompt: 'Thanks!',
    pickerLevel: 'High',
    delayedSubmitAfterClick: 5,
  });
  t.after(() => harness.cleanup());

  const altClick = new harness.window.MouseEvent('click', {
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  assert.equal(harness.sendButton.dispatchEvent(altClick), true);
  await wait(harness.window, 35);

  assert.equal(altClick.defaultPrevented, false);
  assert.equal(harness.counters.sends, 1);
  assert.equal(harness.counters.submits, 1);
  assert.equal(harness.counters.pickerOpens, 0);
  assert.equal(harness.app.state.adaptiveSendPromise, null);
  assert.equal(harness.app.state.lastRouteDecision, null);
  assert.equal(toolkit.extractModelLevel(toolkit.accessibleText(harness.picker)), 'high');
});

test('Send becoming disabled during model switching keeps the draft and never falls back to requestSubmit', async (t) => {
  const prompt = 'Thanks!';
  const harness = await createHarness({
    prompt,
    pickerLevel: 'High',
    disableSendOnOptionClick: true,
  });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(harness.sendButton.disabled, true);
  assert.equal(harness.counters.optionClicks, 1);
  assert.equal(harness.counters.sends, 0);
  assert.equal(harness.counters.requestSubmits, 0);
  assert.equal(harness.counters.submits, 0);
  assert.equal(harness.composer.value, prompt);
  assert.equal(harness.app.state.lastRouteDecision, null);
  assert.match(harness.document.querySelector('#cgs-toast').textContent, /Send control is not ready/iu);
});

test('ordinary unconfirmed Instant switch keeps the draft unsent', async (t) => {
  const harness = await createHarness({
    prompt: 'Thanks!',
    pickerLevel: 'High',
    reflectOptionSelection: false,
  });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(harness.counters.optionClicks, 1);
  assert.equal(harness.counters.sends, 0);
  assert.equal(harness.counters.requestSubmits, 0);
  assert.equal(harness.composer.value, 'Thanks!');
  assert.equal(toolkit.extractModelLevel(toolkit.accessibleText(harness.picker)), 'high');
  assert.equal(harness.app.state.lastRouteDecision, null);
  assert.match(harness.document.querySelector('#cgs-toast').textContent, /did not confirm Instant.*draft was not sent/iu);
});

test('explicit unconfirmed switch stays unsent', async (t) => {
  const prompt = '!route:instant\nSay hello.';
  const harness = await createHarness({
    prompt,
    pickerLevel: 'High',
    reflectOptionSelection: false,
  });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(harness.counters.optionClicks, 1);
  assert.equal(harness.counters.sends, 0);
  assert.equal(harness.counters.requestSubmits, 0);
  assert.equal(harness.composer.value, prompt);
  assert.equal(harness.app.state.lastRouteDecision, null);
  assert.equal(toolkit.extractModelLevel(toolkit.accessibleText(harness.picker)), 'high');
  assert.match(harness.document.querySelector('#cgs-toast').textContent, /did not confirm Instant/iu);
});

test('explicit route does not substitute a different available level', async (t) => {
  const prompt = '!route:high\nExplain this.';
  const harness = await createHarness({
    prompt,
    pickerLevel: 'Medium',
    modelLevels: ['Instant', 'Medium', 'Extra High'],
  });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(harness.counters.optionClicks, 0);
  assert.equal(harness.counters.sends, 0);
  assert.equal(harness.composer.value, prompt);
  assert.match(harness.document.querySelector('#cgs-toast').textContent, /High is not available as an exact option/iu);
});

test('high-stakes heuristic with no picker fails open', async (t) => {
  const prompt = 'Can I take ibuprofen while using warfarin? Please tell me the safe dose.';
  const decision = toolkit.classifyPrompt(prompt);
  assert.equal(decision.explicit, false);
  assert.ok(decision.reasons.includes('personal high-stakes question'));

  const harness = await createHarness({ prompt, includePicker: false });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(harness.counters.sends, 1);
  assert.equal(harness.app.state.lastRouteDecision.target, 'high');
  assert.match(harness.app.state.lastRouteDecision.reason, /model control unavailable/iu);
});

test('model option selectors accept leading Instant auto text and reject Configure rows', () => {
  assert.equal(toolkit.extractModelLevel('Instant — Automatic switching enabled'), 'instant');
  assert.equal(toolkit.extractModelLevel('Configure Instant automatic switching'), '');

  const dom = new JSDOM(`<!doctype html><html><body>
    <div role="menu">
      <button role="menuitem" id="instant-auto">Instant — Automatic switching enabled</button>
      <button role="menuitem" id="configure">Configure Instant automatic switching</button>
      <button role="menuitem" id="settings">Settings High reasoning</button>
      <button role="menuitem" id="school">High school tutor</button>
      <button role="menuitem" id="upgrade">Upgrade to Pro</button>
      <button role="menuitem" id="unlock">Unlock Extra High with Pro</button>
      <button role="menuitem" id="try">Try Pro</button>
      <button role="menuitem" id="label-first">Pro — Upgrade your plan</button>
      <div role="menuitem" id="nested-upgrade"><span>Upgrade your plan</span><button id="nested-pro">Pro</button></div>
      <button role="menuitem" id="plan-only">Pro plan only</button>
      <button role="menuitem" id="included">Included with Pro</button>
      <button role="menuitem" id="requires">Requires Pro</button>
      <button role="menuitem" id="pro-only">Extra High — Pro only</button>
    </div>
  </body></html>`, { url: 'https://chatgpt.com/c/selectors' });
  try {
    const options = toolkit.findModelOptions(dom.window.document);
    assert.deepEqual(options.map((node) => node.id), ['instant-auto']);
  } finally {
    dom.window.close();
  }
});

test('model option selectors recognize radio-style intelligence rows', () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div data-slot="dropdown-menu-content" data-state="open">
      <div role="menuitemradio" id="instant">Instant</div>
      <div role="menuitemradio" id="medium">Medium</div>
      <div role="menuitemradio" id="high">High</div>
    </div>
  </body></html>`, { url: 'https://chatgpt.com/c/radio-options' });
  try {
    assert.deepEqual(
      toolkit.findModelOptions(dom.window.document).map((node) => node.id),
      ['instant', 'medium', 'high'],
    );
  } finally {
    dom.window.close();
  }
});

test('model option selectors recognize plain current-style buttons and accessible labels', () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div class="unannotated-model-portal" id="portal">
      <button type="button" data-testid="model-switcher-option-instant" data-state="checked" aria-checked="true" id="nested-label" aria-label="Instant — Fast for everyday questions">
        <span>Instant</span><small>Fast for everyday questions</small>
      </button>
      <button type="button" data-testid="model-switcher-option-instant-compact" id="accessible-label" aria-label="Instant, fast responses"></button>
      <button type="button" data-testid="model-switcher-configure" id="configure">Configure Instant automatic switching</button>
      <button type="button" data-testid="model-switcher-option-pro" id="disabled" disabled>Pro</button>
    </div>
  </body></html>`, { url: 'https://chatgpt.com/c/plain-option-labels' });
  try {
    assert.deepEqual(
      toolkit.findModelOptions(dom.window.document.querySelector('#portal')).map((node) => node.id),
      ['nested-label', 'accessible-label'],
    );
  } finally {
    dom.window.close();
  }
});

test('two-stage Thinking picker selects the requested reasoning effort before sending', async (t) => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <form>
      <button type="button" data-testid="model-switcher" aria-controls="base-menu" aria-expanded="false">Instant</button>
      <textarea id="prompt-textarea">!route:high\nProve this carefully.</textarea>
      <button type="button" data-testid="send-button">Send</button>
    </form>
    <div id="base-menu" role="menu" hidden></div>
    <div id="effort-menu" role="menu" hidden></div>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/two-stage',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const form = document.querySelector('form');
  const modelPicker = document.querySelector('[data-testid="model-switcher"]');
  const baseMenu = document.querySelector('#base-menu');
  const effortMenu = document.querySelector('#effort-menu');
  const sendButton = document.querySelector('[data-testid="send-button"]');
  let sends = 0;
  let proClicks = 0;
  let restoredEffort = 'Standard';

  const closeBase = () => {
    baseMenu.hidden = true;
    modelPicker.setAttribute('aria-expanded', 'false');
  };
  modelPicker.addEventListener('click', () => {
    baseMenu.replaceChildren();
    for (const label of ['Instant', 'Thinking', 'Pro']) {
      const option = document.createElement('button');
      option.type = 'button';
      option.role = 'menuitem';
      option.textContent = label;
      option.addEventListener('click', () => {
        if (label === 'Pro') proClicks += 1;
        modelPicker.textContent = label;
        closeBase();
        if (label !== 'Thinking' || document.querySelector('[data-testid="reasoning-effort"]')) return;
        const effortPicker = document.createElement('button');
        effortPicker.type = 'button';
        effortPicker.dataset.testid = 'reasoning-effort';
        effortPicker.setAttribute('aria-label', `Reasoning effort: ${restoredEffort}`);
        effortPicker.setAttribute('aria-controls', 'effort-menu');
        effortPicker.setAttribute('aria-expanded', 'false');
        effortPicker.textContent = restoredEffort;
        effortPicker.addEventListener('click', () => {
          effortMenu.replaceChildren();
          for (const effort of ['Standard', 'Extended', 'Heavy']) {
            const effortOption = document.createElement('button');
            effortOption.type = 'button';
            effortOption.role = 'menuitem';
            effortOption.textContent = effort;
            effortOption.addEventListener('click', () => {
              effortPicker.textContent = effort;
              effortPicker.setAttribute('aria-label', `Reasoning effort: ${effort}`);
              effortPicker.setAttribute('aria-expanded', 'false');
              effortMenu.hidden = true;
            });
            effortMenu.append(effortOption);
          }
          effortMenu.hidden = false;
          effortPicker.setAttribute('aria-expanded', 'true');
        });
        form.insertBefore(effortPicker, document.querySelector('#prompt-textarea'));
      });
      baseMenu.append(option);
    }
    baseMenu.hidden = false;
    modelPicker.setAttribute('aria-expanded', 'true');
  });
  sendButton.addEventListener('click', () => { sends += 1; });

  const app = toolkit.createApp(document, dom.window);
  await app.start();
  t.after(() => {
    if (app.state.observer) app.state.observer.disconnect();
    dom.window.close();
  });

  sendButton.click();
  await finishAdaptiveSend({ app });

  const effortPicker = document.querySelector('[data-testid="reasoning-effort"]');
  assert.equal(toolkit.extractModelLevel(modelPicker.textContent), 'medium');
  assert.equal(toolkit.extractModelLevel(effortPicker.getAttribute('aria-label')), 'high');
  assert.equal(proClicks, 0);
  assert.equal(sends, 1);
  assert.equal(app.state.lastRouteDecision.level, 'high');

  effortPicker.remove();
  restoredEffort = 'High';
  modelPicker.textContent = 'Instant';
  document.querySelector('#prompt-textarea').value = '!route:high\nCheck this too.';
  sendButton.click();
  await finishAdaptiveSend({ app });

  const restoredPicker = document.querySelector('[data-testid="reasoning-effort"]');
  assert.equal(toolkit.extractModelLevel(restoredPicker.getAttribute('aria-label')), 'high');
  assert.equal(proClicks, 0, 'a restored effort must not make staging jump to Pro');
  assert.equal(sends, 2);
  assert.equal(app.state.lastRouteDecision.level, 'high');

  restoredPicker.remove();
  restoredEffort = 'High';
  modelPicker.textContent = 'Instant';
  document.querySelector('#prompt-textarea').value = 'Compare TCP and UDP for a beginner.';
  sendButton.click();
  await finishAdaptiveSend({ app });

  const correctedMediumPicker = document.querySelector('[data-testid="reasoning-effort"]');
  assert.equal(toolkit.extractModelLevel(correctedMediumPicker.getAttribute('aria-label')), 'medium');
  assert.equal(proClicks, 0, 'a Medium target must correct a retained High effort instead of jumping to Pro');
  assert.equal(sends, 3);
  assert.equal(app.state.lastRouteDecision.target, 'medium');
  assert.equal(app.state.lastRouteDecision.level, 'medium');
});
