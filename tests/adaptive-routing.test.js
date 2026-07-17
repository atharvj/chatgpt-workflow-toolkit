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
  assertClassifiesAs('what is 2+2', 'instant');
  assertClassifiesAs('Define osmosis in one sentence.', 'instant');
  assertClassifiesAs('What is mediation in simple terms?', 'instant');
  assertClassifiesAs('Translate “Where is the station?” to Spanish.', 'instant');
  assertClassifiesAs('What is the capital of France?', 'instant');
  assertClassifiesAs('Who wrote Hamlet?', 'instant');
  assertClassifiesAs('When did World War II end?', 'instant');
  assertClassifiesAs('Where is Tokyo?', 'instant');
  assertClassifiesAs('Define photosynthesis.', 'instant');
  assertClassifiesAs('Write a one-sentence thank-you note.', 'instant');
  assertClassifiesAs('Could you define encryption in one sentence?', 'instant');
  assertClassifiesAs('How many days are in a week?', 'instant');
  assertClassifiesAs('What color is the sky?', 'instant');
  assertClassifiesAs('What is the largest planet?', 'instant');
  assertClassifiesAs('Define SQL.', 'instant');
  assertClassifiesAs('What does API mean?', 'instant');
  assertClassifiesAs('What is Python in simple terms?', 'instant');
  assertClassifiesAs('How many continents are there?', 'instant');
  assertClassifiesAs('What planet is closest to the Sun?', 'instant');
});

test('classifyPrompt chooses the higher level at an uncertain upper boundary', () => {
  const writing = assertClassifiesAs('Write a short poem about rain.', 'medium');
  assert.equal(writing.uncertain, true);
  assert.match(writing.reasons.join(' '), /uncertainty safety margin/iu);

  const review = assertClassifiesAs('Review this code for correctness and edge cases.', 'high');
  assert.equal(review.uncertain, true);
  assert.match(review.reasons.join(' '), /uncertainty safety margin/iu);

  const ordinaryAnalysis = assertClassifiesAs('Compare TCP and UDP for a beginner.', 'medium');
  assert.equal(ordinaryAnalysis.uncertain, false);

  const verificationAnalysis = assertClassifiesAs('Evaluate this plan and check edge cases.', 'high');
  assert.equal(verificationAnalysis.uncertain, true);
});

test('unrecognized requests use a safer Medium default instead of guessing Instant', () => {
  for (const prompt of [
    'What caused the collapse of the Soviet Union?',
    'Tell me whether nuclear power is good.',
    'Should schools ban phones?',
    'Tell me what I should do.',
  ]) {
    const result = assertClassifiesAs(prompt, 'medium');
    assert.equal(result.uncertain, true);
    assert.match(result.reasons.join(' '), /unclear complexity favored the safer level/iu);
  }

  assertClassifiesAs('What is the halting problem?', 'medium');
  assertClassifiesAs('What is P versus NP?', 'medium');
  assertClassifiesAs('Why can’t anyone solve P vs NP?', 'medium');
  assertClassifiesAs('Who is trying to solve the Riemann hypothesis?', 'medium');
  assertClassifiesAs('What would it mean to resolve P vs NP?', 'medium');
  assertClassifiesAs('Summarize attempts to solve P vs NP.', 'medium');
  assertClassifiesAs('Explain P vs NP in simple terms.', 'medium');
  assertClassifiesAs('Explain why we cannot prove the Riemann hypothesis.', 'high');
  assertClassifiesAs('How do I use localStorage?', 'medium');
  assertClassifiesAs('Can I use localStorage for a theme preference?', 'medium');
  assertClassifiesAs('Store the sidebar state in localStorage.', 'medium');
  assertClassifiesAs('Can you count the tokens in this prompt?', 'medium');
  assertClassifiesAs('Can you explain what tokens are?', 'medium');
  assertClassifiesAs('Can you write about password history?', 'medium');
  assertClassifiesAs('Write a sentence using the word secure.', 'medium');
  assertClassifiesAs('Solve x^2 - 5x + 6 = 0.', 'medium');

  for (const prompt of [
    'Summarize this research paper and flag weaknesses.',
    'Summarize the evidence and recommend an option.',
    'Make a plan to migrate our database.',
    'Make an argument for this policy.',
    'Format this data and detect anomalies.',
    'Format this JSON and validate it against the schema.',
    'Edit this config and validate every field.',
    'Summarize this report and validate the calculations.',
    'Format this data and calculate the totals.',
    'Translate this document and confirm every name.',
  ]) {
    assertClassifiesAs(prompt, 'medium');
  }
});

