'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const toolkit = require('../chatgpt-workflow-toolkit.user.js');

function editorPage(t, html = '<p><br class="ProseMirror-trailingBreak"></p>') {
  const dom = new JSDOM(`<!doctype html><main><form><div id="prompt-textarea" class="ProseMirror" contenteditable="true">${html}</div></form></main>`, {
    url: 'https://chatgpt.com/c/test-composer', pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  return { win: dom.window, doc: dom.window.document, editor: dom.window.document.querySelector('#prompt-textarea') };
}

for (const [name, html, expected] of [
  ['paragraphs and an empty line', '<p>Focus on this.</p><p><br class="ProseMirror-trailingBreak"></p><p>Highlighted passage:</p><p>&gt; Methods:</p><p><br></p><p>My question: what does this word mean</p>', 'Focus on this.\n\nHighlighted passage:\n> Methods:\n\nMy question: what does this word mean'],
  ['browser div paragraphs', 'First line<div><br></div><div>Third line</div>', 'First line\n\nThird line'],
  ['hard breaks', '<p>First<br>Second<br><br class="ProseMirror-trailingBreak"></p>', 'First\nSecond\n'],
  ['empty editor', '<p><br class="ProseMirror-trailingBreak"></p>', ''],
  ['literal code indentation', '<p>```python</p><p>if ready:</p><p>  send()</p><p>```</p>', '```python\nif ready:\n  send()\n```'],
  ['inline marks and Unicode', '<p><strong>Keep</strong> a*b, 👩‍🔬, θ₁, &lt;tag&gt; &amp; &quot;text&quot;.</p>', 'Keep a*b, 👩‍🔬, θ₁, <tag> & "text".'],
]) {
  test(`editor text preserves logical lines: ${name}`, (t) => {
    const { editor } = editorPage(t, html);
    // innerText is layout-dependent: paragraph spacing/wrapping must not be
    // confused with logical text in the editor document.
    Object.defineProperty(editor, 'innerText', { get() { return 'misleading layout text'; } });
    assert.equal(toolkit.getComposerText(editor), expected);
    assert.equal(toolkit.composerTextEquals(editor, expected), true);
  });
}

test('different words, removed newlines, changed indentation, or Unicode are not the same draft', (t) => {
  const { editor } = editorPage(t, '<p>```python</p><p>if ready:</p><p>  send()</p><p>```</p><p>👩‍🔬</p>');
  const expected = '```python\nif ready:\n  send()\n```\n👩‍🔬';
  assert.equal(toolkit.composerTextEquals(editor, expected), true);
  for (const changed of [expected.replace('ready', 'not_ready'), expected.replaceAll('\n', ' '),
    expected.replace('  send', 'send'), expected.replace('👩‍🔬', '👩🔬')]) {
    assert.equal(toolkit.composerTextEquals(editor, changed), false);
  }
});

for (const mode of ['native-paragraphs', 'native-collapsed', 'native-throws', 'no-native-command']) {
  test(`multiline insertion survives editor parsing without flattened text: ${mode}`, (t) => {
    const { editor, doc, win } = editorPage(t);
    const expected = 'Focus only on this.\n\nHighlighted passage:\n> Methods:\n\nMy question: what does this word mean\n  Keep <tag> & 👩‍🔬 literal.';
    let nativeParagraph = null;
    if (mode !== 'no-native-command') doc.execCommand = (_command, _ui, text) => {
      if (mode === 'native-throws') throw new Error('Unavailable command');
      if (mode === 'native-collapsed') editor.textContent = text.replace(/\s+/gu, ' ');
      else {
        editor.replaceChildren(...text.split('\n').map((line) => {
          const p = doc.createElement('p');
          if (line) p.textContent = line;
          else p.append(doc.createElement('br'));
          return p;
        }));
        nativeParagraph = editor.firstElementChild;
      }
      return true;
    };
    Object.defineProperty(editor, 'innerText', {
      get() {
        return editor.children.length ? [...editor.children].map((p) => p.textContent).join('\n\n') : editor.textContent.replace(/\s+/gu, ' ');
      },
    });
    let parsedText = '';
    editor.addEventListener('input', () => {
      // Model the editor's paragraph parser, independently of the script's
      // reader. Raw text-node newlines would collapse to spaces (the bug).
      parsedText = editor.children.length ? [...editor.children].map((p) => p.textContent).join('\n') : editor.textContent.replace(/\s+/gu, ' ');
    });
    assert.equal(toolkit.setComposerText(editor, expected, win), true);
    assert.equal(parsedText, expected);
    assert.equal(toolkit.getComposerText(editor), expected);
    assert.equal(editor.querySelector('tag'), null, 'text is never interpreted as HTML');
    if (nativeParagraph) assert.equal(editor.firstElementChild, nativeParagraph, 'do not discard a successful native insertion because innerText adds paragraph spacing');
  });
}
