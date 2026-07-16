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

test('classifyPrompt reserves Extra High or Ultra for independently complex work', () => {
  const result = toolkit.classifyPrompt(
    'Design a production multi-tenant authentication architecture. Include a threat model, concurrency risks, migration steps, rollback plan, tests, and security tradeoffs.',
  );
  assert.ok(
    ['extra-high', 'ultra'].includes(canonicalLevel(result)),
    `expected Extra High or Ultra, received ${JSON.stringify(result)}`,
  );
});

test('classifyPrompt reserves Pro for difficult long-horizon workflows', () => {
  const result = toolkit.classifyPrompt(
    'Design and implement a production compiler end to end. Specify the parser, type checker, optimizer, concurrency model, migration plan, exhaustive tests, security review, benchmarks, and a formal correctness argument for every optimization.',
  );
  assert.ok(
    canonicalLevel(result).startsWith('pro'),
    `expected a Pro tier, received ${JSON.stringify(result)}`,
  );
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
