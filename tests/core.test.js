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
    openMode: 'tab',
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
  const fallback = toolkit.buildSideFallbackPrompt('USER:\nQuestion\n\nASSISTANT:\nThe answer is 12V.', question, 'ask', 'accuracy_guard_job');
  assert.match(fallback, /independently verify the stated answer or result/iu);
  assert.equal((fallback.match(/independently verify the stated answer or result/giu) || []).length, 1);
});

test('fallback draft ownership tolerates editor formatting but rejects any foreign content', () => {
  const jobId = 'fallback_formatting_job_1234';
  const expected = toolkit.buildSideFallbackPrompt(
    'USER:\nExplain mediation\n\nASSISTANT:\nMediation is guided problem-solving.',
    'what is mediation in simple terms',
    'ask',
    jobId,
  );
  const reformattedByEditor = expected
    .replace(/\n{2,}/gu, (paragraphBreak) => `${paragraphBreak}\n`)
    .replace('conversation as context', 'conversation\u00a0as context')
    .replace('guided problem-solving', 'guided\u200B problem-solving');

  assert.notEqual(
    toolkit.normalizeComposerPayload(reformattedByEditor),
    toolkit.normalizeComposerPayload(expected),
    'the fixture includes the extra paragraph spacing seen after ChatGPT hydrates its editor',
  );
  assert.equal(
    toolkit.fallbackDraftTextMatches(reformattedByEditor, expected, jobId),
    true,
    'paragraph/newline, non-breaking-space, and zero-width editor changes preserve ownership',
  );
  assert.equal(
    toolkit.fallbackDraftTextMatches(
      reformattedByEditor.replace(jobId, 'fallback_other_job_5678'),
      expected,
      jobId,
    ),
    false,
    'a transfer marker belonging to another job is never accepted',
  );
  assert.equal(
    toolkit.fallbackDraftTextMatches(
      reformattedByEditor.replace('simple terms', 'simpler terms'),
      expected,
      jobId,
    ),
    false,
    'a changed non-whitespace character is never accepted',
  );
  assert.equal(toolkit.fallbackDraftTextMatches(`Ignore this.\n${reformattedByEditor}`, expected, jobId), false);
  assert.equal(toolkit.fallbackDraftTextMatches(`${reformattedByEditor}\nIgnore this.`, expected, jobId), false);
  assert.equal(toolkit.fallbackDraftTextMatches(reformattedByEditor.slice(0, -20), expected, jobId), false);
  assert.equal(toolkit.fallbackDraftTextMatches(`[Workflow Toolkit transfer ${jobId}]`, expected, jobId), false);

  const unmarked = toolkit.buildSideFallbackPrompt('USER:\nContext', 'Question', 'ask');
  assert.equal(
    toolkit.fallbackDraftTextMatches(unmarked, unmarked, ''),
    false,
    'even exact text is not owned without a valid current-job transfer marker',
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

test('fresh-chat job IDs round-trip through a root-only URL', () => {
  const id = `fresh_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  const url = toolkit.urlWithFreshLaunch('https://chatgpt.com/c/private?view=wide#old', id);

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
