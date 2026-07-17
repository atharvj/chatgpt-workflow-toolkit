'use strict';

const assert = require('node:assert/strict');
const { join } = require('node:path');
const test = require('node:test');

const toolkit = require(join(__dirname, '..', 'chatgpt-workflow-toolkit.user.js'));

test('normalizeText and settings sanitization use stable defaults', () => {
  assert.equal(toolkit.normalizeText('  Ask\n\t in new chat  '), 'Ask in new chat');
  assert.deepEqual(toolkit.sanitizeSettings(null), toolkit.DEFAULT_SETTINGS);
  assert.deepEqual(toolkit.sanitizeSettings({
    openMode: 'tab',
    autoSend: false,
    autoRouting: false,
    hideStartWriting: false,
    showTurnButtons: false,
  }), {
    openMode: 'tab',
    autoSend: false,
    autoRouting: false,
    adaptiveRouting: true,
    autoMaxLevel: 'highest',
    hideStartWriting: false,
    showTurnButtons: false,
  });
  assert.equal(toolkit.sanitizeSettings({ openMode: 'window' }).openMode, 'popup');
});

test('selected text is quoted and clipped safely for a side question', () => {
  assert.equal(toolkit.quoteForPrompt(' first line\r\nsecond line '), '> first line\n> second line');
  assert.equal(toolkit.quoteForPrompt('abcdef', 4), '> abc…');
  assert.equal(toolkit.quoteForPrompt('   '), '');
  assert.equal(
    toolkit.buildSelectedQuestion('Step 3'),
    'I have a question about this specific part of the response:\n\n> Step 3\n\nMy question:\n',
  );
});

test('selection pill stays visible without covering a bottom-edge selection', () => {
  const selection = { left: 40, top: 738, width: 320, height: 24, right: 360, bottom: 762 };
  const position = toolkit.chooseSelectionPillPosition(
    selection,
    { width: 112, height: 30 },
    { width: 400, height: 768 },
  );
  const pill = {
    left: position.left,
    top: position.top,
    right: position.left + position.width,
    bottom: position.top + position.height,
  };

  assert.notEqual(position.placement, 'below');
  assert.ok(pill.left >= 8 && pill.top >= 8);
  assert.ok(pill.right <= 392 && pill.bottom <= 760);
  assert.equal(
    pill.left < selection.right && pill.right > selection.left &&
      pill.top < selection.bottom && pill.bottom > selection.top,
    false,
  );
});

test('composer payload normalization removes editor artifacts without flattening code layout', () => {
  assert.equal(
    toolkit.normalizeComposerPayload('  line one\r\n  indented\u00a0\u200B\r\n'),
    'line one\n  indented',
  );
  assert.notEqual(
    toolkit.normalizeComposerPayload('if (ready) {\n  send();\n}'),
    toolkit.normalizeComposerPayload('if (ready) { send(); }'),
  );
});

test('locator sanitization rejects unsafe IDs and clamps indexes', () => {
  assert.deepEqual(toolkit.sanitizeLocator({
    testId: ' conversation-turn-abc_123 ',
    turnIndex: 4.9,
    assistantIndex: '7',
  }), {
    testId: 'conversation-turn-abc_123',
    turnIndex: 4,
    assistantIndex: 7,
  });
  assert.deepEqual(toolkit.sanitizeLocator({
    testId: 'conversation-turn-1"] body',
    turnIndex: -99,
    assistantIndex: Infinity,
  }), {
    testId: '',
    turnIndex: -1,
    assistantIndex: -1,
  });
});

test('chat URLs are canonicalized and restricted to exact supported hosts', () => {
  assert.equal(
    toolkit.canonicalPageUrl('https://chatgpt.com/c/abc?model=auto#temporary'),
    'https://chatgpt.com/c/abc?model=auto',
  );
  assert.equal(toolkit.routeKey('https://chatgpt.com/c/abc?model=auto#temporary'), '/c/abc?model=auto');
  assert.equal(toolkit.conversationIdentity('https://chatgpt.com/c/abc?model=auto#temporary'), 'abc');
  assert.equal(toolkit.conversationIdentity('https://chatgpt.com/g/g-test/c/project-chat?model=high'), 'project-chat');
  assert.equal(toolkit.conversationIdentity('https://chatgpt.com/?model=auto'), '');
  assert.equal(toolkit.isAllowedChatGPTUrl('https://chatgpt.com/c/abc'), true);
  assert.equal(toolkit.isAllowedChatGPTUrl('https://chat.openai.com/c/abc'), true);
  assert.equal(toolkit.isAllowedChatGPTUrl('http://chatgpt.com/c/abc'), false);
  assert.equal(toolkit.isAllowedChatGPTUrl('https://evil.chatgpt.com/c/abc'), false);
  assert.equal(toolkit.isAllowedChatGPTUrl('not a URL'), false);
  assert.equal(toolkit.isReadOnlyChatPage('https://chatgpt.com/share/abc'), true);
  assert.equal(toolkit.isReadOnlyChatPage('https://chatgpt.com/c/abc'), false);
});

