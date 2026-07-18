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

test('attachment profiles distinguish file difficulty and scale with file count', () => {
  const pdf = toolkit.buildAttachmentProfile([{ name: 'lab-instructions.pdf', size: 900_000 }], 1);
  const spreadsheet = toolkit.buildAttachmentProfile([{ name: 'measurements.xlsx', size: 2_000_000 }], 1);
  const archive = toolkit.buildAttachmentProfile([{ name: 'project-source.zip', size: 4_000_000 }], 1);
  const medicalImage = toolkit.buildAttachmentProfile([{ name: 'scan.png', size: 3_000_000 }], 1);
  const manyPdfs = toolkit.buildAttachmentProfile(
    Array.from({ length: 8 }, (_value, index) => ({ name: `paper-${index + 1}.pdf` })),
    8,
  );

  assert.deepEqual(pdf.kinds, ['document']);
  assert.deepEqual(spreadsheet.kinds, ['structured-data']);
  assert.deepEqual(archive.kinds, ['archive']);
  assertClassifiesAs('Summarize this file.', 'medium', { attachmentProfile: pdf });
  assertClassifiesAs('Summarize this file.', 'high', { attachmentProfile: spreadsheet });
  assertClassifiesAs('Open this attachment.', 'high', { attachmentProfile: archive });
  assertClassifiesAs('Analyze this radiology scan for abnormalities.', 'extra-high', { attachmentProfile: medicalImage });
  assertClassifiesAs('Summarize all of these files.', 'extra-high', { attachmentProfile: manyPdfs });
});

test('attachment metadata recognizes structured, large, and sensitive material conservatively', () => {
  const json = toolkit.buildAttachmentProfile([{ name: 'records.json' }], 1);
  const numbers = toolkit.buildAttachmentProfile([{ name: 'forecast.numbers' }], 1);
  const large = toolkit.buildAttachmentProfile([{ name: 'manual.pdf', size: 15 * 1024 * 1024 }], 1);
  const sensitive = toolkit.buildAttachmentProfile([{ name: 'lab_results.pdf' }], 1);
  const sensitiveNames = toolkit.buildAttachmentProfile([
    { name: 'medications.pdf' },
    { name: 'bank_statement.pdf' },
    { name: 'insurance_policy.pdf' },
  ], 3);
  const jsonMime = toolkit.buildAttachmentProfile([{ name: 'upload', mime: 'application/json' }], 1);
  const excelMime = toolkit.buildAttachmentProfile([{
    name: 'upload',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }], 1);
  const jsMime = toolkit.buildAttachmentProfile([{ name: 'upload', mime: 'text/javascript' }], 1);
  const unknown = toolkit.buildAttachmentProfile([{ name: 'mystery.bin' }], 1);
  const five = toolkit.buildAttachmentProfile(
    Array.from({ length: 5 }, (_value, index) => ({ name: `source-${index}.pdf` })),
    5,
  );
  const six = toolkit.buildAttachmentProfile(
    Array.from({ length: 6 }, (_value, index) => ({ name: `source-${index}.pdf` })),
    6,
  );

  assert.deepEqual(json.kinds, ['structured-data']);
  assert.deepEqual(numbers.kinds, ['structured-data']);
  assert.deepEqual(jsonMime.kinds, ['structured-data']);
  assert.deepEqual(excelMime.kinds, ['structured-data']);
  assert.deepEqual(jsMime.kinds, ['code']);
  assert.equal(sensitive.sensitiveCount, 1);
  assert.equal(sensitiveNames.sensitiveCount, 3);
  assertClassifiesAs('Summarize this.', 'high', { attachmentProfile: large });
  assertClassifiesAs('Analyze this attachment.', 'high', { attachmentProfile: unknown });
  assertClassifiesAs('Explain these files.', 'high', { attachmentProfile: five });
  assertClassifiesAs('Explain these files.', 'extra-high', { attachmentProfile: six });
});

