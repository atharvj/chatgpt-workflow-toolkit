'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const toolkit = require('../chatgpt-workflow-toolkit.user.js');

function fixture(t) {
  const dom = new JSDOM(`<!doctype html><body><main>
    <article data-testid="conversation-turn-1"><div data-message-author-role="assistant" id="answer"></div><button data-testid="copy-turn-action-button">Copy</button></article>
    <form><textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button></form>
  </main></body>`, { url: 'https://chatgpt.com/c/math-source', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  return { dom, doc, turn: doc.querySelector('article'), answer: doc.querySelector('#answer') };
}

function equation(doc, tex, display = false) {
  const outer = doc.createElement('span');
  outer.className = display ? 'katex-display' : 'inline-equation';
  outer.innerHTML = `<span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>duplicate</mi></mrow><annotation encoding="application/x-tex"></annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="base"><span>VISUAL</span><span class="vlist"><span>x</span><span>2</span></span></span></span></span>`;
  outer.querySelector('annotation').textContent = tex;
  return outer;
}

function select(dom, start, startOffset, end, endOffset) {
  const range = dom.window.document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  range.getBoundingClientRect = () => ({ left: 100, top: 100, right: 400, bottom: 200, width: 300, height: 100 });
  const selection = dom.window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

test('the screenshot-style highlight keeps all equilibrium equations once and in order', (t) => {
  const { dom, doc, turn, answer } = fixture(t);
  answer.innerHTML = '<p>Unselected angle definitions.</p><p id="start">At point A:</p>';
  const weight = String.raw`W = mg = 55(9.81) = 539.55\,\mathrm{N}`;
  const fx = String.raw`\sum F_x = 0:\quad -T_{AB}\sin 34^{\circ} + T_{AC}\cos 50^{\circ} = 0`;
  const fy = String.raw`\sum F_y = 0:\quad T_{AB}\cos 34^{\circ} + T_{AC}\sin 50^{\circ} - 539.55 = 0`;
  answer.append(equation(doc, weight, true));
  const label = doc.createElement('p'); label.textContent = 'Equilibrium:'; answer.append(label);
  answer.append(equation(doc, fx, true), equation(doc, fy, true));
  const endIndex = answer.childNodes.length;
  const later = doc.createElement('p'); later.textContent = 'Unselected solution: 360.79 N'; answer.append(later);
  const before = turn.innerHTML;
  const selection = select(dom, doc.querySelector('#start').firstChild, 0, answer, endIndex);
  const result = toolkit.extractSelectionQuote(selection, turn);
  for (const tex of [weight, fx, fy]) assert.equal(result.text.split(tex).length - 1, 1);
  assert.ok(result.text.indexOf(weight) < result.text.indexOf(fx));
  assert.ok(result.text.indexOf(fx) < result.text.indexOf(fy));
  assert.match(result.text, /^At point A:/u);
  assert.match(result.text, /Equilibrium:/u);
  assert.doesNotMatch(result.text, /VISUAL|duplicate|Unselected|360\.79/u);
  assert.match(result.note, /source notation/u);
  assert.equal(turn.innerHTML, before, 'never change the original equations');
});

test('partial formula selection expands only that formula, not surrounding prose or math', (t) => {
  const { dom, doc, turn, answer } = fixture(t);
  answer.append('Before ', equation(doc, String.raw`\frac{x_1^2}{y_{AB}}`), ' after ', equation(doc, 'z=9'));
  const text = answer.querySelector('.katex-html .vlist span').firstChild;
  const selection = select(dom, text, 0, text, 1);
  const before = selection.toString();
  const result = toolkit.extractSelectionQuote(selection, turn);
  assert.equal(result.text, String.raw`\(\frac{x_1^2}{y_{AB}}\)`);
  assert.match(result.note, /whole equation/u);
  assert.equal(selection.toString(), before, 'do not move the live highlight');
});

test('selection starting in one formula and ending in another keeps the intervening text', (t) => {
  const { dom, doc, turn, answer } = fixture(t);
  answer.append(equation(doc, 'a_1'), ' compared with ', equation(doc, 'b^2'));
  const texts = [...answer.querySelectorAll('.katex-html .vlist span:first-child')].map((node) => node.firstChild);
  const result = toolkit.extractSelectionQuote(select(dom, texts[0], 0, texts[1], 1), turn);
  assert.equal(result.text, String.raw`\(a_1\) compared with \(b^2\)`);
});

test('unselected adjacent equations are not pulled into a prose highlight', (t) => {
  const { dom, doc, turn, answer } = fixture(t);
  answer.append(equation(doc, 'a=1'), ' ordinary prose ', equation(doc, 'b=2'));
  const selection = select(dom, answer, 1, answer, 2);
  assert.deepEqual(toolkit.extractSelectionQuote(selection, turn), { text: 'ordinary prose', note: '' });
});

test('HTML-only math uses compact display text without guessing missing structure', (t) => {
  const { dom, turn, answer } = fixture(t);
  answer.innerHTML = '<span class="katex"><span class="katex-html"><span>x</span><span>2</span></span></span>';
  const selection = select(dom, answer, 0, answer, 1);
  const result = toolkit.extractSelectionQuote(selection, turn);
  assert.equal(result.text, selection.toString());
  assert.match(result.note, /compact display text/u);
  assert.equal(result.usesVisualMath, true);
  assert.doesNotMatch(result.text, /x\^2/u, 'no guessed exponent');
});

test('mixed source and HTML-only math preserves each available source independently', (t) => {
  const { dom, doc, turn, answer } = fixture(t);
  const tex = String.raw`\frac{a_1}{b^2}`;
  const sourceBacked = equation(doc, tex);
  const htmlOnly = equation(doc, 'discard');
  htmlOnly.querySelector('.katex-mathml').remove();
  htmlOnly.querySelector('.katex-html').innerHTML = '<span>F</span><span class="vlist"><span>x</span></span><span>=0</span><span class="vlist-s">\u200b|</span>';
  answer.append(sourceBacked, ' and ', htmlOnly);
  const selection = select(dom, answer, 0, answer, 3);
  selection.toString = () => 'a\n1\nb\n2 and F\nx\n=0';
  const result = toolkit.extractSelectionQuote(selection, turn);
  assert.equal(result.text, `\\(${tex}\\) and Fx=0`);
  assert.equal(result.usesVisualMath, true);
  assert.match(result.note, /compact display text/u);
});

test('equations without source or readable text still warn and do not invent a transcription', (t) => {
  const { dom, turn, answer } = fixture(t);
  answer.innerHTML = '<mjx-container><svg><text>inaccessible glyphs</text></svg></mjx-container>';
  const selection = select(dom, answer, 0, answer, 1);
  const result = toolkit.extractSelectionQuote(selection, turn);
  assert.equal(result.text, selection.toString());
  assert.match(result.note, /neither source notation nor readable display text/u);
  assert.equal(result.usesVisualMath, true);
});

test('flattened math prompts require original-equation verification without affecting ordinary questions', () => {
  const prompt = toolkit.buildSelectedQuestion('Fx=0', 'Why?', true);
  assert.match(prompt, /Locate the original equations in this branched conversation/u);
  assert.match(prompt, /ask for clarification instead of guessing/u);
  assert.match(prompt, /My question:\nWhy\?$/u);
  assert.doesNotMatch(toolkit.buildSelectedQuestion('Normal prose', 'Why?'), /flattened display text/u);
});

test('a range beginning at the end of a math span does not add an unselected equation', (t) => {
  const { dom, doc, turn, answer } = fixture(t);
  answer.append(equation(doc, 'x^2'), ' Only this prose');
  const last = answer.querySelector('.katex-html .vlist span:last-child').firstChild;
  const selection = select(dom, last, last.length, answer.lastChild, answer.lastChild.length);
  assert.deepEqual(toolkit.extractSelectionQuote(selection, turn), { text: 'Only this prose', note: '' });
});

test('MathML without a TeX annotation preserves fraction and subscript structure', (t) => {
  const { dom, turn, answer } = fixture(t);
  answer.innerHTML = '<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><msub><mi>T</mi><mi>AB</mi></msub><mn>2</mn></mfrac></math>';
  const result = toolkit.extractSelectionQuote(select(dom, answer, 0, answer, 1), turn);
  assert.match(result.text, /MathML equation:/u);
  assert.match(result.text, /<mfrac><msub><mi>T<\/mi><mi>AB<\/mi><\/msub><mn>2<\/mn><\/mfrac>/u);
});

test('TeX whitespace, dollar signs, and special text are preserved literally', (t) => {
  const { dom, doc, turn, answer } = fixture(t);
  const tex = String.raw`\text{a  b $& <tag>} + \frac{1}{2}`;
  answer.append(equation(doc, tex));
  const result = toolkit.extractSelectionQuote(select(dom, answer, 0, answer, 1), turn);
  assert.equal(result.text, `\\(${tex}\\)`);
});

test('ordinary text and code selections retain the original selection text', (t) => {
  const { dom, turn, answer } = fixture(t);
  answer.innerHTML = '<p>Some <strong>ordinary</strong> text.</p><pre><code>&lt;span class="katex"&gt;x&lt;/span&gt;\n  a*b</code></pre>';
  const selection = select(dom, answer, 0, answer, 2);
  assert.deepEqual(toolkit.extractSelectionQuote(selection, turn), { text: selection.toString(), note: '' });
});

test('math-aware selection reaches the preview and saved native-branch question', async (t) => {
  const { dom, doc, turn, answer } = fixture(t);
  const tex = String.raw`-T_{AB}\sin 34^{\circ} + T_{AC}\cos 50^{\circ} = 0`;
  answer.append(equation(doc, tex, true));
  const text = answer.querySelector('.katex-html .vlist span').firstChild;
  select(dom, text, 0, text, 1);
  const previousGM = globalThis.GM;
  const values = new Map();
  globalThis.GM = {
    async getValue(key, fallback) { return values.get(key) ?? fallback; },
    async setValue(key, value) { values.set(key, value); },
    async deleteValue(key) { values.delete(key); },
  };
  t.after(() => { if (previousGM === undefined) delete globalThis.GM; else globalThis.GM = previousGM; });
  const app = await toolkit.install(doc, dom.window);
  t.after(() => app.state.observer.disconnect());
  text.parentElement.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true }));
  const deadline = Date.now() + 1500;
  while (doc.querySelector('#cgs-selection-pill').hidden && Date.now() < deadline) await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
  assert.equal(doc.querySelector('#cgs-selection-pill').hidden, false);
  doc.querySelector('#cgs-selection-pill').click();
  assert.equal(doc.querySelector('#cgs-selected-context').textContent, `\\[${tex}\\]`);
  assert.equal(doc.querySelector('#cgs-selection-note'), null);
  assert.equal(doc.querySelector('#cgs-selected-context').children.length, 0, 'source is shown as text, not executed as HTML');
  dom.window.open = () => ({ location: { replace() {} }, focus() {} });
  doc.querySelector('#cgs-question').value = 'Why are these angles different?';
  doc.querySelector('[data-cgs-action="submit-question"]').click();
  assert.equal(await app.state.sideLaunchPromise, true);
  const job = [...values.values()].find((value) => value.kind === 'ask');
  assert.ok(job.question.includes(tex));
  assert.match(job.question, /Why are these angles different\?/u);
  assert.equal(doc.querySelector('#prompt-textarea').value, '');
  assert.equal(turn.querySelectorAll('.katex').length, 1);
});