test('job IDs round-trip through the URL fragment', () => {
  const id = 'job_1234-abcd';
  const url = toolkit.urlWithJob('https://chatgpt.com/c/abc#old', id);

  assert.equal(toolkit.isValidJobId(id), true);
  assert.equal(url, `https://chatgpt.com/c/abc#cwt-job=${id}`);
  assert.equal(toolkit.parseJobId(url), id);
  assert.equal(toolkit.isValidJobId('short'), false);
  assert.equal(toolkit.urlWithJob('https://chatgpt.com/c/abc', 'bad id!'), '');
  assert.equal(toolkit.parseJobId('https://chatgpt.com/c/abc#cwt-job=bad%20id'), '');
});

test('fresh-chat job IDs round-trip through a root-only URL', () => {
  const id = `fresh_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  const url = toolkit.urlWithFreshLaunch('https://chatgpt.com/c/private?model=high#old', id);

  assert.equal(url, `https://chatgpt.com/#cwt-fresh=${id}`);
  assert.equal(toolkit.parseFreshJobId(url), id);
  assert.equal(toolkit.isFreshLaunch(url), true);
  assert.equal(toolkit.urlWithFreshLaunch('https://chat.openai.com/c/legacy', id), `https://chat.openai.com/#cwt-fresh=${id}`);
  assert.equal(toolkit.urlWithFreshLaunch('https://chatgpt.com/c/private', 'bad id!'), '');
  assert.equal(toolkit.urlWithFreshLaunch('not a URL', id), '');
  assert.equal(toolkit.parseFreshJobId('https://chatgpt.com/#cwt-fresh=bad%20id'), '');
  assert.equal(toolkit.parseFreshJobId('not a URL'), '');
  assert.equal(toolkit.isFreshLaunch('https://chatgpt.com/#cwt-fresh=0'), false);
  assert.notEqual(toolkit.freshHandoffStorageKey(id), toolkit.freshHandoffStorageKey('fresh_job_other'));
  assert.match(toolkit.freshHandoffStorageKey(id), new RegExp(`${id}$`, 'u'));
  assert.equal(toolkit.freshHandoffStorageKey('bad id!'), '');
});

test('sanitizeFreshHandoff validates identity, age, content, and bounds', () => {
  const now = 1_800_000_000_000;
  const id = 'fresh_job_1234';
  const valid = {
    version: 99,
    id,
    createdAt: now - 1_000,
    handoff: '  Goal\r\n\r\n- Next step  ',
  };

  assert.deepEqual(toolkit.sanitizeFreshHandoff(valid, now, id), {
    version: 1,
    id,
    createdAt: now - 1_000,
    handoff: 'Goal\n\n- Next step',
  });
  assert.equal(toolkit.sanitizeFreshHandoff({ ...valid, handoff: ' \n ' }, now, id), null);
  assert.equal(toolkit.sanitizeFreshHandoff({ ...valid, id: 'fresh_job_other' }, now, id), null);
  assert.equal(
    toolkit.sanitizeFreshHandoff({ ...valid, createdAt: now - toolkit.FRESH_HANDOFF_MAX_AGE_MS - 1 }, now, id),
    null,
  );

  const bounded = toolkit.sanitizeFreshHandoff({
    ...valid,
    handoff: 'x'.repeat(toolkit.FRESH_HANDOFF_MAX_LENGTH + 100),
  }, now, id);
  assert.equal(bounded.handoff.length, toolkit.FRESH_HANDOFF_MAX_LENGTH);
  assert.match(bounded.handoff, /^x+$/u);
});

test('buildFreshContinuationPrompt wraps a usable handoff with optional-material safeguards', () => {
  const handoff = 'Goal: finish the lab.\r\n\r\nOptional materials: lab.png is helpful but optional.';
  const prompt = toolkit.buildFreshContinuationPrompt(handoff);

  assert.match(prompt, /^Continue the previous conversation from the handoff below\./u);
  assert.match(prompt, /follow its recommended next step/u);
  assert.match(prompt, /follow any “Optional materials” instruction in your first response/u);
  assert.match(prompt, /Do not require materials that the handoff says are optional\./u);
  assert.match(prompt, /--- HANDOFF ---\nGoal: finish the lab\.\n\nOptional materials: lab\.png is helpful but optional\.$/u);
  assert.equal(toolkit.buildFreshContinuationPrompt(' \r\n '), '');
});