test('attachment-only and cross-file requests receive conservative reasoning floors', () => {
  const onePdf = toolkit.buildAttachmentProfile([{ name: 'worksheet.pdf' }], 1);
  const unknown = toolkit.buildAttachmentProfile([], 1);
  const twoPapers = toolkit.buildAttachmentProfile([{ name: 'a.pdf' }, { name: 'b.pdf' }], 2);
  const tenPapers = toolkit.buildAttachmentProfile(
    Array.from({ length: 10 }, (_value, index) => ({ name: `source-${index}.pdf` })),
    10,
  );

  assertClassifiesAs('', 'medium', { attachmentProfile: onePdf });
  assertClassifiesAs('', 'high', { attachmentProfile: unknown });
  assertClassifiesAs('Compare the attached papers and identify contradictions.', 'high', { attachmentProfile: twoPapers });
  assertClassifiesAs('Why?', 'extra-high', {
    previousLevel: 'instant',
    hasPriorConversation: true,
    attachmentProfile: tenPapers,
  });
  assertClassifiesAs('!route:instant', 'instant', { attachmentProfile: tenPapers });
});

test('context-dependent prompts inherit relevant difficulty without contaminating new easy questions', () => {
  for (const [prompt, previousLevel, expected] of [
    ['Summarize it.', 'extra-high', 'high'],
    ['Translate that to Spanish.', 'high', 'high'],
    ['Use the same assumptions and solve part C.', 'extra-high', 'extra-high'],
    ['What is its determinant?', 'high', 'high'],
    ['Does equation 7 still hold?', 'extra-high', 'extra-high'],
    ['Explain section 4.', 'extra-high', 'extra-high'],
    ['Apply that fix.', 'extra-high', 'extra-high'],
  ]) {
    const result = assertClassifiesAs(prompt, expected, { previousLevel, hasPriorConversation: true });
    assert.equal(result.inherited, true);
  }

  const historical = toolkit.buildAttachmentProfile([{ name: 'calculations.xlsx' }], 1);
  assertClassifiesAs('What does the second table mean?', 'high', {
    conversationLevel: 'medium',
    hasPriorConversation: true,
    historicalAttachmentProfile: historical,
  });
  assertClassifiesAs('what is 2+2', 'instant', {
    conversationLevel: 'pro',
    hasPriorConversation: true,
    historicalAttachmentProfile: toolkit.buildAttachmentProfile([{ name: 'repository.zip' }], 1),
  });
  assertClassifiesAs('New question: What is the capital of France?', 'instant', {
    conversationLevel: 'pro',
    hasPriorConversation: true,
  });
});

test('short confirmations inherit only when the latest assistant invited the next step', () => {
  for (const prompt of [
    'Yes.', 'Okay.', 'Sure.', 'Sure thing.', 'Definitely.', 'Of course.',
    'That works.', 'Sounds good to me.', 'Yes, do it.', 'Yes, go ahead.',
    'Okay, continue.', 'Go ahead.',
  ]) {
    const result = assertClassifiesAs(prompt, 'pro', {
      previousLevel: 'pro',
      hasPriorConversation: true,
      awaitingConfirmation: true,
    });
    assert.equal(result.inherited, true, prompt);
  }

  assertClassifiesAs('Yes.', 'instant', {
    previousLevel: 'pro',
    hasPriorConversation: true,
    awaitingConfirmation: false,
  });

  for (const prompt of [
    'Yes, and add tests.',
    'Sure, add tests.',
    'Yes, but use Python.',
    'Okay, use the first approach.',
    'Go ahead and implement it.',
  ]) {
    const result = assertClassifiesAs(prompt, 'pro', {
      previousLevel: 'pro',
      hasPriorConversation: true,
      awaitingConfirmation: true,
    });
    assert.equal(result.inherited, true, prompt);
  }
});

