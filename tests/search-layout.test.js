'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const toolkit = require('../chatgpt-workflow-toolkit.user.js');

// User-supplied September layout, with synthetic text, message IDs and chat ID.
// Only the assistant ancestor markup was supplied; user/footer markup below
// covers supported variants rather than claiming a complete live-page capture.
function message(index, role, text) {
  return `<div class="group flex flex-col pb-2 pt-2"><div class="flex flex-col gap-3 browser:gap-1"><div class="block-BQZwFn">
    <div data-content-search-unit-key="fallback-turn-${index}:1:${role}" data-chatgpt-search-unit-key="fallback-turn-${index}:1:${role}" data-chatgpt-search-message-ids="message-${index} message-${index}">
      <div class="group flex min-w-0 flex-col" data-chatgpt-selection-conversation-id="local-chatgpt:fixture" data-chatgpt-selection-message-id="message-${index}">
        <div data-selected-text-overlay-target="fixture-${index}" dir="auto" data-markdown-text-style="${role}-message" class="MarkdownRoot-rZKhxa" style="--markdown-link-color: currentColor;">
          <p class="Paragraph-kKnbIo" dir="auto"><span>${text}</span></p>
        </div>
      </div>
    </div></div>
    ${role === 'assistant' ? '<button class="sources">Sources</button><div class="native-actions"><button aria-label="Copy">Copy</button><button aria-label="Good response">Good</button><button aria-label="More actions" aria-haspopup="menu">...</button></div>' : ''}
  </div></div>`;
}

async function fixture(t, values = new Map()) {
  const dom = new JSDOM(`<!doctype html><html><head><style>input { appearance: none; }</style></head><body><main>
    <div id="history">${message(0, 'user', 'Explain my lab.')}${message(1, 'assistant', 'First instruction. Second instruction.')}${message(2, 'user', 'Explain the next step.')}${message(3, 'assistant', 'A later answer.')}</div>
    <form><textarea id="prompt-textarea">Keep my draft.</textarea><button type="button" data-testid="send-button">Send</button></form>
    <input id="native-checkbox" type="checkbox">
  </main></body></html>`, { url: 'https://chatgpt.com/c/layout-test', pretendToBeVisual: true });
  const win = dom.window, doc = win.document;
  const previous = globalThis.GM;
  globalThis.GM = {
    async getValue(key, fallback) { return structuredClone(values.get(key) ?? fallback); },
    async setValue(key, value) { values.set(key, structuredClone(value)); },
    async deleteValue(key) { values.delete(key); },
  };
  const app = await toolkit.install(doc, win);
  app.processRoot(doc.body);
  const turns = toolkit.getTurns(doc);
  const footers = [...doc.querySelectorAll('.native-actions')];
  const click = (action) => doc.querySelector(`[data-cgs-action="${action}"]`).click();
  let sends = 0;
  doc.querySelector('[data-testid="send-button"]').onclick = () => sends++;
  win.open = () => assert.fail('opening a panel must not open a tab');
  t.after(() => {
    assert.equal(sends, 0);
    assert.equal(doc.querySelector('#prompt-textarea').value, 'Keep my draft.');
    app.state.observer.disconnect(); win.close();
    if (previous === undefined) delete globalThis.GM; else globalThis.GM = previous;
  });
  async function highlight() {
    const span = doc.querySelector('[data-markdown-text-style="assistant-message"] span');
    const range = doc.createRange(); range.setStart(span.firstChild, 0); range.setEnd(span.firstChild, 18);
    range.getBoundingClientRect = () => ({ left: 50, right: 220, top: 100, bottom: 130, width: 170, height: 30 });
    win.getSelection().removeAllRanges(); win.getSelection().addRange(range);
    span.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true }));
    await new Promise((resolve) => win.requestAnimationFrame(resolve));
  }
  return { win, doc, app, turns, footers, click, highlight, values };
}

