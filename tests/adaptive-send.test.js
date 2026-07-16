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
