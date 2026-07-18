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

test('branch composer readiness is strict until a separate conversation is confirmed', async () => {
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

test('confirmed separate conversation may reuse ChatGPT SPA composer node', async () => {
  const dom = createDom('<main><form><textarea id="prompt-textarea"></textarea></form></main>');
  const { document } = dom.window;
  const sourceComposer = toolkit.findComposer(document);

  const branchComposer = await toolkit.waitForStableComposer(
    document,
    dom.window,
    sourceComposer,
    1_200,
    { allowReused: true },
  );
  assert.equal(branchComposer, sourceComposer);
  dom.window.close();
});

test('conversation change ignores query-only navigation and requires a different chat ID', async () => {
  const dom = createDom('<main></main>');
  const changed = toolkit.waitForConversationChange(dom.window, 'test', 1_200);
  dom.window.setTimeout(() => {
    dom.window.history.pushState({}, '', '/c/test?model=instant');
  }, 75);
  dom.window.setTimeout(() => {
    dom.window.history.pushState({}, '', '/c/separate-chat?model=instant');
  }, 300);

  assert.equal(await changed, 'separate-chat');
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

test('findSendButton resolves tightly scoped edited-message controls without choosing Cancel or the bottom Send', () => {
  const { document } = createDom(`
    <main>
      <article data-testid="conversation-turn-user" data-message-author-role="user">
        <form id="edit-form">
          <textarea id="edit-composer">edited prompt</textarea>
          <button type="button">Cancel</button>
          <button type="submit" id="edit-send">Save &amp; submit</button>
        </form>
      </article>
      <form><textarea id="prompt-textarea"></textarea><button data-testid="send-button" id="bottom-send">Send</button></form>
    </main>
  `).window;

  const editComposer = document.querySelector('#edit-composer');
  assert.equal(toolkit.findComposer(document), document.querySelector('#prompt-textarea'));
  assert.equal(toolkit.findSendButton(document, editComposer), document.querySelector('#edit-send'));
  assert.equal(toolkit.findSendButton(document), document.querySelector('#bottom-send'));
});

test('findSendButton supports no-form and externally form-associated edit Send controls', () => {
  const noForm = createDom(`
    <main><article data-testid="conversation-turn-user" data-message-author-role="user">
      <div id="edit-composer" class="ProseMirror" contenteditable="true" role="textbox">edited</div>
      <button type="button">Cancel</button><button type="button" id="edit-send">Send</button>
    </article><form><textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button></form></main>
  `).window.document;
  assert.equal(toolkit.findSendButton(noForm, noForm.querySelector('#edit-composer')), noForm.querySelector('#edit-send'));

  const external = createDom(`
    <main><article data-testid="conversation-turn-user" data-message-author-role="user">
      <form id="edit-form"><textarea id="edit-composer">edited</textarea></form>
      <button type="submit" form="edit-form" id="edit-send">Submit</button>
    </article><form><textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button></form></main>
  `).window.document;
  assert.equal(toolkit.findSendButton(external, external.querySelector('#edit-composer')), external.querySelector('#edit-send'));
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

test('model and reasoning helpers keep distinct current composer pills', () => {
  const { document } = createDom(`
    <main><div data-composer-surface="true"><form>
      <button class="__composer-pill" id="radix-model" data-testid="model-switcher-dropdown-button" aria-haspopup="menu">GPT-5.5</button>
      <textarea id="prompt-textarea"></textarea>
      <button class="__composer-pill" id="radix-intelligence" aria-haspopup="menu" aria-label="Intelligence level: High">High</button>
      <button data-testid="send-button">Send</button>
    </form></div></main>
  `).window;

  const modelPicker = toolkit.findModelPicker(document);
  const reasoningPicker = toolkit.findReasoningPicker(document);
  assert.equal(modelPicker, document.querySelector('#radix-model'));
  assert.equal(reasoningPicker, document.querySelector('#radix-intelligence'));
  assert.notEqual(reasoningPicker, modelPicker);
});

test('findReasoningPicker ignores a generic Tools composer pill', () => {
  const { document } = createDom(`
    <main><div data-composer-surface="true"><form>
      <button class="__composer-pill" id="radix-model" data-testid="model-switcher-dropdown-button" aria-haspopup="menu">High</button>
      <textarea id="prompt-textarea"></textarea>
      <button class="__composer-pill" id="radix-tools" aria-haspopup="menu">Tools</button>
      <button data-testid="send-button">Send</button>
    </form></div></main>
  `).window;

  assert.equal(toolkit.findModelPicker(document), document.querySelector('#radix-model'));
  assert.equal(toolkit.findReasoningPicker(document), null);
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
    <article id="preferred" data-testid="message-actions">
      <button data-testid="more-turn-action-button" id="hidden-more" hidden>More</button>
      <button aria-label="More actions" id="more">Menu</button>
    </article>
    <article id="fallback"><div data-testid="message-actions"><button id="ellipsis">⋯</button></div></article>
  `).window;

  assert.equal(toolkit.findMoreButton(document.querySelector('#preferred')), document.querySelector('#more'));
  assert.equal(toolkit.findMoreButton(document.querySelector('#fallback')), document.querySelector('#ellipsis'));
});

test('findMoreButton resolves a response toolbar outside the article by message ID', () => {
  const { document } = createDom(`
    <article data-testid="conversation-turn-1">
      <div data-message-author-role="assistant" data-message-id="message-first">First answer</div>
    </article>
    <div data-testid="message-actions" data-message-id="message-first">
      <button data-testid="turn-actions-menu-button" id="first-more" aria-label="More actions"></button>
    </div>
    <article data-testid="conversation-turn-3" id="target-turn">
      <div data-message-author-role="assistant" data-message-id="message-target">Target answer</div>
    </article>
    <div data-testid="message-actions" data-message-id="message-target">
      <button data-testid="turn-actions-menu-button" id="target-more" aria-label="More actions"></button>
    </div>
  `).window;

  assert.equal(
    toolkit.findMoreButton(document.querySelector('#target-turn')),
    document.querySelector('#target-more'),
    'the action toolbar can be a sibling/portal rather than a descendant of the response article',
  );
});

test('findMoreButton recognizes an unlabeled menu button from its ellipsis icon test ID', () => {
  const { document } = createDom(`
    <article id="turn" data-testid="conversation-turn-1" data-turn="assistant">
      <p>Answer</p>
      <div data-testid="message-actions">
        <button id="unlabeled-more" data-testid="turn-actions-menu-button">
          <svg data-testid="ellipsis-icon" aria-hidden="true"></svg>
        </button>
      </div>
    </article>
  `).window;

  assert.equal(
    toolkit.findMoreButton(document.querySelector('#turn')),
    document.querySelector('#unlabeled-more'),
    'ChatGPT does not always expose More actions as button text or an aria-label',
  );
});

test('findMoreButton accepts ChatGPT hover-hidden controls but rejects unrelated and ambiguous controls', () => {
  const { document } = createDom(`
    <header><button aria-label="More actions" id="header-more"></button></header>
    <article id="turn" data-testid="conversation-turn-1" data-turn="assistant">
      <p>Answer</p>
      <div role="group" data-testid="message-actions"><button id="hover-more" aria-label="More actions" style="opacity: 0"></button></div>
    </article>
    <form><button aria-label="More actions" id="composer-more"></button></form>
  `).window;

  assert.equal(toolkit.findMoreButton(document.querySelector('#turn')), document.querySelector('#hover-more'));

  document.querySelector('#hover-more').insertAdjacentHTML(
    'afterend',
    '<button id="duplicate-more" aria-label="More actions" style="opacity: 0"></button>',
  );
  assert.equal(toolkit.findMoreButton(document.querySelector('#turn')), null, 'equal target-owned candidates fail closed');
});

test('findMoreButton supports a response-owned role button', () => {
  const { document } = createDom(`
    <article id="turn" data-testid="conversation-turn-1" data-turn="assistant">
      <div data-testid="message-actions"><span id="role-more" role="button" tabindex="0" aria-haspopup="menu" aria-label="More options"></span></div>
    </article>
  `).window;

  assert.equal(toolkit.findMoreButton(document.querySelector('#turn')), document.querySelector('#role-more'));
});

test('findMoreButton never mistakes content overflow controls for response actions', () => {
  const { document } = createDom(`
    <article id="turn" data-testid="conversation-turn-1" data-turn="assistant">
      <div class="image-carousel"><button id="content-overflow" data-testid="image-ellipsis-button"><svg data-testid="ellipsis-icon"></svg></button></div>
      <div data-testid="message-actions"><button id="real-more" aria-label="More actions"></button></div>
    </article>
  `).window;

  assert.equal(toolkit.findMoreButton(document.querySelector('#turn')), document.querySelector('#real-more'));
  document.querySelector('#real-more').remove();
  assert.equal(toolkit.findMoreButton(document.querySelector('#turn')), null);
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