test('elliptical follow-ups inherit difficulty while standalone lookalikes do not', () => {
  for (const prompt of [
    'Using that, find y.',
    'Now solve for y.',
    'What happens when x = 0?',
    'What if x is negative?',
    'And for the other one?',
    'Where did that number come from?',
    'What assumption did you use?',
    'Could you show the algebra?',
    'Which formula did you use?',
    'How did you know to divide by 2?',
    'Why did you subtract 4?',
    'Can you explain where 12 came from?',
    'What does x represent?',
    'What about x = 0?',
    'Could you calculate the next value?',
    'Based on that, what is y?',
    'So is x positive?',
    'Then is y zero?',
    'Could you do B?',
    'Can you explain?',
    'Could you simplify?',
    'Can you go over it?',
    'Can you give me another example?',
    'What about the last example?',
    'Can you elaborate on the last point?',
    'Could you revisit your last point?',
    'Can you explain your last sentence?',
    'Could you explain the first bullet?',
    'What about item 3?',
    'What about aspirin?',
    'And the second medication?',
    'What about page 7?',
    'And on Windows?',
    'What if the patient is pregnant?',
    'Does it work on Windows?',
    'Should I sign it?',
    'Can I deploy it now?',
    'Where should I put it?',
    'What should I do with it?',
    'Really?',
    'Seriously?',
    'Correct?',
    'Right?',
    'Wrong?',
    'Source?',
    'Sources?',
    'Evidence?',
    'Proof?',
    'Examples?',
    'Meaning?',
    'Where did you get that?',
    'No, use Python instead.',
    'No, do the other option.',
    'Pick the second one.',
  ]) {
    const result = assertClassifiesAs(prompt, 'extra-high', {
      previousLevel: 'extra-high',
      hasPriorConversation: true,
    });
    assert.equal(result.inherited, true, prompt);
  }

  const historical = toolkit.buildAttachmentProfile([{ name: 'old.zip' }], 1);
  for (const prompt of [
    'Create a file named report.pdf.',
    'What is the function of mitochondria?',
    'What is still life art?',
    'Are there better options for renters insurance?',
    'Does it rain more in Seattle or Portland?',
    'What is more accurate, a thermometer or your hand?',
    'When does bus line 4 arrive?',
    'What is Medicare Part B?',
    'What is Formula 1?',
    'Rewrite “Using that, find y.” politely.',
    'Translate "Where did that number come from?" to Spanish.',
    'What is the file system?',
    'What is the Document Object Model?',
    'What is the table of contents?',
    'How does the image sensor work?',
    'What is the spreadsheet software called?',
    'What is attachment theory?',
    'How do I use the Document Object Model?',
    'How do I read a file system path?',
    'How does an image sensor work?',
    'How do I create a table of contents?',
    'Rewrite ‘Using that, find y.’ politely.',
    'What is the Code of Hammurabi?',
    'What is the proof of stake?',
    'What is The Matrix about?',
    'What is the answer key format?',
    'Make it rain.',
    'How do I use files in Python?',
    'How do I read documents in Java?',
    'How can I compare tables in SQL?',
    'How do I analyze images with OpenCV?',
    'How do I read PDFs on Android?',
    'Can you check Paris?',
    'What was the first file in Unix?',
    'What is the first image sensor?',
    'What is the first table in SQL?',
    'What is the first step in photosynthesis?',
    'What is the last section of the Constitution?',
    'Explain the first step of mitosis.',
    'What is the same-origin policy?',
    'How does the same-origin policy work?',
    'What is Above & Beyond?',
    'How do I install previous versions of Windows?',
    'What is the previous version of iOS?',
    'Explain earlier English literature.',
    'What is Again by Noah Cyrus?',
  ]) {
    const baseline = toolkit.classifyPrompt(prompt);
    const contextual = toolkit.classifyPrompt(prompt, {
      previousLevel: 'pro',
      hasPriorConversation: true,
      historicalAttachmentProfile: historical,
    });
    assert.equal(canonicalLevel(contextual), canonicalLevel(baseline), prompt);
    assert.equal(contextual.inherited, false, prompt);
  }
});