test('classifyPrompt uses Medium for ordinary analysis and bounded coding work', () => {
  assertClassifiesAs('Compare TCP and UDP for a beginner.', 'medium');
  assertClassifiesAs('Write a Python function that groups records by key, with a few unit tests.', 'medium');
  assertClassifiesAs('Rewrite this regex in a clearer form.', 'medium');
});

test('classifyPrompt escalates debugging and rigorous proof work to High', () => {
  assertClassifiesAs(
    'Debug this failing Python test and explain the root cause:\nTypeError: cannot unpack non-iterable NoneType object',
    'high',
  );
  assertClassifiesAs('Debug this failing test:\nTypeError: cannot read property of undefined', 'high');
  assertClassifiesAs('Prove rigorously that the square root of 2 is irrational.', 'high');
  assertClassifiesAs('Write a one-sentence rigorous proof that this algorithm terminates.', 'high');
});

test('question phrasing cannot suppress technical and risk signals', () => {
  for (const prompt of [
    'Design a multi-tenant payment architecture.',
    'What architecture should we use for a multi-tenant payment system?',
    'Prove Fermat’s little theorem rigorously.',
    'Explain a rigorous proof of Fermat’s little theorem.',
    'Review the security vulnerabilities in an authentication API.',
    'What are the security vulnerabilities in an authentication API?',
    'Evaluate a database migration strategy for race conditions.',
    'Which database migration strategy avoids race conditions?',
  ]) {
    assertClassifiesAs(prompt, 'high');
  }
});