test('HTML-only screenshot equations reach the full preview and outgoing question despite a collapsed preview', async (t) => {
  const { dom, doc, answer } = fixture(t);
  const strings = ['W=mg=55(9.81)=539.55 N', '∑Fx=0:−TABsin34°+TACcos50°=0', '∑Fy=0:TABcos34°+TACsin50°−539.55=0'];
  answer.innerHTML = '<p>At point A:</p>';
  strings.forEach((text, index) => {
    if (index === 1) {
      const label = doc.createElement('p'); label.textContent = 'Equilibrium:'; answer.append(label);
    }
    const math = equation(doc, 'unused', true);
    math.querySelector('.katex-mathml').remove();
    const visual = math.querySelector('.katex-html');
    visual.replaceChildren();
    for (const character of text) {
      const span = doc.createElement('span'); span.textContent = character; visual.append(span);
    }
    answer.append(math);
  });
  const selection = select(dom, answer, 0, answer, answer.childNodes.length);
  // Browsers insert newlines around positioned math spans; jsdom does not.
  selection.toString = () => `At point A:\n${strings[0]}\nEquilibrium:\n∑F\nx\n=0:−TABsin34°+TACcos50°=0\n∑F\ny\n=0:TABcos34°+TACsin50°−539.55=0`;
  const previousGM = globalThis.GM;
  const values = new Map();
  globalThis.GM = {
    async getValue(key, fallback) { return values.get(key) ?? fallback; },
    async setValue(key, value) { values.set(key, value); },
    async deleteValue(key) { values.delete(key); },
  };
  t.after(() => { if (previousGM === undefined) delete globalThis.GM; else globalThis.GM = previousGM; });
  const app = await toolkit.install(doc, dom.window);
  t.after(() => app.state.observer.disconnect());
  answer.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true }));
  const deadline = Date.now() + 1500;
  while (doc.querySelector('#cgs-selection-pill').hidden && Date.now() < deadline) await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
  assert.equal(doc.querySelector('#cgs-selection-pill').hidden, false);
  doc.querySelector('#cgs-selection-pill').click();
  const preview = doc.querySelector('#cgs-selected-context');
  for (const equation of strings) assert.ok(preview.textContent.includes(equation), equation);
  assert.doesNotMatch(preview.textContent, /∑F\n/u);
  const allText = preview.textContent;
  const toggle = doc.querySelector('[data-cgs-action="toggle-selection-preview"]');
  assert.equal(toggle.hidden, false);
  toggle.click();
  assert.equal(preview.dataset.expanded, 'true');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  toggle.click();
  assert.equal(preview.dataset.expanded, 'false');
  assert.equal(preview.textContent, allText);
  dom.window.open = () => ({ location: { replace() {} }, focus() {} });
  doc.querySelector('#cgs-question').value = 'Why sine instead of cosine?';
  doc.querySelector('[data-cgs-action="submit-question"]').click();
  assert.equal(await app.state.sideLaunchPromise, true);
  const job = [...values.values()].find((value) => value.kind === 'ask');
  for (const equation of strings) assert.ok(job.question.includes(equation));
  assert.match(job.question, /Locate the original equations/u);
  assert.equal(doc.querySelector('#prompt-textarea').value, '');
  app.processRoot(doc.body);
  doc.querySelector('.cgs-turn-action').click();
  assert.equal(app.state.questionScope, 'response');
  assert.equal(app.state.questionUsesVisualMath, true, 'whole response includes its own visual-only equations');
  assert.equal(toggle.hidden, false);
  const plain = doc.createElement('article'); plain.dataset.testid = 'conversation-turn-99';
  plain.innerHTML = '<div data-message-author-role="assistant">A plain answer.</div>';
  doc.querySelector('main').append(plain); app.processRoot(plain);
  plain.querySelector('.cgs-turn-action').click();
  assert.equal(app.state.questionUsesVisualMath, false, 'a different plain response does not inherit the math caveat');
});
