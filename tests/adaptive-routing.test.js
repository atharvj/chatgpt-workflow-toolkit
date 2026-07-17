'use strict';

const assert = require('node:assert/strict');
const { join } = require('node:path');
const test = require('node:test');

const toolkit = require(join(__dirname, '..', 'chatgpt-workflow-toolkit.user.js'));

const DIRECT_LEVELS = new Map([
  ['instant', 'instant'],
  ['auto', 'auto'],
  ['medium', 'medium'],
  ['high', 'high'],
  ['extra high', 'extra-high'],
  ['extra-high', 'extra-high'],
  ['x-high', 'extra-high'],
  ['xhigh', 'extra-high'],
  ['ultra', 'ultra'],
  ['pro', 'pro'],
  ['pro standard', 'pro'],
  ['pro-standard', 'pro'],
  ['pro extended', 'pro-extended'],
  ['pro-extended', 'pro-extended'],
  ['pro ultra', 'pro-ultra'],
  ['pro-ultra', 'pro-ultra'],
  ['max', 'max'],
  ['highest', 'max'],
]);

function canonicalLevel(value, seen = new Set()) {
  if (value == null) return '';
  if (typeof value === 'object') {
    if (seen.has(value)) return '';
    seen.add(value);
    const keys = [
      'selectedLevel',
      'selectedOption',
      'selected',
      'option',
      'level',
      'target',
      'value',
      'id',
      'label',
      'text',
      'textContent',
    ];
    for (const key of keys) {
      const resolved = canonicalLevel(value[key], seen);
      if (resolved) return resolved;
    }
    return '';
  }

  const text = String(value).trim().toLocaleLowerCase('en-US');
  const direct = DIRECT_LEVELS.get(text.replace(/\s+/gu, ' '));
  if (direct) return direct;
  return toolkit.extractModelLevel(String(value));
}

function assertClassifiesAs(prompt, expected, context = {}) {
  const result = toolkit.classifyPrompt(prompt, context);
  assert.equal(canonicalLevel(result), expected, `classification for ${JSON.stringify(prompt)}`);
  return result;
}

function assertSelectedLevel(options, target, maxSetting, expected) {
  const result = toolkit.chooseModelOption(options, target, maxSetting);
  assert.equal(
    canonicalLevel(result),
    expected,
    `selection for target=${target}, max=${maxSetting}, options=${JSON.stringify(options)}`,
  );
  return result;
}

test('extractModelLevel returns stable canonical IDs for current and future-facing labels', () => {
  assert.equal(toolkit.extractModelLevel('Instant — fast answers'), 'instant');
  assert.equal(toolkit.extractModelLevel('Instant5.5'), 'instant');
  assert.equal(toolkit.extractModelLevel('Medium reasoning'), 'medium');
  assert.equal(toolkit.extractModelLevel('Medium5.6'), 'medium');
  assert.equal(toolkit.extractModelLevel('GPT-5 High'), 'high');
  assert.equal(toolkit.extractModelLevel('High5.6'), 'high');
  assert.equal(toolkit.extractModelLevel('Use Extra High reasoning'), 'extra-high');
  assert.equal(toolkit.extractModelLevel('Ultra — maximum reasoning'), 'ultra');
  assert.equal(toolkit.extractModelLevel('Thinking Extended'), 'high');
  assert.equal(toolkit.extractModelLevel('Thinking Heavy'), 'extra-high');
  assert.equal(toolkit.extractModelLevel('Pro Standard'), 'pro');
  assert.equal(toolkit.extractModelLevel('GPT-5 · Pro Extended thinking'), 'pro-extended');
  assert.equal(toolkit.extractModelLevel('Pro Ultra'), 'pro-ultra');
  assert.equal(toolkit.extractModelLevel('Automatic switching'), '');
});

test('extractPickerLevel separates current Intelligence labels from adjacent version badges', () => {
  assert.equal(toolkit.extractPickerLevel('Instant5.5'), 'instant');
  assert.equal(toolkit.extractPickerLevel('Medium5.6'), 'medium');
  assert.equal(toolkit.extractPickerLevel('High5.6'), 'high');
  assert.equal(toolkit.extractPickerLevel('4.5 Instant'), 'instant');
  assert.equal(toolkit.extractPickerLevel('o3 Medium'), 'medium');
  assert.equal(toolkit.extractPickerLevel('5.5 High'), 'high');
});

test('parseRouteOverride accepts an anchored hard override and ignores ordinary mentions', () => {
  assert.equal(canonicalLevel(toolkit.parseRouteOverride('!route:high\nReview this code.')), 'high');
  assert.equal(canonicalLevel(toolkit.parseRouteOverride('  !route:extra high: prove this.')), 'extra-high');
  assert.equal(canonicalLevel(toolkit.parseRouteOverride('!route:max Say hello.')), 'max');
  assert.equal(toolkit.parseRouteOverride('Explain what "!route:pro" means.'), null);
  assert.equal(toolkit.parseRouteOverride('Please summarize this, then !route:pro.'), null);
});

test('classifyPrompt keeps everyday requests on Instant', () => {
  assertClassifiesAs('Thanks!', 'instant');
  assertClassifiesAs('Define osmosis in one sentence.', 'instant');
  assertClassifiesAs('Translate “Where is the station?” to Spanish.', 'instant');
});

test('classifyPrompt uses Medium for ordinary analysis and bounded coding work', () => {
  assertClassifiesAs('Compare TCP and UDP for a beginner.', 'medium');
  assertClassifiesAs('Write a Python function that groups records by key, with a few unit tests.', 'medium');
});

