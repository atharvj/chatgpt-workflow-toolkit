'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const toolkit = require('../chatgpt-workflow-toolkit.user.js');
const userscriptWindow = require('./helpers/userscript-window');

for (const label of ['Open new branch', 'Branch conversation']) for (const mode of [
  'click', 'keyboard', 'rtl-keyboard', 'hover', 'delayed', 'unlinked', 'inline', 'remount',
  'already-open', 'missing-chat', 'disabled-chat', 'closed-submenu', 'ambiguous-chat',
  'unrelated-menu', 'ambiguous-unlinked', 'route-change', 'history-change',
  'aria-mask', 'inert-mask', 'aria-mask-edited', 'aria-mask-user-edited', 'aria-mask-stream',
  'aria-mask-root', 'aria-mask-prehidden', 'aria-mask-new-turn',
  'already-open-mask',
]) test(`${label} submenu: ${mode}`, async (t) => {
  // Labels from the supplied screenshot; synthetic ARIA menu/portal variants.
  const dom = new JSDOM(`<!doctype html><main>
    <article data-testid="conversation-turn-0"><div data-message-author-role="user">A question about Work mode</div></article>
    <article data-testid="conversation-turn-1" id="turn"><div data-message-author-role="assistant">An answer mentioning Work mode</div>
      <div><button aria-label="Copy"></button><button aria-label="Rate response"></button>
        <button id="more" aria-label="More actions" aria-haspopup="menu" aria-expanded="false" data-state="closed" aria-controls="menu"></button>
      </div>
    </article>
    <div id="menu" role="menu" data-state="closed" aria-labelledby="more">
      <div id="subtrigger" role="menuitem" tabindex="-1" aria-haspopup="menu" aria-expanded="false" data-state="closed" aria-controls="submenu">${label}</div>
    </div>
    <div id="submenu" role="menu" data-state="closed" aria-labelledby="subtrigger">
      <div role="menuitem" id="work">Branch into Work mode</div>
      <div role="menuitem" id="chat">Branch in new Chat</div>
    </div>
    <div id="foreign" role="menu" aria-labelledby="other-trigger"><button role="menuitem" id="foreign-chat">Branch in new Chat</button></div>
    <form><textarea id="prompt-textarea">Existing draft</textarea><button type="button" data-testid="send-button">Send</button></form>
  </main>`, { url: 'https://chatgpt.com/c/source-chat', pretendToBeVisual: true });
  const win = dom.window, doc = win.document;
  const turn = doc.querySelector('#turn'), more = doc.querySelector('#more');
  const menu = doc.querySelector('#menu'), submenu = doc.querySelector('#submenu');
  let trigger = doc.querySelector('#subtrigger');
  if (mode === 'aria-mask-prehidden') turn.querySelector('[data-message-author-role]').insertAdjacentHTML('beforeend',
    '<span aria-hidden="true">Hidden duplicate notation</span><span inert>Hidden panel text</span>');
  if (mode === 'aria-mask-root') doc.body.append(menu, submenu);
  const foreign = doc.querySelector('#foreign');
  foreign.hidden = true;
  turn.scrollIntoView = () => {};
  let branches = 0, work = 0, wrong = 0, sends = 0, opens = 0, clicks = 0, keys = 0;
  const setOpen = (node) => { node.dataset.state = 'open'; node.setAttribute('aria-expanded', 'true'); };
  const openSubmenu = () => {
    opens++;
    if (mode === 'route-change') { win.history.pushState({}, '', '/c/unrelated'); return; }
    if (mode === 'history-change') { turn.querySelector('[data-message-author-role]').textContent = 'Changed answer'; return; }
    if (mode === 'closed-submenu') return;
    setOpen(trigger);
    if (mode === 'unrelated-menu') { foreign.hidden = false; return; }
    setOpen(submenu);
    if (mode === 'ambiguous-unlinked') { foreign.removeAttribute('aria-labelledby'); foreign.hidden = false; }
  };
  const wireTrigger = (node) => {
    node.addEventListener('click', () => {
      clicks++;
      if (mode === 'remount') {
        trigger = node.cloneNode(true); wireTrigger(trigger); node.replaceWith(trigger); return;
      }
      if (mode === 'delayed') { win.setTimeout(openSubmenu, 400); return; }
      if (!['keyboard', 'rtl-keyboard', 'hover'].includes(mode)) openSubmenu();
    });
    node.addEventListener('keydown', (event) => {
      if (event.key !== (mode === 'rtl-keyboard' ? 'ArrowLeft' : 'ArrowRight')) return;
      keys++;
      if (['keyboard', 'rtl-keyboard', 'remount'].includes(mode)) openSubmenu();
    });
    node.addEventListener('pointermove', () => { if (mode === 'hover') openSubmenu(); });
  };
  wireTrigger(trigger);
  if (mode === 'rtl-keyboard') menu.style.direction = 'rtl';
  if (mode === 'inline') menu.append(submenu);
  if (mode === 'unlinked' || mode === 'ambiguous-unlinked' || mode === 'unrelated-menu') {
    trigger.removeAttribute('aria-controls'); submenu.removeAttribute('aria-labelledby');
  }
  if (mode === 'missing-chat') doc.querySelector('#chat').remove();
  if (mode === 'disabled-chat') doc.querySelector('#chat').setAttribute('aria-disabled', 'true');
  if (mode === 'ambiguous-chat') submenu.append(doc.querySelector('#chat').cloneNode(true));
  more.addEventListener('click', () => {
    setOpen(more); setOpen(menu);
    if (mode.includes('mask')) {
      for (const node of doc.querySelectorAll('[data-message-author-role]')) {
        node.setAttribute(mode === 'inert-mask' ? 'inert' : 'aria-hidden', mode === 'inert-mask' ? '' : 'true');
      }
      if (mode === 'aria-mask-edited') turn.querySelector('[data-message-author-role]').textContent = 'Actually edited answer';
      if (mode === 'aria-mask-user-edited') doc.querySelector('[data-message-author-role="user"]').textContent = 'Actually edited prompt';
      if (mode === 'aria-mask-stream') {
        doc.querySelector('form').setAttribute('aria-hidden', 'true');
        const stop = doc.createElement('button'); stop.dataset.testid = 'stop-button';
        doc.querySelector('form').append(stop);
      }
      if (mode === 'aria-mask-root') doc.querySelector('main').setAttribute('aria-hidden', 'true');
      if (mode === 'aria-mask-new-turn') turn.insertAdjacentHTML('afterend',
        '<article data-testid="conversation-turn-2"><div data-message-author-role="user">A genuinely new question</div></article>');
    }
  });
  if (mode === 'already-open' || mode === 'already-open-mask') {
    setOpen(more); setOpen(menu);
    if (mode === 'already-open-mask') {
      for (const node of doc.querySelectorAll('[data-message-author-role]')) node.setAttribute('aria-hidden', 'true');
    }
    doc.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        for (const node of [more, menu, trigger, submenu]) { node.dataset.state = 'closed'; node.setAttribute('aria-expanded', 'false'); }
        if (mode === 'already-open-mask') {
          for (const node of doc.querySelectorAll('[data-message-author-role]')) node.removeAttribute('aria-hidden');
        }
      }
    });
  }
  for (const node of submenu.querySelectorAll('#chat')) node.addEventListener('click', () => {
    branches++; win.history.pushState({}, '', '/c/new-branch');
  });
  doc.querySelector('#work').addEventListener('click', () => { work++; });
  doc.querySelector('#foreign-chat').onclick = () => { wrong++; };
  doc.querySelector('[data-testid="send-button"]').onclick = () => { sends++; };
  const app = toolkit.createApp(doc, userscriptWindow(win), { pageWindow: win, branchActionTimeout: 150, branchNavigationTimeout: 400 });
  t.after(() => { app.state.observer?.disconnect(); win.close(); });
  await app.start();
  const job = toolkit.sanitizeJob({ kind: 'ask', createdAt: Date.now(), sourceUrl: win.location.href,
    locator: toolkit.getTurnLocator(turn, doc), targetFingerprint: toolkit.assistantTurnFingerprint(turn),
    contextFingerprint: toolkit.conversationContextFingerprint(doc, turn), question: 'Explain this part.' });
  await app.runIncomingJob(job); // Stop before the verified-destination reload/send.
  const succeeds = ['click', 'keyboard', 'rtl-keyboard', 'hover', 'delayed', 'unlinked', 'inline', 'remount', 'already-open',
    'aria-mask', 'inert-mask', 'aria-mask-root', 'aria-mask-prehidden', 'already-open-mask'].includes(mode);
  const reason = doc.querySelector('#cgs-recovery-reason').textContent;
  assert.equal(branches, succeeds ? 1 : 0, reason);
  assert.equal(work, 0, 'normal Chat is the explicit fallback; never infer mode from message text');
  assert.equal(wrong, 0, 'never use another menu’s branch option');
  assert.equal(sends, 0);
  assert.equal(doc.querySelector('#prompt-textarea').value, 'Existing draft');
  assert.equal(clicks, ['aria-mask-edited', 'aria-mask-user-edited', 'aria-mask-stream', 'aria-mask-new-turn'].includes(mode) ? 0 : 1, 'open the branch submenu only once, after verifying the source');
  if (succeeds) { assert.equal(opens, 1); assert.equal(win.location.pathname, '/c/new-branch'); }
  else {
    assert.equal(app.state.branchClickAttempted, false, 'opening a submenu is not a branch attempt');
    assert.match(reason, mode.endsWith('-change') ? /could not re-verify the source chat/iu : /submenu/iu);
  }
  if (mode.includes('keyboard') || mode === 'remount') assert.equal(keys, 1);
  if (mode.includes('mask')) {
    assert.equal(turn.querySelector('[data-message-author-role]').hasAttribute(mode === 'inert-mask' ? 'inert' : 'aria-hidden'), true,
      'do not remove native accessibility attributes from the page');
    if (!succeeds) assert.match(reason, new RegExp(`Details \\(v${toolkit.VERSION.replaceAll('.', '\\.')}\\):`));
  }
});