test('claimed-answer explanations require High without misreading ordinary questions', () => {
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
    'I think the answer is B. Am I right?',
    'Can you check whether B is correct?',
    'Can you tell me whether B is correct?',
    'Can you tell me if my answer is right?',
    'Did I calculate this correctly?',
    'Did I choose the right answer?',
    'Does B look right?',
    'Can you check B?',
    'Is the answer definitely 12V?',
    'Are you sure the answer is B?',
    'Are you certain?',
    'Are you positive?',
    'Please double check.',
    'Double check that.',
    'My answer was 12V. Is that correct?',
    'The key says B; is that right?',
    'Please verify that 12V is correct.',
    'Check this calculation.',
    'Answer quickly but check whether B is correct.',
    'Can you verify it?',
    'Is B correct?',
    'I got B, right?',
    'Did I get B?',
    'I got B. Am I right?',
    'I chose B. Is that right?',
    'My calculation gave 12V. Is it correct?',
    'Is B the right answer?',
    'Is 12V the correct answer?',
    'Was B actually correct?',
    'Is option B correct?',
    'Did I get B right?',
    "Why isn't the answer B?",
    "Wouldn't C be the answer?",
    'Shouldn’t it be C?',
    'You said B, but the answer key says C. Which is right?',
    'Your previous answer conflicts with the answer key. Which one is correct?',
    'I don’t think that’s correct.',
    "That doesn't look right.",
    'Your answer seems wrong.',
    'That answer is wrong.',
    'The answer is wrong.',
    "That can't be right.",
    "B can't be right.",
    "No, that's wrong.",
    'The answer key says B but I got C.',
    'I think it should be C, not B.',
    'What if C is the answer instead?',
    'I selected C—is that right?',
    'The answer is probably C, correct?',
    'Is option BC correct?',
    'Is 3/4 correct?',
    'Double-check B for me.',
    'Can you see if my proof is correct?',
    'Is my calculation correct?',
    'Is my reasoning sound?',
    'Is x = 4 correct?',
    'Check whether the determinant is zero.',
    'Are you really sure?',
    'Are you absolutely sure?',
    'Are you 100% sure?',
    'I think B is wrong.',
    'Your answer and mine disagree.',
    'Check your logic.',
    'Validate your conclusion.',
    'Review your calculation.',
    'Recalculate it.',
    'Re-evaluate the answer.',
    'Can you check my math?',
    'Please check whether x = 4.',
    'Could you recheck?',
    'Check again please.',
    'Check once more.',
    'You sure?',
    'You’re sure?',
    'Still sure?',
    'Really sure?',
    'Are you confident?',
    'Could you reconsider that answer?',
    'I doubt that answer.',
    'I do not trust that result.',
    'That result looks suspicious.',
    'This cannot be correct.',
    'That seems off.',
    'This does not add up.',
    'The key has B, but C seems right.',
    'My teacher says that is wrong.',
    'The calculator says 5, not 4.',
    'I got something different.',
    'My result differs from yours.',
    'Is 2+2=4 correct?',
    'Is Paris the correct answer?',
    'I selected mitochondria—is that right?',
    'Can you make sure this answer is correct?',
    'Please make sure this is correct.',
    'Can you make it more correct?',
    'Is the answer Paris?',
    'Could the answer be Paris?',
    'Why isn’t the answer Paris?',
    'Wouldn’t Paris be the answer?',
    'Why 4?',
    'Why B?',
    'Why option B?',
    'Where did 4 come from?',
    'Why did you choose B?',
    'How did you pick B?',
    'Why did you say B?',
    'What makes B correct?',
    'x is 4, right?',
    'I got x as 4, right?',
    'I got 4 for x, right?',
    'How come B is the answer?',
    'You picked C—why?',
    'How did you reach 12V?',
    'That contradicts the key.',
    'Make sure the answer is B.',
    'Please ensure this result is correct.',
    'Shouldn’t the answer be Paris?',
    'Rewrite my solution, but verify whether the answer is correct first.',
    'Translate this answer and tell me if it is correct.',
    'What does the answer mean, and is it correct?',
    `${toolkit.buildSelectedQuestion('The answer is 12V')}Why?`,
    `${toolkit.buildSelectedQuestion('12V and 4V')}Why?`,
  ]) {
    const result = assertClassifiesAs(prompt, 'high');
    assert.equal(result.strict, true);
    assert.match(result.reasons.join(' '), /verify a supplied answer|recheck the previous answer/iu);
    assert.match(toolkit.buildAccuracyGuardedPrompt(prompt), /independently verify the stated answer or result/iu);
  }

  const rewritten = assertClassifiesAs('Rewrite “I don’t get why the answer is 12” politely.', 'instant');
  assert.equal(Boolean(rewritten.strict), false);

  for (const prompt of [
    'Why is the sky blue?',
    'I don’t understand why you left.',
    'Explain how to turn right at the light.',
    'How do I submit the answer?',
    'Why did you delete the result?',
    'Can you tell me how you got into Harvard?',
    'How did you get 12 tickets?',
    'Can you tell me how you got 12 followers?',
    'Why is correct grammar important?',
    'How is correct posture maintained?',
    'Why is knowing the answer important?',
    'Why is guessing the answer bad?',
    'Why is the right lane closed?',
    `${toolkit.buildSelectedQuestion('Shakespeare uses a metaphor')}Why?`,
  ]) {
    const result = assertClassifiesAs(prompt, 'medium');
    assert.equal(Boolean(result.strict), false);
  }

  for (const prompt of [
    'Why is it 5 PM?',
    'How is it 2026 already?',
    'Why is this 4K monitor expensive?',
    'Why is this correct grammar rule useful?',
    'Why is knowing the answer to this important?',
    'Why is guessing the answer in this game bad?',
  ]) {
    const result = assertClassifiesAs(prompt, 'medium');
    assert.equal(Boolean(result.strict), false);
    assert.match(result.reasons.join(' '), /safer context level/iu);
  }
});

