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

test('turn helpers find roles and preserve transcript order', () => {
  const { document } = createDom(`
    <article data-testid="conversation-turn-0"><div data-message-author-role="user">Question</div></article>
    <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Answer one</div></article>
    <article data-testid="conversation-turn-2" data-turn="assistant">Answer two</article>
  `).window;
  const turns = toolkit.getTurns(document);

  assert.equal(turns.length, 3);
  assert.deepEqual(turns.map(toolkit.roleOfTurn), ['user', 'assistant', 'assistant']);
  assert.deepEqual(toolkit.getAssistantTurns(document), [turns[1], turns[2]]);
  assert.equal(toolkit.closestAssistantTurn(turns[1].firstElementChild), turns[1]);
  assert.equal(toolkit.closestAssistantTurn(turns[0].firstElementChild), null);
});

test('turn helpers fall back to role nodes and assistant UI clues', () => {
  const { document } = createDom(`
    <section id="standalone" data-message-author-role="assistant">Answer</section>
    <article id="rated"><button data-testid="good-response">Good</button></article>
    <article id="markdown"><div class="markdown">Rendered answer</div></article>
  `).window;

  assert.deepEqual(toolkit.getTurns(document), [document.querySelector('#standalone')]);
  assert.equal(toolkit.roleOfTurn(document.querySelector('#rated')), 'assistant');
  assert.equal(toolkit.roleOfTurn(document.querySelector('#markdown')), 'assistant');
});

test('turn locators survive test-id lookup and fall back to indexes', () => {
  const { document } = createDom(`
    <article data-testid="conversation-turn-0" data-turn="user"></article>
    <article data-testid="conversation-turn-a" data-turn="assistant"></article>
    <article data-testid="conversation-turn-b" data-turn="assistant"></article>
  `).window;
  const target = document.querySelector('[data-testid="conversation-turn-b"]');
  const locator = toolkit.getTurnLocator(target, document);

  assert.deepEqual(locator, { testId: 'conversation-turn-b', turnIndex: 2, assistantIndex: 1 });
  assert.equal(toolkit.locateTurn(document, locator), target);
  assert.equal(toolkit.locateTurn(document, { testId: 'conversation-turn-missing', turnIndex: 2 }), target);
  assert.equal(toolkit.locateTurn(document, { assistantIndex: 0 }), document.querySelector('[data-testid="conversation-turn-a"]'));
  assert.equal(toolkit.locateTurn(document, { turnIndex: 0 }), null, 'a user turn cannot be a branch target');
});

test('completed turn helpers exclude the actively streaming response', () => {
  const { document } = createDom(`
    <article data-testid="conversation-turn-1" data-turn="assistant">Done</article>
    <article data-testid="conversation-turn-2" data-turn="assistant">Streaming</article>
    <button data-testid="stop-button">Stop</button>
  `).window;

  assert.deepEqual(
    toolkit.getCompletedAssistantTurns(document),
    [document.querySelector('[data-testid="conversation-turn-1"]')],
  );
  assert.equal(toolkit.isTurnStreaming(document.querySelector('[data-testid="conversation-turn-2"]'), document), true);
});

test('extractAssistantContent keeps useful response content and omits action labels', () => {
  const { document } = createDom(`
    <article data-testid="conversation-turn-1">
      <div data-message-author-role="assistant">
        <div class="markdown">
          <p>Resume the lab with these items:</p>
          <ul>
            <li>Open <strong>results.csv</strong></li>
            <li>Compare the control group</li>
          </ul>
          <pre><code>if (ready) {
    npm test -- --runInBand
}</code></pre>
          <p>Use the <a href="https://example.com/reference">reference guide</a>.</p>
          <button data-testid="copy-turn-action-button">Copy response</button>
          <div id="cgs-root"><button>Ask in new chat</button></div>
          <button class="cgs-turn-action">Toolkit side question</button>
        </div>
      </div>
      <div data-testid="message-actions"><button>Good response</button></div>
    </article>
  `).window;
  const text = toolkit.extractAssistantContent(document.querySelector('article'));
  const fingerprint = toolkit.assistantTurnFingerprint(document.querySelector('article'));
  const contextFingerprint = toolkit.conversationContextFingerprint(document, document.querySelector('article'));

  assert.match(text, /Resume the lab with these items:/u);
  assert.match(text, /- Open results\.csv/u);
  assert.match(text, /- Compare the control group/u);
  assert.match(text, /npm test -- --runInBand/u);
  assert.ok(text.includes('```\nif (ready) {\n    npm test -- --runInBand\n}\n```'), 'code indentation is preserved');
  assert.match(text, /reference guide \(https:\/\/example\.com\/reference\)/u);
  assert.doesNotMatch(text, /Copy response|Ask in new chat|Toolkit side question|Good response/u);
  assert.match(fingerprint, /Resume the lab with these items:/u);
  document.querySelector('.markdown p').textContent = 'A different answer';
  assert.notEqual(toolkit.assistantTurnFingerprint(document.querySelector('article')), fingerprint);
  assert.notEqual(toolkit.conversationContextFingerprint(document, document.querySelector('article')), contextFingerprint);
});