test('explicit references can recover older attachment difficulty without affecting new questions', () => {
  const archived = toolkit.buildAttachmentProfile([{ name: 'results.xlsx' }], 1);
  assertClassifiesAs('What does the table in results.xlsx mean?', 'high', {
    previousLevel: 'medium',
    hasPriorConversation: true,
    archivedAttachmentProfile: archived,
  });
  assertClassifiesAs('what is 2+2', 'instant', {
    previousLevel: 'pro',
    hasPriorConversation: true,
    archivedAttachmentProfile: archived,
  });

  const manyArchived = toolkit.buildAttachmentProfile(
    Array.from({ length: 8 }, (_value, index) => ({ name: `old${index}.pdf`, key: `id:${index}` })),
    8,
  );
  const current = toolkit.buildAttachmentProfile([{ name: 'new.pdf' }], 1);
  const currentResult = assertClassifiesAs('Summarize this attached file.', 'medium', {
    attachmentProfile: current,
    previousLevel: 'pro',
    hasPriorConversation: true,
    archivedAttachmentProfile: manyArchived,
  });
  assert.equal(currentResult.inherited, false);
  for (const prompt of [
    'Compare this attached file with your previous answer.',
    'Apply the previous formula to this spreadsheet.',
    'Use this file to finish the proof above.',
  ]) {
    const mixedContextResult = assertClassifiesAs(prompt, 'pro', {
      attachmentProfile: current,
      previousLevel: 'pro',
      hasPriorConversation: true,
    });
    assert.equal(mixedContextResult.inherited, true, prompt);
  }
  assertClassifiesAs('What does old4.pdf say?', 'medium', {
    previousLevel: 'instant',
    hasPriorConversation: true,
    archivedAttachmentProfile: manyArchived,
  });
  assertClassifiesAs('What does `old4.pdf` show?', 'medium', {
    previousLevel: 'instant',
    hasPriorConversation: true,
    archivedAttachmentProfile: manyArchived,
  });
  for (const prompt of [
    'Compare all files.',
    'Review all attachments.',
    'Analyze every PDF so far.',
    'Summarize all uploaded documents.',
    'Compare the files from the whole conversation.',
    'Explain the first file.',
    'Review the earliest attachment.',
    'Use the original PDF.',
    'Compare the first and last files.',
    'What was in the first uploaded document?',
  ]) {
    assertClassifiesAs(prompt, 'extra-high', {
      previousLevel: 'instant',
      conversationLevel: 'instant',
      hasPriorConversation: true,
      archivedAttachmentProfile: manyArchived,
    });
  }
  const resetAllFiles = assertClassifiesAs('New question: Compare all files.', 'extra-high', {
    previousLevel: 'pro',
    conversationLevel: 'pro',
    hasPriorConversation: true,
    archivedAttachmentProfile: manyArchived,
  });
  assert.equal(resetAllFiles.inherited, false);

  for (const prompt of [
    'How do I select all files on Windows?',
    'Delete all files in this directory.',
    'Compare all files in a folder with Python.',
    'Write a script that reviews every PDF in /tmp.',
    'Find every document on my computer.',
    'Upload all files to S3.',
    'What was the first file in Unix?',
    'What is the original PDF specification?',
    'Where is the earliest document from ancient Egypt?',
    'Explain the oldest spreadsheet format.',
    'Who made the first image sensor?',
  ]) {
    const baseline = toolkit.classifyPrompt(prompt);
    const result = toolkit.classifyPrompt(prompt, {
      previousLevel: 'pro',
      hasPriorConversation: true,
      archivedAttachmentProfile: manyArchived,
    });
    assert.equal(canonicalLevel(result), canonicalLevel(baseline), prompt);
    assert.equal(result.inherited, false, prompt);
  }
  const substring = toolkit.buildAttachmentProfile([{ name: 'data.csv' }], 1);
  for (const prompt of ['What is metadata.csv?', 'How do I open metadata.csv?', 'Review mydata.csv.']) {
    const baseline = toolkit.classifyPrompt(prompt);
    const result = toolkit.classifyPrompt(prompt, {
      previousLevel: 'pro',
      hasPriorConversation: true,
      archivedAttachmentProfile: substring,
    });
    assert.equal(canonicalLevel(result), canonicalLevel(baseline), prompt);
    assert.equal(result.inherited, false, prompt);
  }
});

