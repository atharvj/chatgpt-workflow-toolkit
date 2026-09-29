'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const toolkit = require('../chatgpt-workflow-toolkit.user.js');

const localId = 'local-chatgpt:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const localUrl = `https://chatgpt.com/c/${encodeURIComponent(localId)}`;
const sourceUrl = 'https://chatgpt.com/c/source-chat';
const jobId = 'local_branch_job_12345';
const jobKey = `chatgptSidecar.job.v1.${jobId}`;
const marker = (href = '/c/source-chat') => `<div class="separator"><div></div><div><span aria-hidden="true"></span><span>Continued from </span><a href="${href}">Synthetic title</a></div><div></div></div>`;
const editor = '<form><div role="presentation"><div class="ProseMirror" contenteditable="true" role="textbox"><p><br></p></div></div><button type="button" aria-label="Send message" disabled>Send</button></form>';
const history = `<article data-testid="conversation-turn-0"><div data-message-author-role="user">Question</div></article>
  <article data-testid="conversation-turn-1"><div data-message-author-role="assistant" data-message-id="answer-one">Answer</div>
  <button data-testid="branch-turn-action-button">Branch in new chat</button></article>`;

test('only valid local-chatgpt UUID identities are accepted, including encoded routes and saved jobs', () => {
  for (const url of [localUrl, localUrl.replace('%3A', ':')]) {
    assert.equal(toolkit.conversationIdentity(url), localId);
    assert.equal(toolkit.validatedBranchUrl(url, sourceUrl), url);
  }
  const job = toolkit.sanitizeJob({ kind: 'ask', createdAt: Date.now(), sourceUrl,
    branchConversation: localId, branchDestinationUrl: localUrl });
  assert.equal(job.branchConversation, localId); assert.equal(job.branchDestinationUrl, localUrl);
  for (const id of ['local-chatgpt:bad', 'other:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'local-chatgpt%253Aaaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', encodeURIComponent('local-chatgpt:../../source')]) {
    assert.equal(toolkit.conversationIdentity(`https://chatgpt.com/c/${id}`), '');
  }
  assert.equal(toolkit.validatedBranchUrl(localUrl.replace('chatgpt.com', 'evil.test'), sourceUrl), '');
});

for (const wrapper of ['plain', 'answer', 'code', 'sidebar', 'dialog', 'hidden', 'toolkit', 'two-links', 'extra-text']) {
  test(`Continued from div separator: ${wrapper}`, (t) => {
    let html = marker();
    if (wrapper === 'answer') html = `<div data-markdown-text-style="assistant-message">${html}</div>`;
    if (wrapper === 'code') html = `<pre>${html}</pre>`;
    if (wrapper === 'sidebar') html = `<aside>${html}</aside>`;
    if (wrapper === 'dialog') html = `<div role="dialog">${html}</div>`;
    if (wrapper === 'hidden') html = `<div hidden>${html}</div>`;
    if (wrapper === 'toolkit') html = `<div id="cgs-root">${html}</div>`;
    if (wrapper === 'two-links') html = html.replace('</a>', '</a><a href="/c/other">Other</a>');
    if (wrapper === 'extra-text') html = html.replace('Continued from ', 'Example: Continued from ');
    const dom = new JSDOM(`<main>${history}${html}${editor}</main>`, { url: localUrl });
    t.after(() => dom.window.close());
    const native = toolkit.nativeBranchContext(dom.window.document, sourceUrl);
    if (wrapper === 'plain') {
      assert.equal(native.sourceMatches, true); assert.equal(native.paragraph.tagName, 'DIV');
      assert.equal(native.turn, toolkit.getTurns(dom.window.document).at(-1));
    } else assert.equal(native, null);
  });
}

for (const mode of ['remounted-editor', 'reused-editor', 'server-on-send', 'delayed-marker', 'retry-late-marker',
  'server-delayed-bubble', 'server-count-shift', 'server-no-editor', 'server-delayed-provenance',
  'server-wrong-question', 'server-old-copy', 'server-source-return', 'server-second-route',
  'url-only', 'wrong-source', 'quoted-marker', 'preexisting-marker', 'existing-draft', 'source-return',
  'marker-changes-on-input', 'route-changes-on-input', 'unacknowledged', 'new-user', 'saved-job-only']) {
  test(`local branch → Continued from → id-less composer → Send: ${mode}`, async (t) => {
    const dom = new JSDOM(`<!doctype html><main>${history}${editor}</main>`, { url: sourceUrl, pretendToBeVisual: true });
    const win = dom.window, doc = win.document;
    const values = new Map(), previousGM = globalThis.GM;
    globalThis.GM = {
      async getValue(key, fallback) { return structuredClone(values.get(key) ?? fallback); },
      async setValue(key, value) { values.set(key, structuredClone(value)); },
      async deleteValue(key) { values.delete(key); },
    };
    let reloads = 0, branches = 0, sends = 0, outgoing = '';
    const app = toolkit.createApp(doc, win, { pageInstanceId: 'local_page_12345', branchComposerTimeout: 1600,
      branchNavigationTimeout: 400, sideSendAckTimeout: mode.startsWith('server-') ? 600 : 250,
      reloadPage: () => { reloads++; return true; } });
    t.after(() => {
      app.state.observer?.disconnect(); win.close();
      if (previousGM === undefined) delete globalThis.GM; else globalThis.GM = previousGM;
    });
    await app.start();
    const sourceEditor = toolkit.findComposer(doc);
    assert.equal(doc.querySelector('#prompt-textarea'), null);
    assert.equal(sourceEditor, doc.querySelector('.ProseMirror'), 'the existing fallback already matches the reported editor');
    const target = toolkit.getTurns(doc).at(-1);
    const job = toolkit.sanitizeJob({ kind: 'ask', createdAt: Date.now(), sourceUrl,
      question: toolkit.buildSelectedQuestion('Answer', 'Explain the selected passage.'),
      locator: toolkit.getTurnLocator(target, doc), targetFingerprint: toolkit.assistantTurnFingerprint(target),
      contextFingerprint: toolkit.conversationContextFingerprint(doc, target) });
    app.state.incomingJobId = jobId; values.set(jobKey, structuredClone(job));
    if (mode === 'preexisting-marker') doc.querySelector('form').insertAdjacentHTML('beforebegin', marker());
    const arrive = () => {
      win.history.pushState({}, '', localUrl);
      if (mode === 'remounted-editor') doc.querySelector('form').outerHTML = editor;
      if (mode === 'existing-draft') toolkit.findComposer(doc).textContent = 'Keep this draft.';
      if (mode === 'source-return') win.history.pushState({}, '', sourceUrl);
      if (mode === 'quoted-marker') target.querySelector('[data-message-author-role]').insertAdjacentHTML('beforeend', marker());
      else if (mode === 'delayed-marker') win.setTimeout(() => doc.querySelector('form').insertAdjacentHTML('beforebegin', marker()), 650);
      else if (!['url-only', 'preexisting-marker', 'retry-late-marker'].includes(mode)) {
        doc.querySelector('form').insertAdjacentHTML('beforebegin', marker(mode === 'wrong-source' ? '/c/different-source' : undefined));
      }
      if (mode === 'new-user') doc.querySelector('form').insertAdjacentHTML('beforebegin', '<article data-testid="conversation-turn-new"><div data-message-author-role="user">Another question</div></article>');
      const composer = toolkit.findComposer(doc), send = doc.querySelector('[aria-label="Send message"]');
      composer.addEventListener('input', () => {
        send.disabled = !toolkit.getComposerText(composer).trim();
        if (mode === 'marker-changes-on-input') doc.querySelector('.separator a').href = '/c/different-source';
        if (mode === 'route-changes-on-input') win.history.pushState({}, '', sourceUrl);
      });
      send.onclick = () => {
        assert.notEqual(toolkit.conversationIdentity(win.location.href), 'source-chat');
        assert.equal(values.get(jobKey).sendAttempted, true, 'persist Send before clicking');
        sends++; outgoing = toolkit.getComposerText(composer);
        if (mode === 'unacknowledged') return;
        if (mode.startsWith('server-')) win.history.pushState({}, '', '/c/persisted-branch');
        if (mode === 'server-count-shift') doc.querySelector('[data-testid="conversation-turn-0"]').remove();
        if (mode === 'server-old-copy') {
          doc.querySelector('[data-message-author-role="user"]').textContent = outgoing;
          composer.replaceChildren(); return;
        }
        const post = () => {
          const sent = doc.createElement('article'); sent.dataset.testid = 'conversation-turn-sent';
          const body = doc.createElement('div'); body.dataset.messageAuthorRole = 'user';
          body.textContent = mode === 'server-wrong-question' ? 'A different message' : outgoing;
          sent.append(body); doc.querySelector('form').before(sent); composer.replaceChildren();
          if (mode === 'server-no-editor') doc.querySelector('form').remove();
          if (mode === 'server-delayed-provenance') {
            const separator = doc.querySelector('.separator'); separator.remove();
            win.setTimeout(() => sent.before(separator), 180);
          }
        };
        if (mode === 'server-delayed-bubble' || mode === 'server-second-route') win.setTimeout(post, 180);
        else post();
        if (mode === 'server-source-return') win.history.pushState({}, '', sourceUrl);
        if (mode === 'server-second-route') win.setTimeout(() => win.history.pushState({}, '', '/c/another-chat'), 70);
      };
    };
    doc.querySelector('[data-testid="branch-turn-action-button"]').onclick = () => { branches++; arrive(); };
    if (mode === 'saved-job-only') {
      arrive(); job.branchClickAttempted = true; job.branchConversation = localId;
    }
    let done = await app.runIncomingJob(job);
    if (mode === 'retry-late-marker') {
      assert.equal(done, false); assert.equal(sends, 0);
      doc.querySelector('form').insertAdjacentHTML('beforebegin', marker());
      done = await app.runIncomingJob(toolkit.sanitizeJob(values.get(jobKey)));
    }
    const success = ['remounted-editor', 'reused-editor', 'server-on-send', 'delayed-marker', 'retry-late-marker',
      'server-delayed-bubble', 'server-count-shift', 'server-no-editor', 'server-delayed-provenance'].includes(mode);
    assert.equal(done, success, doc.querySelector('#cgs-recovery-reason').textContent);
    assert.equal(reloads, 0, 'never reload the local-only branch');
    assert.equal(branches, mode === 'saved-job-only' ? 0 : 1, 'never create a second branch on retry');
    assert.equal(sends, success || mode === 'unacknowledged' || mode.startsWith('server-') ? 1 : 0);
    if (success) {
      assert.equal(outgoing, toolkit.buildAccuracyGuardedPrompt(job.question));
      assert.equal(values.has(jobKey), false);
      assert.equal(doc.querySelector('#cgs-recovery-backdrop').hidden, true, 'confirmed Send clears any earlier recovery popup');
    } else if (mode.startsWith('server-')) {
      assert.equal(values.get(jobKey).sendAttempted, true);
      assert.equal(doc.querySelector('[data-cgs-action="retry-branch"]').hidden, true, 'never offer to resend');
      assert.equal(doc.querySelector('#cgs-recovery-backdrop').hidden, false, 'unverified delivery still warns');
    } else if (mode === 'unacknowledged') {
      assert.equal(await app.runIncomingJob(toolkit.sanitizeJob(values.get(jobKey))), false);
      assert.equal(sends, 1, 'never resend an unacknowledged question');
    } else if (mode === 'existing-draft') assert.equal(toolkit.getComposerText(toolkit.findComposer(doc)), 'Keep this draft.');
    else if (!mode.endsWith('-on-input')) assert.equal(toolkit.getComposerText(toolkit.findComposer(doc)), '');
    if (mode === 'remounted-editor') assert.equal(toolkit.getComposerText(sourceEditor), '', 'detached source editor untouched');
  });
}
