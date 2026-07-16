// ==UserScript==
// @name         ChatGPT Workflow Toolkit
// @namespace    https://github.com/atharvj/chatgpt-workflow-toolkit
// @version      1.4.0
// @description  Branch or hand off conversations, ask separately with context, hide Start writing, and adapt model effort per message.
// @author       Atharv Joshi
// @license      MIT
// @homepageURL  https://github.com/atharvj/chatgpt-workflow-toolkit
// @supportURL   https://github.com/atharvj/chatgpt-workflow-toolkit/issues
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.addStyle
// @grant        GM.registerMenuCommand
// ==/UserScript==

(function chatGPTWorkflowToolkitModule(global, factory) {
  'use strict';

  const api = factory(global);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (global && global.document) {
    Promise.resolve(api.install(global.document, global)).catch((error) => {
      if (global.console && typeof global.console.error === 'function') {
        global.console.error('[ChatGPT Workflow Toolkit] Failed to start:', error);
      }
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function chatGPTWorkflowToolkitFactory(global) {
  'use strict';

  const VERSION = '1.4.0';
  const LEGACY_INSTALL_VERSION = '1.1.0';
  // Preserve the original storage keys so upgrades retain settings and one-time handoffs.
  const SETTINGS_KEY = 'chatgptSidecar.settings.v1';
  const JOB_INDEX_KEY = 'chatgptSidecar.jobIndex.v1';
  const JOB_PREFIX = 'chatgptSidecar.job.v1.';
  const JOB_HASH_KEY = 'cwt-job';
  const FRESH_HASH_KEY = 'cwt-fresh';
  const FRESH_HANDOFF_PREFIX = 'chatgptWorkflowToolkit.freshHandoff.v1.';
  const FRESH_HANDOFF_INDEX_KEY = 'chatgptWorkflowToolkit.freshHandoffIndex.v1';
  const JOB_MAX_AGE_MS = 5 * 60 * 1000;
  const FRESH_HANDOFF_MAX_AGE_MS = 10 * 60 * 1000;
  const FRESH_HANDOFF_MAX_LENGTH = 28_000;
  const QUESTION_MAX_LENGTH = 30_000;
  const SELECTED_QUOTE_MAX_LENGTH = 2_000;
  const UI_ROOT_ID = 'cgs-root';
  const TURN_BUTTON_CLASS = 'cgs-turn-action';
  const HIDDEN_START_WRITING_CLASS = 'cgs-hidden-start-writing';
  const HANDOFF_PROMPT = `Create a compact, self-contained handoff for continuing this conversation in a brand-new chat. Do not continue the task yet.

Include only the context needed to resume:
- the goal and current task
- constraints and user preferences
- key facts, resources, and assumptions
- decisions made and work already completed
- unresolved issues, errors, or open questions
- the exact recommended next step

Preserve essential commands, code, formulas, or data exactly where needed. Clearly mark uncertainty. Keep the handoff under 1,000 words.

Also account for materials that will not automatically carry into a new chat:
- Identify any files, images, datasets, pasted documents, attachments, or other external artifacts this chat used. Use each exact filename or name when known; do not invent names.
- Include all important facts already learned from those materials in the handoff itself, so the handoff is still sufficient if the user cannot provide them again.
- Add an “Optional materials” section for the next assistant. If any such items exist, instruct the next assistant to ask for them once in its first reply, by name, and to request that the user provide or upload them in full if available. Make clear that it is okay if the user cannot provide them and the conversation can continue from the handoff. Say that providing them would give significantly more context.
- If no such materials exist, say that no additional materials are needed and do not ask the user for any.

The request should sound natural, for example: “Okay, let’s continue here. If you have them, could you provide [exact names] in full? If not, that’s okay—I can continue from this handoff. Providing them would give me significantly more context.”`;

  const TURN_SELECTOR = 'article[data-testid^="conversation-turn-"]';
  const ROLE_SELECTOR = '[data-message-author-role]';
  const COMPOSER_SELECTORS = [
    'textarea#prompt-textarea',
    '#prompt-textarea[contenteditable="true"]',
    'main form [contenteditable="true"][role="textbox"]',
    'main form textarea',
  ];
  const SEND_BUTTON_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send message"]',
    'button[aria-label^="Send"]',
  ];
  const MODEL_OPTION_CONTAINER_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="option"], [role="radio"], [data-radix-collection-item], [data-slot="dropdown-menu-item"], [data-slot="dropdown-menu-radio-item"]';
  const MODEL_OPTION_SELECTOR = `${MODEL_OPTION_CONTAINER_SELECTOR}, button`;
  const MODEL_MENU_ROOT_SELECTOR = '[role="menu"], [role="listbox"], [role="radiogroup"], [data-radix-menu-content], [data-radix-popper-content-wrapper], [data-headlessui-menu-items], [data-slot="dropdown-menu-content"], [data-slot="popover-content"], [data-state="open"][role="dialog"], [data-testid*="model-menu"], [data-testid*="model-picker-menu"], [data-testid*="intelligence-menu"]';
  const ROUTE_LEVEL_RANK = Object.freeze({
    instant: 0,
    auto: 0,
    medium: 1,
    high: 2,
    'extra-high': 3,
    ultra: 4,
    pro: 5,
    'pro-extended': 6,
    'pro-ultra': 7,
  });
  const ROUTE_LEVEL_LABEL = Object.freeze({
    instant: 'Instant',
    auto: 'Instant',
    medium: 'Medium',
    high: 'High',
    'extra-high': 'Extra High',
    ultra: 'Ultra',
    pro: 'Pro',
    'pro-extended': 'Pro Extended',
    'pro-ultra': 'Pro Ultra',
    max: 'highest available',
  });

  const DEFAULT_SETTINGS = Object.freeze({
    openMode: 'popup',
    autoSend: false,
    autoRouting: false,
    adaptiveRouting: true,
    autoMaxLevel: 'highest',
    hideStartWriting: true,
    showTurnButtons: true,
  });

  const STYLE_TEXT = `
    #${UI_ROOT_ID}, #${UI_ROOT_ID} * { box-sizing: border-box; }
    #${UI_ROOT_ID} {
      color-scheme: light dark;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.4;
    }
    #${UI_ROOT_ID} [hidden] { display: none !important; }
    .${HIDDEN_START_WRITING_CLASS} { display: none !important; }
    .${TURN_BUTTON_CLASS} {
      all: unset;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 28px;
      margin-inline-start: 2px;
      padding: 3px 7px;
      border-radius: 7px;
      color: var(--text-secondary, #6b7280);
      cursor: pointer;
      font: 500 12px/1.2 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      opacity: .78;
    }
    .${TURN_BUTTON_CLASS}:hover,
    .${TURN_BUTTON_CLASS}:focus-visible {
      color: var(--text-primary, #111827);
      background: var(--main-surface-secondary, rgba(127, 127, 127, .13));
      opacity: 1;
      outline: none;
    }
    .${TURN_BUTTON_CLASS}:focus-visible { box-shadow: 0 0 0 2px #10a37f; }
    .cgs-turn-fallback-row { display: flex; justify-content: flex-start; margin-top: 6px; }
    .cgs-branch-target { outline: 2px solid #10a37f !important; outline-offset: 5px; border-radius: 8px; }
    #cgs-dock {
      position: fixed;
      right: 18px;
      bottom: 78px;
      z-index: 2147483000;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px;
      border: 1px solid color-mix(in srgb, var(--text-primary, #111827) 13%, transparent);
      border-radius: 14px;
      color: var(--text-primary, #111827);
      background: color-mix(in srgb, var(--main-surface-primary, #fff) 94%, transparent);
      box-shadow: 0 8px 28px rgba(0, 0, 0, .14);
      backdrop-filter: blur(12px);
    }
    .cgs-button, .cgs-icon-button, .cgs-primary, .cgs-secondary, .cgs-link-button {
      appearance: none;
      border: 0;
      font: inherit;
      cursor: pointer;
    }
    .cgs-button {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-height: 34px;
      padding: 7px 10px;
      border-radius: 9px;
      color: var(--text-primary, #111827);
      background: transparent;
      font-weight: 650;
    }
    .cgs-button:hover, .cgs-icon-button:hover { background: var(--main-surface-secondary, rgba(127, 127, 127, .13)); }
    .cgs-icon-button {
      width: 34px;
      height: 34px;
      border-radius: 9px;
      color: var(--text-primary, #111827);
      background: transparent;
    }
    .cgs-auto-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 7px;
      border-radius: 999px;
      color: #087f5b;
      background: rgba(16, 163, 127, .12);
      font-size: 11px;
      font-weight: 700;
    }
    .cgs-auto-badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #10a37f; }
    .cgs-auto-badge[data-enabled="false"] { color: var(--text-secondary, #6b7280); background: rgba(127, 127, 127, .12); }
    .cgs-auto-badge[data-enabled="false"]::before { background: #9ca3af; }
    #cgs-settings-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483002;
      display: grid;
      place-items: center;
      padding: 18px;
      background: rgba(0, 0, 0, .42);
    }
    #cgs-settings {
      width: min(520px, 100%);
      max-height: min(720px, calc(100vh - 36px));
      overflow: auto;
      padding: 16px;
      border: 1px solid color-mix(in srgb, var(--text-primary, #111827) 14%, transparent);
      border-radius: 15px;
      color: var(--text-primary, #111827);
      background: var(--main-surface-primary, #fff);
      box-shadow: 0 18px 55px rgba(0, 0, 0, .2);
    }
    .cgs-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .cgs-panel-head h2 { margin: 0; font-size: 16px; line-height: 1.25; }
    .cgs-panel-head p { margin: 2px 0 0; color: var(--text-secondary, #6b7280); font-size: 11px; }
    .cgs-setting { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: start; padding: 11px 0; border-top: 1px solid color-mix(in srgb, var(--text-primary, #111827) 10%, transparent); }
    .cgs-setting:first-of-type { border-top: 0; }
    .cgs-setting strong { display: block; margin-bottom: 3px; font-size: 13px; }
    .cgs-setting small { display: block; max-width: 270px; color: var(--text-secondary, #6b7280); font-size: 11px; line-height: 1.45; }
    .cgs-setting input[type="checkbox"] { width: 18px; height: 18px; accent-color: #10a37f; }
    .cgs-setting select {
      min-width: 112px;
      padding: 6px 8px;
      border: 1px solid color-mix(in srgb, var(--text-primary, #111827) 20%, transparent);
      border-radius: 8px;
      color: var(--text-primary, #111827);
      background: var(--main-surface-primary, #fff);
      font: inherit;
    }
    .cgs-link-button { margin-top: 8px; padding: 6px 8px; border-radius: 7px; color: #087f5b; background: rgba(16, 163, 127, .12); font-size: 11px; font-weight: 700; }
    .cgs-help-link { color: #0f8f70; text-decoration: underline; text-underline-offset: 2px; }
    .cgs-version { margin-top: 10px; color: var(--text-secondary, #6b7280); font-size: 10px; text-align: right; }
    #cgs-dialog-backdrop, #cgs-handoff-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483002;
      display: grid;
      place-items: center;
      padding: 18px;
      background: rgba(0, 0, 0, .36);
    }
    .cgs-dialog {
      width: min(560px, 100%);
      padding: 18px;
      border: 1px solid color-mix(in srgb, var(--text-primary, #111827) 14%, transparent);
      border-radius: 16px;
      color: var(--text-primary, #111827);
      background: var(--main-surface-primary, #fff);
      box-shadow: 0 24px 75px rgba(0, 0, 0, .28);
    }
    .cgs-dialog h2 { margin: 0 0 5px; font-size: 18px; }
    .cgs-dialog p { margin: 0 0 12px; color: var(--text-secondary, #6b7280); font-size: 12px; }
    .cgs-dialog textarea {
      display: block;
      width: 100%;
      min-height: 145px;
      resize: vertical;
      padding: 11px 12px;
      border: 1px solid color-mix(in srgb, var(--text-primary, #111827) 22%, transparent);
      border-radius: 10px;
      color: var(--text-primary, #111827);
      background: var(--main-surface-secondary, rgba(127, 127, 127, .08));
      font: 14px/1.45 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      outline: none;
    }
    .cgs-dialog textarea:focus { border-color: #10a37f; box-shadow: 0 0 0 2px rgba(16, 163, 127, .18); }
    .cgs-dialog-options { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 10px; }
    .cgs-dialog-options label { display: inline-flex; align-items: center; gap: 7px; color: var(--text-secondary, #6b7280); font-size: 12px; }
    .cgs-dialog-options input { accent-color: #10a37f; }
    .cgs-dialog-options select {
      padding: 5px 7px;
      border: 1px solid color-mix(in srgb, var(--text-primary, #111827) 18%, transparent);
      border-radius: 7px;
      color: var(--text-primary, #111827);
      background: var(--main-surface-primary, #fff);
      font: inherit;
    }
    .cgs-dialog-help { margin-top: 8px !important; line-height: 1.45; }
    .cgs-dialog-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 15px; }
    .cgs-primary, .cgs-secondary { min-height: 36px; padding: 8px 12px; border-radius: 9px; font-weight: 700; }
    .cgs-primary { color: #fff; background: #10a37f; }
    .cgs-primary:hover { background: #0d8c6d; }
    .cgs-secondary { color: var(--text-primary, #111827); background: var(--main-surface-secondary, rgba(127, 127, 127, .13)); }
    #cgs-selection-pill {
      position: fixed;
      z-index: 2147483001;
      transform: translate(-50%, -100%);
      padding: 7px 10px;
      border: 0;
      border-radius: 9px;
      color: #fff;
      background: #111827;
      box-shadow: 0 8px 24px rgba(0, 0, 0, .22);
      font: 700 12px/1 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
    }
    #cgs-selection-pill:hover { background: #10a37f; }
    #cgs-toast {
      position: fixed;
      left: 50%;
      bottom: 28px;
      z-index: 2147483004;
      width: max-content;
      max-width: min(520px, calc(100vw - 30px));
      transform: translateX(-50%);
      padding: 10px 13px;
      border-radius: 10px;
      color: #fff;
      background: #111827;
      box-shadow: 0 10px 32px rgba(0, 0, 0, .22);
      font-size: 12px;
      text-align: center;
    }
    #cgs-recovery-backdrop {
      position: fixed;
      right: 18px;
      top: 70px;
      z-index: 2147483003;
      width: min(430px, calc(100vw - 24px));
      max-height: calc(100vh - 90px);
      overflow: auto;
    }
    #cgs-recovery-backdrop .cgs-dialog { width: 100%; padding: 15px; }
    .cgs-recovery-note { padding: 9px 10px; border-radius: 9px; color: #7c4a03; background: #fff4d6; font-size: 12px; }
    @media (max-width: 720px) {
      #cgs-dock { right: 10px; bottom: 68px; }
      .cgs-dock-label, .cgs-auto-badge { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      #${UI_ROOT_ID} *, .${TURN_BUTTON_CLASS} { scroll-behavior: auto !important; transition: none !important; }
    }
  `;

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/\s+/gu, ' ').trim();
  }

  function lowerText(value) {
    return normalizeText(value).toLocaleLowerCase('en-US');
  }

  function clampInteger(value, fallback, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.trunc(number)));
  }

  function sanitizeSettings(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      openMode: source.openMode === 'tab' ? 'tab' : 'popup',
      autoSend: source.autoSend === true,
      autoRouting: source.autoRouting === true,
      adaptiveRouting: source.adaptiveRouting !== false,
      autoMaxLevel: ['high', 'extra-high', 'highest'].includes(source.autoMaxLevel)
        ? source.autoMaxLevel
        : 'highest',
      hideStartWriting: source.hideStartWriting !== false,
      showTurnButtons: source.showTurnButtons !== false,
    };
  }

  function collectMatches(root, selector) {
    const matches = [];
    if (!root) return matches;
    if (root.nodeType === 1 && typeof root.matches === 'function' && root.matches(selector)) {
      matches.push(root);
    }
    if (typeof root.querySelectorAll === 'function') {
      matches.push(...root.querySelectorAll(selector));
    }
    return matches;
  }

  function uniqueElements(elements) {
    return [...new Set(elements.filter(Boolean))];
  }

  function getTurns(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    const primary = [...root.querySelectorAll(TURN_SELECTOR)];
    if (root.nodeType === 1 && root.matches && root.matches(TURN_SELECTOR)) primary.unshift(root);
    if (primary.length) return uniqueElements(primary);

    const roleNodes = collectMatches(root, ROLE_SELECTOR);
    return uniqueElements(roleNodes.map((node) => node.closest('article') || node));
  }

  function roleOfTurn(turn) {
    if (!turn || turn.nodeType !== 1) return '';
    const direct = lowerText(turn.getAttribute('data-message-author-role') || turn.getAttribute('data-turn'));
    if (direct === 'assistant' || direct === 'user') return direct;
    const roleNode = turn.querySelector(ROLE_SELECTOR);
    const nested = lowerText(roleNode && roleNode.getAttribute('data-message-author-role'));
    if (nested === 'assistant' || nested === 'user') return nested;
    if (turn.querySelector('[data-testid*="good-response"], [data-testid*="bad-response"], [data-testid*="regenerate-response"]')) {
      return 'assistant';
    }
    if (turn.querySelector('.markdown, [class~="prose"]') && !turn.querySelector('[data-message-author-role="user"]')) {
      return 'assistant';
    }
    return '';
  }

  function isAssistantTurn(turn) {
    return roleOfTurn(turn) === 'assistant';
  }

  function getAssistantTurns(root) {
    return getTurns(root).filter(isAssistantTurn);
  }

  function isTurnStreaming(turn, doc = turn && turn.ownerDocument) {
    if (!turn || !doc) return false;
    if (turn.matches('[data-is-streaming="true"], [data-streaming="true"], .result-streaming') ||
        turn.querySelector('[data-is-streaming="true"], [data-streaming="true"], .result-streaming')) {
      return true;
    }
    const stopButton = [...doc.querySelectorAll(
      'button[data-testid="stop-button"], button[data-testid*="stop-generating"], button[aria-label^="Stop generating" i], button[aria-label^="Stop streaming" i]',
    )].find(isProbablyVisible);
    if (!stopButton) return false;
    const assistants = getAssistantTurns(doc);
    return assistants[assistants.length - 1] === turn;
  }

  function getCompletedAssistantTurns(root) {
    if (!root) return [];
    const doc = root.nodeType === 9 ? root : root.ownerDocument;
    const assistants = getAssistantTurns(root);
    const stopButton = doc && [...doc.querySelectorAll(
      'button[data-testid="stop-button"], button[data-testid*="stop-generating"], button[aria-label^="Stop generating" i], button[aria-label^="Stop streaming" i]',
    )].find(isProbablyVisible);
    return assistants.filter((turn, index) => {
      const explicitlyStreaming = turn.matches('[data-is-streaming="true"], [data-streaming="true"], .result-streaming') ||
        turn.querySelector('[data-is-streaming="true"], [data-streaming="true"], .result-streaming');
      return !explicitlyStreaming && !(stopButton && index === assistants.length - 1);
    });
  }

  function hasActiveGeneration(doc) {
    if (!doc) return false;
    const stopButton = [...doc.querySelectorAll(
      'button[data-testid="stop-button"], button[data-testid*="stop-generating"], button[aria-label^="Stop generating" i], button[aria-label^="Stop streaming" i]',
    )].find(isProbablyVisible);
    if (stopButton) return true;
    const assistants = getAssistantTurns(doc);
    const latest = assistants[assistants.length - 1];
    return Boolean(latest && (
      latest.matches('[data-is-streaming="true"], [data-streaming="true"], .result-streaming') ||
      latest.querySelector('[data-is-streaming="true"], [data-streaming="true"], .result-streaming')
    ));
  }

  function potentialTurnsFromRoot(root) {
    if (!root) return [];
    const turns = getTurns(root);
    if (root.nodeType === 1 && typeof root.closest === 'function') {
      const closest = root.closest(TURN_SELECTOR) || root.closest(ROLE_SELECTOR);
      if (closest) turns.unshift(closest.closest('article') || closest);
    }
    return uniqueElements(turns);
  }

  function getTurnLocator(turn, doc) {
    if (!turn || !doc) return null;
    const turns = getTurns(doc);
    const assistants = turns.filter(isAssistantTurn);
    const testId = normalizeText(turn.getAttribute && turn.getAttribute('data-testid'));
    return {
      testId: testId.startsWith('conversation-turn-') ? testId : '',
      turnIndex: turns.indexOf(turn),
      assistantIndex: assistants.indexOf(turn),
    };
  }

  function sanitizeLocator(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const testId = normalizeText(source.testId);
    return {
      testId: /^conversation-turn-[\w-]+$/u.test(testId) ? testId : '',
      turnIndex: clampInteger(source.turnIndex, -1, -1, 100_000),
      assistantIndex: clampInteger(source.assistantIndex, -1, -1, 100_000),
    };
  }

  function locateTurn(doc, rawLocator) {
    if (!doc) return null;
    const locator = sanitizeLocator(rawLocator);
    const turns = getTurns(doc);
    if (locator.testId) {
      const exact = turns.find((turn) => turn.getAttribute('data-testid') === locator.testId);
      if (exact && isAssistantTurn(exact)) return exact;
    }
    if (locator.turnIndex >= 0 && isAssistantTurn(turns[locator.turnIndex])) return turns[locator.turnIndex];
    const assistants = turns.filter(isAssistantTurn);
    if (locator.assistantIndex >= 0) return assistants[locator.assistantIndex] || null;
    return null;
  }

  function closestAssistantTurn(node) {
    const element = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!element || typeof element.closest !== 'function') return null;
    const primary = element.closest(TURN_SELECTOR);
    if (primary) return isAssistantTurn(primary) ? primary : null;
    const roleNode = element.closest('[data-message-author-role="assistant"]');
    return roleNode ? roleNode.closest('article') || roleNode : null;
  }

  function quoteForPrompt(value, maximumLength = SELECTED_QUOTE_MAX_LENGTH) {
    const raw = String(value == null ? '' : value).replace(/\r\n?/gu, '\n').trim();
    const limit = clampInteger(maximumLength, SELECTED_QUOTE_MAX_LENGTH, 1, SELECTED_QUOTE_MAX_LENGTH);
    if (!raw) return '';
    const clipped = raw.length > limit ? `${raw.slice(0, Math.max(1, limit - 1)).trimEnd()}…` : raw;
    return clipped
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
  }

  function buildSelectedQuestion(value) {
    const quote = quoteForPrompt(value);
    if (!quote) return '';
    return `I have a question about this specific part of the response:\n\n${quote}\n\nMy question:\n`;
  }

  function readableNodeText(root) {
    if (!root) return '';
    const blockTags = new Set([
      'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'DT', 'DD', 'FIGCAPTION', 'FIGURE',
      'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'MAIN', 'NAV', 'OL', 'P',
      'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
    ]);
    const ignoredSelector = [
      `#${UI_ROOT_ID}`, `.${TURN_BUTTON_CLASS}`, '.cgs-turn-fallback-row',
      'button', 'input', 'textarea', 'select', 'option', 'script', 'style', 'svg', 'canvas', 'noscript',
      '[aria-hidden="true"]', '[data-testid*="turn-action"]', '[data-testid*="message-actions"]',
      '[data-testid*="feedback"]', '[data-cgs-injected]',
    ].join(', ');

    const codeBlocks = [];
    const visit = (node) => {
      if (!node) return '';
      if (node.nodeType === 3) return String(node.nodeValue || '');
      if (node.nodeType !== 1 || node.matches(ignoredSelector)) return '';
      const tag = node.tagName;
      if (tag === 'BR') return '\n';
      if (tag === 'PRE') {
        const index = codeBlocks.push(String(node.textContent || '').replace(/\r\n?/gu, '\n')) - 1;
        return `\n\uE000${index}\uE001\n`;
      }
      let content = [...node.childNodes].map(visit).join('');
      if (tag === 'A') {
        const href = String(node.getAttribute('href') || '').trim();
        if (/^https?:\/\//iu.test(href) && !content.includes(href)) content = `${content} (${href})`;
      }
      if (tag === 'LI') return `\n- ${content.trim()}\n`;
      return blockTags.has(tag) ? `\n${content}\n` : content;
    };

    let text = visit(root)
      .replace(/[ \t]+\n/gu, '\n')
      .replace(/\n[ \t]+/gu, '\n')
      .replace(/[ \t]{2,}/gu, ' ')
      .replace(/\n{3,}/gu, '\n\n')
      .trim();
    codeBlocks.forEach((code, index) => {
      text = text.replace(`\uE000${index}\uE001`, `\`\`\`\n${code}\n\`\`\``);
    });
    return text;
  }

  function extractAssistantHandoff(turn) {
    if (!turn) return '';
    const roleNode = turn.matches && turn.matches('[data-message-author-role="assistant"]')
      ? turn
      : turn.querySelector && turn.querySelector('[data-message-author-role="assistant"]');
    if (!roleNode) return '';
    const preferred = [...roleNode.querySelectorAll('[data-message-content], .markdown, [class~="prose"]')]
      .filter((node) => !node.parentElement || !node.parentElement.closest('[data-message-content], .markdown, [class~="prose"]'));
    const candidates = preferred.length ? preferred : [roleNode];
    const text = candidates.map(readableNodeText).sort((a, b) => b.length - a.length)[0] || '';
    return text.slice(0, FRESH_HANDOFF_MAX_LENGTH).trim();
  }

  function isEditableElement(element) {
    if (!element || element.nodeType !== 1) return false;
    const tag = element.tagName.toLowerCase();
    return tag === 'textarea' || tag === 'input' || element.isContentEditable || element.getAttribute('contenteditable') === 'true';
  }

  function markerForAttribute(attribute) {
    return `data-cgs-original-${attribute.replace(/[^a-z0-9]+/giu, '-').toLowerCase()}`;
  }

  function cleanStartWriting(root) {
    if (!root) return 0;
    let changes = 0;
    const attributeSelector = '[placeholder], [aria-placeholder], [data-placeholder], [aria-label]';
    for (const element of collectMatches(root, attributeSelector)) {
      if (element.closest && element.closest(`#${UI_ROOT_ID}`)) continue;
      for (const attribute of ['placeholder', 'aria-placeholder', 'data-placeholder', 'aria-label']) {
        if (lowerText(element.getAttribute(attribute)) !== 'start writing') continue;
        if (isEditableElement(element)) {
          const marker = markerForAttribute(attribute);
          if (!element.hasAttribute(marker)) element.setAttribute(marker, element.getAttribute(attribute));
          element.setAttribute(attribute, attribute === 'aria-label' ? 'Message ChatGPT' : '');
        } else if (element.matches('button, [role="button"]')) {
          element.classList.add(HIDDEN_START_WRITING_CLASS);
        }
        changes += 1;
      }
    }

    for (const control of collectMatches(root, 'button, [role="button"]')) {
      if (control.closest && (control.closest(`#${UI_ROOT_ID}`) || control.closest(TURN_SELECTOR))) continue;
      if (lowerText(control.textContent) === 'start writing') {
        control.classList.add(HIDDEN_START_WRITING_CLASS);
        changes += 1;
      }
    }
    return changes;
  }

  function restoreStartWriting(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return 0;
    let changes = 0;
    for (const attribute of ['placeholder', 'aria-placeholder', 'data-placeholder', 'aria-label']) {
      const marker = markerForAttribute(attribute);
      for (const element of collectMatches(root, `[${marker}]`)) {
        element.setAttribute(attribute, element.getAttribute(marker) || 'Start writing');
        element.removeAttribute(marker);
        changes += 1;
      }
    }
    for (const element of collectMatches(root, `.${HIDDEN_START_WRITING_CLASS}`)) {
      element.classList.remove(HIDDEN_START_WRITING_CLASS);
      changes += 1;
    }
    return changes;
  }

  function canonicalPageUrl(value) {
    try {
      const url = new URL(String(value));
      url.hash = '';
      return url.toString();
    } catch (_error) {
      return '';
    }
  }

  function routeKey(value) {
    try {
      const url = new URL(String(value));
      return `${url.pathname}${url.search}`;
    } catch (_error) {
      return '';
    }
  }

  function isReadOnlyChatPage(value) {
    try {
      const url = new URL(String(value));
      return /^\/share(?:\/|$)/u.test(url.pathname);
    } catch (_error) {
      return false;
    }
  }

  function isAllowedChatGPTUrl(value) {
    try {
      const url = new URL(String(value));
      return url.protocol === 'https:' && (url.hostname === 'chatgpt.com' || url.hostname === 'chat.openai.com');
    } catch (_error) {
      return false;
    }
  }

  function isValidJobId(value) {
    return /^[a-z0-9_-]{8,80}$/iu.test(String(value || ''));
  }

  function freshHandoffStorageKey(jobId) {
    return isValidJobId(jobId) ? `${FRESH_HANDOFF_PREFIX}${jobId}` : '';
  }

  function urlWithJob(value, jobId) {
    if (!isValidJobId(jobId)) return '';
    try {
      const url = new URL(String(value));
      url.hash = `${JOB_HASH_KEY}=${encodeURIComponent(jobId)}`;
      return url.toString();
    } catch (_error) {
      return '';
    }
  }

  function parseJobId(value) {
    try {
      const url = new URL(String(value));
      const params = new URLSearchParams(url.hash.replace(/^#/u, ''));
      const id = params.get(JOB_HASH_KEY) || '';
      return isValidJobId(id) ? id : '';
    } catch (_error) {
      return '';
    }
  }

  function urlWithFreshLaunch(value, jobId) {
    if (!isValidJobId(jobId)) return '';
    try {
      const source = new URL(String(value));
      const url = new URL('/', source.origin);
      url.hash = `${FRESH_HASH_KEY}=${encodeURIComponent(jobId)}`;
      return url.toString();
    } catch (_error) {
      return '';
    }
  }

  function parseFreshJobId(value) {
    try {
      const url = new URL(String(value));
      const params = new URLSearchParams(url.hash.replace(/^#/u, ''));
      const id = params.get(FRESH_HASH_KEY) || '';
      return isValidJobId(id) ? id : '';
    } catch (_error) {
      return '';
    }
  }

  function isFreshLaunch(value) {
    return Boolean(parseFreshJobId(value));
  }

  function sanitizeFreshHandoff(raw, now = Date.now(), expectedId = '') {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || '');
    const createdAt = Number(raw.createdAt);
    const handoff = String(raw.handoff == null ? '' : raw.handoff)
      .replace(/\r\n?/gu, '\n')
      .slice(0, FRESH_HANDOFF_MAX_LENGTH)
      .trim();
    if (!isValidJobId(id) || expectedId && id !== expectedId || !handoff) return null;
    if (!Number.isFinite(createdAt) || createdAt > now + 60_000 || now - createdAt > FRESH_HANDOFF_MAX_AGE_MS) return null;
    return { version: 1, id, createdAt, handoff };
  }

  function buildFreshContinuationPrompt(value) {
    const handoff = String(value == null ? '' : value).replace(/\r\n?/gu, '\n').trim();
    if (!handoff) return '';
    return `Continue the previous conversation from the handoff below. Treat it as context, follow its recommended next step, and follow any “Optional materials” instruction in your first response. Do not require materials that the handoff says are optional.\n\n--- HANDOFF ---\n${handoff}`;
  }

  function sanitizeJob(raw, now = Date.now()) {
    if (!raw || typeof raw !== 'object') return null;
    const createdAt = Number(raw.createdAt);
    const sourceUrl = canonicalPageUrl(raw.sourceUrl);
    const kind = raw.kind === 'continue' ? 'continue' : raw.kind === 'ask' ? 'ask' : '';
    if (!kind || !Number.isFinite(createdAt) || createdAt > now + 60_000 || now - createdAt > JOB_MAX_AGE_MS) return null;
    if (!isAllowedChatGPTUrl(sourceUrl)) return null;
    const question = String(raw.question == null ? '' : raw.question).slice(0, QUESTION_MAX_LENGTH);
    return {
      version: 1,
      createdAt,
      sourceUrl,
      sourceRoute: routeKey(sourceUrl),
      kind,
      locator: sanitizeLocator(raw.locator),
      question,
      autoSend: raw.autoSend === true,
    };
  }

  function createJobId() {
    const cryptoObject = global && global.crypto;
    if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
      return cryptoObject.randomUUID();
    }
    if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
      const values = new Uint32Array(4);
      cryptoObject.getRandomValues(values);
      return [...values].map((value) => value.toString(16).padStart(8, '0')).join('');
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function accessibleText(element) {
    if (!element) return '';
    return normalizeText([
      element.getAttribute && element.getAttribute('aria-label'),
      element.getAttribute && element.getAttribute('title'),
      element.innerText,
      element.textContent,
    ].filter(Boolean).join(' '));
  }

  function isProbablyVisible(element) {
    if (!element || !element.isConnected || element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    const hiddenParent = element.closest && element.closest('[hidden], [aria-hidden="true"]');
    if (hiddenParent) return false;
    const inlineStyle = element.style;
    if (inlineStyle && (inlineStyle.display === 'none' || inlineStyle.visibility === 'hidden')) return false;
    try {
      const view = element.ownerDocument && element.ownerDocument.defaultView;
      const style = view && view.getComputedStyle(element);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      const userAgent = view && view.navigator && view.navigator.userAgent || '';
      if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0 && !/jsdom/iu.test(userAgent)) {
        return false;
      }
    } catch (_error) {
      // A detached cross-realm node is not a usable target anyway; isConnected was checked above.
    }
    return true;
  }

  function findComposer(doc) {
    if (!doc) return null;
    for (const selector of COMPOSER_SELECTORS) {
      const elements = [...doc.querySelectorAll(selector)];
      const visible = elements.find(isProbablyVisible);
      if (visible) return visible;
    }
    return null;
  }

  function getComposerText(composer) {
    if (!composer) return '';
    const tag = composer.tagName && composer.tagName.toLowerCase();
    if (tag === 'textarea' || tag === 'input') return String(composer.value || '');
    return String(composer.innerText || composer.textContent || '').replace(/\u00a0/gu, ' ');
  }

  function composerTextEquals(composer, value) {
    if (!composer) return false;
    const actual = getComposerText(composer).replace(/\r\n?/gu, '\n').replace(/\u00a0/gu, ' ');
    const expected = String(value == null ? '' : value).replace(/\r\n?/gu, '\n').replace(/\u00a0/gu, ' ');
    return actual === expected;
  }

  function setNativeValue(element, value) {
    let prototype = element;
    while (prototype) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (descriptor && typeof descriptor.set === 'function') {
        descriptor.set.call(element, value);
        return true;
      }
      prototype = Object.getPrototypeOf(prototype);
    }
    element.value = value;
    return true;
  }

  function dispatchInput(element, win, value) {
    let event;
    try {
      event = new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: value });
    } catch (_error) {
      event = new win.Event('input', { bubbles: true });
    }
    element.dispatchEvent(event);
  }

  function setComposerText(composer, value, win) {
    if (!composer || !win) return false;
    const text = String(value == null ? '' : value).slice(0, QUESTION_MAX_LENGTH);
    const tag = composer.tagName.toLowerCase();
    composer.focus();
    if (tag === 'textarea' || tag === 'input') {
      setNativeValue(composer, text);
      dispatchInput(composer, win, text);
      composer.dispatchEvent(new win.Event('change', { bubbles: true }));
      return getComposerText(composer) === text;
    }

    let inserted = false;
    const selection = win.getSelection && win.getSelection();
    if (selection && composer.ownerDocument.createRange) {
      const range = composer.ownerDocument.createRange();
      range.selectNodeContents(composer);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    try {
      if (typeof composer.ownerDocument.execCommand === 'function') {
        inserted = composer.ownerDocument.execCommand('insertText', false, text) === true;
      }
    } catch (_error) {
      inserted = false;
    }
    if (!inserted || getComposerText(composer) !== text) {
      composer.textContent = text;
    }
    dispatchInput(composer, win, text);
    return composerTextEquals(composer, text);
  }

  function composerScope(composer) {
    if (!composer) return null;
    const form = composer.closest('form');
    if (form) return form;
    let ancestor = composer.parentElement;
    for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
      if (SEND_BUTTON_SELECTORS.some((selector) => ancestor.querySelector(selector))) return ancestor;
    }
    return composer.closest('main') || composer.ownerDocument;
  }

  function findSendButton(doc, composer = findComposer(doc)) {
    if (!doc) return null;
    const scope = composerScope(composer) || doc;
    for (const selector of SEND_BUTTON_SELECTORS) {
      const button = [...scope.querySelectorAll(selector)].find(isProbablyVisible);
      if (button) return button;
    }
    return null;
  }

  function extractModelLevel(value) {
    const text = lowerText(value)
      .replace(/[–—·|/()]+/gu, ' ')
      .replace(/[_]+/gu, '-')
      .replace(/\s+/gu, ' ');
    if (!text) return '';
    if (/\bautomatic(?:ally)?\s+switch/iu.test(text)) {
      return /^(?:gpt[-\s\d.]+\s+)?instant\b/iu.test(text) ? 'instant' : '';
    }

    const patterns = [
      ['pro-ultra', /\bpro\s*(?:-|\s)\s*(?:ultra|maximum|max)\b/iu],
      ['pro-extended', /\bpro\s*(?:-|\s)\s*extended\b/iu],
      ['pro', /\bpro\s*(?:-|\s)\s*standard\b/iu],
      ['extra-high', /\b(?:extra\s*-?\s*high|x\s*-?\s*high|xhigh|thinking\s+heavy)\b|\b(?:reasoning effort|thinking time|intelligence level)\s*:?\s*heavy\b/iu],
      ['ultra', /\bultra\b|\bmaximum reasoning\b/iu],
      ['instant', /\binstant\b|^fast(?:\s|$)/iu],
      ['high', /\bhigh\b|\bextended reasoning\b|\bthinking\s+extended\b|\b(?:reasoning effort|thinking time|intelligence level)\s*:?\s*extended\b/iu],
      ['medium', /\bmedium\b|\bstandard reasoning\b|\bthinking(?:\s+(?:standard|medium|light))?\b|\b(?:reasoning effort|thinking time|intelligence level)\s*:?\s*standard\b/iu],
      ['pro', /\bpro\b/iu],
      ['auto', /^(?:gpt[-\s\d.]+\s+)?auto(?:\s|$)/iu],
    ];
    const match = patterns.find(([, pattern]) => pattern.test(text));
    return match ? match[0] : '';
  }

  function isModelUpsellLabel(value) {
    const text = lowerText(value).replace(/[–—·|/()]+/gu, ' ').replace(/\s+/gu, ' ');
    return Boolean(text && (
      /^(?:upgrade|unlock|subscribe|try|get|view plans?|change plans?|switch plans?)\b/iu.test(text) ||
      /\b(?:upgrade|unlock|subscribe|subscription|purchase|paywall|requires? (?:a )?(?:paid |different )?plan|plan required|not available|locked|available only (?:on|with|for))\b/iu.test(text) ||
      /\bavailable (?:only )?(?:on|with|for) (?:plus|pro|team|business|enterprise)\b/iu.test(text)
      || /\b(?:included with|requires?) (?:plus|pro|team|business|enterprise)\b/iu.test(text)
      || /\b(?:plus|pro|team|business|enterprise)(?: plan)? only\b/iu.test(text)
      || /\b(?:plus|pro|team|business|enterprise) required\b/iu.test(text)
    ));
  }

  function extractPickerLevel(value, options = {}) {
    const text = lowerText(value).replace(/[–—·|/()]+/gu, ' ').replace(/\s+/gu, ' ');
    if (!text || /^(?:configure|settings?|automatic switching)\b/iu.test(text) || isModelUpsellLabel(text) || /\bhigh school\b/iu.test(text)) return '';
    if (options.allowBareEffort === true) {
      if (/^standard(?:\s+standard)?(?:\s+reasoning)?$/iu.test(text)) return 'medium';
      if (/^extended(?:\s+extended)?(?:\s+reasoning)?$/iu.test(text)) return 'high';
      if (/^heavy(?:\s+heavy)?(?:\s+reasoning)?$/iu.test(text)) return 'extra-high';
    }
    const prefixedEffort = text.match(/^(?:model|reasoning effort|thinking time|intelligence level)\s*:?\s*(instant|fast|auto|standard|medium|extended|high|heavy|extra\s*-?\s*high|ultra)\b/iu);
    if (prefixedEffort) {
      const effort = lowerText(prefixedEffort[1]).replace(/\s*-?\s+/gu, '-');
      if (effort === 'instant' || effort === 'fast') return 'instant';
      if (effort === 'auto') return 'auto';
      if (effort === 'standard' || effort === 'medium') return 'medium';
      if (effort === 'extended' || effort === 'high') return 'high';
      if (effort === 'heavy' || effort === 'extra-high') return 'extra-high';
      if (effort === 'ultra') return 'ultra';
    }
    const level = extractModelLevel(text);
    if (!level) return '';
    if (['pro', 'pro-extended', 'pro-ultra', 'extra-high', 'ultra'].includes(level)) return level;
    if (level === 'instant') {
      return /^(?:gpt[-\s\d.]+\s+)?(?:instant|fast)\b|\binstant\s+(?:mode|model|answers?|reasoning)\b/iu.test(text) ? level : '';
    }
    if (level === 'medium') {
      return /^(?:(?:gpt[-\s\d.]+\s+)(?:[a-z][\w-]*\s+){0,2}|(?:reasoning effort|thinking time|intelligence level)\s*:?\s*)?(?:thinking\s+)?(?:medium|standard|thinking)\b|\b(?:medium|standard)\s+reasoning\b/iu.test(text) ? level : '';
    }
    if (level === 'high') {
      return /^(?:(?:gpt[-\s\d.]+\s+)(?:[a-z][\w-]*\s+){0,2}|(?:reasoning effort|thinking time|intelligence level)\s*:?\s*)?(?:thinking\s+)?high\b|\bthinking\s+(?:high|extended)\b|\b(?:high|extended)\s+reasoning\b/iu.test(text) ? level : '';
    }
    if (level === 'auto') return /^(?:gpt[-\s\d.]+\s+)?auto\b/iu.test(text) ? level : '';
    return '';
  }

  function modelLevelRank(value) {
    const level = ROUTE_LEVEL_RANK[value] == null ? extractModelLevel(value) : value;
    return ROUTE_LEVEL_RANK[level] == null ? -1 : ROUTE_LEVEL_RANK[level];
  }

  function modelLevelLabel(value) {
    return ROUTE_LEVEL_LABEL[value] || ROUTE_LEVEL_LABEL[extractModelLevel(value)] || 'current model';
  }

  function parseRouteOverride(value) {
    const firstLine = String(value == null ? '' : value).replace(/^\uFEFF/u, '').split(/\r?\n/u, 1)[0];
    const match = firstLine.match(/^\s*!route\s*:\s*(extra\s*-?\s*high|x\s*-?\s*high|xhigh|pro\s*-?\s*extended|pro\s*-?\s*ultra|pro\s*-?\s*standard|instant|medium|high|ultra|pro|max|highest|auto)(?=\s|:|;|$)/iu);
    if (!match) return null;
    const token = lowerText(match[1]).replace(/\s*-\s*|\s+/gu, '-');
    if (token === 'extra-high' || token === 'x-high' || token === 'xhigh') return 'extra-high';
    if (token === 'pro-standard') return 'pro';
    if (token === 'highest') return 'max';
    return token;
  }

  function classifyPrompt(value, context = {}) {
    const raw = String(value == null ? '' : value);
    const override = parseRouteOverride(raw);
    if (override && override !== 'auto') {
      return {
        target: override === 'max' ? 'max' : override,
        score: override === 'max' ? 100 : Math.max(0, modelLevelRank(override) * 16),
        confidence: 1,
        explicit: true,
        reasons: ['explicit route override'],
      };
    }

    const normalized = normalizeText(raw);
    if (!normalized) {
      return { target: 'instant', score: 0, confidence: 0.94, explicit: false, reasons: ['empty prompt'] };
    }

    const lower = normalized.toLocaleLowerCase('en-US');
    const sample = raw.length <= 24_000 ? raw : `${raw.slice(0, 12_000)}\n${raw.slice(-12_000)}`;
    const sampleLower = sample.toLocaleLowerCase('en-US');
    const wordCount = (sample.match(/[\p{L}\p{N}_]+/gu) || []).length;
    const codeLineCount = sample.split(/\r?\n/u).filter((line) => /^\s{4,}|[{}();]|=>|\b(?:const|let|var|def|class|function|import|SELECT)\b/u.test(line)).length;
    const reasons = [];
    const strongGroups = new Set();
    let score = 12;
    let highStakes = false;
    let debuggingWork = false;
    let longHorizon = false;
    let expertWork = false;

    const acknowledgment = /^(?:thanks?(?: you)?|thank you|ok(?:ay)?|got it|cool|great|yes|no|hello|hi|hey|bye)[.!\s]*$/iu;
    const simpleTransform = /^(?:please\s+)?(?:make|rewrite|shorten|translate|format|spell|capitalize|lowercase)\b.{0,160}$/iu;
    const continuation = /^(?:why\??|how so\??|continue(?: and (?:finish|complete) it)?[.!]?|go on[.!]?|fix (?:that|it)[.!]?|try again[.!]?|prove it[.!]?|finish (?:that|it)[.!]?)$/iu;
    const simpleFact = /^(?:what|who|when|where|which|define|explain)\b.{0,180}$/iu;
    const simpleMath = /^(?:what is|calculate|compute)?\s*[\d\s()+\-*/^%.=]+\??$/iu;
    const shortWriting = /\b(?:one|two|three|\d+)\s+(?:sentence|line|word)s?\b|\bshort\s+(?:email|reply|message|paragraph)\b/iu;
    const technical = /\b(?:code|program|function|algorithm|python|javascript|typescript|rust|java|sql|regex|api|database|equation|theorem|prove|proof|derive|rigorous(?:ly)?|square root|math|physics|chemistry|research|study|analyze|analysis)\b/iu;
    const normalAnalysis = /\b(?:compare|contrast|plan|recommend|trade-?offs?|pros and cons|evaluate|analy[sz]e|strategy|outline)\b/iu;

    if (acknowledgment.test(lower)) score = 4;
    else if (simpleMath.test(lower)) score = 6;
    else if (simpleTransform.test(lower) || (simpleFact.test(lower) && wordCount <= 24) || (shortWriting.test(lower) && wordCount <= 35)) score = 12;
    else if (/\b(?:write|rewrite|summari[sz]e|translate|draft|edit)\b/iu.test(lower)) score = 18;
    else if (technical.test(lower) || /\b(?:architecture|concurrency|distributed system|security review|threat model)\b/iu.test(lower)) score = 28;
    else if (normalAnalysis.test(lower)) score = 24;
    else score = wordCount > 45 ? 20 : 12;

    const attachmentCount = clampInteger(context.attachmentCount, 0, 0, 100);
    if (attachmentCount > 0) {
      score = Math.max(score, 24);
      reasons.push('attached material');
      if (attachmentCount > 1) {
        score += 8;
        strongGroups.add('multiple attachments');
      }
    }

    const previousLevel = extractModelLevel(context.previousLevel || '');
    if (continuation.test(lower)) {
      if (previousLevel) {
        return {
          target: previousLevel === 'auto' ? 'instant' : previousLevel,
          score: Math.max(20, modelLevelRank(previousLevel) * 18),
          confidence: 0.82,
          explicit: false,
          inherited: true,
          reasons: ['continuation of the previous task'],
        };
      }
      return { target: 'medium', score: 24, confidence: 0.5, explicit: false, reasons: ['short follow-up without routing history'] };
    }

    const addSignal = (pattern, points, code, strong = true) => {
      if (!pattern.test(sampleLower)) return false;
      score += points;
      reasons.push(code);
      if (strong) strongGroups.add(code);
      return true;
    };

    debuggingWork = addSignal(/\b(?:debug|bug|failing test|failure|exception|stack trace|traceback|segmentation fault|root cause)\b|(?:type|reference|syntax|runtime|value)error\s*:/iu, 14, 'debugging');
    addSignal(/\b(?:prove|proof|derive|derivation|rigorous(?:ly)?|formal correctness|correctness argument|justify every|theorem)\b/iu, 14, 'formal reasoning');
    addSignal(/\b(?:architecture|concurren(?:cy|t)|race condition|thread safety|security|threat model|performance|scalab(?:le|ility)|migration|rollback|distributed system|multi-tenant)\b/iu, 14, 'architecture or risk');
    addSignal(/\b(?:synthesi[sz]e|systematic review|primary sources?|conflicting (?:evidence|studies)|multiple sources?|citations?|cite (?:the )?(?:official|primary))\b/iu, 10, 'source synthesis');
    addSignal(/\b(?:verify|verification|tests?|test suite|edge cases?|double-check|exhaustive|benchmarks?|every case|correctness)\b/iu, 10, 'verification');

    const numberedTasks = (sample.match(/(?:^|\n)\s*(?:\d+[.)]|[-*])\s+/gu) || []).length;
    const taskVerbs = new Set((sampleLower.match(/\b(?:design|implement|review|explain|compare|test|verify|benchmark|migrate|document|optimi[sz]e|debug|prove|specify)\b/gu) || []));
    const listSeparators = (sample.match(/[,;]/gu) || []).length;
    if (numberedTasks >= 3 || taskVerbs.size >= 4 ||
      strongGroups.has('architecture or risk') && listSeparators >= 5 ||
      /\b(?:three|four|five|six|several|multiple)\s+(?:tasks?|steps?|parts?|policies|options)\b/iu.test(sampleLower)) {
      score += 8;
      reasons.push('multiple subtasks');
      strongGroups.add('multiple subtasks');
    }

    const constraintHits = sampleLower.match(/\b(?:must|should|without|only|at least|at most|under \d+|do not|don\W?t|require[ds]?|include)\b/gu) || [];
    if (constraintHits.length >= 4) {
      score += 8;
      reasons.push('many constraints');
      strongGroups.add('many constraints');
    }

    if (wordCount > 4_000) {
      score += 16;
      reasons.push('very large input');
      strongGroups.add('very large input');
    } else if (wordCount > 1_200 || codeLineCount > 100) {
      score += 8;
      reasons.push('large input');
      strongGroups.add('large input');
    }

    if (/\b(?:my|i|me)\b.{0,80}\b(?:medical|medicine|medication|dose|symptom|diagnosis|legal|lawsuit|contract|tax|investment|financial|warfarin|pregnan|chest pain)\b|\b(?:can i take|should i take)\b/iu.test(sampleLower)) {
      score += 12;
      highStakes = true;
      reasons.push('personal high-stakes question');
      strongGroups.add('personal high-stakes question');
    }

    if (/\b(?:end[- ]to[- ]end|production|repo(?:sitory)?[- ]scale|whole (?:repository|codebase)|long[- ]running|from scratch|complete implementation|design and implement|compiler)\b/iu.test(sampleLower)) {
      score += 16;
      longHorizon = true;
      reasons.push('long-horizon work');
      strongGroups.add('long-horizon work');
    }
    if (/\b(?:expert|novel|research[- ]level|graduate[- ]level|olympiad|formal verification|publication[- ]quality|state of the art|optimizer|type checker)\b/iu.test(sampleLower)) {
      score += 16;
      expertWork = true;
      reasons.push('expert-level work');
      strongGroups.add('expert-level work');
    }
    if (/\b(?:take your time|highest accuracy|maximum accuracy|be meticulous|do not make (?:any )?mistakes|check every|fully rigorous)\b/iu.test(sampleLower)) {
      score += 10;
      reasons.push('accuracy priority');
      strongGroups.add('accuracy priority');
    }
    if (/\b(?:quick answer|answer quickly|don\W?t overthink|do not overthink|least tokens?|be brief|briefly)\b/iu.test(sampleLower)) {
      score -= 8;
      reasons.push('speed priority');
    }

    score = Math.max(0, Math.min(100, score));
    let target = score < 20
      ? 'instant'
      : score < 40
        ? 'medium'
        : score < 60
          ? 'high'
          : score < 70
            ? 'extra-high'
            : score < 80
              ? 'ultra'
              : score < 92
                ? 'pro'
                : 'pro-ultra';

    if (highStakes && modelLevelRank(target) < ROUTE_LEVEL_RANK.high) target = 'high';
    if (debuggingWork && modelLevelRank(target) < ROUTE_LEVEL_RANK.high) target = 'high';
    if (modelLevelRank(target) >= ROUTE_LEVEL_RANK['extra-high'] && strongGroups.size < 2) target = 'high';
    if (modelLevelRank(target) >= ROUTE_LEVEL_RANK.pro && (
      strongGroups.size < 3 || !(longHorizon || expertWork || (highStakes && strongGroups.has('source synthesis')))
    )) {
      target = score >= 70 ? 'ultra' : 'extra-high';
    }

    const boundaries = [20, 40, 60, 70, 80, 92];
    const margin = Math.min(...boundaries.map((boundary) => Math.abs(score - boundary)));
    const confidence = Math.max(0.45, Math.min(0.94, 0.58 + Math.min(margin, 10) * 0.018 + Math.min(strongGroups.size, 3) * 0.045));
    return {
      target,
      score,
      confidence,
      explicit: false,
      reasons: reasons.length ? reasons : [score < 20 ? 'short everyday request' : 'general complexity'],
    };
  }

  function maxRouteRank(maxSetting) {
    if (maxSetting === 'high') return ROUTE_LEVEL_RANK.high;
    if (maxSetting === 'extra-high') return ROUTE_LEVEL_RANK['extra-high'];
    return Number.POSITIVE_INFINITY;
  }

  function optionLevel(option) {
    if (typeof option === 'string') return extractPickerLevel(option, { allowBareEffort: true });
    if (!option || typeof option !== 'object') return '';
    return option.level
      ? extractModelLevel(option.level)
      : extractPickerLevel(option.label || option.text || accessibleText(option), { allowBareEffort: true });
  }

  function chooseModelOption(options, target, maxSetting = 'highest') {
    const cap = maxRouteRank(maxSetting);
    const recognized = [];
    for (const option of Array.isArray(options) ? options : []) {
      const level = optionLevel(option);
      const rank = modelLevelRank(level);
      if (!level || rank < 0 || rank > cap) continue;
      if (option && typeof option === 'object' && option.nodeType === 1 && (
        option.disabled || option.closest('[aria-disabled="true"], [data-disabled="true"], :disabled')
      )) continue;
      recognized.push({ element: typeof option === 'string' ? null : option, option, level, rank });
    }
    if (!recognized.length) return null;
    recognized.sort((left, right) => left.rank - right.rank);

    if (target === 'max') {
      const selected = recognized[recognized.length - 1];
      return { ...selected, selectedLevel: selected.level, requestedLevel: 'max', fallback: false };
    }

    const canonicalTarget = ROUTE_LEVEL_RANK[target] == null ? extractModelLevel(target) : target;
    let desiredRank = modelLevelRank(canonicalTarget);
    if (desiredRank < 0) return null;
    desiredRank = Math.min(desiredRank, cap);
    const exact = recognized.find((entry) => entry.rank === desiredRank && entry.level === canonicalTarget) ||
      recognized.find((entry) => entry.rank === desiredRank && canonicalTarget === 'instant' && entry.level === 'auto');
    const sameFamilyFallback = canonicalTarget === 'ultra'
      ? [...recognized].reverse().find((entry) => entry.level === 'extra-high')
      : null;
    const selected = exact || sameFamilyFallback || recognized.find((entry) => entry.rank >= desiredRank) || recognized[recognized.length - 1];
    return {
      ...selected,
      selectedLevel: selected.level,
      requestedLevel: canonicalTarget,
      fallback: selected.level !== canonicalTarget,
    };
  }

  function isPlausiblePickerButton(button, allowGenericPopup = false) {
    if (!button || !isProbablyVisible(button) || button.closest(`#${UI_ROOT_ID}`)) return false;
    const testId = lowerText(button.getAttribute('data-testid'));
    if (/\b(?:model-(?:picker|switcher)|intelligence|reasoning|thinking-time)\b/iu.test(testId)) return true;
    if (extractPickerLevel(accessibleText(button))) return true;
    return allowGenericPopup && (button.hasAttribute('aria-controls') || button.hasAttribute('aria-expanded') || button.hasAttribute('aria-haspopup'));
  }

  function findModelPicker(doc, composer = findComposer(doc)) {
    if (!doc || !composer) return null;
    const form = composer.closest && composer.closest('form');
    const localScopes = uniqueElements([
      composerScope(composer),
      form && form.parentElement && !form.parentElement.matches('main, body, html') ? form.parentElement : null,
      composer.parentElement && !composer.parentElement.matches('main, body, html') ? composer.parentElement : null,
    ]);
    const scopes = uniqueElements([
      ...localScopes,
      composer.closest && composer.closest('main'),
      doc.querySelector('main'),
      doc,
    ]);
    const preferred = [
      'button[data-testid*="model-picker"]',
      'button[data-testid*="model-switcher"]',
      'button[aria-label*="model" i]',
      'button[aria-label*="reasoning" i]',
    ];
    const localPreferred = [
      'button[data-testid*="intelligence"]',
      'button[aria-label*="intelligence" i]',
      ...preferred,
    ];
    for (const scope of scopes) {
      const isLocal = localScopes.includes(scope);
      for (const selector of localScopes.includes(scope) ? localPreferred : preferred) {
        const candidate = [...scope.querySelectorAll(selector)].find((button) => isPlausiblePickerButton(button, isLocal));
        if (candidate) return candidate;
      }
    }
    for (const scope of localScopes) {
      const fallback = [...scope.querySelectorAll('button')].find((button) => {
        if (!isProbablyVisible(button) || button.closest(`#${UI_ROOT_ID}`)) return false;
        return Boolean(extractPickerLevel(accessibleText(button)));
      });
      if (fallback) return fallback;
    }
    return null;
  }

  function findReasoningPicker(doc, composer = findComposer(doc)) {
    if (!doc || !composer) return null;
    const form = composer.closest && composer.closest('form');
    const localScopes = uniqueElements([
      composerScope(composer),
      form && form.parentElement && !form.parentElement.matches('main, body, html') ? form.parentElement : null,
      composer.parentElement && !composer.parentElement.matches('main, body, html') ? composer.parentElement : null,
    ]);
    const scopes = uniqueElements([
      ...localScopes,
      composer.closest && composer.closest('main'),
      doc.querySelector('main'),
      doc,
    ]);
    const preferred = [
      'button[data-testid*="reasoning"]',
      'button[data-testid*="thinking-time"]',
      'button[data-testid*="intelligence"]',
      'button[aria-label*="reasoning effort" i]',
      'button[aria-label*="thinking time" i]',
      'button[aria-label*="intelligence level" i]',
    ];
    for (const scope of localScopes) {
      for (const selector of preferred) {
        const candidate = [...scope.querySelectorAll(selector)].find((button) => isPlausiblePickerButton(button, true));
        if (candidate) return candidate;
      }
    }
    const primary = findModelPicker(doc, composer);
    for (const scope of scopes.filter((scope) => !localScopes.includes(scope))) {
      for (const selector of preferred) {
        const candidate = [...scope.querySelectorAll(selector)].find((button) => isPlausiblePickerButton(button, false));
        if (candidate) return candidate;
      }
    }
    for (const scope of localScopes) {
      const candidate = [...scope.querySelectorAll('button')].find((button) => {
        if (button === primary || !isProbablyVisible(button) || button.closest(`#${UI_ROOT_ID}`)) return false;
        return Boolean(extractPickerLevel(accessibleText(button)));
      });
      if (candidate) return candidate;
    }
    return null;
  }

  function findModelOptions(root, picker = null, excluded = new Set()) {
    if (!root) return null;
    const contextText = lowerText(`${accessibleText(picker)} ${accessibleText(root)}`);
    const allowBareEffort = /\b(?:reasoning|thinking time|intelligence level|effort)\b/iu.test(contextText);
    const candidates = [...root.querySelectorAll(MODEL_OPTION_SELECTOR)];
    return candidates.filter((candidate) => {
      if (excluded.has(candidate) || candidate === picker || candidate.contains(picker) || !isProbablyVisible(candidate) ||
        candidate.closest('[data-state="closed"], [aria-hidden="true"], [hidden]') || candidate.closest(`#${UI_ROOT_ID}`)) return false;
      if (candidate.disabled || candidate.closest('[aria-disabled="true"], [data-disabled="true"], :disabled')) return false;
      const outerOption = candidate.closest(MODEL_OPTION_CONTAINER_SELECTOR);
      if (outerOption && isModelUpsellLabel(accessibleText(outerOption))) return false;
      if (outerOption && outerOption !== candidate &&
        extractPickerLevel(accessibleText(outerOption), { allowBareEffort }) === extractPickerLevel(accessibleText(candidate), { allowBareEffort })) return false;
      return Boolean(extractPickerLevel(accessibleText(candidate), { allowBareEffort }));
    });
  }

  function findInstantOption(root, picker = null, excluded = new Set()) {
    return findModelOptions(root, picker, excluded).find((candidate) => {
      const level = extractModelLevel(accessibleText(candidate));
      return level === 'instant' || level === 'auto';
    }) || null;
  }

  function findMoreButton(turn) {
    if (!turn) return null;
    const preferred = [
      'button[data-testid="more-turn-action-button"]',
      'button[data-testid*="more-turn"]',
      'button[aria-label="More actions"]',
      'button[aria-label*="More" i]',
      'button[title*="More" i]',
    ];
    for (const selector of preferred) {
      const button = [...turn.querySelectorAll(selector)].find(isProbablyVisible);
      if (button) return button;
    }
    return [...turn.querySelectorAll('button')].find((button) => /^(?:\.\.\.|…|⋯)$/u.test(normalizeText(button.textContent)) && isProbablyVisible(button)) || null;
  }

  function isBranchLabel(value) {
    const text = lowerText(value).replace(/[.!…]+$/gu, '');
    return text === 'branch in new chat' || text === 'branch in a new chat' || text.startsWith('branch in new chat ') || text.startsWith('branch in a new chat ');
  }

  function findBranchAction(root, excluded = new Set()) {
    if (!root) return null;
    const candidates = [...root.querySelectorAll('[role="menuitem"], [role="option"], [data-radix-collection-item], button, a')];
    return candidates.find((candidate) => !excluded.has(candidate) && !candidate.closest(`#${UI_ROOT_ID}`) && isProbablyVisible(candidate) && isBranchLabel(accessibleText(candidate))) || null;
  }

  function waitForCondition(test, options = {}) {
    const root = options.root;
    const win = options.win || global;
    const timeout = clampInteger(options.timeout, 5_000, 50, 60_000);
    return new Promise((resolve) => {
      let settled = false;
      let observer = null;
      let timeoutTimer = null;
      let checkTimer = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (observer) observer.disconnect();
        if (timeoutTimer) win.clearTimeout(timeoutTimer);
        if (checkTimer) win.clearTimeout(checkTimer);
        resolve(value || null);
      };
      const check = () => {
        try {
          const value = test();
          if (value) finish(value);
        } catch (_error) {
          // A transient detached node is expected while ChatGPT rerenders.
        }
      };
      check();
      if (settled) return;
      if (root && win.MutationObserver) {
        observer = new win.MutationObserver(() => {
          if (checkTimer || settled) return;
          checkTimer = win.setTimeout(() => {
            checkTimer = null;
            check();
          }, 60);
        });
        observer.observe(root, { childList: true, subtree: true, attributes: options.attributes === true });
      }
      timeoutTimer = win.setTimeout(() => finish(null), timeout);
    });
  }

  function waitForRouteChange(win, before, timeout = 15_000) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const interval = win.setInterval(() => {
        const current = routeKey(win.location.href);
        if (current && current !== before) {
          win.clearInterval(interval);
          resolve(current);
        } else if (Date.now() - startedAt >= timeout) {
          win.clearInterval(interval);
          resolve('');
        }
      }, 125);
    });
  }

  function waitForStableComposer(doc, win, previousComposer = null, timeout = 20_000) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      let lastCandidate = null;
      let stableChecks = 0;
      const interval = win.setInterval(() => {
        const elapsed = Date.now() - startedAt;
        const candidate = findComposer(doc);
        if (candidate && candidate.isConnected) {
          // During a branch transition, reusing the source composer is not a
          // sufficient readiness signal. If ChatGPT intentionally retains it,
          // the workflow falls back to an explicit user-confirmed insertion.
          if (previousComposer && candidate === previousComposer && previousComposer.isConnected) {
            lastCandidate = null;
            stableChecks = 0;
            if (elapsed >= timeout) {
              win.clearInterval(interval);
              resolve(null);
            }
            return;
          }
          if (candidate === lastCandidate) stableChecks += 1;
          else {
            lastCandidate = candidate;
            stableChecks = 1;
          }
          if (elapsed >= 600 && stableChecks >= 3) {
            win.clearInterval(interval);
            resolve(candidate);
            return;
          }
        } else {
          lastCandidate = null;
          stableChecks = 0;
        }
        if (elapsed >= timeout) {
          win.clearInterval(interval);
          resolve(null);
        }
      }, 125);
    });
  }

  function dispatchHover(turn, win) {
    for (const type of ['pointerover', 'mouseover', 'mouseenter']) {
      try {
        turn.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, view: win }));
      } catch (_error) {
        // Pointer event support differs across browser/userscript combinations.
      }
    }
  }

  async function clickNativeBranch(doc, win, turn) {
    if (!turn || !turn.isConnected) return { ok: false, reason: 'The target response is not currently rendered.' };
    try {
      turn.scrollIntoView({ block: 'center', behavior: 'auto' });
    } catch (_error) {
      turn.scrollIntoView();
    }
    turn.classList.add('cgs-branch-target');
    dispatchHover(turn, win);

    const preexistingBranchActions = new Set(
      [...doc.querySelectorAll('[role="menuitem"], [role="option"], [data-radix-collection-item], button, a')]
        .filter((candidate) => isProbablyVisible(candidate) && isBranchLabel(accessibleText(candidate))),
    );
    if (preexistingBranchActions.size) {
      try {
        doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      } catch (_error) {
        // Opening the target menu below still fails safe if another portal remains open.
      }
    }

    let moreButton = findMoreButton(turn);
    if (!moreButton) {
      moreButton = await waitForCondition(() => findMoreButton(turn), {
        root: turn,
        win,
        timeout: 3_000,
        attributes: true,
      });
    }
    if (!moreButton) return { ok: false, reason: 'Could not find More actions on the response.' };
    moreButton.click();

    const controlledId = normalizeText(moreButton.getAttribute('aria-controls'));
    const controlledMenu = controlledId ? doc.getElementById(controlledId) : null;

    const branchAction = await waitForCondition(
      () => findBranchAction(controlledMenu && controlledMenu.isConnected ? controlledMenu : doc, preexistingBranchActions), {
      root: controlledMenu || doc.documentElement,
      win,
      timeout: 4_000,
    });
    if (!branchAction) return { ok: false, reason: 'Could not find “Branch in new chat” in ChatGPT’s menu.' };
    branchAction.click();
    return { ok: true };
  }

  function legacyGrant(name) {
    try {
      if (global && typeof global[name] === 'function') return global[name].bind(global);
    } catch (_error) {
      return null;
    }
    return null;
  }

  const gmGetValue = legacyGrant('GM_getValue');
  const gmSetValue = legacyGrant('GM_setValue');
  const gmDeleteValue = legacyGrant('GM_deleteValue');
  const gmAddStyle = legacyGrant('GM_addStyle');
  const gmRegisterMenuCommand = legacyGrant('GM_registerMenuCommand');

  async function storageGet(key, fallback) {
    try {
      if (gmGetValue) return await Promise.resolve(gmGetValue(key, fallback));
      if (global.GM && typeof global.GM.getValue === 'function') return await global.GM.getValue(key, fallback);
    } catch (_error) {
      return fallback;
    }
    return fallback;
  }

  async function storageSet(key, value) {
    try {
      if (gmSetValue) {
        await Promise.resolve(gmSetValue(key, value));
        return true;
      }
      if (global.GM && typeof global.GM.setValue === 'function') {
        await global.GM.setValue(key, value);
        return true;
      }
    } catch (_error) {
      return false;
    }
    return false;
  }

  async function storageDelete(key) {
    try {
      if (gmDeleteValue) {
        await Promise.resolve(gmDeleteValue(key));
        return true;
      }
      if (global.GM && typeof global.GM.deleteValue === 'function') {
        await global.GM.deleteValue(key);
        return true;
      }
    } catch (_error) {
      return false;
    }
    return false;
  }

  function sanitizeJobIndex(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const entries = [];
    for (const item of raw) {
      const id = String(item && item.id || '');
      const createdAt = Number(item && item.createdAt);
      if (!isValidJobId(id) || !Number.isFinite(createdAt) || seen.has(id)) continue;
      seen.add(id);
      entries.push({ id, createdAt });
    }
    return entries.slice(-50);
  }

  async function trackJob(jobId, createdAt) {
    const entries = sanitizeJobIndex(await storageGet(JOB_INDEX_KEY, []));
    const next = entries.filter((entry) => entry.id !== jobId);
    next.push({ id: jobId, createdAt });
    return storageSet(JOB_INDEX_KEY, next.slice(-50));
  }

  async function untrackJob(jobId) {
    const entries = sanitizeJobIndex(await storageGet(JOB_INDEX_KEY, []));
    return storageSet(JOB_INDEX_KEY, entries.filter((entry) => entry.id !== jobId));
  }

  async function deleteTrackedJob(jobId) {
    const deleted = await storageDelete(`${JOB_PREFIX}${jobId}`);
    if (deleted) await untrackJob(jobId);
    return deleted;
  }

  async function cleanupExpiredJobs(now = Date.now()) {
    const entries = sanitizeJobIndex(await storageGet(JOB_INDEX_KEY, []));
    const keep = [];
    for (const entry of entries) {
      const raw = await storageGet(`${JOB_PREFIX}${entry.id}`, null);
      if (sanitizeJob(raw, now)) keep.push(entry);
      else if (!await storageDelete(`${JOB_PREFIX}${entry.id}`)) keep.push(entry);
    }
    await storageSet(JOB_INDEX_KEY, keep);
    return entries.length - keep.length;
  }

  function injectStyles(doc) {
    if (gmAddStyle) {
      gmAddStyle(STYLE_TEXT);
      return;
    }
    if (global.GM && typeof global.GM.addStyle === 'function') {
      global.GM.addStyle(STYLE_TEXT);
      return;
    }
    const style = doc.createElement('style');
    style.id = 'cgs-style';
    style.textContent = STYLE_TEXT;
    (doc.head || doc.documentElement).append(style);
  }

  function waitForBody(doc, win) {
    if (doc.body) return Promise.resolve(doc.body);
    return new Promise((resolve) => {
      doc.addEventListener('DOMContentLoaded', () => resolve(doc.body), { once: true });
      win.setTimeout(() => resolve(doc.body || doc.documentElement), 5_000);
    });
  }

  function createUI(doc) {
    const root = doc.createElement('div');
    root.id = UI_ROOT_ID;
    root.innerHTML = `
      <div id="cgs-dock" aria-label="ChatGPT Workflow Toolkit controls" hidden>
        <button class="cgs-button" type="button" data-cgs-action="open-handoff" aria-label="Continue in fresh chat" title="Continue in a fresh chat with a compact handoff">
          <span aria-hidden="true">↗</span><span class="cgs-dock-label">Continue in fresh chat</span>
        </button>
        <span class="cgs-auto-badge" data-cgs-auto-badge data-enabled="true" title="Adaptive Auto is ready">Adaptive Auto</span>
        <button class="cgs-icon-button" type="button" data-cgs-action="toggle-settings" aria-label="Open Workflow Toolkit settings" title="Workflow Toolkit settings">⚙</button>
      </div>

      <div id="cgs-settings-backdrop" hidden>
        <section id="cgs-settings" role="dialog" aria-modal="true" aria-labelledby="cgs-settings-title">
          <div class="cgs-panel-head">
            <div><h2 id="cgs-settings-title">ChatGPT Workflow Toolkit</h2><p>Branches, handoffs, and per-message model routing</p></div>
            <button class="cgs-icon-button" type="button" data-cgs-action="close-settings" aria-label="Close settings">×</button>
          </div>
          <label class="cgs-setting">
            <span><strong>Adaptive Auto for every message</strong><small>On Send, a fast local heuristic chooses the lowest likely-sufficient level your account exposes—from Instant through the strongest available option. It never sends your draft anywhere else. Hold Alt while sending to bypass it once. ChatGPT’s own automatic switching can still promote Instant to Medium.</small></span>
            <input type="checkbox" data-cgs-setting="adaptiveRouting" aria-label="Choose a model level for every message">
          </label>
          <label class="cgs-setting">
            <span><strong>Maximum Auto level</strong><small>“Highest available” allows recognized Extra High, Ultra, and Pro-class labels currently shown in the picker, only when the prompt has multiple hard-task signals. Prefix a prompt with <code>!route:high</code>, <code>!route:pro</code>, or <code>!route:max</code> for a one-message override; this safety cap still applies.</small></span>
            <select data-cgs-setting="autoMaxLevel" aria-label="Maximum Adaptive Auto level"><option value="high">High</option><option value="extra-high">Extra High</option><option value="highest">Highest available</option></select>
          </label>
          <label class="cgs-setting">
            <span><strong>Open side-question branches in</strong><small>A side window keeps the original instructions visible. Small screens use a tab. Fresh-chat continuation always switches this tab.</small></span>
            <select data-cgs-setting="openMode" aria-label="Open side-question branches in"><option value="popup">Side window</option><option value="tab">New tab</option></select>
          </label>
          <label class="cgs-setting">
            <span><strong>Send side questions automatically</strong><small>The question is sent only after ChatGPT finishes creating the native branch.</small></span>
            <input type="checkbox" data-cgs-setting="autoSend" aria-label="Send side questions automatically">
          </label>
          <label class="cgs-setting">
            <span><strong>Show “Ask in new chat” on responses</strong><small>You can also select response text to get a temporary Ask in new chat button.</small></span>
            <input type="checkbox" data-cgs-setting="showTurnButtons" aria-label="Show Ask in new chat buttons">
          </label>
          <label class="cgs-setting">
            <span><strong>Remove “Start writing”</strong><small>Clears that exact placeholder/control without touching message content.</small></span>
            <input type="checkbox" data-cgs-setting="hideStartWriting" aria-label="Remove Start writing">
          </label>
          <div class="cgs-version">v${VERSION} · Adaptive choices are estimates, not an accuracy guarantee · <a class="cgs-help-link" href="https://help.openai.com/en/articles/20001354" target="_blank" rel="noopener noreferrer">model availability</a></div>
        </section>
      </div>

      <div id="cgs-handoff-backdrop" hidden>
        <section class="cgs-dialog" role="dialog" aria-modal="true" aria-labelledby="cgs-handoff-title">
          <h2 id="cgs-handoff-title">Are you sure you want to continue in fresh chat?</h2>
          <div class="cgs-dialog-actions">
            <button class="cgs-secondary" type="button" data-cgs-action="close-handoff">Cancel</button>
            <button class="cgs-primary" type="button" data-cgs-action="confirm-fresh-chat">Yes</button>
          </div>
        </section>
      </div>

      <div id="cgs-dialog-backdrop" hidden>
        <section class="cgs-dialog" role="dialog" aria-modal="true" aria-labelledby="cgs-dialog-title">
          <h2 id="cgs-dialog-title">Ask in new chat</h2>
          <p>The new chat uses ChatGPT’s native branch, so it keeps context while this page stays put.</p>
          <textarea id="cgs-question" aria-label="Side question" placeholder="What are you stuck on?"></textarea>
          <div class="cgs-dialog-options">
            <label><input id="cgs-dialog-autosend" type="checkbox"> Send this question automatically</label>
            <label>Context <select id="cgs-context-mode" aria-label="Side chat context"><option value="latest">Through latest response (include later messages)</option><option value="clicked">Only through this response (exclude later messages)</option></select></label>
          </div>
          <p class="cgs-dialog-help">When checked, this sends the question after the new branch is ready. When unchecked, it leaves the question in the composer for review. “Only through this response” stops at the clicked response and excludes later messages. “Through latest response” includes those later messages.</p>
          <div class="cgs-dialog-actions">
            <button class="cgs-secondary" type="button" data-cgs-action="cancel-question">Cancel</button>
            <button class="cgs-primary" type="button" data-cgs-action="submit-question">Open side chat</button>
          </div>
        </section>
      </div>

      <div id="cgs-recovery-backdrop" hidden>
        <section class="cgs-dialog" role="region" aria-labelledby="cgs-recovery-title">
          <h2 id="cgs-recovery-title">Finish the branch manually</h2>
          <p class="cgs-recovery-note" id="cgs-recovery-reason"></p>
          <p>On the highlighted response, choose More actions (⋯) → Branch in new chat. Workflow Toolkit has kept your question below.</p>
          <textarea id="cgs-recovery-question" aria-label="Saved side question" readonly></textarea>
          <div class="cgs-dialog-actions">
            <button class="cgs-secondary" type="button" data-cgs-action="close-recovery">Close</button>
            <button class="cgs-secondary" type="button" data-cgs-action="retry-branch">Try again</button>
            <button class="cgs-primary" type="button" data-cgs-action="insert-recovery">I branched — insert question</button>
          </div>
        </section>
      </div>

      <button id="cgs-selection-pill" type="button" data-cgs-action="ask-selection" hidden>Ask in new chat</button>
      <div id="cgs-toast" role="status" aria-live="polite" hidden></div>
    `;
    doc.body.append(root);

    return root;
  }

  function decorateTurn(doc, turn) {
    if (!turn || !isAssistantTurn(turn) || isTurnStreaming(turn, doc) || turn.querySelector(`.${TURN_BUTTON_CLASS}`)) return false;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = TURN_BUTTON_CLASS;
    button.dataset.cgsAction = 'ask-turn';
    button.setAttribute('aria-label', 'Ask about this response in a new chat');
    button.title = 'Ask about this response in a new chat';
    button.textContent = '↗ Ask in new chat';

    const anchor = turn.querySelector(
      'button[data-testid="copy-turn-action-button"], button[data-testid*="copy-turn"], button[aria-label^="Copy"]',
    );
    const actionRow = anchor && anchor.parentElement;
    if (actionRow) {
      actionRow.append(button);
    } else {
      const fallback = doc.createElement('div');
      fallback.className = 'cgs-turn-fallback-row';
      fallback.dataset.cgsInjected = 'true';
      fallback.append(button);
      turn.append(fallback);
    }
    return true;
  }

  function removeTurnButtons(doc) {
    for (const button of doc.querySelectorAll(`.${TURN_BUTTON_CLASS}`)) {
      const fallback = button.closest('.cgs-turn-fallback-row');
      if (fallback) fallback.remove();
      else button.remove();
    }
  }

  function createApp(doc, win, options = {}) {
    const injectedMenuRegister = typeof options.registerMenuCommand === 'function'
      ? options.registerMenuCommand
      : null;
    const freshStorageGet = typeof options.storageGet === 'function' ? options.storageGet : storageGet;
    const freshStorageSet = typeof options.storageSet === 'function' ? options.storageSet : storageSet;
    const freshStorageDelete = typeof options.storageDelete === 'function' ? options.storageDelete : storageDelete;
    const navigateCurrent = typeof options.navigateTo === 'function'
      ? options.navigateTo
      : (url) => {
        win.location.assign(url);
        return true;
      };
    const freshResponseTimeout = clampInteger(options.freshResponseTimeout, 5 * 60 * 1000, 500, 10 * 60 * 1000);
    const freshStabilityMs = clampInteger(options.freshStabilityMs, 650, 20, 5_000);
    const state = {
      settings: { ...DEFAULT_SETTINGS },
      root: null,
      observer: null,
      pendingRoots: new Set(),
      scanScheduled: false,
      toastTimer: null,
      activeTurn: null,
      selectedTurn: null,
      selectedQuote: '',
      focusReturn: null,
      recoveryJob: null,
      recoveryTurn: null,
      incomingJobId: '',
      autoEnsurePromise: null,
      adaptiveSendPromise: null,
      replayingSend: false,
      submitReplayPermit: null,
      composingComposer: null,
      lastRouteDecision: null,
      adaptiveCancelled: false,
      dockUpdateTimer: null,
      freshContinuationPromise: null,
      freshTransferPromise: null,
      initialJobId: isValidJobId(options.initialJobId) ? options.initialJobId : '',
      initialFreshJobId: isValidJobId(options.initialFreshJobId) ? options.initialFreshJobId : '',
    };

    function element(selector) {
      return state.root && state.root.querySelector(selector);
    }

    function freshIndexEntries(raw) {
      if (!Array.isArray(raw)) return [];
      const seen = new Set();
      return raw.flatMap((entry) => {
        const id = String(entry && entry.id || '');
        const createdAt = Number(entry && entry.createdAt);
        if (!isValidJobId(id) || !Number.isFinite(createdAt) || seen.has(id)) return [];
        seen.add(id);
        return [{ id, createdAt }];
      }).slice(-30);
    }

    async function trackFreshJob(job) {
      const raw = await Promise.resolve(freshStorageGet(FRESH_HANDOFF_INDEX_KEY, null));
      const entries = freshIndexEntries(raw).filter((entry) => entry.id !== job.id);
      entries.push({ id: job.id, createdAt: job.createdAt });
      return Promise.resolve(freshStorageSet(FRESH_HANDOFF_INDEX_KEY, entries.slice(-30)));
    }

    async function deleteFreshJob(id) {
      const storageKey = freshHandoffStorageKey(id);
      if (storageKey) await Promise.resolve(freshStorageDelete(storageKey));
      const raw = await Promise.resolve(freshStorageGet(FRESH_HANDOFF_INDEX_KEY, null));
      if (!Array.isArray(raw)) return;
      const keep = freshIndexEntries(raw).filter((entry) => entry.id !== id);
      if (keep.length) await Promise.resolve(freshStorageSet(FRESH_HANDOFF_INDEX_KEY, keep));
      else await Promise.resolve(freshStorageDelete(FRESH_HANDOFF_INDEX_KEY));
    }

    async function cleanupFreshJobs(now = Date.now()) {
      const raw = await Promise.resolve(freshStorageGet(FRESH_HANDOFF_INDEX_KEY, null));
      if (!Array.isArray(raw)) return;
      const keep = [];
      for (const entry of freshIndexEntries(raw)) {
        const job = sanitizeFreshHandoff(
          await Promise.resolve(freshStorageGet(freshHandoffStorageKey(entry.id), null)),
          now,
          entry.id,
        );
        if (job) keep.push(entry);
        else await Promise.resolve(freshStorageDelete(freshHandoffStorageKey(entry.id)));
      }
      if (keep.length) await Promise.resolve(freshStorageSet(FRESH_HANDOFF_INDEX_KEY, keep));
      else await Promise.resolve(freshStorageDelete(FRESH_HANDOFF_INDEX_KEY));
    }

    async function saveSettings() {
      await storageSet(SETTINGS_KEY, state.settings);
    }

    function syncSettingsUI() {
      if (!state.root) return;
      for (const input of state.root.querySelectorAll('[data-cgs-setting]')) {
        const key = input.dataset.cgsSetting;
        if (input.type === 'checkbox') input.checked = Boolean(state.settings[key]);
        else input.value = String(state.settings[key]);
      }
      const badge = element('[data-cgs-auto-badge]');
      if (badge) {
        const enabled = state.settings.adaptiveRouting;
        badge.dataset.enabled = String(enabled);
        if (!enabled) {
          badge.textContent = 'Auto off';
          badge.title = 'Adaptive Auto is disabled';
        } else if (state.adaptiveSendPromise) {
          badge.textContent = 'Auto choosing…';
          badge.title = 'Choosing from the model levels available to this account';
        } else if (state.lastRouteDecision && state.lastRouteDecision.level) {
          badge.textContent = `${state.lastRouteDecision.manual ? 'Manual' : 'Auto'} → ${modelLevelLabel(state.lastRouteDecision.level)}`;
          badge.title = state.lastRouteDecision.reason || 'Last per-message routing choice';
        } else {
          badge.textContent = 'Adaptive Auto';
          badge.title = 'Each send is classified locally; no extra request or transcript scan is used';
        }
      }
    }

    function toast(message, duration = 4_000) {
      const node = element('#cgs-toast');
      if (!node) return;
      if (state.toastTimer) win.clearTimeout(state.toastTimer);
      node.textContent = String(message);
      node.hidden = false;
      state.toastTimer = win.setTimeout(() => {
        node.hidden = true;
        node.textContent = '';
      }, duration);
    }

    function scheduleScan(root) {
      if (!root || (root.closest && root.closest(`#${UI_ROOT_ID}`))) return;
      state.pendingRoots.add(root.nodeType === 1 || root.nodeType === 9 ? root : root.parentElement);
      if (state.pendingRoots.size > 80) {
        state.pendingRoots.clear();
        state.pendingRoots.add(doc.body);
      }
      if (state.scanScheduled) return;
      state.scanScheduled = true;
      const run = () => {
        state.scanScheduled = false;
        const roots = [...state.pendingRoots];
        state.pendingRoots.clear();
        for (const scanRoot of roots) processRoot(scanRoot);
        scheduleDockAvailability();
      };
      if (typeof win.requestIdleCallback === 'function') win.requestIdleCallback(run, { timeout: 350 });
      else win.setTimeout(run, 40);
    }

    function processRoot(root) {
      if (!root || (root.closest && root.closest(`#${UI_ROOT_ID}`))) return;
      if (state.settings.hideStartWriting) cleanStartWriting(root);
      if (state.settings.showTurnButtons && !isReadOnlyChatPage(win.location.href)) {
        for (const turn of potentialTurnsFromRoot(root)) decorateTurn(doc, turn);
      }
    }

    function scheduleDockAvailability() {
      if (state.dockUpdateTimer) return;
      state.dockUpdateTimer = win.setTimeout(() => {
        state.dockUpdateTimer = null;
        updateDockAvailability();
      }, 200);
    }

    function updateDockAvailability() {
      const dock = element('#cgs-dock');
      if (!dock) return;
      if (isReadOnlyChatPage(win.location.href)) {
        dock.hidden = true;
        removeTurnButtons(doc);
        hideSelectionPill();
        return;
      }
      const hasComposer = Boolean(findComposer(doc));
      const hasCompletedResponse = getCompletedAssistantTurns(doc).length > 0;
      const generating = hasActiveGeneration(doc);
      dock.hidden = !hasComposer && !hasCompletedResponse;
      const continueButton = dock.querySelector('[data-cgs-action="open-handoff"]');
      if (continueButton) continueButton.hidden = !hasCompletedResponse || generating || Boolean(state.freshContinuationPromise);
    }

    async function ensureInstant(options = {}) {
      const userInitiated = options.userInitiated === true;
      if (state.autoEnsurePromise) return state.autoEnsurePromise;

      state.autoEnsurePromise = (async () => {
        const composer = findComposer(doc);
        const picker = findReasoningPicker(doc, composer) || findModelPicker(doc, composer);
        if (!picker) {
          if (userInitiated) toast('Could not find the model control. Your plan may already use ChatGPT’s default Auto routing.');
          return { ok: false, reason: 'picker-not-found' };
        }
        const current = extractModelLevel(accessibleText(picker));
        if (current === 'instant' || current === 'auto') {
          syncSettingsUI();
          if (userInitiated) toast('Instant is selected. In ChatGPT’s model picker → Configure, keep automatic switching enabled.');
          return { ok: true, reason: current };
        }

        const preexistingOptions = new Set(
          [...doc.querySelectorAll(MODEL_OPTION_SELECTOR)]
            .filter((candidate) => isProbablyVisible(candidate) && lowerText(accessibleText(candidate)).startsWith('instant')),
        );
        picker.click();
        const option = await waitForCondition(() => {
          const controlledId = normalizeText(picker.getAttribute('aria-controls'));
          const menu = controlledId ? doc.getElementById(controlledId) : null;
          return findInstantOption(menu && menu.isConnected ? menu : doc, picker, preexistingOptions);
        }, {
          root: doc.documentElement,
          win,
          timeout: 3_000,
        });
        if (!option) {
          if (userInitiated) toast('The Instant option was not available in this account’s model picker.');
          return { ok: false, reason: 'instant-not-found' };
        }
        option.click();
        win.setTimeout(syncSettingsUI, 100);
        if (userInitiated) toast('Instant selected. ChatGPT can now auto-route harder prompts to Medium.');
        return { ok: true, reason: 'selected' };
      })();

      try {
        return await state.autoEnsurePromise;
      } finally {
        state.autoEnsurePromise = null;
      }
    }

    function conversationPath() {
      try { return new URL(String(win.location.href)).pathname; } catch (_error) { return ''; }
    }

    function attachmentState(composer) {
      const scope = composerScope(composer);
      if (!scope || typeof scope.querySelectorAll !== 'function') return { count: 0, signature: '' };
      const selectors = [
        '[data-testid*="attachment"]',
        '[data-testid*="file-pill"]',
        '[aria-label*="remove file" i]',
        '[aria-label*="remove attachment" i]',
        '[data-file-id]',
        '[data-attachment-id]',
      ];
      const rawNodes = uniqueElements(selectors.flatMap((selector) => [...scope.querySelectorAll(selector)]))
        .filter((node) => isProbablyVisible(node) && !node.closest(`#${UI_ROOT_ID}`));
      const nodes = uniqueElements(rawNodes.map((node) => node.closest(
        '[data-file-id], [data-attachment-id], [data-testid*="attachment"], [data-testid*="file-pill"]',
      ) || node));
      const labels = nodes.map((node) => normalizeText([
        node.getAttribute('data-file-id'),
        node.getAttribute('data-attachment-id'),
        node.getAttribute('data-testid'),
        node.getAttribute('aria-label'),
        node.getAttribute('title'),
        node.textContent,
      ].filter(Boolean).join('|')).slice(0, 240)).sort();
      return { count: nodes.length, signature: labels.join('\n') };
    }

    function activeToolState(composer) {
      const scope = composerScope(composer);
      if (!scope || typeof scope.querySelectorAll !== 'function') return { signature: '', special: '' };
      const specialPattern = /\b(?:agent(?: mode)?|deep research|canvas|create (?:an )?image|image generation|video generation|voice mode|record mode)\b/iu;
      const routingControls = new Set([findModelPicker(doc, composer), findReasoningPicker(doc, composer)].filter(Boolean));
      const active = [...scope.querySelectorAll(
        '[aria-pressed="true"], [aria-checked="true"], [data-state="active"], [data-state="on"], [data-state="checked"], [data-selected="true"]',
      )].filter((node) => isProbablyVisible(node) && !node.closest(`#${UI_ROOT_ID}`) && !routingControls.has(node));
      const ambiguousSpecial = [...scope.querySelectorAll('button, [role="button"], [data-testid*="tool"], [data-testid*="mode"]')]
        .filter((node) => isProbablyVisible(node) && !node.closest(`#${UI_ROOT_ID}`) &&
          node.getAttribute('aria-pressed') !== 'false' && node.getAttribute('aria-checked') !== 'false' &&
          !['off', 'closed', 'inactive'].includes(lowerText(node.getAttribute('data-state'))) && specialPattern.test(accessibleText(node)));
      const labels = uniqueElements([...active, ...ambiguousSpecial]).map(accessibleText).filter(Boolean).sort();
      const special = labels.find((label) => specialPattern.test(label)) || '';
      return { signature: labels.join('\n'), special };
    }

    function captureSendSnapshot(composer = findComposer(doc)) {
      if (!composer) return null;
      const attachments = attachmentState(composer);
      const tools = activeToolState(composer);
      return {
        path: conversationPath(),
        draft: getComposerText(composer),
        attachmentCount: attachments.count,
        attachmentSignature: attachments.signature,
        toolSignature: tools.signature,
        specialMode: tools.special,
      };
    }

    function validateSendSnapshot(snapshot) {
      if (!snapshot || conversationPath() !== snapshot.path) return { ok: false, reason: 'The conversation changed while Auto was choosing.' };
      const composer = findComposer(doc);
      if (!composer || !composerTextEquals(composer, snapshot.draft)) {
        return { ok: false, reason: 'Your draft changed while Auto was choosing.' };
      }
      const attachments = attachmentState(composer);
      if (attachments.count !== snapshot.attachmentCount || attachments.signature !== snapshot.attachmentSignature) {
        return { ok: false, reason: 'An attachment changed while Auto was choosing.' };
      }
      const tools = activeToolState(composer);
      if (tools.signature !== snapshot.toolSignature) {
        return { ok: false, reason: 'The active ChatGPT tool changed while Auto was choosing.' };
      }
      return { ok: true, composer };
    }

    function cappedTarget(target) {
      if (target === 'max') {
        if (state.settings.autoMaxLevel === 'high') return 'high';
        if (state.settings.autoMaxLevel === 'extra-high') return 'extra-high';
        return 'max';
      }
      const cap = maxRouteRank(state.settings.autoMaxLevel);
      const rank = modelLevelRank(target);
      if (rank <= cap) return target;
      return state.settings.autoMaxLevel === 'high' ? 'high' : 'extra-high';
    }

    function previousRouteLevel() {
      const previous = state.lastRouteDecision;
      if (!previous || previous.path !== conversationPath() || Date.now() - previous.timestamp > 6 * 60 * 60 * 1000) return '';
      return previous.level;
    }

    function rememberRoute(level, decision, manual, reason) {
      const record = {
        path: conversationPath(),
        level: level || decision.target,
        target: decision.target,
        timestamp: Date.now(),
        manual: Boolean(manual),
        reason: reason || `${decision.reasons && decision.reasons.slice(0, 2).join(' + ') || 'prompt complexity'}; score ${decision.score}`,
      };
      state.lastRouteDecision = record;
      syncSettingsUI();
      win.setTimeout(() => {
        if (state.lastRouteDecision === record) record.path = conversationPath();
      }, 1_500);
    }

    function armSubmitReplayPermit(composer, kind) {
      const form = composer && composer.closest('form');
      if (!form) return;
      state.submitReplayPermit = {
        form,
        path: conversationPath(),
        draft: getComposerText(composer),
        kind,
        expiresAt: Date.now() + 1_500,
      };
    }

    function consumeSubmitReplayPermit(event, composer) {
      const permit = state.submitReplayPermit;
      if (!permit) return false;
      if (Date.now() > permit.expiresAt) {
        state.submitReplayPermit = null;
        return false;
      }
      if (!event || event.target !== permit.form || conversationPath() !== permit.path) return false;
      const currentDraft = getComposerText(composer);
      if (currentDraft && currentDraft !== permit.draft) return false;
      state.submitReplayPermit = null;
      return true;
    }

    function replayNativeSend(snapshot, decision, selectedLevel, manual = false, reason = '') {
      const validation = validateSendSnapshot(snapshot);
      if (!validation.ok) {
        toast(`${validation.reason} Review it and press Send again.`, 7_000);
        return false;
      }
      if (state.adaptiveCancelled) {
        toast('Adaptive send cancelled. Your draft is unchanged.');
        return false;
      }
      const sendButton = findSendButton(doc, validation.composer);
      if (sendButton) {
        if (sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') {
          toast('ChatGPT’s Send control is not ready. Your draft was not sent.', 7_000);
          return false;
        }
        armSubmitReplayPermit(validation.composer, 'adaptive-replay');
        state.replayingSend = true;
        try { sendButton.click(); } finally { state.replayingSend = false; }
        rememberRoute(selectedLevel, decision, manual, reason);
        return true;
      }
      const form = validation.composer.closest('form');
      if (form && typeof form.requestSubmit === 'function') {
        armSubmitReplayPermit(validation.composer, 'adaptive-replay');
        state.replayingSend = true;
        try { form.requestSubmit(); } catch (_error) { return false; } finally { state.replayingSend = false; }
        rememberRoute(selectedLevel, decision, manual, reason);
        return true;
      }
      toast('ChatGPT’s Send control changed. Your draft is ready; press Send again.', 7_000);
      return false;
    }

    function routingIsStrict(decision) {
      return Boolean(decision.explicit);
    }

    function programmaticClick(node) {
      if (!node || typeof node.click !== 'function') return false;
      node.click();
      return true;
    }

    function controlledModelMenu(picker) {
      const ids = normalizeText(picker && picker.getAttribute('aria-controls')).split(/\s+/u).filter(Boolean);
      return ids.map((id) => doc.getElementById(id)).find((node) => node && node.isConnected && isProbablyVisible(node) &&
        !node.matches('[data-state="closed"], [aria-hidden="true"], [hidden]')) || null;
    }

    function visibleModelMenuRoots(picker) {
      const roots = [];
      const controlled = controlledModelMenu(picker);
      if (controlled) roots.push(controlled);
      for (const candidate of doc.querySelectorAll(MODEL_MENU_ROOT_SELECTOR)) {
        if (isProbablyVisible(candidate) && !candidate.matches('[data-state="closed"], [aria-hidden="true"], [hidden]') &&
          !candidate.closest('[data-state="closed"]') && !candidate.closest(`#${UI_ROOT_ID}`)) roots.push(candidate);
      }
      for (const item of doc.querySelectorAll(MODEL_OPTION_CONTAINER_SELECTOR)) {
        if (!isProbablyVisible(item) || item.closest('[data-state="closed"], [aria-hidden="true"], [hidden]') || item.closest(`#${UI_ROOT_ID}`)) continue;
        roots.push(item.closest(MODEL_MENU_ROOT_SELECTOR) || item.parentElement);
      }
      return uniqueElements(roots);
    }

    function closeModelMenu(picker) {
      const current = picker && picker.isConnected ? picker : findModelPicker(doc);
      if (current && current.getAttribute('aria-expanded') === 'true') programmaticClick(current);
    }

    async function routeAndReplay(snapshot, decision, manual = false, silent = false, routingStage = 0) {
      const target = manual ? decision.target : cappedTarget(decision.target);
      const targetRank = modelLevelRank(target);
      const currentRoutingPicker = () => findReasoningPicker(doc) || findModelPicker(doc);
      const picker = currentRoutingPicker();
      const current = extractModelLevel(accessibleText(picker));

      if (snapshot.specialMode) {
        if (!silent) toast(`Adaptive Auto kept the current model because ${snapshot.specialMode} controls model compatibility.`);
        return replayNativeSend(snapshot, decision, current || 'unknown', manual, `kept current for ${snapshot.specialMode}`);
      }
      if (!snapshot.draft.trim()) {
        return replayNativeSend(snapshot, decision, current || 'unknown', manual, 'attachment-only message kept the current model');
      }
      if (picker && target !== 'max' && (
        current === target || target === 'instant' && current === 'auto' || modelLevelRank(current) === targetRank && targetRank === 0
      )) {
        return replayNativeSend(snapshot, decision, current || target, manual);
      }
      if (!picker) {
        if (routingIsStrict(decision)) {
          toast(`Adaptive Auto could not find ChatGPT’s model control for the requested ${modelLevelLabel(target)} level. Your draft was not sent.`, 8_000);
          return false;
        }
        if (!silent) toast('Adaptive Auto could not access this account’s model control, so this message used the current model.', 6_000);
        return replayNativeSend(snapshot, decision, current || 'unknown', manual, 'model control unavailable; used current');
      }

      const preexistingMenuRoots = new Set(visibleModelMenuRoots(picker));
      if (!programmaticClick(picker)) return replayNativeSend(snapshot, decision, current || 'unknown', manual, 'model control could not be opened; used current');
      const options = await waitForCondition(() => {
        const controlled = controlledModelMenu(picker);
        const roots = visibleModelMenuRoots(picker).filter((root) => root === controlled || !preexistingMenuRoots.has(root));
        const candidates = [];
        for (const root of roots) {
          const found = findModelOptions(root, picker) || [];
          if (!found.length) continue;
          const levels = new Set(found.map(optionLevel).filter(Boolean));
          const context = lowerText(`${root.getAttribute && root.getAttribute('aria-label')} ${root.getAttribute && root.getAttribute('data-testid')}`);
          let score = root === controlled ? 100 : 0;
          if (/\b(?:model|reasoning|thinking|intelligence|effort)\b/iu.test(context)) score += 40;
          if (root.matches('[data-slot*="menu"], [data-slot*="popover"], [data-radix-menu-content], [data-radix-popper-content-wrapper]') ||
            root.querySelector('[data-slot*="menu"], [data-slot*="popover"], [data-radix-menu-content]')) score += 30;
          score += levels.size * 5;
          if (current && levels.has(current)) score += 25;
          if (found.some((option) => option.matches('[aria-checked="true"], [aria-selected="true"], [data-state="checked"]') && optionLevel(option) === current)) score += 25;
          candidates.push({ found, score });
        }
        candidates.sort((left, right) => right.score - left.score);
        return candidates[0] && candidates[0].found || null;
      }, {
        root: doc.documentElement,
        win,
        timeout: 2_500,
        attributes: true,
      });

      if (state.adaptiveCancelled) {
        closeModelMenu(picker);
        toast('Adaptive send cancelled. Your draft is unchanged.');
        return false;
      }
      const validation = validateSendSnapshot(snapshot);
      if (!validation.ok) {
        closeModelMenu(picker);
        toast(`${validation.reason} It was not sent.`, 7_000);
        return false;
      }
      const thinkingOption = routingStage === 0 && targetRank >= ROUTE_LEVEL_RANK.medium && targetRank <= ROUTE_LEVEL_RANK.ultra &&
        (options || []).find((option) => optionLevel(option) === 'medium' && /\bthinking\b/iu.test(accessibleText(option)));
      const hasDirectEffortOption = (options || []).some((option) => {
        const rank = modelLevelRank(optionLevel(option));
        return rank >= ROUTE_LEVEL_RANK.high && rank <= ROUTE_LEVEL_RANK.ultra;
      });
      const stagedThinkingChoice = thinkingOption && !hasDirectEffortOption
        ? chooseModelOption([thinkingOption], 'medium', 'highest')
        : null;
      const choice = stagedThinkingChoice || chooseModelOption(options || [], target, manual ? 'highest' : state.settings.autoMaxLevel);
      if (!choice || !choice.element) {
        closeModelMenu(picker);
        if (routingIsStrict(decision)) {
          toast(`The requested ${modelLevelLabel(target)} level is not available in this account’s current model menu. Your draft was not sent.`, 8_000);
          return false;
        }
        if (!silent) toast('No compatible Auto level was visible, so this message used the current model.', 6_000);
        return replayNativeSend(snapshot, decision, current || 'unknown', manual, 'no compatible option; used current');
      }
      if (!stagedThinkingChoice && decision.explicit && decision.target !== 'max' && choice.level !== target) {
        closeModelMenu(picker);
        toast(`${modelLevelLabel(target)} is not available as an exact option in the current picker. Your explicit-route draft was not sent.`, 8_000);
        return false;
      }

      let selectionConfirmed = choice.level === current;
      if (choice.level !== current) {
        programmaticClick(choice.element);
        await new Promise((resolve) => win.setTimeout(resolve, 100));
        selectionConfirmed = Boolean(await waitForCondition(() => {
          if (stagedThinkingChoice) {
            const effortPicker = findReasoningPicker(doc);
            if (effortPicker) return effortPicker;
            const basePicker = findModelPicker(doc);
            if (basePicker && /\bthinking\b/iu.test(accessibleText(basePicker))) return basePicker;
          }
          const updated = currentRoutingPicker();
          const selected = extractModelLevel(accessibleText(updated));
          if (selected === choice.level || choice.level === 'instant' && selected === 'auto') return updated || doc.documentElement;
          return null;
        }, {
          root: doc.documentElement,
          win,
          timeout: 500,
          attributes: true,
        }));
      } else {
        closeModelMenu(picker);
      }

      const after = validateSendSnapshot(snapshot);
      if (!after.ok) {
        toast(`${after.reason} It was not sent.`, 7_000);
        return false;
      }
      const reflected = extractModelLevel(accessibleText(currentRoutingPicker()));
      const confirmed = selectionConfirmed || reflected === choice.level || choice.level === 'instant' && reflected === 'auto';
      if (!confirmed) {
        closeModelMenu(picker);
        if (routingIsStrict(decision)) {
          toast(`ChatGPT did not confirm ${modelLevelLabel(choice.level)}. Your draft was not sent.`, 8_000);
          return false;
        }
        if (!silent) toast('ChatGPT did not confirm the Auto switch, so this message used the current model.', 6_000);
        return replayNativeSend(snapshot, decision, reflected || current || 'unknown', manual, 'model switch unconfirmed; used current');
      }
      if (stagedThinkingChoice) {
        await waitForCondition(() => findReasoningPicker(doc), {
          root: composerScope(findComposer(doc)) || doc.documentElement,
          win,
          timeout: 500,
          attributes: true,
        });
        if (state.adaptiveCancelled) {
          toast('Adaptive send cancelled. Your draft is unchanged.');
          return false;
        }
        const stagedValidation = validateSendSnapshot(snapshot);
        if (!stagedValidation.ok) {
          toast(`${stagedValidation.reason} It was not sent.`, 7_000);
          return false;
        }
        return routeAndReplay(snapshot, decision, manual, silent, routingStage + 1);
      }
      const reason = `${decision.reasons && decision.reasons.slice(0, 2).join(' + ') || 'prompt complexity'}${choice.fallback ? `; ${modelLevelLabel(target)} unavailable` : ''}`;
      return replayNativeSend(snapshot, decision, choice.level, manual, reason);
    }

    async function smartRouteAndSend(options = {}) {
      if (state.replayingSend) return false;
      if (state.adaptiveSendPromise) return state.adaptiveSendPromise;
      const composer = options.composer && options.composer.isConnected ? options.composer : findComposer(doc);
      const snapshot = captureSendSnapshot(composer);
      if (!snapshot) return false;
      state.adaptiveCancelled = false;

      const task = Promise.resolve().then(async () => {
        const explicitDecision = classifyPrompt(snapshot.draft, {
          previousLevel: previousRouteLevel(),
          attachmentCount: snapshot.attachmentCount,
        });
        const decision = explicitDecision;
        if (!state.settings.adaptiveRouting && !explicitDecision.explicit) {
          return replayNativeSend(snapshot, decision, extractModelLevel(accessibleText(findModelPicker(doc))) || 'unknown', false, 'Adaptive Auto disabled');
        }
        return routeAndReplay(snapshot, decision, false, options.silent === true);
      });
      state.adaptiveSendPromise = task;
      syncSettingsUI();
      try {
        return await task;
      } finally {
        if (state.adaptiveSendPromise === task) state.adaptiveSendPromise = null;
        syncSettingsUI();
      }
    }

    function openQuestion(turn, selectedText = '') {
      if (isReadOnlyChatPage(win.location.href)) {
        toast('Shared ChatGPT pages are read-only. Open a signed-in conversation before using Workflow Toolkit.');
        return;
      }
      if (!turn) {
        toast('No completed ChatGPT response is available to branch yet.');
        return;
      }
      state.activeTurn = turn;
      state.focusReturn = doc.activeElement;
      const textarea = element('#cgs-question');
      textarea.value = buildSelectedQuestion(selectedText);
      element('#cgs-dialog-autosend').checked = state.settings.autoSend;
      element('#cgs-context-mode').value = selectedText ? 'latest' : 'clicked';
      element('#cgs-dialog-backdrop').hidden = false;
      win.setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }, 0);
    }

    function closeQuestion(restoreFocus = true) {
      element('#cgs-dialog-backdrop').hidden = true;
      state.activeTurn = null;
      if (restoreFocus && state.focusReturn && state.focusReturn.isConnected) state.focusReturn.focus();
      state.focusReturn = null;
    }

    function openSettings() {
      syncSettingsUI();
      const backdrop = element('#cgs-settings-backdrop');
      if (!backdrop || !backdrop.hidden) return;
      state.focusReturn = doc.activeElement;
      backdrop.hidden = false;
      win.setTimeout(() => {
        const closeButton = element('[data-cgs-action="close-settings"]');
        if (closeButton) closeButton.focus();
      }, 0);
    }

    function closeSettings(restoreFocus = true) {
      const backdrop = element('#cgs-settings-backdrop');
      if (!backdrop || backdrop.hidden) return;
      backdrop.hidden = true;
      if (restoreFocus && state.focusReturn && state.focusReturn.isConnected) state.focusReturn.focus();
      state.focusReturn = null;
    }

    function hideSelectionPill() {
      const pill = element('#cgs-selection-pill');
      if (pill) pill.hidden = true;
      state.selectedTurn = null;
      state.selectedQuote = '';
    }

    function openHandoff() {
      if (isReadOnlyChatPage(win.location.href)) {
        toast('Shared ChatGPT pages are read-only. Open a signed-in conversation before continuing.');
        return;
      }
      if (hasActiveGeneration(doc)) {
        toast('Wait for ChatGPT to finish before preparing a fresh-chat continuation.');
        return;
      }
      if (!getCompletedAssistantTurns(doc).length) {
        toast('Continue in fresh chat becomes available after ChatGPT completes a response.');
        return;
      }
      if (state.freshContinuationPromise) {
        toast('The fresh-chat handoff is already being prepared.');
        return;
      }
      state.focusReturn = doc.activeElement;
      element('#cgs-handoff-backdrop').hidden = false;
      win.setTimeout(() => element('[data-cgs-action="confirm-fresh-chat"]').focus(), 0);
    }

    function closeHandoff(restoreFocus = true) {
      element('#cgs-handoff-backdrop').hidden = true;
      if (restoreFocus && state.focusReturn && state.focusReturn.isConnected) state.focusReturn.focus();
      state.focusReturn = null;
    }

    function sendComposerDirectly(composer) {
      const sendButton = findSendButton(doc, composer);
      if (!sendButton || sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') return false;
      armSubmitReplayPermit(composer, 'fresh-handoff');
      state.replayingSend = true;
      try {
        sendButton.click();
        return true;
      } finally {
        state.replayingSend = false;
      }
    }

    function isHandoffRequestTurn(turn) {
      const signature = 'Create a compact, self-contained handoff for continuing this conversation in a brand-new chat.';
      return roleOfTurn(turn) === 'user' && normalizeText(accessibleText(turn)).startsWith(signature);
    }

    function waitForFreshAssistant(sourceRoute, baselineUserCount, baselineRequestCount) {
      return new Promise((resolve) => {
        const startedAt = Date.now();
        let observer = null;
        let checkTimer = null;
        let timeoutTimer = null;
        let candidate = null;
        let candidateText = '';
        let stableSince = 0;
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          if (observer) observer.disconnect();
          if (checkTimer) win.clearTimeout(checkTimer);
          if (timeoutTimer) win.clearTimeout(timeoutTimer);
          resolve(value);
        };
        const scheduleCheck = (delay = 180) => {
          if (settled || checkTimer) return;
          checkTimer = win.setTimeout(() => {
            checkTimer = null;
            check();
          }, delay);
        };
        const check = () => {
          if (routeKey(win.location.href) !== sourceRoute) {
            finish({ error: 'The conversation changed before the handoff finished.' });
            return;
          }
          const turns = getTurns(doc);
          const users = turns.filter((turn) => roleOfTurn(turn) === 'user');
          const userCount = users.length;
          if (userCount > baselineUserCount + 1) {
            finish({ error: 'Another message was sent before the handoff finished.' });
            return;
          }
          const requests = users.filter(isHandoffRequestTurn);
          if (userCount > baselineUserCount && requests.length <= baselineRequestCount) {
            finish({ error: 'ChatGPT did not post the expected handoff request.' });
            return;
          }
          const request = requests.length > baselineRequestCount ? requests[requests.length - 1] : null;
          const requestIndex = request ? turns.indexOf(request) : -1;
          const laterTurns = requestIndex >= 0 ? turns.slice(requestIndex + 1) : [];
          if (laterTurns.some((turn) => roleOfTurn(turn) === 'user')) {
            finish({ error: 'Another message was sent before the handoff finished.' });
            return;
          }
          const next = laterTurns.find((turn) => roleOfTurn(turn) === 'assistant') || null;
          const text = next && !hasActiveGeneration(doc) ? extractAssistantHandoff(next) : '';
          if (next && text) {
            if (candidate === next && candidateText === text) {
              if (Date.now() - stableSince >= freshStabilityMs) finish({ turn: next, text });
              else scheduleCheck(Math.max(20, freshStabilityMs - (Date.now() - stableSince)));
            } else {
              candidate = next;
              candidateText = text;
              stableSince = Date.now();
              scheduleCheck(freshStabilityMs);
            }
          } else {
            candidate = null;
            candidateText = '';
            stableSince = 0;
          }
        };
        if (win.MutationObserver) {
          observer = new win.MutationObserver(() => scheduleCheck());
          observer.observe(doc.querySelector('main') || doc.body || doc.documentElement, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['data-is-streaming', 'data-streaming', 'data-message-author-role', 'data-testid', 'aria-label'],
          });
        }
        timeoutTimer = win.setTimeout(() => {
          finish({ error: 'ChatGPT did not finish the handoff in time.' });
        }, Math.max(1, freshResponseTimeout - (Date.now() - startedAt)));
        check();
      });
    }

    async function continueInFreshChat() {
      if (state.freshContinuationPromise) return state.freshContinuationPromise;
      const task = (async () => {
        closeHandoff(false);
        if (isReadOnlyChatPage(win.location.href)) {
          toast('Fresh-chat continuation requires a signed-in, editable conversation.');
          return false;
        }
        if (hasActiveGeneration(doc)) {
          toast('Wait for ChatGPT to finish its current response, then try again.');
          return false;
        }
        const baselineTurns = getCompletedAssistantTurns(doc);
        if (!baselineTurns.length) {
          toast('A completed ChatGPT response is required before continuing in a fresh chat.');
          return false;
        }
        const composer = findComposer(doc);
        if (!composer) {
          toast('Could not find ChatGPT’s message box. Open a normal chat and try again.');
          return false;
        }
        if (getComposerText(composer).trim()) {
          toast('Your message box already has a draft. Send, save, or clear it before continuing in a fresh chat.', 8_000);
          composer.focus();
          return false;
        }
        if (attachmentState(composer).count) {
          toast('Remove or send the staged attachment before continuing in a fresh chat.', 8_000);
          composer.focus();
          return false;
        }
        const sourceRoute = routeKey(win.location.href);
        const sourceTurns = getTurns(doc);
        const baselineUserCount = sourceTurns.filter((turn) => roleOfTurn(turn) === 'user').length;
        const baselineRequestCount = sourceTurns.filter(isHandoffRequestTurn).length;
        if (!setComposerText(composer, HANDOFF_PROMPT, win) || !composerTextEquals(composer, HANDOFF_PROMPT)) {
          toast('ChatGPT did not accept the handoff request. Nothing was sent.');
          return false;
        }
        const readySend = await waitForCondition(() => {
          const button = findSendButton(doc, composer);
          return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' ? button : null;
        }, { root: composerScope(composer) || doc.documentElement, win, timeout: 5_000, attributes: true });
        if (!readySend || !sendComposerDirectly(composer)) {
          toast('The handoff request is ready, but ChatGPT’s Send button was unavailable. Press Send or try again.', 8_000);
          composer.focus();
          return false;
        }
        toast('Creating a compact handoff, then switching this tab…', 10_000);
        const result = await waitForFreshAssistant(sourceRoute, baselineUserCount, baselineRequestCount);
        if (!result || !result.text) {
          toast(result && result.error || 'ChatGPT did not produce a usable handoff. This chat was left open.', 9_000);
          return false;
        }
        const currentComposer = findComposer(doc);
        if (!currentComposer || getComposerText(currentComposer).trim() || attachmentState(currentComposer).count) {
          toast('A new draft or attachment appeared while the handoff was being created, so this chat was left open.', 9_000);
          if (currentComposer) currentComposer.focus();
          return false;
        }
        const id = createJobId();
        const job = sanitizeFreshHandoff({ version: 1, id, createdAt: Date.now(), handoff: result.text }, Date.now(), id);
        const targetUrl = urlWithFreshLaunch(win.location.href, id);
        const storageKey = freshHandoffStorageKey(id);
        if (!job || !targetUrl || !storageKey || !await Promise.resolve(freshStorageSet(storageKey, job))) {
          toast('Workflow Toolkit could not save the one-time handoff. This chat was left open.', 9_000);
          return false;
        }
        try { await trackFreshJob(job); } catch (_error) { /* The transfer can proceed without the expiry index. */ }
        const navigationComposer = findComposer(doc);
        if (routeKey(win.location.href) !== sourceRoute || !navigationComposer || getComposerText(navigationComposer).trim() ||
          attachmentState(navigationComposer).count) {
          await deleteFreshJob(id);
          toast('The conversation, draft, or attachments changed before the new chat opened, so this chat was left open.', 9_000);
          if (navigationComposer) navigationComposer.focus();
          return false;
        }
        try {
          const navigated = await Promise.resolve(navigateCurrent(targetUrl));
          if (navigated === false) throw new Error('navigation rejected');
        } catch (_error) {
          await deleteFreshJob(id);
          toast('The new chat could not be opened. This chat was left open.', 9_000);
          return false;
        }
        return true;
      })().catch((error) => {
        if (win.console && typeof win.console.error === 'function') {
          win.console.error('[ChatGPT Workflow Toolkit] Fresh-chat continuation failed:', error);
        }
        toast('The fresh-chat handoff stopped unexpectedly. This chat was left open.', 9_000);
        return false;
      });
      state.freshContinuationPromise = task;
      state.freshTransferPromise = task;
      scheduleDockAvailability();
      try {
        return await task;
      } finally {
        if (state.freshContinuationPromise === task) state.freshContinuationPromise = null;
        scheduleDockAvailability();
      }
    }

    async function consumeFreshLaunch(capturedJobId = '') {
      const id = isValidJobId(capturedJobId) ? capturedJobId : parseFreshJobId(win.location.href);
      if (!id) return false;
      const storageKey = freshHandoffStorageKey(id);
      const raw = await Promise.resolve(freshStorageGet(storageKey, null));
      const job = sanitizeFreshHandoff(raw, Date.now(), id);
      if (!job) {
        await deleteFreshJob(id);
        try { win.history.replaceState(win.history.state, '', canonicalPageUrl(win.location.href)); } catch (_error) { /* Random ID only. */ }
        toast('This fresh-chat handoff expired. Return to the original chat and try again.', 8_000);
        return false;
      }
      const prompt = buildFreshContinuationPrompt(job.handoff);
      const composer = await waitForCondition(() => findComposer(doc), {
        root: doc.documentElement,
        win,
        timeout: 20_000,
        attributes: true,
      });
      if (!composer) {
        toast('The fresh chat opened, but its message box was not available.', 8_000);
        return false;
      }
      const existing = getComposerText(composer).trim();
      if (existing && existing !== prompt) {
        toast('The fresh chat already has a draft, so Workflow Toolkit did not replace it.', 8_000);
        composer.focus();
        return false;
      }
      if (!setComposerText(composer, prompt, win) || !composerTextEquals(composer, prompt)) {
        toast('ChatGPT did not keep the handoff in its message box.', 8_000);
        return false;
      }
      const sendButton = await waitForCondition(() => {
        const button = findSendButton(doc, composer);
        return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' ? button : null;
      }, { root: composerScope(composer) || doc.documentElement, win, timeout: 10_000, attributes: true });
      const baselineUserCount = getTurns(doc).filter((turn) => roleOfTurn(turn) === 'user').length;
      if (!sendButton || !sendComposerDirectly(composer)) {
        toast('The handoff is ready. ChatGPT’s Send button was unavailable, so press Send once it is ready.', 9_000);
        composer.focus();
        return false;
      }
      const acknowledged = await waitForCondition(() => {
        const current = findComposer(doc);
        if (current && !getComposerText(current).trim()) return current;
        const users = getTurns(doc).filter((turn) => roleOfTurn(turn) === 'user');
        const latest = users.length > baselineUserCount ? users[users.length - 1] : null;
        return latest && normalizeText(accessibleText(latest)).startsWith('Continue the previous conversation from the handoff below.')
          ? latest
          : null;
      }, { root: doc.documentElement, win, timeout: 8_000, attributes: true });
      if (!acknowledged) {
        toast('The handoff is still in the message box because ChatGPT did not confirm Send. Press Send once when ready.', 9_000);
        composer.focus();
        return false;
      }
      await deleteFreshJob(id);
      try { win.history.replaceState(win.history.state, '', canonicalPageUrl(win.location.href)); } catch (_error) { /* Random ID only. */ }
      toast('Continuing in this fresh chat.');
      return true;
    }

    function updateSelectionPill() {
      if (!state.settings.showTurnButtons) return hideSelectionPill();
      const selection = win.getSelection && win.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return hideSelectionPill();
      const turn = closestAssistantTurn(selection.anchorNode);
      if (!turn || !turn.contains(selection.focusNode) || state.root.contains(selection.anchorNode)) return hideSelectionPill();
      const quote = String(selection.toString() || '').trim();
      if (!quote) return hideSelectionPill();
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) return hideSelectionPill();
      state.selectedTurn = turn;
      state.selectedQuote = quote.slice(0, SELECTED_QUOTE_MAX_LENGTH);
      const pill = element('#cgs-selection-pill');
      pill.style.left = `${Math.min(win.innerWidth - 55, Math.max(55, rect.left + rect.width / 2))}px`;
      pill.style.top = `${Math.max(42, rect.top - 7)}px`;
      pill.hidden = false;
    }

    function openChildWindow(url, mode, jobId) {
      const smallScreen = Number(win.screen && win.screen.availWidth) < 900;
      const usePopup = mode === 'popup' && !smallScreen;
      let features = '';
      if (usePopup) {
        const screen = win.screen || {};
        const availableWidth = Number(screen.availWidth) || 1440;
        const availableHeight = Number(screen.availHeight) || 900;
        const width = Math.max(480, Math.min(760, Math.floor(availableWidth * 0.44)));
        const height = Math.max(620, Math.min(availableHeight, 1_000));
        const left = (Number(screen.availLeft) || 0) + availableWidth - width;
        const top = Number(screen.availTop) || 0;
        features = `popup=yes,resizable=yes,scrollbars=yes,width=${width},height=${height},left=${left},top=${top}`;
      }
      const child = win.open(url, `chatgpt-workflow-toolkit-${jobId}`, features);
      if (child) {
        try { child.opener = null; } catch (_error) { /* Cross-origin redirect can race this assignment. */ }
        try { child.focus(); } catch (_error) { /* Browser focus policies are allowed to win. */ }
      }
      return child;
    }

    function reserveBranchWindow() {
      const jobId = createJobId();
      return {
        jobId,
        child: openChildWindow('about:blank', state.settings.openMode, jobId),
      };
    }

    function closeReservedWindow(reservation) {
      if (!reservation || !reservation.child) return;
      try { reservation.child.close(); } catch (_error) { /* A browser-owned tab may already be closed. */ }
    }

    function navigateReservedWindow(reservation, url) {
      if (!reservation || !reservation.child || reservation.child.closed) return false;
      try {
        reservation.child.location.replace(url);
        reservation.child.focus();
        return true;
      } catch (_error) {
        try {
          reservation.child.location.href = url;
          return true;
        } catch (_secondError) {
          return false;
        }
      }
    }

    async function launchBranch(turn, options = {}) {
      const reservation = options.reservation || null;
      if (isReadOnlyChatPage(win.location.href)) {
        closeReservedWindow(reservation);
        toast('Native branching requires a signed-in, editable ChatGPT conversation.');
        return false;
      }
      if (!turn || isTurnStreaming(turn, doc)) {
        closeReservedWindow(reservation);
        toast('Wait for ChatGPT to finish the response before branching it.');
        return false;
      }
      const locator = getTurnLocator(turn, doc);
      if (!locator) {
        closeReservedWindow(reservation);
        toast('Could not identify the response to branch.');
        return false;
      }
      if (reservation && !reservation.child) {
        toast('The browser blocked the side window. Allow popups for chatgpt.com or choose New tab in Workflow Toolkit settings.', 7_000);
        return false;
      }
      const jobId = reservation ? reservation.jobId : createJobId();
      const sourceUrl = canonicalPageUrl(win.location.href);
      const job = sanitizeJob({
        version: 1,
        createdAt: Date.now(),
        sourceUrl,
        kind: options.kind === 'continue' ? 'continue' : 'ask',
        locator,
        question: String(options.question || ''),
        autoSend: options.autoSend === true,
      });
      if (!job || !await storageSet(`${JOB_PREFIX}${jobId}`, job)) {
        closeReservedWindow(reservation);
        toast('Workflow Toolkit could not save the one-time branch handoff. Check userscript storage permissions.');
        return false;
      }
      await trackJob(jobId, job.createdAt);

      const targetUrl = urlWithJob(sourceUrl, jobId);
      const child = reservation
        ? (navigateReservedWindow(reservation, targetUrl) ? reservation.child : null)
        : openChildWindow(targetUrl, state.settings.openMode, jobId);
      if (!child) {
        closeReservedWindow(reservation);
        await deleteTrackedJob(jobId);
        toast('The browser blocked the side window. Allow popups for chatgpt.com or choose New tab in Workflow Toolkit settings.', 7_000);
        return false;
      }
      win.setTimeout(async () => {
        await deleteTrackedJob(jobId);
      }, JOB_MAX_AGE_MS + 5_000);
      toast(options.kind === 'continue' ? 'Opening a separate native branch…' : 'Opening your side question in a native branch…');
      return true;
    }

    async function fillQuestion(job, fromRecovery = false, suppliedComposer = null) {
      if (!job.question) {
        if (fromRecovery) closeRecovery();
        toast('Branch ready.');
        return true;
      }
      let composer = suppliedComposer || await waitForCondition(() => findComposer(doc), {
        root: doc.documentElement,
        win,
        timeout: 20_000,
      });
      if (!composer) {
        showRecovery(job, 'The branch opened, but Workflow Toolkit could not find ChatGPT’s message box.');
        return false;
      }

      if (!setComposerText(composer, job.question, win)) {
        showRecovery(job, 'The branch opened, but ChatGPT did not accept the saved question automatically.');
        return false;
      }

      await new Promise((resolve) => win.setTimeout(resolve, 250));
      if (!composer.isConnected || !composerTextEquals(composer, job.question)) {
        const replacement = await waitForStableComposer(doc, win, composer, 5_000);
        if (!replacement || !setComposerText(replacement, job.question, win)) {
          showRecovery(job, 'ChatGPT replaced its message box during the branch transition. Your saved question is still available here.');
          return false;
        }
        composer = replacement;
        await new Promise((resolve) => win.setTimeout(resolve, 200));
        if (!composer.isConnected || !composerTextEquals(composer, job.question)) {
          showRecovery(job, 'ChatGPT’s message box did not keep the saved question.');
          return false;
        }
      }

      if (fromRecovery) closeRecovery();

      if (!job.autoSend) {
        toast(job.kind === 'continue' ? 'Branch ready — your draft was carried over.' : 'Side question ready — review it and press Send.');
        composer.focus();
        return true;
      }

      const sendButton = await waitForCondition(() => {
        const button = findSendButton(doc, composer);
        return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' ? button : null;
      }, {
        root: composerScope(composer) || doc.documentElement,
        win,
        timeout: 5_000,
        attributes: true,
      });
      if (!sendButton) {
        toast('Side question is ready. ChatGPT’s Send button was not available, so press Send when ready.', 7_000);
        composer.focus();
        return true;
      }
      const sent = await smartRouteAndSend({ composer, silent: true });
      if (!sent) {
        toast('Side question is ready, but Adaptive Auto did not send it. Review the draft and press Send.', 7_000);
        composer.focus();
        return true;
      }
      toast('Side question sent in the separate branch.');
      return true;
    }

    function showRecovery(job, reason, turn = state.recoveryTurn) {
      state.recoveryJob = job;
      state.recoveryTurn = turn || state.recoveryTurn;
      if (state.recoveryTurn && state.recoveryTurn.isConnected) state.recoveryTurn.classList.add('cgs-branch-target');
      element('#cgs-recovery-reason').textContent = reason;
      const question = element('#cgs-recovery-question');
      question.value = job.question || '(No saved draft — finish the branch and continue normally.)';
      element('#cgs-recovery-backdrop').hidden = false;
    }

    function closeRecovery() {
      element('#cgs-recovery-backdrop').hidden = true;
      if (state.recoveryTurn) state.recoveryTurn.classList.remove('cgs-branch-target');
      state.recoveryJob = null;
      state.recoveryTurn = null;
    }

    async function runIncomingJob(job) {
      const turn = await waitForCondition(() => locateTurn(doc, job.locator), {
        root: doc.documentElement,
        win,
        timeout: 15_000,
        attributes: true,
      });
      if (!turn) {
        showRecovery(job, 'ChatGPT did not render the response Workflow Toolkit was asked to branch from.');
        return false;
      }
      state.recoveryTurn = turn;
      const before = routeKey(win.location.href);
      const beforeComposer = findComposer(doc);
      const clickResult = await clickNativeBranch(doc, win, turn);
      if (!clickResult.ok) {
        showRecovery(job, clickResult.reason, turn);
        return false;
      }
      const changedRoute = await waitForRouteChange(win, before, 15_000);
      if (!changedRoute) {
        showRecovery(job, 'ChatGPT did not confirm a new branch after the menu action.', turn);
        return false;
      }
      turn.classList.remove('cgs-branch-target');
      state.recoveryTurn = null;
      const branchComposer = await waitForStableComposer(doc, win, beforeComposer, 20_000);
      if (!branchComposer) {
        showRecovery(job, 'The branch opened, but its message box did not become ready.');
        return false;
      }
      const completed = await fillQuestion(job, false, branchComposer);
      if (completed) await finishIncomingJob();
      return completed;
    }

    async function finishIncomingJob() {
      const jobId = state.incomingJobId;
      if (!jobId) return;
      await deleteTrackedJob(jobId);
      state.incomingJobId = '';
      try {
        if (parseJobId(win.location.href)) {
          win.history.replaceState(win.history.state, '', canonicalPageUrl(win.location.href));
        }
      } catch (_error) {
        // The fragment contains only a random handoff ID.
      }
    }

    async function consumeIncomingJob(capturedJobId = '') {
      const jobId = isValidJobId(capturedJobId) ? capturedJobId : parseJobId(win.location.href);
      if (!jobId) return;
      const raw = await storageGet(`${JOB_PREFIX}${jobId}`, null);
      const job = sanitizeJob(raw);
      if (!job) {
        await deleteTrackedJob(jobId);
        try { win.history.replaceState(win.history.state, '', canonicalPageUrl(win.location.href)); } catch (_error) { /* Safe fixed-format fragment. */ }
        toast('This Workflow Toolkit branch request expired. Return to the original chat and try again.');
        return;
      }
      state.incomingJobId = jobId;
      await runIncomingJob(job);
    }

    async function handleSettingChange(target) {
      const key = target.dataset.cgsSetting;
      if (!key) return;
      const next = { ...state.settings };
      next[key] = target.type === 'checkbox' ? target.checked : target.value;
      state.settings = sanitizeSettings(next);
      if (key === 'adaptiveRouting' && !state.settings.adaptiveRouting) {
        if (state.adaptiveSendPromise) state.adaptiveCancelled = true;
        state.submitReplayPermit = null;
      }
      await saveSettings();
      syncSettingsUI();
      if (key === 'hideStartWriting') {
        if (state.settings.hideStartWriting) scheduleScan(doc.body);
        else restoreStartWriting(doc);
      }
      if (key === 'showTurnButtons') {
        if (state.settings.showTurnButtons) scheduleScan(doc.body);
        else {
          removeTurnButtons(doc);
          hideSelectionPill();
        }
      }
      if (key === 'adaptiveRouting') {
        toast(state.settings.adaptiveRouting
          ? 'Adaptive Auto enabled. Each message is classified locally when you press Send.'
          : 'Adaptive Auto disabled. ChatGPT will keep using your current model selection.');
      }
    }

    function adaptiveApplies(composer) {
      if (!composer) return false;
      return state.settings.adaptiveRouting || Boolean(parseRouteOverride(getComposerText(composer)));
    }

    function composerContainsTarget(composer, target) {
      const node = target && (target.nodeType === 1 ? target : target.parentElement);
      return Boolean(composer && node && (node === composer || composer.contains(node)));
    }

    function beginAdaptiveSend(event, composer, options = {}) {
      if (state.replayingSend) return false;
      const bypass = options.altKey || event && event.altKey;
      if (bypass) {
        if (adaptiveApplies(composer)) armSubmitReplayPermit(composer, 'alt-bypass');
        return false;
      }
      if (!adaptiveApplies(composer)) return false;
      state.submitReplayPermit = null;
      const snapshot = captureSendSnapshot(composer);
      if (!snapshot || !snapshot.draft.trim() && snapshot.attachmentCount === 0) return false;
      if (event) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      if (!state.adaptiveSendPromise) {
        smartRouteAndSend({ composer }).catch((error) => {
          if (win.console && typeof win.console.error === 'function') win.console.error('[ChatGPT Workflow Toolkit] Adaptive send failed:', error);
          toast('Adaptive Auto hit an unexpected error. Your draft was kept; press Alt+Send to bypass it.', 8_000);
        });
      }
      return true;
    }

    function onAdaptiveClick(event) {
      if (state.replayingSend) return;
      const potentialSend = event.target && event.target.closest && event.target.closest(SEND_BUTTON_SELECTORS.join(', '));
      if (!potentialSend) return;
      const composer = findComposer(doc);
      const sendButton = findSendButton(doc, composer);
      if (!sendButton || potentialSend !== sendButton) return;
      beginAdaptiveSend(event, composer);
    }

    function onAdaptiveKeyDown(event) {
      if (event.key === 'Escape' && state.adaptiveSendPromise) {
        state.adaptiveCancelled = true;
        return;
      }
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      const composer = findComposer(doc);
      if (!composerContainsTarget(composer, event.target) || state.composingComposer === composer) return;
      if (event.altKey) {
        beginAdaptiveSend(null, composer, { altKey: true });
        return;
      }
      const sendButton = findSendButton(doc, composer);
      if (!sendButton || sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') return;
      const activeDescendantId = normalizeText(composer.getAttribute('aria-activedescendant'));
      const activeDescendant = activeDescendantId ? doc.getElementById(activeDescendantId) : null;
      const selectedSuggestion = activeDescendant && isProbablyVisible(activeDescendant)
        ? activeDescendant
        : [...doc.querySelectorAll('[role="option"][aria-selected="true"], [role="option"][data-highlighted], [role="menuitem"][data-highlighted]')]
        .find((node) => isProbablyVisible(node) && !node.closest(`#${UI_ROOT_ID}`));
      if (selectedSuggestion && !event.metaKey && !event.ctrlKey) return;
      beginAdaptiveSend(event, composer);
    }

    function onAdaptiveSubmit(event) {
      const composer = findComposer(doc);
      if (!composer || !event.target || event.target !== composer.closest('form')) return;
      if (consumeSubmitReplayPermit(event, composer)) return;
      if (state.replayingSend) return;
      beginAdaptiveSend(event, composer);
    }

    function onCompositionStart(event) {
      const composer = findComposer(doc);
      if (composerContainsTarget(composer, event.target)) state.composingComposer = composer;
    }

    function onCompositionEnd(event) {
      if (state.composingComposer && composerContainsTarget(state.composingComposer, event.target)) state.composingComposer = null;
    }

    async function onClick(event) {
      const actionNode = event.target.closest && event.target.closest('[data-cgs-action]');
      if (!actionNode) return;
      const action = actionNode.dataset.cgsAction;
      if (action === 'ask-turn') {
        event.preventDefault();
        event.stopPropagation();
        openQuestion(closestAssistantTurn(actionNode));
      } else if (action === 'ask-selection') {
        event.preventDefault();
        const turn = state.selectedTurn;
        const quote = state.selectedQuote;
        hideSelectionPill();
        openQuestion(turn, quote);
      } else if (action === 'open-handoff') {
        openHandoff();
      } else if (action === 'close-handoff') {
        closeHandoff();
      } else if (action === 'confirm-fresh-chat') {
        await continueInFreshChat();
      } else if (action === 'toggle-settings') {
        openSettings();
      } else if (action === 'close-settings') {
        closeSettings();
      } else if (action === 'select-instant') {
        await ensureInstant({ userInitiated: true });
      } else if (action === 'cancel-question') {
        closeQuestion();
      } else if (action === 'submit-question') {
        const question = element('#cgs-question').value.trim();
        if (!question) {
          toast('Type the question you want to ask in the side chat.');
          return element('#cgs-question').focus();
        }
        const reservation = reserveBranchWindow();
        const autoSend = element('#cgs-dialog-autosend').checked;
        state.settings.autoSend = autoSend;
        await saveSettings();
        const clickedTurn = state.activeTurn;
        const contextMode = element('#cgs-context-mode').value;
        const turns = getCompletedAssistantTurns(doc);
        const turn = contextMode === 'clicked' ? clickedTurn : turns[turns.length - 1] || clickedTurn;
        const launched = await launchBranch(turn, { kind: 'ask', question, autoSend, reservation });
        if (launched) closeQuestion(false);
      } else if (action === 'close-recovery') {
        closeRecovery();
        await finishIncomingJob();
      } else if (action === 'retry-branch') {
        const job = state.recoveryJob;
        closeRecovery();
        if (job) await runIncomingJob(job);
      } else if (action === 'insert-recovery') {
        const job = state.recoveryJob;
        if (!job) return;
        if (routeKey(win.location.href) === job.sourceRoute) {
          return toast('Choose “Branch in new chat” first, then click this button again.', 6_000);
        }
        const completed = await fillQuestion(job, true);
        if (completed) await finishIncomingJob();
      }
    }

    function onKeyDown(event) {
      if (event.key === 'Tab') {
        const activeModal = !element('#cgs-dialog-backdrop').hidden
          ? element('#cgs-dialog-backdrop')
          : !element('#cgs-handoff-backdrop').hidden
            ? element('#cgs-handoff-backdrop')
            : !element('#cgs-settings-backdrop').hidden
              ? element('#cgs-settings-backdrop')
              : null;
        if (activeModal) {
          const focusable = [...activeModal.querySelectorAll('button, textarea, select, input, a[href]')]
            .filter((node) => !node.disabled && isProbablyVisible(node));
          if (focusable.length) {
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && doc.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && doc.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }
      }
      if (event.key === 'Escape') {
        if (!element('#cgs-dialog-backdrop').hidden) closeQuestion();
        else if (!element('#cgs-recovery-backdrop').hidden) {
          closeRecovery();
          finishIncomingJob();
        }
        else if (!element('#cgs-handoff-backdrop').hidden) closeHandoff();
        else if (!element('#cgs-settings-backdrop').hidden) closeSettings();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !element('#cgs-dialog-backdrop').hidden) {
        event.preventDefault();
        element('[data-cgs-action="submit-question"]').click();
      }
    }

    function onMouseUp(event) {
      if (state.root.contains(event.target)) return;
      win.requestAnimationFrame(updateSelectionPill);
    }

    function observe() {
      state.observer = new win.MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes') scheduleScan(mutation.target);
          else {
            for (const node of mutation.addedNodes) scheduleScan(node);
            if (mutation.removedNodes.length) scheduleScan(mutation.target);
          }
        }
      });
      state.observer.observe(doc.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['placeholder', 'aria-placeholder', 'data-placeholder', 'aria-label', 'data-message-author-role', 'data-turn', 'data-testid'],
      });
    }

    function registerMenus() {
      const register = injectedMenuRegister || gmRegisterMenuCommand ||
        (global.GM && typeof global.GM.registerMenuCommand === 'function'
          ? global.GM.registerMenuCommand.bind(global.GM)
          : null);
      if (!register) return;
      register('Open Workflow Toolkit settings…', openSettings);
    }

    async function start() {
      state.settings = sanitizeSettings(await storageGet(SETTINGS_KEY, DEFAULT_SETTINGS));
      state.root = createUI(doc);
      syncSettingsUI();
      doc.addEventListener('click', onAdaptiveClick, true);
      doc.addEventListener('keydown', onAdaptiveKeyDown, true);
      doc.addEventListener('submit', onAdaptiveSubmit, true);
      doc.addEventListener('compositionstart', onCompositionStart, true);
      doc.addEventListener('compositionend', onCompositionEnd, true);
      doc.addEventListener('click', onClick, true);
      doc.addEventListener('keydown', onKeyDown, true);
      doc.addEventListener('mouseup', onMouseUp, true);
      state.root.addEventListener('change', (event) => handleSettingChange(event.target));
      observe();
      registerMenus();
      scheduleScan(doc.body);

      await cleanupExpiredJobs();
      await cleanupFreshJobs();
      await consumeFreshLaunch(state.initialFreshJobId);
      await consumeIncomingJob(state.initialJobId);
      return state;
    }

    return {
      start,
      state,
      ensureInstant,
      smartRouteAndSend,
      launchBranch,
      runIncomingJob,
      processRoot,
      toast,
    };
  }

  async function install(doc, win) {
    if (!doc || !win) return null;
    try {
      if (win.top !== win.self) return null;
    } catch (_error) {
      return null;
    }
    if (doc.documentElement.dataset.chatgptWorkflowToolkitInstalled === VERSION) return null;
    if (doc.documentElement.dataset.chatgptSidecarInstalled) {
      if (win.console && typeof win.console.warn === 'function') {
        win.console.warn('[ChatGPT Workflow Toolkit] The earlier ChatGPT Sidecar userscript is still enabled. Disable it before enabling Workflow Toolkit.');
      }
      return null;
    }
    doc.documentElement.dataset.chatgptWorkflowToolkitInstalled = VERSION;
    // If this renamed build starts first, prevent the known earlier build from starting too.
    doc.documentElement.dataset.chatgptSidecarInstalled = LEGACY_INSTALL_VERSION;
    // Capture one-shot fragments before the first await. ChatGPT may
    // canonicalize its SPA URL while the userscript is starting.
    const initialUrl = String(win.location.href);
    const initialJobId = parseJobId(initialUrl);
    const initialFreshJobId = parseFreshJobId(initialUrl);
    await waitForBody(doc, win);
    injectStyles(doc);
    const app = createApp(doc, win, { initialJobId, initialFreshJobId });
    await app.start();
    return app;
  }

  return {
    VERSION,
    DEFAULT_SETTINGS,
    JOB_MAX_AGE_MS,
    FRESH_HANDOFF_MAX_AGE_MS,
    FRESH_HANDOFF_MAX_LENGTH,
    SELECTED_QUOTE_MAX_LENGTH,
    normalizeText,
    sanitizeSettings,
    getTurns,
    roleOfTurn,
    isAssistantTurn,
    getAssistantTurns,
    isTurnStreaming,
    getCompletedAssistantTurns,
    hasActiveGeneration,
    getTurnLocator,
    sanitizeLocator,
    locateTurn,
    closestAssistantTurn,
    quoteForPrompt,
    buildSelectedQuestion,
    extractAssistantHandoff,
    cleanStartWriting,
    restoreStartWriting,
    canonicalPageUrl,
    routeKey,
    isReadOnlyChatPage,
    isAllowedChatGPTUrl,
    isValidJobId,
    freshHandoffStorageKey,
    urlWithJob,
    parseJobId,
    urlWithFreshLaunch,
    parseFreshJobId,
    isFreshLaunch,
    sanitizeFreshHandoff,
    buildFreshContinuationPrompt,
    sanitizeJob,
    accessibleText,
    findComposer,
    getComposerText,
    composerTextEquals,
    setComposerText,
    findSendButton,
    waitForStableComposer,
    extractModelLevel,
    extractPickerLevel,
    modelLevelRank,
    modelLevelLabel,
    parseRouteOverride,
    classifyPrompt,
    chooseModelOption,
    findModelPicker,
    findReasoningPicker,
    findModelOptions,
    findInstantOption,
    findMoreButton,
    isBranchLabel,
    findBranchAction,
    decorateTurn,
    removeTurnButtons,
    createApp,
    install,
  };
});