test('exact retained filenames remain attachment references inside quotes and topic resets', () => {
  const spreadsheet = toolkit.buildAttachmentProfile([{ name: 'results.xlsx' }], 1);
  const papers = toolkit.buildAttachmentProfile([{ name: 'old1.pdf' }, { name: 'old2.pdf' }], 2);
  const spreadsheetContext = {
    previousLevel: 'medium',
    hasPriorConversation: true,
    archivedAttachmentProfile: spreadsheet,
  };

  for (const prompt of [
    'Summarize results.xlsx.',
    'Translate results.xlsx to Spanish.',
    'Review `results.xlsx`.',
    'What does the table in `results.xlsx` mean?',
  ]) {
    assertClassifiesAs(prompt, 'high', spreadsheetContext);
  }
  const reset = assertClassifiesAs('New question: Summarize results.xlsx.', 'high', {
    ...spreadsheetContext,
    previousLevel: 'pro',
  });
  assert.equal(reset.inherited, false);
  assertClassifiesAs('Compare `old1.pdf` and `old2.pdf`.', 'high', {
    previousLevel: 'medium',
    hasPriorConversation: true,
    archivedAttachmentProfile: papers,
  });

  const literal = assertClassifiesAs('Translate the text “results.xlsx” to Spanish.', 'instant', {
    ...spreadsheetContext,
    previousLevel: 'pro',
  });
  assert.equal(literal.inherited, false, 'an explicitly quoted text payload is not a file request');
});

test('common material nouns retain attachment count and difficulty', () => {
  const workbooks = toolkit.buildAttachmentProfile(
    Array.from({ length: 8 }, (_value, index) => ({ name: `workbook-${index}.xlsx` })),
    8,
  );
  for (const prompt of [
    'Compare the workbooks.',
    'Compare the CSVs.',
    'Analyze the dataset.',
    'Review the slide deck.',
    'Check the presentation.',
    'Use the uploads.',
  ]) {
    const result = assertClassifiesAs(prompt, 'extra-high', {
      previousLevel: 'medium',
      hasPriorConversation: true,
      historicalAttachmentProfile: workbooks,
    });
    assert.equal(result.inherited, true, prompt);
  }
});

test('terse revisions inherit the task they modify', () => {
  for (const prompt of [
    'Same but for x=5',
    'Same for second one',
    'Repeat for x=5',
    'This one too',
    'Based on above',
    'Refactor it same way',
    'Actually, do it in Python',
    'Use TypeScript',
    'Add error handling',
    'Try other method',
    'The second one',
    'Part 2 please',
    'In Python',
    'With comments',
    'Be more specific',
    'One more example',
    'Can you expand',
    'Shorter.',
    'More concise.',
    'More detail.',
    'More detailed.',
    'Again.',
    'Without comments.',
    'Now with tests.',
    'The other way.',
    'Fix the errors.',
    'Simpler please.',
    'How come?',
    'More examples.',
    'One more.',
    'Next.',
    'Keep going.',
    'Try once more.',
    'Same thing.',
    'Formal tone.',
    'Use bullets.',
    'As a table.',
    'No citations.',
    'Remove the tests.',
    'Only show the code.',
    'Do the rest.',
    'Finish the rest.',
  ]) {
    const result = assertClassifiesAs(prompt, 'pro', {
      previousLevel: 'pro',
      hasPriorConversation: true,
    });
    assert.equal(result.inherited, true, prompt);
  }
  const styleOnly = assertClassifiesAs('Make it formal.', 'high', {
    previousLevel: 'pro',
    hasPriorConversation: true,
  });
  assert.equal(styleOnly.inherited, true);
});