test('classifyPrompt uses the strongest eligible level for independently complex work', () => {
  const result = toolkit.classifyPrompt(
    'Design a production multi-tenant authentication architecture. Include a threat model, concurrency risks, migration steps, rollback plan, tests, and security tradeoffs.',
  );
  assert.equal(canonicalLevel(result), 'pro');
  assertClassifiesAs('Design a secure authentication architecture and derive its invariant.', 'extra-high');
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
  assertClassifiesAs('Why?', 'medium', { previousLevel: 'instant' });
  assertClassifiesAs('Continue and finish it.', 'extra-high', { previousLevel: 'extra-high' });
  assertClassifiesAs('Can you explain the second step?', 'high', { previousLevel: 'high' });
  assertClassifiesAs('Does this change if x is negative?', 'high', { previousLevel: 'high' });
  assertClassifiesAs('Are you sure?', 'extra-high', { previousLevel: 'extra-high' });
  assertClassifiesAs('Check that again.', 'high', { previousLevel: 'instant' });
  assertClassifiesAs('Can you explain the second step?', 'medium');
  assertClassifiesAs('Thanks!', 'instant', { previousLevel: 'pro' });

  for (const prompt of [
    'What should I do?',
    'Which one?',
    'What next?',
    'What about part B?',
    'Can you do the next one?',
    'Can you explain more?',
    'Try a different approach.',
    'What should I change here?',
    'What about the other option?',
    'Can you continue from there?',
    'Now what?',
    'Then what?',
    'Can you make it better?',
    'Can you make it more accurate?',
    'Can you check Paris?',
    'What do I do now?',
    'So what now?',
    'And then?',
    'What do we do now?',
    'Okay, then what?',
    'Where do we go from here?',
  ]) {
    assertClassifiesAs(prompt, 'medium');
    assertClassifiesAs(prompt, 'high', { previousLevel: 'high' });
  }

  for (const prompt of [
    'How?',
    'How exactly?',
    'Why not?',
    'What do you mean?',
    'What now?',
    'I don’t follow.',
    'Can you elaborate?',
    'Explain further.',
    'I still don’t follow.',
    'I don’t understand.',
    'Can you go deeper?',
    'Please elaborate on that.',
    'Run through that again.',
    'Walk me through it again.',
    'Where did that come from?',
    'Why though?',
    'How did you know?',
    'Explain why.',
    'Source for that?',
    'Cite that.',
    'Prove that.',
    'I’m lost.',
    'Still don’t get it.',
    'Can you clarify?',
    'Clarify that.',
    'Say that another way.',
    'Put that differently.',
    'Break that down.',
    'Go over that again.',
    'Elaborate more.',
    'Expand on that.',
    'Explain your reasoning.',
    'Show your work.',
    'Walk me through your logic.',
    'Don’t make mistakes.',
    'Answer carefully.',
    'I’m confused.',
    'Go through it once more.',
    'Can you show the steps?',
  ]) {
    assertClassifiesAs(prompt, 'high', { previousLevel: 'high' });
    assertClassifiesAs(prompt, 'extra-high', { previousLevel: 'extra-high' });
  }

  for (const prompt of [
    'Recalculate it.',
    'Check your logic.',
    'Your answer and mine disagree.',
    'Could you recheck?',
    'Can you verify?',
    'Make sure this is correct.',
    'Please make sure that is right.',
    'Fact-check this.',
  ]) {
    const result = assertClassifiesAs(prompt, 'extra-high', { previousLevel: 'extra-high' });
    assert.equal(result.strict, true);
    assert.equal(result.minimumLevel, 'high');
  }
});

