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
    hideStartWriting: false,
    showTurnButtons: false,
  }), {
    ...toolkit.DEFAULT_SETTINGS,
    openMode: 'tab',
    hideStartWriting: false,
    showTurnButtons: false,
    showSelectionButton: false,
  });
  assert.equal(toolkit.sanitizeSettings({ openMode: 'window' }).openMode, 'popup');
});

test('optional changes have persistent independent switches with legacy selection migration', () => {
  assert.equal(toolkit.sanitizeSettings({}).showMathNotices, false);
  assert.equal(toolkit.sanitizeSettings({ showMathNotices: 'true' }).showMathNotices, false);
  assert.equal(toolkit.sanitizeSettings({ showMathNotices: true }).showMathNotices, true);
  assert.equal(toolkit.sanitizeSettings({ showTurnButtons: false }).showSelectionButton, false);
  assert.equal(toolkit.sanitizeSettings({ showTurnButtons: false, showSelectionButton: true }).showSelectionButton, true);
  assert.equal(toolkit.sanitizeSettings({ showSelectionButton: false }).showTurnButtons, true);
  for (const key of ['hideStartWriting', 'hideShareHighlighted', 'showTurnButtons', 'showSelectionButton', 'preserveMathFormatting']) {
    assert.equal(toolkit.sanitizeSettings({ [key]: false })[key], false);
    assert.equal(toolkit.sanitizeSettings({ [key]: true })[key], true);
  }
});

test('selected text is quoted and clipped safely for a side question', () => {
  assert.equal(toolkit.quoteForPrompt(' first line\r\nsecond line '), '> first line\n> second line');
  assert.equal(toolkit.quoteForPrompt('abcdef', 4), '> abc…');
  assert.equal(toolkit.quoteForPrompt('   '), '');
  const prompt = toolkit.buildSelectedQuestion('Step 3');
  assert.match(prompt, /Focus only on the highlighted passage/u);
  assert.match(prompt, /Highlighted passage:\n> Step 3\n\nMy question:\nExplain this highlighted passage clearly\./u);
  assert.match(toolkit.buildSelectedQuestion('Step 3', 'Why?'), /My question:\nWhy\?$/u);
  assert.equal(toolkit.buildSelectedQuestion('', '  Unrelated question  '), 'Unrelated question');
});

test('accuracy guard verifies a claimed answer once without truncating the user question', () => {
  const question = "I don't get why the answer is 12V and 4V.";
  const guarded = toolkit.buildAccuracyGuardedPrompt(question);
  assert.ok(guarded.startsWith(question));
  assert.match(guarded, /independently verify the stated answer or result/iu);
  assert.match(guarded, /if it is wrong.+corrected result/iu);
  assert.equal(toolkit.buildAccuracyGuardedPrompt(guarded), guarded, 'retries do not duplicate the guard');
  assert.equal(toolkit.buildAccuracyGuardedPrompt('Why is the sky blue?'), 'Why is the sky blue?');
  assert.equal(toolkit.buildAccuracyGuardedPrompt(question, question.length + 5), question, 'the original is never truncated to fit the guard');

  const job = toolkit.sanitizeJob({
    version: 1,
    createdAt: Date.now(),
    sourceUrl: 'https://chatgpt.com/c/accuracy-source',
    kind: 'ask',
    locator: { turnIndex: 1, assistantIndex: 0 },
    question,
  });
  assert.equal(job.question, question, 'saved and recovery state keeps the user-authored question');
  const focused = toolkit.buildAccuracyGuardedPrompt(toolkit.buildSelectedQuestion('The answer is 12V.', question));
  assert.match(focused, /independently verify the stated answer or result/iu);
  assert.equal((focused.match(/independently verify the stated answer or result/giu) || []).length, 1);
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

test('floating dock stays above the composer and hides when no safe space remains', () => {
  const desktop = toolkit.chooseDockPosition(
    { top: 720, right: 1_100 },
    { width: 500, height: 48 },
    { width: 1_200, height: 900 },
  );
  assert.deepEqual(desktop, { right: 100, bottom: 192, hidden: false });
  assert.ok(900 - desktop.bottom <= 720 - 12, 'the dock bottom edge clears the composer');

  const grownComposer = toolkit.chooseDockPosition(
    { top: 560, right: 1_100 },
    { width: 500, height: 48 },
    { width: 1_200, height: 900 },
  );
  assert.equal(grownComposer.bottom, 352, 'a taller composer moves the dock upward');
  assert.ok(grownComposer.bottom > desktop.bottom);

  const narrow = toolkit.chooseDockPosition(
    { top: 500, right: 395 },
    { width: 84, height: 48 },
    { width: 400, height: 700 },
  );
  assert.equal(narrow.right, 10, 'the dock stays inside the viewport margin');
  assert.equal(narrow.hidden, false);

  assert.equal(toolkit.chooseDockPosition({ top: 0, right: 0 }, {}, { width: 0, height: 0 }), null);
  assert.equal(
    toolkit.chooseDockPosition({ top: 55, right: 390 }, { width: 84, height: 48 }, { width: 400, height: 700 }).hidden,
    true,
    'the dock is suppressed instead of covering a composer with no room above it',
  );
  assert.equal(
    toolkit.chooseDockPosition({ top: 55, right: 390 }, { width: 0, height: 0 }, { width: 400, height: 700 }).hidden,
    true,
    'zero-sized transient measurements use the real fallback height',
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
    toolkit.canonicalPageUrl('https://chatgpt.com/c/abc?view=compact#temporary'),
    'https://chatgpt.com/c/abc?view=compact',
  );
  assert.equal(toolkit.routeKey('https://chatgpt.com/c/abc?view=compact#temporary'), '/c/abc?view=compact');
  assert.equal(toolkit.conversationIdentity('https://chatgpt.com/c/abc?view=compact#temporary'), 'abc');
  assert.equal(toolkit.conversationIdentity('https://chatgpt.com/g/g-test/c/project-chat?view=wide'), 'project-chat');
  assert.equal(toolkit.conversationIdentity('https://chatgpt.com/?view=compact'), '');
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

test('sanitizeJob returns a bounded, normalized one-shot job', () => {
  const now = 1_800_000_000_000;
  const result = toolkit.sanitizeJob({
    createdAt: now - 1_000,
    sourceUrl: 'https://chatgpt.com/c/lab?view=compact#discard-me',
    kind: 'ask',
    locator: { testId: 'conversation-turn-42', turnIndex: 5.8, assistantIndex: 2 },
    question: 123,
    autoSend: false,
  }, now);

  assert.deepEqual(result, {
    version: 1,
    createdAt: now - 1_000,
    sourceUrl: 'https://chatgpt.com/c/lab?view=compact',
    sourceRoute: '/c/lab?view=compact',
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
    questionInserted: false,
    baselineUserCount: -1,
    sendAttempted: false,
  });
});

test('old text-only jobs cannot resume after upgrading to native-only branches', () => {
  for (const fallbackTranscript of ['', 'USER: context']) {
    assert.equal(toolkit.sanitizeJob({
      createdAt: Date.now(),
      sourceUrl: 'https://chatgpt.com/c/source',
      kind: 'ask',
      question: 'Explain this',
      fallbackMode: true,
      fallbackTranscript,
    }), null);
  }
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