test('long-range references use archived difficulty without confusing ordinary numbered tasks', () => {
  const context = {
    conversationLevel: 'medium',
    archivedConversationLevel: 'pro',
    previousLevel: 'medium',
    hasPriorConversation: true,
  };
  for (const prompt of [
    'Go back to message 3 and finish that task.',
    'Use the method near the top of this chat.',
    'Continue the task from the beginning.',
    'Finish the proof from 20 messages ago.',
    'Go back to the third message and finish it.',
    'Use our second question and continue.',
    'Continue the tenth message.',
    'Go back three messages.',
    'Use the message before last.',
    'Use the third message from this chat.',
    'Continue the earlier task.',
    'Resume the previous task.',
    'Finish our old task.',
    'Go back to that earlier problem.',
    'Use the earlier instructions.',
    'Continue what we were doing before.',
    'Return to the prior question.',
    'Revisit the old problem.',
    'Finish the previous request.',
    'Summarize our entire conversation.',
    'Summarize the whole chat.',
    'Review the full conversation.',
    'Use everything we have discussed so far.',
    'Consider everything above.',
    'Based on all earlier messages, decide.',
    'Give me a recap of this chat.',
    'Continue using the full context.',
    'Look at the conversation history.',
  ]) {
    assertClassifiesAs(prompt, 'pro', context);
  }
  for (const [prompt, expected] of [
    ['Solve question 3.', 'medium'],
    ['Do task 2.', 'medium'],
    ['What does error message 3 mean?', 'instant'],
    ['Rewrite prompt 4.', 'instant'],
  ]) {
    const result = assertClassifiesAs(prompt, expected, context);
    assert.equal(result.inherited, false, prompt);
  }

  for (const prompt of [
    'What is a full conversation?',
    'Define conversation history.',
    'What does entire conversation mean?',
    'Write a story containing an entire conversation.',
    'Give an example of a whole conversation in Spanish.',
    'How do I export my chat history?',
    'Who sent the first message over the internet?',
    'What is the first question on the exam?',
    'Write an original prompt for an image generator.',
    'Repeat the song from the beginning.',
    'Continue the video from the start.',
    'Use recursion from the beginning.',
    'Go back to the first chapter.',
  ]) {
    const baseline = toolkit.classifyPrompt(prompt);
    const result = toolkit.classifyPrompt(prompt, context);
    assert.equal(canonicalLevel(result), canonicalLevel(baseline), prompt);
    assert.equal(result.inherited, false, prompt);
  }

  assertClassifiesAs('Summarize our entire conversation.', 'high', {
    conversationLevel: 'instant',
    archivedConversationLevel: 'instant',
    hasPriorConversation: true,
    archivedMeaningfulTurnCount: 30,
    archivedSampledTextLength: 30_000,
  });
  assertClassifiesAs('Summarize our entire conversation.', 'extra-high', {
    conversationLevel: 'instant',
    archivedConversationLevel: 'instant',
    hasPriorConversation: true,
    archivedMeaningfulTurnCount: 100,
    archivedSampledTextLength: 100_000,
  });
});

test('attachment-derived answer checks require independent verification', () => {
  const pdf = toolkit.buildAttachmentProfile([{ name: 'scan.pdf' }], 1);
  const sheet = toolkit.buildAttachmentProfile([{ name: 'budget.xlsx' }], 1);
  for (const [prompt, profile] of [
    ['Are the extracted names correct?', pdf],
    ['The spreadsheet says $10,000; is that correct?', sheet],
  ]) {
    const result = assertClassifiesAs(prompt, 'high', { attachmentProfile: profile });
    assert.equal(result.strict, true);
    assert.match(toolkit.buildAccuracyGuardedPrompt(prompt), /independently verify the stated answer or result/iu);
  }
});

test('topic resets still independently verify supplied answers and extracted data', () => {
  for (const prompt of [
    'New question: I don’t get why the answer is 12V.',
    'New question. Are the extracted names correct?',
    'Changing topics: The OCR says 12V—is that correct?',
    'Verify every extracted number against the PDF.',
    'Compare the transcribed values with the source image.',
  ]) {
    const resetsTopic = /^(?:new question|changing topics)/iu.test(prompt);
    const result = assertClassifiesAs(prompt, resetsTopic ? 'high' : 'pro', {
      previousLevel: 'pro',
      hasPriorConversation: true,
    });
    assert.equal(result.strict, true, prompt);
    if (resetsTopic) assert.equal(result.inherited, false, prompt);
    assert.match(toolkit.buildAccuracyGuardedPrompt(prompt), /independently verify the stated answer or result/iu);
  }
});

