'use strict';

const assert = require('node:assert/strict');
const { join } = require('node:path');
const test = require('node:test');

const toolkit = require(join(__dirname, '..', 'chatgpt-workflow-toolkit.user.js'));

test('normalizeText and settings sanitization use stable defaults', () => {
  assert.equal(toolkit.normalizeText('  Ask\n\t aside  '), 'Ask aside');
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

test('fresh-chat markers open only the ChatGPT origin root', () => {
  assert.equal(
    toolkit.urlWithFreshLaunch('https://chatgpt.com/c/private?model=high'),
    'https://chatgpt.com/#cwt-fresh=1',
  );
  assert.equal(toolkit.isFreshLaunch('https://chatgpt.com/#cwt-fresh=1'), true);
  assert.equal(toolkit.isFreshLaunch('https://chatgpt.com/#cwt-fresh=0'), false);
  assert.equal(toolkit.urlWithFreshLaunch('not a URL'), '');
});

test('sanitizeJob returns a bounded, normalized one-shot job', () => {
  const now = 1_800_000_000_000;
  const result = toolkit.sanitizeJob({
    createdAt: now - 1_000,
    sourceUrl: 'https://chatgpt.com/c/lab?model=auto#discard-me',
    kind: 'ask',
    locator: { testId: 'conversation-turn-42', turnIndex: 5.8, assistantIndex: 2 },
    question: 123,
    autoSend: true,
  }, now);

  assert.deepEqual(result, {
    version: 1,
    createdAt: now - 1_000,
    sourceUrl: 'https://chatgpt.com/c/lab?model=auto',
    sourceRoute: '/c/lab?model=auto',
    kind: 'ask',
    locator: { testId: 'conversation-turn-42', turnIndex: 5, assistantIndex: 2 },
    question: '123',
    autoSend: true,
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
  }, now);

  assert.equal(result.kind, 'continue');
  assert.equal(result.question.length, 30_000);
  assert.equal(result.autoSend, false, 'autoSend must be the boolean true');
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