test('sanitizeJob returns a bounded, normalized one-shot job', () => {
  const now = 1_800_000_000_000;
  const result = toolkit.sanitizeJob({
    createdAt: now - 1_000,
    sourceUrl: 'https://chatgpt.com/c/lab?model=auto#discard-me',
    kind: 'ask',
    locator: { testId: 'conversation-turn-42', turnIndex: 5.8, assistantIndex: 2 },
    question: 123,
    autoSend: false,
  }, now);

  assert.deepEqual(result, {
    version: 1,
    createdAt: now - 1_000,
    sourceUrl: 'https://chatgpt.com/c/lab?model=auto',
    sourceRoute: '/c/lab?model=auto',
    sourceConversation: 'lab',
    kind: 'ask',
    locator: { testId: 'conversation-turn-42', turnIndex: 5, assistantIndex: 2 },
    targetFingerprint: '',
    contextFingerprint: '',
    question: '123',
    autoSend: true,
    branchClickAttempted: false,
    branchConversation: '',
    branchReloadFrom: '',
    fallbackMode: false,
    fallbackTranscript: '',
    questionInserted: false,
    baselineUserCount: -1,
    sendAttempted: false,
  });
});

test('sanitizeJob accepts continue jobs and caps oversized questions', () => {
  const now = 1_800_000_000_000;
  const result = toolkit.sanitizeJob({
    createdAt: now,
    sourceUrl: 'https://chat.openai.com/c/legacy',
    kind: 'continue',
    question: 'x'.repeat(30_100),
    autoSend: 'true',
    branchClickAttempted: true,
    branchConversation: 'separate-chat',
    sendAttempted: true,
  }, now);

  assert.equal(result.kind, 'continue');
  assert.equal(result.question.length, 30_000);
  assert.equal(result.autoSend, false, 'autoSend must be the boolean true');
  assert.equal(result.branchClickAttempted, true);
  assert.equal(result.branchConversation, 'separate-chat');
  assert.equal(result.sendAttempted, true);
});

test('fallback jobs keep bounded transcript context and cannot retain a native Branch click intent', () => {
  const now = 1_800_000_000_000;
  const result = toolkit.sanitizeJob({
    createdAt: now,
    sourceUrl: 'https://chatgpt.com/c/source-chat',
    kind: 'ask',
    question: 'What does step four mean?',
    fallbackMode: true,
    fallbackTranscript: `USER:\r\nQuestion\r\n\r\nASSISTANT:\r\n${'x'.repeat(toolkit.SIDE_FALLBACK_TRANSCRIPT_MAX_LENGTH + 100)}`,
    branchClickAttempted: true,
    branchReloadFrom: 'source_page_1234',
  }, now);

  assert.equal(result.fallbackMode, true);
  assert.equal(result.branchClickAttempted, false);
  assert.equal(result.branchReloadFrom, 'source_page_1234');
  assert.ok(result.fallbackTranscript.length <= toolkit.SIDE_FALLBACK_TRANSCRIPT_MAX_LENGTH);
  assert.doesNotMatch(result.fallbackTranscript, /\r/u);
  assert.equal(toolkit.sanitizeJob({
    createdAt: now,
    sourceUrl: 'https://chatgpt.com/c/source-chat',
    kind: 'ask',
    fallbackMode: true,
    fallbackTranscript: '',
  }, now).fallbackMode, false);
});

test('sanitizeJob rejects malformed, expired, future, and off-site jobs', () => {
  const now = 1_800_000_000_000;
  const valid = {
    createdAt: now,
    sourceUrl: 'https://chatgpt.com/c/abc',
    kind: 'ask',
    question: 'Help',
  };

  assert.equal(toolkit.sanitizeJob(null, now), null);
  assert.equal(toolkit.sanitizeJob({ ...valid, kind: 'other' }, now), null);
  assert.equal(toolkit.sanitizeJob({ ...valid, createdAt: now - toolkit.JOB_MAX_AGE_MS - 1 }, now), null);
  assert.equal(toolkit.sanitizeJob({ ...valid, createdAt: now + 60_001 }, now), null);
  assert.equal(toolkit.sanitizeJob({ ...valid, sourceUrl: 'https://example.com/c/abc' }, now), null);
  assert.equal(toolkit.sanitizeJob({ ...valid, sourceUrl: 'not a URL' }, now), null);
});