test('accuracy wording cannot lower reasoning and verification false positives stay excluded', () => {
  assertClassifiesAs('Briefly prove that this algorithm terminates.', 'high');
  assertClassifiesAs('Give a quick answer: is this SQL migration safe?', 'high');
  assertClassifiesAs('Is this contract enforceable?', 'high');
  assertClassifiesAs('Should I sell my stocks today?', 'high');
  assertClassifiesAs('Quickly check whether this dosage is safe.', 'high');
  for (const prompt of [
    'Make this thread-safe.',
    'Make this code thread safe.',
    'Make this API secure.',
    'Edit this SQL query to prevent injection.',
    'Rewrite this regex without changing behavior.',
    'Summarize this contract and flag risks.',
    'Summarize this lease and flag risky clauses.',
    'Summarize this medical report and flag dangerous findings.',
    'Implement AES-GCM correctly.',
    'Design a secure login flow.',
    'Assess prompt injection risks.',
    'Should I use MD5 for passwords?',
    'Can I store passwords in localStorage?',
    'Is eval safe here?',
    'Should I commit this API key?',
    'Should I go to the ER?',
    'Can I mix Tylenol and alcohol?',
    'Could this chest pain be serious?',
    'Is this mole cancer?',
    'Can I sue over this?',
    'Write code to encrypt data with AES-GCM.',
    'Write an MD5 password hasher.',
    'Analyze this cryptographic protocol for flaws.',
    'Write code that uses eval on user input.',
    'Sanitize this HTML.',
    'Escape this SQL input.',
    'Review this OAuth callback.',
    'Audit this access-control rule.',
    'Is this CORS policy safe?',
    'Can this regex cause a denial of service?',
    'Summarize this diagnosis.',
    'Explain this lab result.',
    'Review this medication list.',
    'Should I call an ambulance?',
    'What are the warning signs of a stroke?',
    'What are heart attack symptoms?',
    'Could this headache be a stroke?',
    'What are my rights under this lease?',
    'Is this investment a scam?',
    'Write a JWT verifier.',
    'Review this JWT implementation.',
    'Analyze this TLS configuration.',
    'Check whether these bcrypt rounds are sufficient.',
    'What are signs of sepsis?',
    'Could this be a blood clot?',
    'Do I need a lawyer?',
    'Can my landlord evict me?',
    'Can I be arrested for this?',
    'Is this crypto safe?',
    'Review this OpenID Connect flow.',
    'Is this session cookie setup safe?',
    'Check these Argon2 parameters.',
    'Could this be meningitis?',
    'Can my employer fire me for this?',
    'Should I report this fraud?',
    'Is this NFT a scam?',
  ]) {
    assertClassifiesAs(prompt, 'high');
  }
  assertClassifiesAs('Solve the Riemann hypothesis.', 'pro');
  assertClassifiesAs('I need you to solve P vs NP.', 'pro');
  assertClassifiesAs('Try solving the Riemann hypothesis.', 'pro');
  assertClassifiesAs('Please attempt to prove the Riemann hypothesis.', 'pro');
  assertClassifiesAs('Find a proof of the Riemann hypothesis.', 'pro');

  for (const prompt of [
    'Please rewrite “Can you check whether B is correct?” politely.',
    'What does “verify the answer” mean?',
    'Why is correct grammar important?',
    'Explain how to turn right at the light.',
    'Check this box.',
    'Confirm your email address.',
    'Make sure the door is locked.',
    'Write code to validate the result object.',
    'Confirm the output file exists.',
    'Could the answer box be hidden?',
    'Should the result card be blue?',
    'Would the output format be JSON?',
    'Is the answer button disabled?',
    'Check the answer box in the form.',
    'Check my work schedule.',
    'Confirm the proof of delivery arrived.',
    'Validate the output format against this JSON schema.',
    'Are these correct spellings?',
    'Can you confirm that your email address is correct?',
    'Is my spelling correct?',
    'Is my grammar correct?',
    'Is this CSS valid?',
    'Is this JSON valid?',
    'Please confirm the answer was submitted.',
    'Validate that the API result has an id.',
    'Is the blue button on the right?',
    'Can you check option B in the menu?',
    'Confirm that option B is selected.',
    'Can you validate this proof of identity?',
    'Confirm the right button works.',
    'Can you check the calculation checkbox?',
    'Validate the result schema.',
    'Check whether this email is valid.',
    'Can you check whether my phone number is correct?',
    'Check that the appointment time is right.',
    'Verify the shipping address is correct.',
    'Verify the coupon code is valid.',
    'Check if this link is valid.',
    'Verify this URL is valid.',
    'Check whether this sentence is grammatically correct.',
    'Check whether I used the right word.',
    'Check that capitalization is correct.',
    'Check whether the verb tense is right.',
    'Check if this is the right button.',
    'Check this option.',
    'Can you verify the date is correct?',
    'Check whether this password is correct.',
    'Check whether this file path is correct.',
    'Check whether this sentence is correct.',
    'Tell me whether this sentence is correct.',
    'Check if this translation is accurate.',
    'Can you confirm the reservation is correct?',
    'Verify the booking date is right.',
    'Check whether the username is valid.',
    'Verify the solution file exists.',
    'Check my work email.',
    'Verify the proof of concept builds.',
    'Check the determinant checkbox.',
    'Check the checkbox.',
    'Check this radio button.',
    'Check the weather.',
    'Check the weather for me.',
    'Can you check today’s date?',
    'Verify my reservation.',
    'Check the spelling.',
    'Can you check the train time?',
    'Verify the file path.',
    'Check my email.',
    'Check the meeting time.',
    'Check the train schedule.',
    'Check the door.',
    'Check the grocery list.',
    'Verify the customer name.',
    'Check order status.',
    'Verify the file name.',
    'Recheck the calendar.',
    'Double-check the address.',
    'Can you check the menu?',
    'Check my spelling.',
    'Check this paragraph.',
    'Check a box.',
    'Verify the booking time.',
    'Check the temperature.',
    'Check the bus schedule.',
    'Check my inbox.',
    'Verify the meeting room.',
  ]) {
    assert.equal(toolkit.requiresAnswerVerification(prompt), false, prompt);
  }

  for (const prompt of [
    'Can you rewrite this sentence?',
    'Could you translate that to Spanish?',
    'Can you summarize the above?',
    'Can you click this button?',
    'Could you check this box?',
    'Would you select this option?',
    'Can you confirm this email?',
    'Can you confirm that your email address is correct?',
    'What does “verify the answer” mean?',
    'Verify the shipping address is correct.',
    'Verify the coupon code is valid.',
    'Verify this URL is valid.',
    'Check if this is the right button.',
    'Can you proofread this sentence?',
    'Can you paraphrase this?',
    'Can you press this button?',
    'Can you open this link?',
    'Could you close that dialog?',
    'Can you copy this text?',
    'Can you verify the date is correct?',
    'Check whether this password is correct.',
    'Tell me whether this sentence is correct.',
    'Click this blue button.',
    'Select that menu option.',
    'Uncheck this setting.',
    'Press the green button.',
    'Open the first link.',
    'Copy the highlighted text.',
    'Check the checkbox.',
    'Check this radio button.',
    'Confirm this setting.',
    'Verify the solution file exists.',
    'Check my work email.',
    'Check the determinant checkbox.',
    'Check the weather.',
    'Can you check today’s date?',
    'Verify my reservation.',
    'Check the spelling.',
    'Can you check the train time?',
    'Verify the file path.',
    'Check the grocery list.',
    'Verify the customer name.',
    'Check order status.',
    'Recheck the calendar.',
    'Double-check the address.',
    'Can you check the menu?',
    'Check this paragraph.',
    'Check a box.',
    'Verify the booking time.',
    'Check the temperature.',
    'Check the bus schedule.',
    'Check my inbox.',
    'Verify the meeting room.',
  ]) {
    assertClassifiesAs(prompt, 'instant');
  }
  assertClassifiesAs('Verify the proof of concept builds.', 'medium');
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
