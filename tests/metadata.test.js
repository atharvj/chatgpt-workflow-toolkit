'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const userscriptPath = join(__dirname, '..', 'chatgpt-workflow-toolkit.user.js');
const source = readFileSync(userscriptPath, 'utf8');
const api = require(userscriptPath);

function parseMetadata(text) {
  const block = text.match(/\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/u);
  assert.ok(block, 'userscript metadata block should exist');

  const metadata = new Map();
  for (const line of block[1].split(/\r?\n/u)) {
    const entry = line.match(/^\/\/\s+@(\S+)(?:\s+(.*))?$/u);
    if (!entry) continue;
    const [, key, value = ''] = entry;
    metadata.set(key, [...(metadata.get(key) || []), value.trim()]);
  }
  return metadata;
}

test('metadata identifies a valid Greasy Fork userscript', () => {
  const metadata = parseMetadata(source);

  assert.deepEqual(metadata.get('name'), ['ChatGPT Workflow Toolkit']);
  assert.deepEqual(metadata.get('version'), [api.VERSION]);
  assert.deepEqual(metadata.get('namespace'), ['https://github.com/atharvj/chatgpt-workflow-toolkit']);
  assert.deepEqual(metadata.get('license'), ['MIT']);
  assert.deepEqual(metadata.get('run-at'), ['document-idle']);
  assert.deepEqual(metadata.get('noframes'), ['']);
});

test('metadata targets both supported ChatGPT origins', () => {
  const metadata = parseMetadata(source);

  assert.deepEqual(metadata.get('match'), [
    'https://chatgpt.com/*',
    'https://chat.openai.com/*',
  ]);
});

test('metadata declares only the storage, style, and menu grants it uses', () => {
  const metadata = parseMetadata(source);

  assert.deepEqual(metadata.get('grant'), [
    'GM_getValue',
    'GM_setValue',
    'GM_deleteValue',
    'GM_addStyle',
    'GM_registerMenuCommand',
    'GM.getValue',
    'GM.setValue',
    'GM.deleteValue',
    'GM.addStyle',
    'GM.registerMenuCommand',
  ]);
  assert.equal(metadata.has('require'), false);
  assert.equal(metadata.has('connect'), false);
});

test('metadata advertises the canonical project and support URLs', () => {
  const metadata = parseMetadata(source);
  const rawUserscript = 'https://raw.githubusercontent.com/atharvj/chatgpt-workflow-toolkit/main/chatgpt-workflow-toolkit.user.js';
  assert.deepEqual(metadata.get('homepageURL'), ['https://github.com/atharvj/chatgpt-workflow-toolkit']);
  assert.deepEqual(metadata.get('supportURL'), ['https://github.com/atharvj/chatgpt-workflow-toolkit/issues']);
  assert.deepEqual(metadata.get('downloadURL'), [rawUserscript]);
  assert.deepEqual(metadata.get('updateURL'), [rawUserscript]);
});
