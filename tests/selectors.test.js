'use strict';

const assert = require('node:assert/strict');
const { join } = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const toolkit = require(join(__dirname, '..', 'chatgpt-workflow-toolkit.user.js'));

function createDom(body) {
  return new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    url: 'https://chatgpt.com/c/test',
  });
}

test('findComposer skips hidden candidates and supports the contenteditable fallback', () => {
  const { document } = createDom(`
    <main>
      <form>
        <textarea id="prompt-textarea" style="display: none"></textarea>
        <div id="editor" contenteditable="true" role="textbox"></div>
      </form>
    </main>
  `).window;

  assert.equal(toolkit.findComposer(document), document.querySelector('#editor'));
});

test('composer text reads and writes textarea values with native events', () => {
  const dom = createDom('<main><form><textarea id="prompt-textarea">old</textarea></form></main>');
  const { document } = dom.window;
  const composer = toolkit.findComposer(document);
  const events = [];
  composer.addEventListener('input', () => events.push('input'));
  composer.addEventListener('change', () => events.push('change'));

  assert.equal(toolkit.getComposerText(composer), 'old');
  assert.equal(toolkit.setComposerText(composer, 'new question', dom.window), true);
  assert.equal(composer.value, 'new question');
  assert.deepEqual(events, ['input', 'change']);
});

test('composer text reads and writes a contenteditable composer', () => {
  const dom = createDom('<main><form><div id="prompt-textarea" contenteditable="true">old</div></form></main>');
  const { document } = dom.window;
  const composer = toolkit.findComposer(document);
  let inputCount = 0;
  composer.addEventListener('input', () => { inputCount += 1; });

  assert.equal(toolkit.setComposerText(composer, 'side question', dom.window), true);
  assert.equal(toolkit.getComposerText(composer), 'side question');
  assert.equal(toolkit.composerTextEquals(composer, 'side question'), true);
  assert.equal(toolkit.composerTextEquals(composer, 'side  question'), false);
  assert.equal(inputCount, 1);
});

test('branch composer readiness requires replacing the source composer', async () => {
  const dom = createDom('<main><form><textarea id="prompt-textarea"></textarea></form></main>');
  const { document } = dom.window;
  const sourceComposer = toolkit.findComposer(document);

  assert.equal(
    await toolkit.waitForStableComposer(document, dom.window, sourceComposer, 300),
    null,
    'elapsed time alone must not accept the source composer',
  );

  const ready = toolkit.waitForStableComposer(document, dom.window, sourceComposer, 1_500);
  dom.window.setTimeout(() => {
    const replacement = document.createElement('textarea');
    replacement.id = 'prompt-textarea';
    sourceComposer.replaceWith(replacement);
  }, 100);
  const branchComposer = await ready;
  assert.ok(branchComposer);
  assert.notEqual(branchComposer, sourceComposer);
  dom.window.close();
});

test('findSendButton stays inside the selected composer form', () => {
  const { document } = createDom(`
    <main>
      <form id="first"><textarea></textarea><button data-testid="send-button" id="wrong">Send</button></form>
      <form id="second">
        <textarea id="prompt-textarea"></textarea>
        <button aria-label="Send message" id="right">Send</button>
      </form>
    </main>
  `).window;

  const composer = toolkit.findComposer(document);
  assert.equal(toolkit.findSendButton(document, composer), document.querySelector('#right'));
});

test('findSendButton honors selector priority and ignores hidden buttons', () => {
  const { document } = createDom(`
    <main><form>
      <textarea id="prompt-textarea"></textarea>
      <button data-testid="send-button" id="hidden" hidden>Send</button>
      <button aria-label="Send prompt" id="aria">Send</button>
      <button aria-label="Send message" id="later">Send</button>
    </form></main>
  `).window;

  assert.equal(toolkit.findSendButton(document), document.querySelector('#aria'));
});