test('search-layout turns, content, IDs and footer owners are recognized without legacy attributes', async (t) => {
  const { doc, turns, footers, app, click } = await fixture(t);
  assert.equal(doc.querySelectorAll('[data-testid^="conversation-turn-"], [data-message-author-role]').length, 0);
  assert.equal(turns.length, 4);
  assert.deepEqual(turns.map(toolkit.roleOfTurn), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(toolkit.extractAssistantContent(turns[1]), 'First instruction. Second instruction.');
  assert.equal(toolkit.readingAnchor(turns[1]).messageId, 'message-1');
  for (const [i, footer] of footers.entries()) {
    assert.equal(footer.querySelectorAll('.cgs-turn-action').length, 1);
    assert.equal(footer.querySelectorAll('.cgs-bookmark-action').length, 1);
    const more = footer.querySelector('[aria-label="More actions"]');
    assert.equal(toolkit.findMoreButton(turns[1 + i * 2]), more);
    assert.equal(more.nextElementSibling.dataset.cgsAction, 'ask-turn');
    footer.querySelector('.cgs-turn-action').click();
    assert.equal(app.state.activeTurn, turns[1 + i * 2]);
    assert.equal(app.state.questionScope, 'response');
    assert.doesNotMatch(doc.querySelector('#cgs-selected-context').textContent, /Sources|Copy|Bookmark/u);
    click('cancel-question');
  }
});

test('search-layout highlights offer both controls and preserve the selected passage when bookmarking', async (t) => {
  const values = new Map();
  const { doc, app, click, highlight } = await fixture(t, values);
  await highlight();
  assert.equal(doc.querySelector('#cgs-selection-tools').hidden, false);
  assert.equal(doc.querySelector('#cgs-selection-bookmark').hidden, false);
  assert.equal(doc.querySelector('#cgs-selection-pill').hidden, false);
  click('ask-selection');
  assert.equal(doc.querySelector('#cgs-selected-context').textContent, 'First instruction.');
  click('cancel-question');
  await highlight(); click('bookmark-selection');
  click('reading-save'); await app.state.readingTools.state.writes;
  const key = 'chatgptWorkflowToolkit.bookmarks.v1.https://chatgpt.com.layout-test';
  const saved = values.get(key)[0];
  assert.equal(saved.messageId, 'message-1');
  assert.equal(saved.prompt.messageId, 'message-0');
  assert.equal(saved.passage.exact, 'First instruction.');
  const reloaded = await fixture(t, values);
  assert.equal(toolkit.locateReadingAnchor(reloaded.doc, saved), reloaded.turns[1]);
});

test('search-layout Sources rescans stay idle and mixed legacy wrappers do not duplicate controls', async (t) => {
  const { doc, win, turns, app, footers } = await fixture(t);
  const wrapper = doc.createElement('article'); wrapper.dataset.testid = 'conversation-turn-1';
  const outer = turns[1].parentElement.parentElement.parentElement;
  outer.before(wrapper); wrapper.append(outer);
  app.processRoot(wrapper);
  assert.equal(toolkit.getTurns(doc).length, 4);
  const content = turns[1].querySelector('[data-markdown-text-style]');
  for (const root of [content, content.firstChild, turns[1], outer, footers[0]]) app.processRoot(root.nodeType === 1 ? root : root.parentElement);
  assert.equal(toolkit.closestAssistantTurn(content), wrapper);
  await new Promise((resolve) => win.setTimeout(resolve, 250));
  const changes = [];
  const observer = new win.MutationObserver((records) => changes.push(...records));
  observer.observe(doc.querySelector('#history'), { subtree: true, childList: true });
  t.after(() => observer.disconnect());
  content.classList.toggle('expanded');
  await new Promise((resolve) => win.setTimeout(resolve, 250));
  assert.equal(changes.length, 0);
  assert.equal(doc.querySelectorAll('.cgs-turn-action').length, 2);
  assert.equal(doc.querySelectorAll('.cgs-bookmark-action').length, 2);
  assert.equal(doc.querySelector('.cgs-turn-fallback-row'), null);
});

test('checkbox appearance survives the page reset without changing native inputs; toggles still work', async (t) => {
  const { doc, win, values } = await fixture(t);
  for (const input of doc.querySelectorAll('#cgs-settings input')) {
    assert.equal(win.getComputedStyle(input).appearance, 'auto');
    assert.equal(input.checked, true);
  }
  assert.equal(win.getComputedStyle(doc.querySelector('#native-checkbox')).appearance, 'none');
  const input = doc.querySelector('[data-cgs-setting="showTurnButtons"]');
  input.click(); await new Promise((resolve) => win.setTimeout(resolve, 50));
  assert.equal(values.get('chatgptSidecar.settings.v1').showTurnButtons, false);
  assert.equal(doc.querySelector('.cgs-turn-action'), null);
  assert.equal(doc.querySelectorAll('.cgs-bookmark-action').length, 2);
  input.click(); await new Promise((resolve) => win.setTimeout(resolve, 50));
  assert.equal(doc.querySelectorAll('.cgs-turn-action').length, 2);
});

test('Bookmark and Ask share appearance and interaction styles in both action locations', async (t) => {
  const { doc, win, footers } = await fixture(t);
  const properties = ['color', 'backgroundColor', 'opacity', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'padding', 'borderRadius', 'minHeight', 'display', 'cursor'];
  const rules = [...doc.querySelector('#cgs-style').sheet.cssRules].filter((rule) => rule.selectorText);
  for (const color of ['rgb(235, 235, 235)', 'rgb(20, 20, 20)']) {
    footers[0].style.color = color;
    const pairs = [
      [footers[0].querySelector('.cgs-turn-action'), footers[0].querySelector('.cgs-bookmark-action')],
      [doc.querySelector('#cgs-selection-pill'), doc.querySelector('#cgs-selection-bookmark')],
    ];
    for (const [ask, bookmark] of pairs) {
      ask.hidden = false; bookmark.hidden = false;
      const a = win.getComputedStyle(ask), b = win.getComputedStyle(bookmark);
      for (const property of properties) assert.equal(a[property], b[property], property);
      // JSDOM does not render pointer states. Check that each state applies
      // exactly the same CSS declarations to both buttons, not just at rest.
      for (const state of [':hover', ':active', ':focus-visible']) {
        const declarations = (button) => rules.filter((rule) => rule.selectorText.split(',').some((selector) =>
          selector.includes(state) && button.matches(selector.replaceAll(state, '').trim())))
          .map((rule) => rule.style.cssText);
        assert.ok(declarations(ask).length, `explicit ${state} styling`);
        assert.deepEqual(declarations(ask), declarations(bookmark), state);
      }
    }
  }
});

test('native provenance in new answer markup stays untrusted, outside separator stays usable', async (t) => {
  const { doc, turns } = await fixture(t);
  const marker = doc.createElement('p'); marker.innerHTML = 'Branched from <a href="/c/original">Original</a>';
  turns[3].querySelector('[data-markdown-text-style]').append(marker);
  assert.equal(toolkit.nativeBranchContext(doc, 'https://chatgpt.com/c/original'), null);
  doc.querySelector('#history').append(marker);
  const context = toolkit.nativeBranchContext(doc, 'https://chatgpt.com/c/original');
  assert.equal(context.sourceMatches, true);
  assert.equal(context.turn, turns[3]);
});

test('search-layout whole-answer bookmarks retain the preceding prompt and no selection', async (t) => {
  const { app, values, click, doc, turns } = await fixture(t);
  click('reading-add'); click('reading-save'); await app.state.readingTools.state.writes;
  const saved = values.get('chatgptWorkflowToolkit.bookmarks.v1.https://chatgpt.com.layout-test')[0];
  assert.equal(saved.quote, '');
  assert.equal(saved.messageId, 'message-1');
  assert.equal(saved.prompt.messageId, 'message-0');
  assert.equal(toolkit.locateReadingAnchor(doc, saved.prompt), turns[0]);
});

test('new-layout controls mount after streaming ends and after identity attributes arrive', async (t) => {
  const { doc, win } = await fixture(t);
  const fragment = doc.createElement('div'); fragment.innerHTML = message(5, 'assistant', 'A new answer.');
  const turn = fragment.querySelector('[data-chatgpt-search-unit-key]');
  turn.dataset.isStreaming = 'true';
  doc.querySelector('#history').append(fragment);
  await new Promise((resolve) => win.setTimeout(resolve, 150));
  assert.equal(fragment.querySelector('.cgs-turn-action, .cgs-bookmark-action'), null);
  turn.removeAttribute('data-is-streaming');
  await new Promise((resolve) => win.setTimeout(resolve, 150));
  assert.ok(fragment.querySelector('.native-actions .cgs-turn-action'));
  assert.ok(fragment.querySelector('.native-actions .cgs-bookmark-action'));
  const late = doc.createElement('div'); late.innerHTML = message(7, 'assistant', 'Late markers.');
  const wrapper = late.querySelector('[data-chatgpt-search-unit-key]');
  const content = late.querySelector('[data-markdown-text-style]');
  wrapper.removeAttribute('data-chatgpt-search-unit-key'); wrapper.removeAttribute('data-content-search-unit-key');
  content.removeAttribute('data-markdown-text-style'); doc.querySelector('#history').append(late);
  await new Promise((resolve) => win.setTimeout(resolve, 150));
  assert.equal(late.querySelector('.cgs-turn-action, .cgs-bookmark-action'), null);
  wrapper.setAttribute('data-chatgpt-search-unit-key', 'fallback-turn-7:1:assistant');
  content.setAttribute('data-markdown-text-style', 'assistant-message');
  await new Promise((resolve) => win.setTimeout(resolve, 150));
  assert.equal(late.querySelectorAll('.cgs-turn-action').length, 1);
  assert.equal(late.querySelectorAll('.cgs-bookmark-action').length, 1);
});

function cookieFooter(doc) {
  const shell = doc.createElement('div'); shell.dataset.appShellFrame = 'true';
  const footer = doc.createElement('div'); footer.className = 'flex w-full shrink-0 justify-center p-4';
  footer.style.padding = '16px'; footer.style.display = 'flex';
  const button = doc.createElement('button'); button.type = 'button'; button.textContent = 'Cookie preferences'; button.style.height = '24px';
  footer.append(button); shell.append(footer); doc.body.append(shell);
  return { shell, footer, button };
}

test('only the exact Cookie preferences footer loses its layout space; settings keeps native access', async (t) => {
  const { doc, win, app, click, values } = await fixture(t);
  const { footer, button } = cookieFooter(doc);
  let opened = 0; button.onclick = () => { opened++; };
  app.processRoot(doc.body);
  assert.equal(win.getComputedStyle(footer).display, 'none');
  assert.equal(footer.style.padding, '16px', 'original spacing is not destroyed');
  assert.equal(opened, 0, 'never automatically opens or changes cookie consent');
  assert.equal(doc.querySelector('[data-cgs-action="cookie-preferences"]').hidden, false);
  click('toggle-settings'); click('cookie-preferences');
  assert.equal(doc.querySelector('#cgs-settings-backdrop').hidden, true);
  assert.equal(opened, 1, 'only the explicit shortcut opens the native preferences');
  const toggle = doc.querySelector('[data-cgs-setting="hideCookieFooter"]');
  toggle.click(); await new Promise((resolve) => win.setTimeout(resolve, 50));
  assert.equal(win.getComputedStyle(footer).display, 'flex');
  assert.equal(values.get('chatgptSidecar.settings.v1').hideCookieFooter, false);
  toggle.click(); await new Promise((resolve) => win.setTimeout(resolve, 50));
  assert.equal(win.getComputedStyle(footer).display, 'none');
  assert.equal(values.get('chatgptSidecar.settings.v1').hideCookieFooter, true);
});

test('footer cleanup handles late mounts, label changes, rerenders and native dialogs without mutation loops', async (t) => {
  const { doc, win } = await fixture(t);
  const { footer, button } = cookieFooter(doc);
  await new Promise((resolve) => win.setTimeout(resolve, 150));
  assert.equal(win.getComputedStyle(footer).display, 'none');
  // Character-data mutations must be rechecked, too.
  button.firstChild.data = 'Accept cookies';
  await new Promise((resolve) => win.setTimeout(resolve, 150));
  assert.equal(win.getComputedStyle(footer).display, 'flex');
  button.firstChild.data = 'Cookie preferences';
  await new Promise((resolve) => win.setTimeout(resolve, 150));
  assert.equal(win.getComputedStyle(footer).display, 'none');
  const dialog = doc.createElement('div'); dialog.setAttribute('role', 'dialog'); dialog.textContent = 'Privacy options';
  footer.append(dialog);
  await new Promise((resolve) => win.setTimeout(resolve, 150));
  assert.equal(win.getComputedStyle(footer).display, 'flex', 'never conceal a native dialog inside the footer');
  dialog.remove();
  await new Promise((resolve) => win.setTimeout(resolve, 150));
  const changes = [];
  const observer = new win.MutationObserver((records) => changes.push(...records));
  observer.observe(footer, { attributes: true, childList: true, subtree: true });
  t.after(() => observer.disconnect());
  await new Promise((resolve) => win.setTimeout(resolve, 150));
  assert.equal(changes.length, 0, 'the cleanup settles without flashing');
  footer.remove();
  await new Promise((resolve) => win.setTimeout(resolve, 150));
  assert.equal(doc.querySelector('[data-cgs-action="cookie-preferences"]').hidden, true);
  const replacement = cookieFooter(doc);
  await new Promise((resolve) => win.setTimeout(resolve, 150));
  assert.equal(win.getComputedStyle(replacement.footer).display, 'none');
});

test('cookie cleanup leaves consent choices, conversation examples, mixed footers and composer-free pages alone', async (t) => {
  const { doc, win, app, turns } = await fixture(t);
  const examples = [cookieFooter(doc), cookieFooter(doc), cookieFooter(doc), cookieFooter(doc)];
  examples[0].button.textContent = 'Accept all cookies';
  examples[1].footer.append(doc.createElement('input'));
  turns[1].querySelector('[data-markdown-text-style]').append(examples[2].shell);
  examples[3].shell.setAttribute('role', 'dialog');
  app.processRoot(doc.body);
  for (const { footer } of examples) assert.equal(win.getComputedStyle(footer).display, 'flex');
  const { footer } = cookieFooter(doc);
  const form = doc.querySelector('form'); form.remove(); app.processRoot(doc.body);
  assert.equal(win.getComputedStyle(footer).display, 'flex');
  // The shared fixture verifies the draft at teardown; restore its untouched form.
  doc.querySelector('main').append(form);
});