test('extractAssistantContent rejects non-assistant turns', () => {
  const { document } = createDom(`
    <article data-testid="conversation-turn-0">
      <div data-message-author-role="user"><p class="markdown">Do not extract me</p></div>
    </article>
  `).window;

  assert.equal(toolkit.extractAssistantContent(document.querySelector('article')), '');
  assert.equal(toolkit.extractAssistantContent(null), '');
});

test('legacy footer cleanup removes injected buttons and keeps native actions', () => {
  const { document } = createDom('<article><div class="actions"><button>Copy</button><button class="cgs-turn-action" data-cgs-injected="true">Ask</button><button class="cgs-bookmark-action" data-cgs-injected="true">Bookmark</button></div><div class="cgs-turn-fallback-row"><button class="cgs-turn-action" data-cgs-injected="true">Ask</button></div></article>').window;
  toolkit.removeTurnButtons(document);
  assert.equal(document.querySelector('.cgs-turn-action, .cgs-bookmark-action, .cgs-turn-fallback-row'), null);
  assert.equal(document.querySelector('.actions').textContent, 'Copy');
});

test('cleanStartWriting clears editable hints and hides standalone controls', () => {
  const { document } = createDom(`
    <textarea id="composer" placeholder="  Start   writing " aria-label="Start writing"></textarea>
    <div id="editable" contenteditable="true" data-placeholder="Start writing"></div>
    <button id="label-control" aria-label="Start writing">Compose</button>
    <button id="text-control">Start writing</button>
    <article data-testid="conversation-turn-1"><button id="turn-control">Start writing</button></article>
    <div id="cgs-root"><button id="toolkit-control">Start writing</button></div>
  `).window;

  assert.equal(toolkit.cleanStartWriting(document), 5);
  const composer = document.querySelector('#composer');
  assert.equal(composer.placeholder, '');
  assert.equal(composer.getAttribute('aria-label'), 'Message ChatGPT');
  assert.equal(composer.getAttribute('data-cgs-original-placeholder'), '  Start   writing ');
  assert.equal(document.querySelector('#editable').getAttribute('data-placeholder'), '');
  assert.equal(document.querySelector('#label-control').classList.contains('cgs-hidden-start-writing'), true);
  assert.equal(document.querySelector('#text-control').classList.contains('cgs-hidden-start-writing'), true);
  assert.equal(document.querySelector('#turn-control').classList.contains('cgs-hidden-start-writing'), false);
  assert.equal(document.querySelector('#toolkit-control').classList.contains('cgs-hidden-start-writing'), false);

  assert.equal(toolkit.restoreStartWriting(document), 5);
  assert.equal(composer.placeholder, '  Start   writing ');
  assert.equal(composer.getAttribute('aria-label'), 'Start writing');
  assert.equal(composer.hasAttribute('data-cgs-original-placeholder'), false);
  assert.equal(document.querySelector('#editable').getAttribute('data-placeholder'), 'Start writing');
  assert.equal(document.querySelectorAll('.cgs-hidden-start-writing').length, 0);
});

test('cleanStartWriting matches only the exact normalized phrase', () => {
  const { document } = createDom(`
    <textarea id="keep" placeholder="Start writing your report"></textarea>
    <button id="keep-button">Start writing now</button>
  `).window;

  assert.equal(toolkit.cleanStartWriting(document), 0);
  assert.equal(document.querySelector('#keep').placeholder, 'Start writing your report');
  assert.equal(document.querySelector('#keep-button').className, '');
});