test('derivation and doubt follow-ups verify the premise before explaining it', () => {
  for (const prompt of [
    'Why was 12 used?',
    'How was 12 calculated?',
    'Where does 12 come from?',
    'What made you choose B?',
    'Could it be wrong?',
    'Might that be incorrect?',
    'Is there a mistake?',
    'Any mistakes?',
    'Are there any errors?',
    'Any chance that is wrong?',
    'Could your result be wrong?',
    'What if your answer is wrong?',
    "I don't understand why B.",
    'Explain why B.',
    "I don't get where 12 came from.",
    "I don't understand how you chose B.",
    "I don't see why you used 12.",
    'That makes no sense.',
    'How come?',
    'Why?',
  ]) {
    const result = assertClassifiesAs(prompt, 'extra-high', {
      previousLevel: 'extra-high',
      hasPriorConversation: true,
    });
    assert.equal(result.strict, true, prompt);
    assert.match(toolkit.buildAccuracyGuardedPrompt(prompt), /independently verify the stated answer or result/iu);
  }
});

test('candidate-answer explanations verify the premise before rationalizing it', () => {
  for (const prompt of [
    'I got 12, why?',
    'I think the answer is B. Explain.',
    'The answer key says B. Why?',
    'My teacher says it is B. Why?',
    'It says B. Why?',
    'Help me understand 12V.',
    'Why would it be B?',
    'Why should it be B?',
    'B is the answer. Explain why.',
    'The answer is B because x. Is that true?',
    'Why not B?',
    'Why B instead of C?',
    'I do not get 12V.',
    'Explain the 12V.',
    'Walk me through why it is B.',
    'Show why B is correct.',
    'I got negative twelve volts, why?',
    'I think the answer is sodium chloride. Explain.',
    'Why would it be kinetic energy?',
    'The solution says x=5. How?',
    'They got 12V. How?',
    'According to the key, it is B. Why?',
    'B? Why?',
    'Answer: B. Why?',
    'Correct answer: B. Explain.',
    'The answer key says photosynthesis. Why?',
    'My teacher says kinetic energy.',
    'Explain negative voltage.',
    'Is photosynthesis correct?',
    'Could photosynthesis be correct?',
    'Photosynthesis, right?',
    'Can you explain your last answer?',
    'Show reasoning behind that.',
    'How did you arrive at that answer?',
    'Justify it.',
    'Prove that.',
    'Really?',
    'Seriously?',
    'Correct?',
    'Right?',
    'Wrong?',
    'Where did you get that?',
  ]) {
    const result = assertClassifiesAs(prompt, 'high');
    assert.equal(result.strict, true, prompt);
    assert.equal(toolkit.requiresAnswerVerification(prompt), true, prompt);
    assert.match(toolkit.buildAccuracyGuardedPrompt(prompt), /independently verify the stated answer or result/iu);
  }
});

test('deictic candidate explanations verify only when the candidate appears in the prior answer', () => {
  const context = {
    hasPriorConversation: true,
    latestAssistantText: 'After checking the choices, the answer is photosynthesis.',
  };
  for (const prompt of ['Why is it photosynthesis?', 'How is it photosynthesis?']) {
    const result = assertClassifiesAs(prompt, 'high', context);
    assert.equal(result.strict, true, prompt);
    assert.equal(toolkit.requiresAnswerVerification(prompt, context), true, prompt);
    assert.match(
      toolkit.buildAccuracyGuardedPrompt(prompt, 30_000, context),
      /independently verify the stated answer or result/iu,
    );
  }

  assert.equal(toolkit.requiresAnswerVerification('Why is it photosynthesis?'), false);
  assert.equal(toolkit.requiresAnswerVerification('Why is it 5 PM?', context), false);
  assert.equal(toolkit.requiresAnswerVerification('Why is the sky blue?', context), false);
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
    'That result seems off.',
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
    assert.match(result.reasons.join(' '), /safer (?:context )?level/iu);
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
  const bareWhy = assertClassifiesAs('Why?', 'high', { previousLevel: 'instant' });
  assert.equal(bareWhy.strict, true);
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
    'Explain photosynthesis.',
    'Explain the first step.',
    'Explain the process.',
    'Explain the attached file.',
    'Explain this sentence.',
    'Explain why leaves are green.',
    'Explain why Python is popular.',
    'Explain why the sky is blue.',
    'Help me understand photosynthesis.',
    'Why not go outside?',
    'Why not use Python?',
    'Explain the answer key format.',
    'Explain your recommendation.',
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
