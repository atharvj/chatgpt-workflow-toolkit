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
  } = options;
  const pickerMarkup = includePicker
    ? `<button type="button" data-testid="model-switcher" aria-controls="model-menu" aria-expanded="false">${pickerLevel}</button>`
    : '';
  const toolMarkup = activeTool
    ? `<button type="button" aria-pressed="true">${activeTool}</button>`
    : '';
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <form>
      ${pickerMarkup}
      ${toolMarkup}
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

test('current version-badged composer picker switches High5.6 to Instant5.5', async (t) => {
  const dom = new JSDOM(`<!doctype html><html><body><main>
    <div data-composer-surface="true"><form>
      <textarea id="prompt-textarea">what is 2+2</textarea>
      <button type="button" class="__composer-pill" id="radix-r1" aria-haspopup="menu"><span>High</span><span>5.6</span></button>
      <button type="button" data-testid="send-button">Send</button>
    </form></div>
  </main></body></html>`, {
    url: 'https://chatgpt.com/c/version-badged-intelligence-picker',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const picker = document.querySelector('#radix-r1');
  const sendButton = document.querySelector('[data-testid="send-button"]');
  let sends = 0;
  let optionClicks = 0;

  picker.addEventListener('click', () => {
    const existing = document.querySelector('[data-radix-menu-content]');
    if (existing) {
      existing.remove();
      return;
    }
    const portal = document.createElement('div');
    portal.setAttribute('role', 'menu');
    portal.dataset.state = 'open';
    portal.setAttribute('data-radix-menu-content', '');
    portal.setAttribute('aria-labelledby', picker.id);
    const content = document.createElement('div');
    content.dataset.testid = 'composer-intelligence-picker-content';
    for (const [level, version] of [['Instant', '5.5'], ['Medium', '5.6'], ['High', '5.6']]) {
      const option = document.createElement('div');
      option.setAttribute('role', 'menuitemradio');
      option.setAttribute('data-radix-collection-item', '');
      option.dataset.testid = `model-switcher-${level.toLocaleLowerCase('en-US')}`;
      option.innerHTML = `<span>${level}</span><span>${version}</span>`;
      option.addEventListener('click', () => {
        optionClicks += 1;
        picker.innerHTML = `<span>${level}</span><span>${version}</span>`;
        portal.remove();
      });
      content.append(option);
    }
    portal.append(content);
    document.body.append(portal);
  });
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
  assert.equal(optionClicks, 1);
  assert.equal(sends, 1);
  assert.equal(app.state.lastRouteDecision.target, 'instant');
  assert.equal(app.state.lastRouteDecision.level, 'instant');
  assert.doesNotMatch(document.querySelector('#cgs-toast').textContent, /no compatible auto level/iu);
});

test('generic Tools pill is never opened while simple math switches High to Instant', async (t) => {
  const dom = new JSDOM(`<!doctype html><html><body><main><div data-composer-surface="true"><form>
    <button type="button" class="__composer-pill" id="radix-model-tools-decoy" data-testid="model-switcher" aria-haspopup="menu" aria-expanded="false">High</button>
    <textarea id="prompt-textarea">what is 2+2</textarea>
    <button type="button" class="__composer-pill" id="radix-tools-decoy" aria-haspopup="menu" aria-expanded="false">Tools</button>
    <button type="button" data-testid="send-button">Send</button>
  </form></div></main></body></html>`, {
    url: 'https://chatgpt.com/c/tools-pill-decoy',
    pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const picker = document.querySelector('#radix-model-tools-decoy');
  const toolsButton = document.querySelector('#radix-tools-decoy');
  const sendButton = document.querySelector('[data-testid="send-button"]');
  let pickerClicks = 0;
  let toolsClicks = 0;
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

test('alternate picker probes share one discovery timeout budget', async (t) => {
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
  const sendButton = document.querySelector('[data-testid="send-button"]');
  let sends = 0;
  for (const picker of document.querySelectorAll('button[aria-expanded]')) {
    picker.addEventListener('click', () => {
      picker.setAttribute('aria-expanded', picker.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
    });
  }
  sendButton.addEventListener('click', () => { sends += 1; });

  const app = toolkit.createApp(document, dom.window, { routingDiscoveryTimeout: 80 });
  await app.start();
  const nativeSetTimeout = dom.window.setTimeout.bind(dom.window);
  const discoveryTimeouts = [];
  dom.window.setTimeout = (callback, delay, ...args) => {
    if (delay >= 50 && delay <= 100) discoveryTimeouts.push(delay);
    return nativeSetTimeout(callback, delay, ...args);
  };
  t.after(() => {
    if (app.state.observer) app.state.observer.disconnect();
    dom.window.close();
  });

  const startedAt = Date.now();
  sendButton.click();
  await finishAdaptiveSend({ app });
  const elapsed = Date.now() - startedAt;

  assert.equal(discoveryTimeouts.length, 1, 'both picker probes must consume one timeout, not one timeout each');
  assert.ok(elapsed < 500, `the bounded test route should finish promptly, received ${elapsed}ms`);
  assert.equal(sends, 1);
  assert.match(app.state.lastRouteDecision.reason, /no compatible option/iu);
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

test('draft mutation while a delayed model menu opens cancels replay', async (t) => {
  const harness = await createHarness({
    prompt: 'Thanks!',
    pickerLevel: 'High',
    menuDelay: 40,
  });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  harness.composer.value = 'Changed while the menu was opening';
  await finishAdaptiveSend(harness);

  assert.equal(harness.counters.pickerOpens, 1);
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

test('ordinary unconfirmed switch sends with the reflected current level', async (t) => {
  const harness = await createHarness({
    prompt: 'Thanks!',
    pickerLevel: 'High',
    reflectOptionSelection: false,
  });
  t.after(() => harness.cleanup());

  harness.sendButton.click();
  await finishAdaptiveSend(harness);

  assert.equal(harness.counters.optionClicks, 1);
  assert.equal(harness.counters.sends, 1);
  assert.equal(toolkit.extractModelLevel(toolkit.accessibleText(harness.picker)), 'high');
  assert.equal(harness.app.state.lastRouteDecision.target, 'instant');
  assert.equal(harness.app.state.lastRouteDecision.level, 'high');
  assert.match(harness.app.state.lastRouteDecision.reason, /switch unconfirmed.*used current/iu);
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