test('model levels are extracted from exact and descriptive labels', () => {
  assert.equal(toolkit.extractModelLevel('Instant'), 'instant');
  assert.equal(toolkit.extractModelLevel('GPT-5 · Pro Extended thinking'), 'pro-extended');
  assert.equal(toolkit.extractModelLevel('Use extra high reasoning'), 'extra-high');
  assert.equal(toolkit.extractModelLevel('Pro'), 'pro');
  assert.equal(toolkit.extractModelLevel('Automatic switching'), '');
});

test('findModelPicker uses preferred controls in the composer scope', () => {
  const { document } = createDom(`
    <main><form>
      <textarea id="prompt-textarea"></textarea>
      <button data-testid="model-switcher" id="picker">GPT-5 High</button>
      <div id="cgs-root"><button data-testid="model-picker" id="toolkit-picker">Auto</button></div>
    </form></main>
  `).window;

  assert.equal(toolkit.findModelPicker(document), document.querySelector('#picker'));
});

test('findModelPicker falls back to a visible button with a model level', () => {
  const { document } = createDom(`
    <main><form>
      <textarea id="prompt-textarea"></textarea>
      <button id="unrelated">Tools</button>
      <button id="picker">Medium reasoning</button>
    </form></main>
  `).window;

  assert.equal(toolkit.findModelPicker(document), document.querySelector('#picker'));
});

test('findModelPicker ignores unrelated controls whose label merely mentions model', () => {
  const dom = createDom(`<main>
    <button aria-label="Model response feedback" aria-haspopup="menu" aria-expanded="false">Feedback</button>
    <form><textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button></form>
  </main>`);
  assert.equal(toolkit.findModelPicker(dom.window.document), null);
});

test('findReasoningPicker prefers a separate effort control', () => {
  const { document } = createDom(`
    <main><form>
      <textarea id="prompt-textarea"></textarea>
      <button data-testid="model-switcher" id="model">Thinking</button>
      <button aria-label="Reasoning effort: High" id="effort">High</button>
    </form></main>
  `).window;

  assert.equal(toolkit.findReasoningPicker(document), document.querySelector('#effort'));
});

test('findInstantOption selects a visible menu option outside Workflow Toolkit UI', () => {
  const { document } = createDom(`
    <button id="picker">High</button>
    <div role="option" id="hidden" hidden>Instant</div>
    <div id="cgs-root"><div role="option" id="toolkit-option">Instant</div></div>
    <div role="menuitem" id="instant" aria-label="Instant — fast answers"></div>
  `).window;

  assert.equal(
    toolkit.findInstantOption(document, document.querySelector('#picker')),
    document.querySelector('#instant'),
  );
});

test('findMoreButton supports preferred selectors and ellipsis fallback', () => {
  const { document } = createDom(`
    <article id="preferred">
      <button data-testid="more-turn-action-button" id="hidden-more" hidden>More</button>
      <button aria-label="More actions" id="more">Menu</button>
    </article>
    <article id="fallback"><button id="ellipsis">⋯</button></article>
  `).window;

  assert.equal(toolkit.findMoreButton(document.querySelector('#preferred')), document.querySelector('#more'));
  assert.equal(toolkit.findMoreButton(document.querySelector('#fallback')), document.querySelector('#ellipsis'));
});

test('branch menu matching accepts native label variants and ignores Workflow Toolkit UI', () => {
  assert.equal(toolkit.isBranchLabel('Branch in new chat'), true);
  assert.equal(toolkit.isBranchLabel('Branch in a new chat…'), true);
  assert.equal(toolkit.isBranchLabel('Branch in new chat (opens separately)'), true);
  assert.equal(toolkit.isBranchLabel('New chat'), false);

  const { document } = createDom(`
    <div id="cgs-root"><button id="toolkit-branch">Branch in new chat</button></div>
    <div role="menuitem" id="hidden-branch" hidden>Branch in new chat</div>
    <button id="native-branch" aria-label="Branch in a new chat">Open</button>
  `).window;

  assert.equal(toolkit.findBranchAction(document), document.querySelector('#native-branch'));
});