test('classifyPrompt escalates debugging and rigorous proof work to High', () => {
  assertClassifiesAs(
    'Debug this failing Python test and explain the root cause:\nTypeError: cannot unpack non-iterable NoneType object',
    'high',
  );
  assertClassifiesAs('Debug this failing test:\nTypeError: cannot read property of undefined', 'high');
  assertClassifiesAs('Prove rigorously that the square root of 2 is irrational.', 'high');
});

test('claimed-answer explanations require High while ordinary why questions stay Instant', () => {
  for (const prompt of [
    "I don't get why the answer is 12V and 4V.",
    "I still don't get why the answer is 12V.",
    "I really don't get how you got 12V.",
    "I don't understand why this is 12V.",
    'I don’t get how you got 12V and 4V.',
    'How did you get 12V and 4V?',
    'Why is it 12V?',
    'Why is B correct?',
    'Why is B correct here?',
    'Explain why B is correct in this problem.',
    'How can 12V be correct?',
    "Why isn't B correct?",
    "Why can't B be right?",
    'Why was 12V the answer?',
    'Why should the answer be 12V?',
    'Why should it be 12V?',
    'Can you tell me how you got 12V?',
    'Explain why 12V is correct.',
    `${toolkit.buildSelectedQuestion('The answer is 12V')}Why?`,
    `${toolkit.buildSelectedQuestion('12V and 4V')}Why?`,
  ]) {
    const result = assertClassifiesAs(prompt, 'high');
    assert.equal(result.strict, true);
    assert.match(result.reasons.join(' '), /verify a supplied answer/iu);
  }

  for (const prompt of [
    'Why is the sky blue?',
    'I don’t understand why you left.',
    'Rewrite “I don’t get why the answer is 12” politely.',
    'Explain how to turn right at the light.',
    'How do I submit the answer?',
    'Why did you delete the result?',
    'Why is it 5 PM?',
    'How is it 2026 already?',
    'Why is this 4K monitor expensive?',
    'Can you tell me how you got into Harvard?',
    'How did you get 12 tickets?',
    'Can you tell me how you got 12 followers?',
    'Why is correct grammar important?',
    'How is correct posture maintained?',
    'Why is knowing the answer important?',
    'Why is guessing the answer bad?',
    'Why is the right lane closed?',
    'Why is this correct grammar rule useful?',
    'Why is knowing the answer to this important?',
    'Why is guessing the answer in this game bad?',
    `${toolkit.buildSelectedQuestion('Shakespeare uses a metaphor')}Why?`,
  ]) {
    const result = assertClassifiesAs(prompt, 'instant');
    assert.equal(Boolean(result.strict), false);
  }
});

test('classifyPrompt reserves Extra High for independently complex work', () => {
  const result = toolkit.classifyPrompt(
    'Design a production multi-tenant authentication architecture. Include a threat model, concurrency risks, migration steps, rollback plan, tests, and security tradeoffs.',
  );
  assert.equal(canonicalLevel(result), 'extra-high');
});

test('classifyPrompt reserves Pro for difficult long-horizon workflows', () => {
  const result = toolkit.classifyPrompt(
    'Design and implement a production compiler end to end. Specify the parser, type checker, optimizer, concurrency model, migration plan, exhaustive tests, security review, benchmarks, and a formal correctness argument for every optimization.',
  );
  assert.equal(canonicalLevel(result), 'pro');
});

test('classifyPrompt honors hard overrides even when prompt complexity disagrees', () => {
  assertClassifiesAs('!route:instant\nProve this theorem rigorously and check every edge case.', 'instant');
  const result = toolkit.classifyPrompt('!route:pro\nSay hello.');
  assert.ok(canonicalLevel(result).startsWith('pro'));
});

test('short context-dependent follow-ups inherit the previous routing level', () => {
  assertClassifiesAs('Why?', 'high', { previousLevel: 'high' });
  assertClassifiesAs('Continue and finish it.', 'extra-high', { previousLevel: 'extra-high' });
  assertClassifiesAs('Thanks!', 'instant', { previousLevel: 'pro' });
});

test('chooseModelOption recognizes a dynamically available Ultra level', () => {
  const options = ['Instant — fast', 'Medium', 'High', 'Ultra — maximum reasoning', 'Pro'];
  assertSelectedLevel(options, 'ultra', 'highest', 'ultra');
  assertSelectedLevel(options, 'extra-high', 'highest', 'ultra');
  assertSelectedLevel(['Instant', 'High', 'Extra High', 'Pro'], 'ultra', 'highest', 'extra-high');
});

test('chooseModelOption falls upward to preserve capability, then downward when necessary', () => {
  assertSelectedLevel(['Instant', 'Medium', 'High', 'Pro'], 'extra-high', 'highest', 'pro');
  assertSelectedLevel(['Instant', 'Medium', 'High'], 'pro', 'highest', 'high');
  assertSelectedLevel(['Instant', 'High', 'Extra High'], 'medium', 'highest', 'high');
});

test('chooseModelOption respects the configured maximum level', () => {
  const options = ['Instant', 'Medium', 'High', 'Extra High', 'Ultra', 'Pro', 'Pro Extended'];
  assertSelectedLevel(options, 'pro', 'high', 'high');
  assertSelectedLevel(options, 'pro', 'extra-high', 'extra-high');
  assertSelectedLevel(options, 'max', 'highest', 'pro-extended');
});

test('chooseModelOption returns no selection when no model level is recognized', () => {
  assert.equal(toolkit.chooseModelOption([], 'high', 'highest'), null);
  assert.equal(toolkit.chooseModelOption(['Configure', 'Automatic switching'], 'high', 'highest'), null);
});
