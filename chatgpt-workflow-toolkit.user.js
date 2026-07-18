// ==UserScript==
// @name         ChatGPT Workflow Toolkit
// @namespace    https://github.com/atharvj/chatgpt-workflow-toolkit
// @version      1.4.15
// @description  Branch or hand off conversations, ask separately with context, hide Start writing, and adapt model effort per message.
// @author       Intellectual07
// @license      MIT
// @homepageURL  https://github.com/atharvj/chatgpt-workflow-toolkit
// @supportURL   https://github.com/atharvj/chatgpt-workflow-toolkit/issues
// @downloadURL  https://raw.githubusercontent.com/atharvj/chatgpt-workflow-toolkit/main/chatgpt-workflow-toolkit.user.js
// @updateURL    https://raw.githubusercontent.com/atharvj/chatgpt-workflow-toolkit/main/chatgpt-workflow-toolkit.user.js
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

  const VERSION = '1.4.15';
  const LEGACY_INSTALL_VERSION = '1.1.0';
  // Preserve the original storage keys so upgrades retain settings and one-time handoffs.
  const SETTINGS_KEY = 'chatgptSidecar.settings.v1';
  const JOB_INDEX_KEY = 'chatgptSidecar.jobIndex.v1';
  const JOB_PREFIX = 'chatgptSidecar.job.v1.';
  const JOB_LOCK_PREFIX = 'chatgptWorkflowToolkit.sideJob.v1.';
  const JOB_HASH_KEY = 'cwt-job';
  const FRESH_HASH_KEY = 'cwt-fresh';
  const FRESH_HANDOFF_PREFIX = 'chatgptWorkflowToolkit.freshHandoff.v1.';
  const FRESH_HANDOFF_INDEX_KEY = 'chatgptWorkflowToolkit.freshHandoffIndex.v1';
  const JOB_MAX_AGE_MS = 5 * 60 * 1000;
  const FRESH_HANDOFF_MAX_AGE_MS = 10 * 60 * 1000;
  const FRESH_HANDOFF_MAX_LENGTH = 28_000;
  const QUESTION_MAX_LENGTH = 30_000;
  const SIDE_FALLBACK_TRANSCRIPT_MAX_LENGTH = 120_000;
  const SIDE_FALLBACK_PROMPT_MAX_LENGTH = SIDE_FALLBACK_TRANSCRIPT_MAX_LENGTH + QUESTION_MAX_LENGTH + 2_000;
  const TARGET_FINGERPRINT_MAX_LENGTH = 1_200;
  const SELECTED_QUOTE_MAX_LENGTH = 2_000;
  const ACCURACY_GUARD_INSTRUCTION = 'Before explaining, independently verify the stated answer or result. Do not assume it is correct; if it is wrong, say so and give the corrected result.';
  const ROUTE_OVERRIDE_PATTERN = /^\s*!route\s*:\s*(extra\s*-?\s*high|x\s*-?\s*high|xhigh|pro\s*-?\s*extended|pro\s*-?\s*ultra|pro\s*-?\s*standard|instant|medium|high|ultra|pro|max|highest|auto)(?=\s|:|;|$)/iu;
  const USER_ACKNOWLEDGMENT_PATTERN = /^(?:thanks?(?:\s+you)?|thank\s+you|ok(?:ay)?|got\s+it|cool|great|yes|yeah|yep|sure(?:\s+thing)?|absolutely|definitely|sounds\s+good(?:\s+to\s+me)?|that\s+works(?:\s+for\s+me)?|of\s+course|no|hello|hi|hey|bye|go\s+ahead|please\s+do)[.!,\s]*$/iu;
  const SELECTION_PILL_GAP = 7;
  const SELECTION_PILL_MARGIN = 8;
  const SELECTION_PILL_FALLBACK_WIDTH = 112;
  const SELECTION_PILL_FALLBACK_HEIGHT = 30;
  const DOCK_COMPOSER_GAP = 12;
  const DOCK_VIEWPORT_MARGIN = 10;
  const DOCK_FALLBACK_WIDTH = 420;
  const DOCK_FALLBACK_HEIGHT = 48;
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

  const TURN_SELECTOR = '[data-testid^="conversation-turn-"]';
  const ROLE_SELECTOR = '[data-message-author-role]';
  const COMPOSER_SELECTORS = [
    'textarea#prompt-textarea',
    '#prompt-textarea[contenteditable="true"]',
    'main form [contenteditable="true"][role="textbox"]',
    'main form textarea',
  ];
  const LOCAL_COMPOSER_SELECTOR = [
    'textarea',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="plaintext-only"][role="textbox"]',
    '[data-lexical-editor="true"]',
    '.ProseMirror[contenteditable]',
  ].join(', ');
  const SEND_BUTTON_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send message"]',
    'button[aria-label^="Send"]',
  ];
  const SUBMISSION_CONTROL_SELECTOR = 'button, input[type="submit"], [role="button"]';
  const MODEL_OPTION_CONTAINER_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="radio"], [data-radix-collection-item], [data-slot="dropdown-menu-item"], [data-slot="dropdown-menu-radio-item"]';
  const MODEL_OPTION_SELECTOR = `${MODEL_OPTION_CONTAINER_SELECTOR}, button`;
  const MODEL_MENU_ROOT_SELECTOR = '[role="menu"], [role="listbox"], [role="radiogroup"], [data-radix-menu-content], [data-radix-popper-content-wrapper], [data-headlessui-menu-items], [data-slot="dropdown-menu-content"], [data-slot="popover-content"], [data-state="open"][role="dialog"], [data-testid="composer-intelligence-picker-content"], [data-testid*="model-menu"], [data-testid*="model-picker-menu"], [data-testid*="intelligence-menu"]';
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
    #cgs-dock[data-cgs-position-suppressed="true"] { visibility: hidden; pointer-events: none; }
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
    #cgs-handoff-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483002;
      display: grid;
      place-items: center;
      padding: 18px;
      background: rgba(0, 0, 0, .36);
    }
    #cgs-dialog-backdrop {
      position: fixed;
      top: 64px;
      right: 16px;
      bottom: 16px;
      z-index: 2147483002;
      width: min(390px, calc(100vw - 32px));
      pointer-events: none;
    }
    #cgs-dialog-backdrop .cgs-dialog {
      width: 100%;
      max-height: 100%;
      overflow: auto;
      overscroll-behavior: contain;
      pointer-events: auto;
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
    .cgs-dialog-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 15px; }
    .cgs-primary, .cgs-secondary { min-height: 36px; padding: 8px 12px; border-radius: 9px; font-weight: 700; }
    .cgs-primary { color: #fff; background: #10a37f; }
    .cgs-primary:hover { background: #0d8c6d; }
    .cgs-secondary { color: var(--text-primary, #111827); background: var(--main-surface-secondary, rgba(127, 127, 127, .13)); }
    #cgs-selection-pill {
      position: fixed;
      z-index: 2147483001;
      transform: none;
      white-space: nowrap;
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
      top: 18px;
      right: 18px;
      z-index: 2147483004;
      width: max-content;
      max-width: min(520px, calc(100vw - 30px));
      padding: 10px 13px;
      border-radius: 10px;
      color: #fff;
      background: #111827;
      box-shadow: 0 10px 32px rgba(0, 0, 0, .22);
      font-size: 12px;
      text-align: center;
      pointer-events: none;
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
    #cgs-recovery-backdrop .cgs-recovery-note {
      padding: 9px 10px;
      border: 1px solid rgba(245, 158, 11, .38);
      border-color: color-mix(in srgb, #f59e0b 42%, transparent);
      border-radius: 9px;
      color: var(--text-primary, #111827);
      background: var(--main-surface-secondary, #fff4d6);
      background: color-mix(in srgb, #f59e0b 18%, var(--main-surface-primary, #fff));
      font-size: 12px;
    }
    @media (max-width: 1100px) {
      #cgs-dialog-backdrop {
        top: auto;
        right: 12px;
        bottom: 12px;
        left: 12px;
        width: auto;
        height: min(48vh, 420px);
        height: min(48dvh, 420px);
        max-height: calc(100vh - 24px);
        max-height: calc(100dvh - 24px);
        overflow: hidden;
      }
      #cgs-dialog-backdrop .cgs-dialog { height: 100%; max-height: none; }
    }
    @media (max-width: 720px) {
      #cgs-dock { right: 10px; bottom: 68px; }
      .cgs-dock-label, .cgs-auto-badge { display: none; }
      #cgs-dialog-backdrop { right: 8px; bottom: 8px; left: 8px; height: min(50vh, 380px); height: min(50dvh, 380px); }
      #cgs-toast { top: 10px; right: 10px; left: 10px; width: auto; max-width: none; }
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

  function separateAdjacentLevelBadge(value) {
    return String(value == null ? '' : value).replace(
      /\b(instant|fast|auto|thinking|medium|standard|high|extended|heavy|ultra|pro)(?=\d+(?:\.\d+)+)/giu,
      '$1 ',
    );
  }

  function clampInteger(value, fallback, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.trunc(number)));
  }

  function chooseDockPosition(surfaceRect, dockSize = {}, viewportSize = {}) {
    const finite = (value, fallback = 0) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    };
    const viewportWidth = finite(viewportSize.width);
    const viewportHeight = finite(viewportSize.height);
    const surfaceTop = finite(surfaceRect && surfaceRect.top, -1);
    const surfaceRight = finite(surfaceRect && surfaceRect.right, -1);
    if (viewportWidth <= DOCK_VIEWPORT_MARGIN * 2 || viewportHeight <= DOCK_VIEWPORT_MARGIN * 2 ||
      surfaceTop < 0 || surfaceTop >= viewportHeight || surfaceRight <= 0) return null;

    const positive = (value, fallback) => {
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number : fallback;
    };
    const dockWidth = Math.min(
      viewportWidth - DOCK_VIEWPORT_MARGIN * 2,
      positive(dockSize.width, DOCK_FALLBACK_WIDTH),
    );
    const dockHeight = Math.min(
      viewportHeight - DOCK_VIEWPORT_MARGIN * 2,
      positive(dockSize.height, DOCK_FALLBACK_HEIGHT),
    );
    const maximumRight = Math.max(DOCK_VIEWPORT_MARGIN, viewportWidth - dockWidth - DOCK_VIEWPORT_MARGIN);
    const right = Math.min(maximumRight, Math.max(DOCK_VIEWPORT_MARGIN, viewportWidth - surfaceRight));
    const bottom = viewportHeight - surfaceTop + DOCK_COMPOSER_GAP;
    return {
      right: Math.round(right),
      bottom: Math.round(bottom),
      hidden: surfaceTop - DOCK_COMPOSER_GAP - dockHeight < DOCK_VIEWPORT_MARGIN,
    };
  }

  function chooseSelectionPillPosition(selectionRect, pillSize = {}, viewportSize = {}) {
    const finite = (value, fallback) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    };
    const viewportWidth = Math.max(SELECTION_PILL_MARGIN * 2 + 1, finite(viewportSize.width, 0));
    const viewportHeight = Math.max(SELECTION_PILL_MARGIN * 2 + 1, finite(viewportSize.height, 0));
    const pillWidth = Math.min(
      viewportWidth - SELECTION_PILL_MARGIN * 2,
      Math.max(1, finite(pillSize.width, SELECTION_PILL_FALLBACK_WIDTH)),
    );
    const pillHeight = Math.min(
      viewportHeight - SELECTION_PILL_MARGIN * 2,
      Math.max(1, finite(pillSize.height, SELECTION_PILL_FALLBACK_HEIGHT)),
    );
    const left = finite(selectionRect && selectionRect.left, 0);
    const top = finite(selectionRect && selectionRect.top, 0);
    const right = finite(
      selectionRect && selectionRect.right,
      left + Math.max(0, finite(selectionRect && selectionRect.width, 0)),
    );
    const bottom = finite(
      selectionRect && selectionRect.bottom,
      top + Math.max(0, finite(selectionRect && selectionRect.height, 0)),
    );
    const selection = {
      left: Math.min(left, right),
      top: Math.min(top, bottom),
      right: Math.max(left, right),
      bottom: Math.max(top, bottom),
    };
    const selectionCenterX = (selection.left + selection.right) / 2;
    const selectionCenterY = (selection.top + selection.bottom) / 2;
    const minimumLeft = SELECTION_PILL_MARGIN;
    const minimumTop = SELECTION_PILL_MARGIN;
    const maximumLeft = viewportWidth - SELECTION_PILL_MARGIN - pillWidth;
    const maximumTop = viewportHeight - SELECTION_PILL_MARGIN - pillHeight;
    const clampLeft = (value) => Math.min(maximumLeft, Math.max(minimumLeft, value));
    const clampTop = (value) => Math.min(maximumTop, Math.max(minimumTop, value));
    const candidates = [
      {
        placement: 'below',
        left: clampLeft(selectionCenterX - pillWidth / 2),
        top: selection.bottom + SELECTION_PILL_GAP,
      },
      {
        placement: 'right',
        left: selection.right + SELECTION_PILL_GAP,
        top: clampTop(selectionCenterY - pillHeight / 2),
      },
      {
        placement: 'left',
        left: selection.left - SELECTION_PILL_GAP - pillWidth,
        top: clampTop(selectionCenterY - pillHeight / 2),
      },
    ];
    const corners = [
      { placement: 'corner-top-left', left: minimumLeft, top: minimumTop },
      { placement: 'corner-top-right', left: maximumLeft, top: minimumTop },
      { placement: 'corner-bottom-left', left: minimumLeft, top: maximumTop },
      { placement: 'corner-bottom-right', left: maximumLeft, top: maximumTop },
    ].sort((first, second) => {
      const distance = (candidate) => {
        const centerX = candidate.left + pillWidth / 2;
        const centerY = candidate.top + pillHeight / 2;
        return (centerX - selectionCenterX) ** 2 + (centerY - selectionCenterY) ** 2;
      };
      return distance(second) - distance(first);
    });
    candidates.push(...corners);

    const candidateRect = (candidate) => ({
      left: candidate.left,
      top: candidate.top,
      right: candidate.left + pillWidth,
      bottom: candidate.top + pillHeight,
    });
    const fitsViewport = (candidate) => {
      const rect = candidateRect(candidate);
      return rect.left >= minimumLeft && rect.top >= minimumTop &&
        rect.right <= viewportWidth - SELECTION_PILL_MARGIN &&
        rect.bottom <= viewportHeight - SELECTION_PILL_MARGIN;
    };
    const overlapsSelection = (candidate) => {
      const rect = candidateRect(candidate);
      return rect.left < selection.right && rect.right > selection.left &&
        rect.top < selection.bottom && rect.bottom > selection.top;
    };
    const chosen = candidates.find((candidate) => fitsViewport(candidate) && !overlapsSelection(candidate)) || corners[0];
    return {
      left: Math.round(chosen.left),
      top: Math.round(chosen.top),
      width: Math.round(pillWidth),
      height: Math.round(pillHeight),
      placement: chosen.placement,
    };
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

  function inferredStreamingTurn(doc) {
    if (!doc) return null;
    const stopButton = [...doc.querySelectorAll(
      'button[data-testid="stop-button"], button[data-testid*="stop-generating"], button[aria-label^="Stop generating" i], button[aria-label^="Stop streaming" i]',
    )].find(isProbablyVisible);
    if (!stopButton) return null;
    const assistants = getAssistantTurns(doc);
    return assistants[assistants.length - 1] || null;
  }

  function isTurnStreaming(turn, doc = turn && turn.ownerDocument, knownStreamingTurn) {
    if (!turn || !doc) return false;
    if (turn.matches('[data-is-streaming="true"], [data-streaming="true"], .result-streaming') ||
        turn.querySelector('[data-is-streaming="true"], [data-streaming="true"], .result-streaming')) {
      return true;
    }
    if (arguments.length >= 3) return knownStreamingTurn === turn;
    return inferredStreamingTurn(doc) === turn;
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

  function getLatestCompletedAssistantTurn(root, fallback = null) {
    const turns = getCompletedAssistantTurns(root);
    return turns[turns.length - 1] || fallback;
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

  function requiresAnswerVerification(value, context = {}) {
    const raw = String(value == null ? '' : value).slice(0, QUESTION_MAX_LENGTH);
    const withoutBom = raw.replace(/^\uFEFF/u, '');
    const overrideMatch = withoutBom.match(ROUTE_OVERRIDE_PATTERN);
    const routedPrompt = overrideMatch
      ? withoutBom.slice(overrideMatch[0].length).replace(/^\s*(?::|;)?\s*/u, '')
      : raw;
    const topicResetMatch = normalizeText(routedPrompt).match(/^(?:(?:new|unrelated|separate)\s+(?:question|topic)|changing\s+(?:the\s+)?(?:question|topics?)|on\s+(?:an?\s+)?unrelated\s+note)\s*[.:,;!?—–-]\s*(.+)$/iu);
    const prompt = topicResetMatch ? topicResetMatch[1] : routedPrompt;
    const fullText = lowerText(prompt);
    const laterVerificationClause = /\b(?:but|and|then|first|also)\b.{0,160}\b(?:check|recheck|double-check|verify|confirm|validate|correct|right|wrong|accurate)\b/iu.test(fullText);
    if (!fullText || !laterVerificationClause && (
      /^(?:please\s+)?(?:rewrite|rephrase|translate|edit|proofread|quote|summari[sz]e|classify|extract)\b/iu.test(fullText) ||
      /^what does\b.{0,160}\bmean\b/iu.test(fullText) ||
      /^(?:define|explain)\s+(?:the\s+)?(?:word|phrase|term)\b/iu.test(fullText)
    )) return false;
    const questionMarker = 'my question:';
    const markerIndex = fullText.lastIndexOf(questionMarker);
    const selectedContext = markerIndex >= 0 ? fullText.slice(0, markerIndex) : '';
    const text = markerIndex >= 0 ? fullText.slice(markerIndex + questionMarker.length).trim() : fullText;
    if (!text) return false;

    const claimedAnswer = /\b(?:(?:the|my|your|our|their|this|that)\s+)?(?:answer|result|solution|value|output)\s+(?:is|was|equals?|would be|should be|could be|might be|came out(?: to)?)\b/iu;
    const challengeLead = /^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:(?:explain|justify|why|how)\b|(?:tell|show) me\s+(?:why|how)\b|help me understand\s+(?:why|how)\b)|^i\s+(?:(?:still|really|just)\s+)?(?:do\s+not|don['’]?t|cannot|can['’]?t)\s+(?:get|understand|see|follow)\b/iu;
    const reverseClaimedAnswer = /\b(?:why|how)\s+(?:(?:is|was)\s+.{1,80}|(?:would|should|could)\s+.{1,80}\s+be)\s+(?:the\s+)?(?:answer|result|solution|value|output)\b(?:\s+(?:(?:to|for)\s+(?:this|the)\s+(?:question|problem|exercise|equation|case)|in\s+(?:this|the)\s+(?:problem|case|context|key)))?[?.!]*$/iu;
    const forwardAuxClaim = /\b(?:why|how)\s+(?:should|would|could)\s+(?:the\s+)?(?:answer|result|solution|value|output)\s+be\b/iu;
    const correctnessChallenge = /\b(?:why|how)\s+(?:(?:is|was|isn['’]?t|wasn['’]?t)\s+.{1,80}?\s+|.{1,80}?\s+(?:is|was|isn['’]?t|wasn['’]?t|would be|could be|should be)\s+|(?:can|could|should|would|can['’]?t|cannot)\s+.{1,80}?\s+be\s+)(?:correct|right|valid)\b(?:\s+(?:here|in (?:this|the) (?:problem|case|context)))?[?.!]*$/iu;
    const numericAnswerPiece = String.raw`[-+]?(?:(?:\d+\s*\/\s*\d+)|(?:\d+(?:[.,]\d+)?|\.\d+)(?:\s*(?:%|°(?:c|f)?|v|mv|kv|volts?|a|ma|ka|amps?|w|mw|kw|watts?|j|kj|n|pa|kpa|mpa|hz|khz|mhz|ghz|ohms?|m|cm|mm|km|in|ft|yd|mi|g|mg|kg|lbs?|oz|l|ml|s|ms|mins?|h|hrs?|(?:m|km)\/(?:s|h)))?)`;
    const answerOnlyValue = new RegExp(String.raw`^${numericAnswerPiece}(?:\s*(?:and|or|,)\s*${numericAnswerPiece})*[?.!]*$`, 'iu');
    const derivationMatch = text.match(/\b(?:how|why)\b.{0,80}\b(?:(?:(?:did\s+)?(?:you|we|they)\s+)?(?:get|got|find|found|reach|reached|calculate|calculated|compute|computed|derive|derived|conclude|concluded|return|returned|produce|produced)|(?:you|we|they)\s+arrived at)\s+(.+?)$/iu);
    const derivationValue = derivationMatch && derivationMatch[1] || '';
    const derivationChallenge = Boolean(derivationValue && (
      answerOnlyValue.test(derivationValue) ||
      /^(?:the\s+)?(?:answer|result|solution|value|output)\b/iu.test(derivationValue) ||
      /^[a-z](?:\s*=.+)?[?.!]*$/iu.test(derivationValue)
    ));
    const directDeictic = text.match(/^(?:why|how)\s+(?:(?:is|was)\s+(?:it|that|this)|(?:would|could|should)\s+(?:it|that|this)\s+be)\s+(.+)$/iu);
    const subordinateDeictic = text.match(/\b(?:why|how)\s+(?:it|that|this)\s+(?:is|was|would be|could be|should be)\s+(.+)$/iu);
    const deicticValueChallenge = answerOnlyValue.test((directDeictic || subordinateDeictic || [])[1] || '');
    const selectedHasNumericValue = /(?:^|[^\p{L}\p{N}_])[-+]?(?:\d+(?:[.,]\d+)?|\.\d+)(?:\s*(?:%|°|[a-z]{1,8}))?(?=$|[^\p{L}\p{N}_])/iu.test(selectedContext);
    const selectedChallenge = markerIndex >= 0 &&
      /^(?:why|how)(?:\s+so)?[?.!]*$/iu.test(text) &&
      (claimedAnswer.test(selectedContext) || selectedHasNumericValue);
    const verificationVerb = /\b(?:check|recheck|double[\s-]?check|verify|confirm|validate)\b/iu;
    const verifiableSubject = /\b(?:answer|result|solution|value|output|calculation|math|derivation|reasoning|logic|conclusion|determinant|equation|work|proof|choice|option|correct|right|wrong|valid|accurate|mistake|error)\b/iu;
    const operationalNonAnswer = /\b(?:answer\s+(?:box|button|field|form)|answer\s+(?:was\s+)?(?:submitted|saved|uploaded|received)|(?:answer|result|calculation|determinant)\s+(?:schema|checkbox|field|button|menu|dropdown)|(?:solution\s+file\b.{0,40}\bexists?|proof\s+of\s+concept\b.{0,40}\bbuilds?)|result\s+(?:card|page|object)|(?:api\s+)?result\s+(?:has|contains|includes)|output\s+(?:format|file|directory|folder|path|stream|variable|parameter|field|property)|(?:option|choice)\s+[a-z]{1,4}\b.{0,40}\b(?:menu|dropdown|selected|selection|interface|setting)|(?:this|that|the)\s+(?:[\p{L}\p{N}_-]+\s+){0,2}(?:box|checkbox|button|option|setting|link|dialog)|work\s+(?:schedule|calendar|email)|proof\s+of\s+(?:delivery|identity|address|purchase|insurance)|(?:email|phone number|shipping address|appointment time|booking date|date|coupon code|username|password|file path|url|link|sentence|translation|reservation)\b.{0,60}\b(?:accurate|valid|correct|right)|email\s+(?:address|account)|correct\s+(?:spelling|spellings|grammar|wording|words?)|(?:spelling|spellings|grammar|wording|words?|capitalization|verb tense)\s+(?:is\s+|are\s+)?(?:correct|right)|(?:sentence\b.{0,50}\bgrammatically\s+correct|right\s+word)|(?:css|json|html|xml|yaml|schema|syntax)\s+(?:is\s+)?valid|(?:button|link|control|icon)\b.{0,32}\bon\s+the\s+(?:right|left)|(?:right|left)\s+(?:button|link|control|icon)\b(?:.{0,32}\b(?:works?|opens?|closes?|responds?))?)\b/iu.test(text);
    const deicticVerification = /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:check|recheck|double[\s-]?check|verify|confirm|validate)\s+(?:that|this|it)(?:\s+again)?[?.!]*$/iu.test(text);
    const certaintyChallenge = /^(?:are\s+you\s+(?:(?:really|absolutely|completely|totally|100\s*%)\s+)?(?:sure|certain|positive|confident)\b.*|(?:you(?:['’]re|\s+are)?|still|really)\s+(?:sure|certain|positive)\b.*|(?:am\s+i|is\s+(?:this|that|it)|are\s+(?:these|those))\s+(?:actually\s+|definitely\s+|really\s+)?(?:correct|right|wrong|valid|accurate))[?.!]*$/iu.test(text);
    const trailingCertainty = /\b(?:am\s+i|is\s+(?:this|that|it)|are\s+(?:these|those))\s+(?:actually\s+|definitely\s+|really\s+)?(?:correct|right|wrong|valid|accurate)[?.!]*$/iu;
    const keyClaim = /\b(?:answer\s+key|key)\s+(?:says?|gives?|lists?|marks?)\b/iu;
    const verificationLead = /^(?:(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?|(?:answer|respond)\s+(?:quickly|briefly)[,:;]?\s+(?:but\s+)?)(?:check|recheck|double[\s-]?check|verify|confirm|validate)\b/iu;
    const compoundVerification = laterVerificationClause && (
      verificationVerb.test(text) && verifiableSubject.test(text) ||
      trailingCertainty.test(text) ||
      /\b(?:if|whether)\s+(?:it|this|that|the\s+answer|the\s+solution)\s+(?:is|was)\s+(?:correct|right|wrong|valid|accurate)\b/iu.test(text)
    );
    const bareRecheck = /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:(?:recheck|verify)(?:\s+(?:this|that|it))?|double[\s-]?check(?:\s+(?:this|that|it))?|check\s+(?:again|once\s+more)(?:\s+(?:this|that|it))?)(?:\s+please)?[?.!]*$/iu.test(text);
    const reasoningRecheck = !operationalNonAnswer && /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:check|recheck|double[\s-]?check|verify|validate|review)\s+(?:(?:my|your|the|this)\s+)?(?:calculation|reasoning|logic|conclusion|derivation|proof|answer|result|solution|work)[?.!]*$|^(?:please\s+)?(?:recalculate|re[\s-]?evaluate)\s+(?:that|this|it|(?:the|my|your)\s+(?:answer|result|calculation|reasoning|work))[?.!]*$/iu.test(text);
    const directRecheck = !operationalNonAnswer && (certaintyChallenge || deicticVerification || bareRecheck || compoundVerification || reasoningRecheck ||
      verificationLead.test(text) && verificationVerb.test(text) && verifiableSubject.test(text));
    const deicticCorrectnessQuestion = !operationalNonAnswer && /^(?:is|was|are|were)\s+(?:this|that|it|these|those)\s+(?:actually\s+|definitely\s+|really\s+)?(?:correct|right|wrong|accurate|valid)[?.!]*$/iu.test(text);
    const trailingCorrectnessTag = /(?:[,;:]|[—–-])\s*(?:correct|right|wrong)[?.!]*$/iu;
    const claimThenCheck = !operationalNonAnswer && (claimedAnswer.test(text) || keyClaim.test(text)) && (trailingCertainty.test(text) || trailingCorrectnessTag.test(text));
    const personalResultCheck = /\bi\s+(?:got|calculated|computed|found|think|believe)\b.{0,100}\b(?:which|what|is\s+(?:this|that|it))\b.{0,80}\b(?:answer|result|option|choice|correct|right|wrong)\b/iu.test(text);
    const compactAnswerValue = String.raw`(?:[a-z][\p{L}\p{N}_]*\s*=\s*${numericAnswerPiece}|${numericAnswerPiece}|(?:option|choice)\s+[a-z]{1,4}|[a-z])`;
    const freeformAnswerValue = String.raw`(?:[\p{L}][\p{L}\p{N}'’.\/-]*(?:\s+[\p{L}][\p{L}\p{N}'’.\/-]*){0,3})`;
    const conciseCandidateExplanation = new RegExp(String.raw`^(?:(?:please\s+)?explain\s+why|i\s+(?:(?:still|really|just)\s+)?(?:do\s+not|don['’]?t|cannot|can['’]?t)\s+(?:get|understand|see|follow)\s+why)\s+(?:(?:the\s+)?(?:answer|choice|option)\s+(?:is|was)\s+)?${compactAnswerValue}[?.!]*$`, 'iu').test(text);
    const invertedClaim = new RegExp(String.raw`^(?:is|was|could|should|would|might)\s+(?:(?:the|my|your|our|their)\s+)?(?:answer|result|solution|value|output)\s+(?:(?:actually|definitely|really)\s+)?(?:be\s+)?${compactAnswerValue}[?.!]*$`, 'iu').test(text);
    const candidateCorrectness = !operationalNonAnswer && new RegExp(String.raw`^(?:is|was)\s+${compactAnswerValue}\s+(?:actually\s+|definitely\s+|really\s+)?(?:correct|right|wrong|valid|accurate)[?.!]*$`, 'iu').test(text);
    const candidateAsAnswer = new RegExp(String.raw`^(?:is|was)\s+${compactAnswerValue}\s+(?:actually\s+|definitely\s+|really\s+)?(?:the\s+)?(?:correct|right|wrong)\s+(?:answer|result|solution|choice|option)[?.!]*$`, 'iu').test(text);
    const freeformCandidateAsAnswer = !operationalNonAnswer && new RegExp(String.raw`^(?:is|was)\s+${freeformAnswerValue}\s+(?:actually\s+|definitely\s+|really\s+)?(?:the\s+)?(?:correct|right|wrong)\s+(?:answer|result|solution|choice|option)[?.!]*$`, 'iu').test(text);
    const mathEquationCorrectness = !operationalNonAnswer && /^(?:is|was)\s+[\d\s()+\-*/^%.]+=[\d\s()+\-*/^%.]+\s+(?:correct|right|wrong|accurate)[?.!]*$/iu.test(text);
    const answerPredicateCheck = !operationalNonAnswer && /^(?:is|was)\s+(?:(?:the|my|your|our|their)\s+)?(?:answer|result|solution|choice|option|calculation|reasoning|logic|conclusion|derivation|proof|work)\s+(?:actually\s+|definitely\s+|really\s+)?(?:correct|right|wrong|valid|accurate|sound)[?.!]*$/iu.test(text);
    const tellMeCorrectness = !operationalNonAnswer && /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:tell\s+me|see|check|determine|find\s+out)\s+(?:whether|if)\s+.{1,80}\s+(?:is|was)\s+(?:correct|right|wrong|valid|accurate)[?.!]*$/iu.test(text);
    const processCorrectness = /^(?:did\s+i\s+(?:calculate|compute|choose|pick|get|solve)\s+.{1,80}\s+(?:correctly|right)|did\s+i\s+(?:choose|pick|get)\s+(?:the\s+)?(?:correct|right|wrong)\s+(?:answer|result|choice|option))[?.!]*$/iu.test(text);
    const candidateLooksRight = new RegExp(String.raw`^does\s+${compactAnswerValue}\s+look\s+(?:correct|right|wrong|valid)[?.!]*$`, 'iu').test(text);
    const checkCompactCandidate = new RegExp(String.raw`^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:check|recheck|double[\s-]?check|verify)\s+${compactAnswerValue}(?:\s+for\s+me)?[?.!]*$`, 'iu').test(text);
    const personalCompactCheck = new RegExp(String.raw`^(?:(?:did\s+i\s+(?:get|choose|pick|select|calculate|find)|i\s+(?:got|chose|picked|selected|calculated|found)|my\s+(?:answer|calculation|result|solution)\s+(?:is|was|gave|gives|came\s+out\s+to))\s+${compactAnswerValue})(?:\s*(?:[.!;,:—–-])?\s*(?:(?:am\s+i|is\s+(?:this|that|it))\s+)?(?:correct|right|wrong))?[?.!]*$`, 'iu').test(text);
    const personalFreeformCheck = !operationalNonAnswer && new RegExp(String.raw`^(?:i\s+(?:got|chose|picked|selected|found)\s+${freeformAnswerValue})\s*(?:[.!;,:—–-])?\s*(?:(?:am\s+i|is\s+(?:this|that|it))\s+)?(?:correct|right|wrong)[?.!]*$`, 'iu').test(text);
    const negativeAnswerClaim = new RegExp(String.raw`^why\s+(?:isn['’]?t|is\s+not|wasn['’]?t|was\s+not)\s+(?:(?:the|my|your|our)\s+)?(?:answer|result|solution)\s+${compactAnswerValue}[?.!]*$`, 'iu').test(text);
    const alternativeCandidate = new RegExp(String.raw`^(?:(?:wouldn['’]?t|shouldn['’]?t|couldn['’]?t|can['’]?t)\s+(?:it|this|that)\s+be\s+${compactAnswerValue}|(?:wouldn['’]?t|shouldn['’]?t|couldn['’]?t)\s+${compactAnswerValue}\s+be\s+(?:the\s+)?(?:answer|result|solution))[?.!]*$`, 'iu').test(text);
    const conflictCheck = /\b(?:you\s+said|previous\s+answer|answer\s+key|key\s+says?|conflicts?\s+with)\b.{0,180}(?:\b(?:which|what)\s+(?:one\s+)?(?:is|was)\s+(?:right|correct)\b|\bbut\s+i\s+(?:got|chose|picked)\b)|\byour\s+answer\s+and\s+mine\s+disagree\b|\b(?:that|this|it)\s+contradicts?\s+(?:the\s+)?(?:answer\s+)?key\b/iu.test(text);
    const disagreementChallenge = !operationalNonAnswer && new RegExp(String.raw`^(?:i\s+(?:do\s+not|don['’]?t)\s+think\s+(?:that|this|it)(?:['’]s|\s+is)\s+(?:correct|right)|i\s+think\s+${compactAnswerValue}\s+is\s+(?:wrong|incorrect)|(?:that|this|it|(?:your|the|that)\s+answer)\s+(?:doesn['’]?t\s+look\s+(?:correct|right)|seems?\s+(?:wrong|incorrect)|(?:is|was)\s+(?:wrong|incorrect)|can['’]?t\s+be\s+right)|${compactAnswerValue}\s+can['’]?t\s+be\s+right|no[,]?\s+(?:that|this|it)(?:['’]s|\s+is)\s+wrong|i\s+think\s+it\s+should\s+be\s+${compactAnswerValue}\s*,?\s+not\s+${compactAnswerValue}|what\s+if\s+${compactAnswerValue}\s+is\s+(?:the\s+)?answer\s+instead)[?.!]*$`, 'iu').test(text);
    const reconsiderationChallenge = !operationalNonAnswer && /^(?:(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?reconsider\s+(?:that|this|the)\s+(?:answer|result|solution)|i\s+(?:doubt|do\s+not\s+trust|don['’]?t\s+trust)\s+(?:that|this|the)\s+(?:answer|result|solution)|(?:that|this)\s+(?:answer|result|solution)\s+looks?\s+suspicious|(?:that|this)\s+(?:cannot|can['’]?t)\s+be\s+correct|(?:that|this)\s+seems?\s+off|(?:that|this)\s+(?:does\s+not|doesn['’]?t)\s+add\s+up)[?.!]*$/iu.test(text);
    const externalConflict = !operationalNonAnswer && /^(?:the\s+(?:answer\s+)?key\s+has\b.{1,80}\bbut\b.{1,80}\bseems?\s+(?:right|correct)|my\s+teacher\s+says?\b.{1,100}\b(?:wrong|incorrect)|the\s+calculator\s+says?\b.{1,80}\bnot\b.{1,80}|i\s+got\s+something\s+different|my\s+result\s+differs?\s+from\s+yours)[?.!]*$/iu.test(text);
    const checkedMathStatement = !operationalNonAnswer && verificationLead.test(text) && /\b(?:whether|if)\b.{0,80}(?:[a-z][\p{L}\p{N}_]*\s*=\s*[-+]?\d|\bdeterminant\b|\bzero\b)/iu.test(text);
    const accuracyRecheck = !operationalNonAnswer && /^(?:(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:make\s+sure|ensure)\s+(?:(?:this|that|the)\s+(?:answer|result)\s+is|(?:this|that|it)\s+is)\s+(?:correct|right|accurate)|(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?make\s+(?:this|that|it)\s+more\s+correct|(?:please\s+)?fact[\s-]?check\s+(?:this|that|it))[?.!]*$/iu.test(text);
    const namedAnswerClaim = !operationalNonAnswer && new RegExp(String.raw`^(?:(?:is|could|would|should|might)\s+(?:the\s+)?answer\s+(?:be\s+)?${freeformAnswerValue}|(?:make\s+sure|ensure)\s+(?:the\s+)?answer\s+is\s+${freeformAnswerValue}|why\s+(?:isn['’]?t|is\s+not)\s+(?:the\s+)?answer\s+${freeformAnswerValue}|(?:wouldn['’]?t|shouldn['’]?t)\s+(?:(?:the\s+)?answer\s+be\s+${freeformAnswerValue}|${freeformAnswerValue}\s+be\s+(?:the\s+)?answer))[?.!]*$`, 'iu').test(text);
    const conciseCandidateChallenge = new RegExp(String.raw`^(?:(?:why|how\s+come)\s+(?:(?:option\s+)?${compactAnswerValue}|${compactAnswerValue}\s+is\s+(?:the\s+)?answer)|where\s+did\s+${compactAnswerValue}\s+come\s+from|(?:why|how)\s+did\s+you\s+(?:choose|pick|say)\s+${compactAnswerValue}|you\s+(?:chose|picked|selected|said)\s+${compactAnswerValue}\s*(?:[—–-]|[,;:])?\s*why|what\s+makes\s+${compactAnswerValue}\s+(?:correct|right)|[a-z][\p{L}\p{N}_]*\s+is\s+${compactAnswerValue}\s*,?\s+(?:right|correct)|i\s+got\s+(?:[a-z][\p{L}\p{N}_]*\s+as\s+${compactAnswerValue}|${compactAnswerValue}\s+for\s+[a-z][\p{L}\p{N}_]*)\s*,?\s+(?:right|correct))[?.!]*$`, 'iu').test(text);
    const passiveCandidateDerivation = !operationalNonAnswer && new RegExp(String.raw`^(?:why\s+(?:was|were)\s+${compactAnswerValue}\s+(?:used|chosen|picked|selected|substituted|added|subtracted|multiplied|divided)|how\s+(?:was|were)\s+${compactAnswerValue}\s+(?:calculated|computed|derived|obtained|found|chosen)|where\s+(?:does|did)\s+${compactAnswerValue}\s+come\s+from|what\s+made\s+you\s+(?:choose|pick|select|use)\s+${compactAnswerValue})[?.!]*$`, 'iu').test(text);
    const answerDoubt = !operationalNonAnswer && /^(?:(?:could|might|can|would)\s+(?:it|this|that|(?:your|the)\s+(?:answer|result|solution|calculation|conclusion))\s+be\s+(?:wrong|incorrect|mistaken)|is\s+there\s+(?:a|any)\s+(?:mistake|error)|(?:are\s+there\s+)?any\s+(?:mistakes?|errors?)|any\s+chance\s+(?:that|this|it|(?:your|the)\s+(?:answer|result))\s+is\s+(?:wrong|incorrect)|what\s+if\s+(?:your|the)\s+(?:answer|result|solution|calculation|conclusion)\s+is\s+(?:wrong|incorrect))[?.!]*$/iu.test(text);
    const candidateExplanationFollowUp = !operationalNonAnswer && new RegExp(String.raw`^(?:i\s+got\s+${compactAnswerValue}\s*[,;:—–-]?\s*why|i\s+think\s+(?:the\s+)?answer\s+is\s+${compactAnswerValue}\s*[.;:—–-]?\s*explain(?:\s+why)?|(?:the\s+answer\s+key|my\s+teacher|it)\s+says?\s+(?:it\s+is\s+)?${compactAnswerValue}\s*[,;.:—–-]?\s*why|help\s+me\s+understand\s+(?:why\s+)?${compactAnswerValue}|why\s+(?:would|should|could)\s+it\s+be\s+${compactAnswerValue}|${compactAnswerValue}\s+is\s+(?:the\s+)?answer\s*[.;:—–-]?\s*explain\s+why|(?:the\s+)?answer\s+is\s+${compactAnswerValue}\s+because\s+.{1,100}?\s*[.;:—–-]?\s*is\s+that\s+true|why\s+not\s+${compactAnswerValue}|why\s+${compactAnswerValue}\s+instead\s+of\s+${compactAnswerValue}|i\s+(?:do\s+not|don['’]?t|cannot|can['’]?t)\s+(?:get|understand|follow)\s+${compactAnswerValue}|explain\s+(?:the\s+)?${compactAnswerValue}|walk\s+me\s+through\s+why\s+(?:it|that|this|(?:the\s+)?answer)\s+is\s+${compactAnswerValue}|show\s+(?:me\s+)?why\s+${compactAnswerValue}\s+is\s+(?:correct|right))[?.!]*$`, 'iu').test(text);
    const suppliedAnswerValue = String.raw`(?:${compactAnswerValue}|[\p{L}\p{N}][\p{L}\p{N}'’\/-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}'’\/-]*){0,3})`;
    const singleWordAnswerValue = String.raw`[\p{L}\p{N}][\p{L}\p{N}'’\/-]*`;
    const signedAnswerPhrase = String.raw`(?:negative|positive|zero|nonzero|incorrect|wrong)\s+[\p{L}\p{N}][\p{L}\p{N}'’\/-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}'’\/-]*){0,2}`;
    const suppliedAnswerExplanation = !operationalNonAnswer && new RegExp(String.raw`^(?:(?:(?:the|my|your)\s+)?(?:(?:correct\s+)?answer|answer\s+key|solution)\s*(?::|(?:is|was|says?|gives?|lists?|marks?)\s+)\s*${suppliedAnswerValue}(?:\s*[,;.:—–-]?\s*(?:why|explain(?:\s+(?:it|why))?|how\s+(?:is|can|could|would)\s+that))?|(?:(?:my|the)\s+)?(?:teacher|professor|instructor|book|textbook|chegg|calculator|key|it|they)\s+says?\s+(?:the\s+answer\s+is\s+|it\s+is\s+)?${suppliedAnswerValue}(?:\s*[,;.:—–-]?\s*(?:why|explain(?:\s+why)?))?|${suppliedAnswerValue}\s*[,;:—–-]\s*(?:why|explain(?:\s+why)?)|how\s+is\s+(?:the\s+)?answer\s+${suppliedAnswerValue}|why\s+not\s+(?:${compactAnswerValue}|${singleWordAnswerValue})|why\s+${compactAnswerValue}\s+instead\s+of\s+${compactAnswerValue}|(?:please\s+)?explain\s+${signedAnswerPhrase})[?.!]*$`, 'iu').test(text);
    const priorAnswerExplanation = !operationalNonAnswer && /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:(?:explain|justify)\s+(?:(?:how|why)\s+)?(?:(?:your|the|that|this)\s+)?(?:answer|result|solution|reasoning|logic|conclusion)|explain\s+how\s+you\s+(?:got|found|calculated|derived|reached|arrived\s+at)\s+(?:that|this|the\s+answer|your\s+answer)|walk\s+me\s+through\s+(?:(?:your|the|that|this)\s+)?(?:answer|reasoning|logic|solution)|show\s+(?:me\s+)?(?:(?:your|the)\s+)?(?:reasoning|work)|what\s+is\s+your\s+reasoning|how\s+did\s+you\s+arrive\s+at\s+(?:that|this|your\s+answer)|why\s+is\s+that)[?.!]*$/iu.test(text);
    const expandedAnswerValue = String.raw`(?:${compactAnswerValue}|[\p{L}\p{N}][\p{L}\p{N}'’\/-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}'’\/-]*){0,4})`;
    const expandedCandidateExplanation = !operationalNonAnswer && new RegExp(String.raw`^(?:i\s+got\s+${expandedAnswerValue}\s*[,;:.?—–-]+\s*(?:why|how|explain(?:\s+why)?)|i\s+think\s+(?:the\s+)?answer\s+is\s+${expandedAnswerValue}\s*[,;:.?—–-]+\s*(?:why|how|explain(?:\s+why)?)|why\s+(?:would|should|could|can)\s+(?:it|this|that)\s+be\s+${expandedAnswerValue}|(?:(?:the|my)\s+)?(?:solution|answer\s+key|key|teacher|professor|instructor|book|textbook|chegg|calculator|they|it)\s+(?:says?|got|gives?|lists?|marks?)\s+(?:the\s+answer\s+is\s+|it\s+is\s+)?${expandedAnswerValue}\s*[,;:.?—–-]+\s*(?:why|how|explain(?:\s+why)?)|according\s+to\s+(?:the\s+)?(?:answer\s+key|key|teacher|professor|instructor|book|textbook|chegg)\s*[,]?\s*(?:the\s+answer|it)\s+is\s+${expandedAnswerValue}\s*[,;:.?—–-]+\s*(?:why|how|explain(?:\s+why)?)|${expandedAnswerValue}\s*[,;:.?—–-]+\s*(?:why|how|explain(?:\s+why)?))[?.!]*$`, 'iu').test(text);
    const additionalPriorAnswerExplanation = !operationalNonAnswer && /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:show\s+(?:me\s+)?(?:the\s+)?reasoning\s+behind\s+(?:that|this|it|the\s+answer)|how\s+did\s+you\s+arrive\s+at\s+(?:that|this|the|your)\s+answer)[?.!]*$/iu.test(text);
    const freeformDeicticCandidate = !operationalNonAnswer && new RegExp(String.raw`^(?:(?:is|was)\s+${suppliedAnswerValue}\s+(?:correct|right|wrong|valid|accurate)|(?:could|should|would|might|can)\s+${suppliedAnswerValue}\s+be\s+(?:correct|right|wrong|valid|accurate)|${singleWordAnswerValue}\s*[,;:]\s*(?:right|correct)|(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:explain\s+(?:your|the)\s+(?:last|previous)\s+answer|justify\s+(?:it|that|this)|prove\s+(?:it|that|this)))[?.!]*$`, 'iu').test(text);
    const assumedAnswerMatch = text.match(/^(?:why|how)\s+(?:is|was|would|could)\s+(?:it|this|that)\s+(.+?)[?.!]*$/iu);
    const assumedAnswerCandidate = normalizeText(assumedAnswerMatch && assumedAnswerMatch[1]).replace(/[?.!]+$/gu, '');
    const latestAssistantText = lowerText(boundedHeadTailSample(context.latestAssistantText || '', 4_000));
    const contextualAssumedAnswer = Boolean(assumedAnswerCandidate && latestAssistantText &&
      (assumedAnswerCandidate.match(/[\p{L}\p{N}]+/gu) || []).length <= 6 && (() => {
        const escaped = lowerText(assumedAnswerCandidate).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        return escaped.length >= 2 && new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(latestAssistantText);
      })());
    const confusedDerivationChallenge = !operationalNonAnswer && (
      /^i\s+(?:(?:still|really|just)\s+)?(?:do\s+not|don['’]?t|cannot|can['’]?t)\s+(?:get|understand|see|follow)\s+(?:(?:where\s+(?:that|this|the\s+)?(?:answer|result|value|number|[-+]?\d+(?:\.\d+)?\s*[a-z]{0,8})\s+came\s+from)|(?:how|why)\s+(?:you|we)\s+(?:got|found|calculated|computed|derived|chose|picked|selected|used|substituted|added|subtracted|multiplied|divided|concluded|said)\b).*[?.!]*$/iu.test(text) ||
      /^(?:that|this|it|(?:your|the)\s+(?:answer|result|solution|reasoning|explanation))\s+(?:(?:does\s+not|doesn['’]?t)\s+make\s+sense|makes?\s+no\s+sense)[?.!]*$/iu.test(text)
    );
    const tersePriorChallenge = /^(?:really|seriously|correct|right|wrong|where\s+did\s+you\s+get\s+that)[?.!]*$/iu.test(text);
    const bareWhy = markerIndex < 0 && /^(?:why|how\s+come)[?.!]*$/iu.test(text);
    const extractedDataCheck = !operationalNonAnswer && (
      /^(?:are|is|were|was)\s+(?:(?:all|the|these|those)\s+)?(?:extracted|transcribed|identified|calculated|detected)\s+(?:names?|values?|figures?|numbers?|totals?|fields?|dates?|items?|results?)\s+(?:actually\s+|definitely\s+)?(?:correct|right|accurate|complete)[?.!]*$/iu.test(text) ||
      /\b(?:file|document|pdf|spreadsheet|table|chart|image|scan)\s+(?:says?|shows?|lists?|gives?|reports?)\b.{1,140}\b(?:is\s+(?:that|this|it)\s+|is\s+the\s+(?:value|number|total|result)\s+)?(?:correct|right|accurate)[?.!]*$/iu.test(text) ||
      /^(?:is|was)\s+(?:the\s+)?(?:ocr|transcription|extraction)\s+(?:actually\s+)?(?:correct|right|accurate|complete)[?.!]*$/iu.test(text) ||
      /^(?:did\s+(?:it|you)\s+(?:transcribe|extract|copy|identify)\b.{0,100}\b(?:correctly|accurately|completely)|did\s+you\s+extract\s+(?:all|every)\b.{0,100}\b(?:correctly|accurately)?)[?.!]*$/iu.test(text) ||
      /^(?:are|were)\s+(?:the\s+)?(?:transcribed|extracted|copied|ocr(?:['’]d)?)\s+(?:equations?|names?|values?|figures?|numbers?|totals?|fields?|dates?|items?|results?)\s+(?:correct|right|accurate|complete)[?.!]*$/iu.test(text) ||
      /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:check|verify)\s+(?:whether|if)\s+(?:the\s+)?(?:pdf|file|document|image|table|spreadsheet)\b.{0,100}\b(?:copied|transcribed|extracted)\b.{0,60}\b(?:correctly|accurately)[?.!]*$/iu.test(text) ||
      /^(?:this|that|the)\s+(?:ocr|transcription|extraction)\s+(?:has|contains)\s+(?:mistakes?|errors?)[?.!]*$/iu.test(text) ||
      /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:compare|cross[\s-]?check|verify)\s+(?:your|the)\s+(?:answer|result|extraction|transcription)\s+(?:against|with)\s+(?:the\s+|this\s+|that\s+)?(?:file|document|pdf|image|source)[?.!]*$/iu.test(text) ||
      /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:check|verify|compare|cross[\s-]?check)\s+(?:(?:all|every|the)\s+)?(?:extracted|transcribed|copied|ocr(?:['’]d)?)\s+(?:equations?|names?|values?|figures?|numbers?|totals?|fields?|dates?|items?|results?)\s+(?:against|with|to)\s+(?:the\s+|this\s+|that\s+)?(?:original\s+)?(?:source\s+(?:file|document|pdf|image|scan)|file|document|pdf|image|scan|source)[?.!]*$/iu.test(text) ||
      /^(?:the\s+)?(?:ocr|transcription|extraction)\s+(?:says?|shows?|gives?)\b.{1,120}\b(?:is\s+(?:that|this|it)\s+)?(?:correct|right|accurate)[?.!—–-]*$/iu.test(text)
    );
    const suspiciousResultCheck = !operationalNonAnswer && /^(?:that|this|the)\s+(?:answer|result|solution|calculation|conclusion|output|value)\s+(?:(?:seems?|looks?)\s+(?:off|wrong|incorrect|suspicious)|(?:does\s+not|doesn['’]?t)\s+(?:add\s+up|look\s+right))[?.!]*$/iu.test(text);
    return selectedChallenge || deicticValueChallenge || directRecheck || invertedClaim || deicticCorrectnessQuestion || claimThenCheck || personalResultCheck || candidateCorrectness || candidateAsAnswer || freeformCandidateAsAnswer || mathEquationCorrectness || answerPredicateCheck || tellMeCorrectness || processCorrectness || candidateLooksRight || checkCompactCandidate || personalCompactCheck || personalFreeformCheck || negativeAnswerClaim || alternativeCandidate || conflictCheck || disagreementChallenge || reconsiderationChallenge || externalConflict || checkedMathStatement || accuracyRecheck || namedAnswerClaim || conciseCandidateChallenge || conciseCandidateExplanation || passiveCandidateDerivation || answerDoubt || candidateExplanationFollowUp || suppliedAnswerExplanation || priorAnswerExplanation || expandedCandidateExplanation || additionalPriorAnswerExplanation || freeformDeicticCandidate || contextualAssumedAnswer || confusedDerivationChallenge || tersePriorChallenge || bareWhy || extractedDataCheck || suspiciousResultCheck || challengeLead.test(text) && (
      claimedAnswer.test(text) || reverseClaimedAnswer.test(text) || forwardAuxClaim.test(text) || derivationChallenge || correctnessChallenge.test(text)
    );
  }

  function buildAccuracyGuardedPrompt(value, maximumLength = QUESTION_MAX_LENGTH, context = {}) {
    const raw = String(value == null ? '' : value);
    if (!requiresAnswerVerification(raw, context)) return raw;
    const lower = lowerText(raw);
    if (lower.includes(lowerText(ACCURACY_GUARD_INSTRUCTION)) ||
      /\bindependently verify\b.{0,100}\b(?:answer|result)\b|\b(?:do not|don['’]?t) assume\b.{0,100}\b(?:correct|right)\b/iu.test(lower)) {
      return raw;
    }
    const limit = clampInteger(maximumLength, QUESTION_MAX_LENGTH, 1, SIDE_FALLBACK_PROMPT_MAX_LENGTH);
    const separator = raw.endsWith('\n') ? '\n' : '\n\n';
    const guarded = `${raw}${separator}${ACCURACY_GUARD_INSTRUCTION}`;
    return guarded.length <= limit ? guarded : raw;
  }

  function boundedHeadTailSample(value, maximumLength) {
    const text = String(value == null ? '' : value);
    const limit = clampInteger(maximumLength, 16_000, 1, QUESTION_MAX_LENGTH);
    if (text.length <= limit) return text;
    const headLength = Math.ceil((limit - 1) / 2);
    const tailLength = Math.max(0, limit - headLength - 1);
    return `${text.slice(0, headLength)}\n${tailLength ? text.slice(-tailLength) : ''}`;
  }

  function assistantInvitesContinuation(value) {
    const text = lowerText(boundedHeadTailSample(value, 4_000));
    if (!text) return false;
    return /\b(?:would\s+you\s+like|do\s+you\s+want|want\s+me\s+to|should\s+(?:i|we)|shall\s+(?:i|we)|let\s+me\s+know\s+if\s+you\s+(?:want|would\s+like))\b|(?:^|[.!?]\s+)(?:want\s+to|ready\s+(?:to|for))\b[^.!?]{0,180}\?\s*$|\bif\s+you(?:['’]d|\s+would)?\s*(?:like|want)\s*[,;:]?\s+i\s+can\b|\bi\s+(?:can|could)\s+also\b|\bi\s+can\b.{0,180}\bif\s+you(?:['’]d|\s+would)\s+like\b/iu.test(text);
  }

  function inlineStyleHidesContent(value) {
    return /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|content-visibility\s*:\s*hidden)\b/iu.test(
      String(value == null ? '' : value),
    );
  }

  function classTokensHideContent(value) {
    return /(?:^|\s)(?:hidden|invisible|sr-only|visually-hidden)(?=\s|$)/iu.test(
      String(value == null ? '' : value),
    );
  }

  function classMayControlVisibility(value) {
    return /(?:^|\s)[^\s]*(?:hidden|invisible|closed|collaps|inactive|conceal|offscreen|opacity-0|sr-only|visually-hidden)[^\s]*(?=\s|$)/iu.test(
      String(value == null ? '' : value),
    );
  }

  function readableNodeText(root, options = {}) {
    if (!root) return '';
    const blockTags = new Set([
      'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'DT', 'DD', 'FIGCAPTION', 'FIGURE',
      'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'MAIN', 'NAV', 'OL', 'P',
      'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
    ]);
    const ignoredSelector = [
      `#${UI_ROOT_ID}`, `.${TURN_BUTTON_CLASS}`, '.cgs-turn-fallback-row',
      'button', 'input', 'textarea', 'select', 'option', 'script', 'style', 'svg', 'canvas', 'noscript',
      '[hidden]', '[inert]', '[aria-hidden="true"]', '[data-state="closed"]',
      '[class~="hidden"]', '[class~="invisible"]', '[class~="sr-only"]', '[class~="visually-hidden"]',
      '[data-testid*="turn-action"]', '[data-testid*="message-actions"]',
      '[data-testid*="feedback"]', '[data-cgs-injected]',
    ].join(', ');
    const checkComputedVisibility = options.checkComputedVisibility === true;
    const visibilityState = options.visibilityState && typeof options.visibilityState.set === 'function'
      ? options.visibilityState
      : null;
    const computedVisibilityCache = options.computedVisibilityCache instanceof Map
      ? options.computedVisibilityCache
      : new Map();
    const view = root.ownerDocument && root.ownerDocument.defaultView;
    const computedHidden = (node) => {
      if (!checkComputedVisibility || !view || typeof view.getComputedStyle !== 'function' || !node || !node.hasAttribute ||
        !node.hasAttribute('style') && !classMayControlVisibility(node.getAttribute('class'))) return false;
      if (computedVisibilityCache.has(node)) return computedVisibilityCache.get(node);
      let hidden = false;
      try {
        const style = view.getComputedStyle(node);
        hidden = style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' ||
          style.contentVisibility === 'hidden';
      } catch (_error) {
        hidden = false;
      }
      computedVisibilityCache.set(node, hidden);
      if (visibilityState) visibilityState.set(node, hidden);
      return hidden;
    };

    const codeBlocks = [];
    const visit = (node) => {
      if (!node) return '';
      if (node.nodeType === 3) return String(node.nodeValue || '');
      if (node.nodeType !== 1 || node.matches(ignoredSelector) || inlineStyleHidesContent(node.getAttribute('style')) ||
        computedHidden(node)) return '';
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

  function extractAssistantHandoff(turn, options = {}) {
    if (!turn) return '';
    const roleNode = turn.matches && turn.matches('[data-message-author-role="assistant"]')
      ? turn
      : turn.querySelector && turn.querySelector('[data-message-author-role="assistant"]');
    if (!roleNode) return '';
    const preferred = [...roleNode.querySelectorAll('[data-message-content], .markdown, [class~="prose"]')]
      .filter((node) => !node.parentElement || !node.parentElement.closest('[data-message-content], .markdown, [class~="prose"]'));
    const candidates = preferred.length ? preferred : [roleNode];
    const text = candidates.map((node) => readableNodeText(node, options)).sort((a, b) => b.length - a.length)[0] || '';
    if (options.headTailSampleLength) {
      return boundedHeadTailSample(text, options.headTailSampleLength).trim();
    }
    return text.slice(0, FRESH_HANDOFF_MAX_LENGTH).trim();
  }

  function assistantTurnFingerprint(turn) {
    const text = normalizeText(extractAssistantHandoff(turn) || readableNodeText(turn));
    if (!text) return '';
    if (text.length <= TARGET_FINGERPRINT_MAX_LENGTH - 20) return `${text.length}:${text}`;
    const edgeLength = Math.floor((TARGET_FINGERPRINT_MAX_LENGTH - 30) / 2);
    return `${text.length}:${text.slice(0, edgeLength)}\u241f${text.slice(-edgeLength)}`;
  }

  function conversationContextFingerprint(root, throughTurn = null) {
    const turns = getTurns(root);
    const lastIndex = throughTurn ? turns.indexOf(throughTurn) : turns.length - 1;
    if (lastIndex < 0) return '';
    let hashA = 0x811c9dc5;
    let hashB = 0x9e3779b9;
    let length = 0;
    const update = (value) => {
      const text = String(value);
      length += text.length;
      for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        hashA = Math.imul(hashA ^ code, 0x01000193) >>> 0;
        hashB = Math.imul(hashB ^ code, 0x85ebca6b) >>> 0;
      }
    };
    for (const turn of turns.slice(0, lastIndex + 1)) {
      const role = roleOfTurn(turn);
      const content = role === 'assistant' ? extractAssistantHandoff(turn) : readableNodeText(turn);
      update(`${role}\u241e${normalizeText(content)}\u241f`);
    }
    return `${lastIndex + 1}:${length}:${hashA.toString(16).padStart(8, '0')}:${hashB.toString(16).padStart(8, '0')}`;
  }

  function serializeConversation(root, throughTurn = null, maximumLength = SIDE_FALLBACK_TRANSCRIPT_MAX_LENGTH) {
    const turns = getTurns(root);
    const lastIndex = throughTurn ? turns.indexOf(throughTurn) : turns.length - 1;
    if (lastIndex < 0) return '';
    const blocks = turns.slice(0, lastIndex + 1).map((turn) => {
      const role = roleOfTurn(turn);
      if (role !== 'user' && role !== 'assistant') return '';
      const content = readableNodeText(turn).replace(/\r\n?/gu, '\n').trim();
      return content ? `${role.toUpperCase()}:\n${content}` : '';
    }).filter(Boolean);
    const transcript = blocks.join('\n\n');
    const limit = clampInteger(maximumLength, SIDE_FALLBACK_TRANSCRIPT_MAX_LENGTH, 1_000, SIDE_FALLBACK_TRANSCRIPT_MAX_LENGTH);
    if (transcript.length <= limit) return transcript;
    const marker = '\n\n[... older middle messages omitted because the chat was too long for the emergency transfer ...]\n\n';
    const available = Math.max(2, limit - marker.length);
    const headLength = Math.floor(available * 0.38);
    const tailLength = Math.max(1, available - headLength);
    const newestBlock = blocks[blocks.length - 1] || '';
    let tail = transcript.slice(-tailLength).trimStart();
    if (newestBlock.length > tailLength) {
      const innerMarker = '\n[... middle of newest message omitted ...]\n';
      const innerAvailable = Math.max(2, tailLength - innerMarker.length);
      const newestHeadLength = Math.floor(innerAvailable * 0.45);
      tail = `${newestBlock.slice(0, newestHeadLength).trimEnd()}${innerMarker}${newestBlock.slice(-(innerAvailable - newestHeadLength)).trimStart()}`;
    }
    return `${transcript.slice(0, headLength).trimEnd()}${marker}${tail}`
      .slice(0, limit);
  }

  function buildSideFallbackPrompt(transcriptValue, questionValue, kind = 'ask', transferId = '') {
    const transcript = String(transcriptValue == null ? '' : transcriptValue).replace(/\r\n?/gu, '\n').trim();
    const question = String(questionValue == null ? '' : questionValue).replace(/\r\n?/gu, '\n').trim();
    const marker = fallbackTransferMarker(transferId);
    if (!transcript) return '';
    const rawRequest = question || (kind === 'continue'
      ? 'Continue the conversation from where it stopped.'
      : 'Answer the side question using the available conversation context.');
    const request = kind === 'ask'
      ? buildAccuracyGuardedPrompt(rawRequest)
      : rawRequest;
    return `Answer the request at the end using the previous ChatGPT conversation as context. This is a separate chat, so do not merely summarize the transcript and do not ask the user to repeat information already included here.

Files, images, and other attachments are not transferred by this fallback. Use all information available in the transcript. If missing material is truly essential, ask the user to upload it, while making clear that it is okay if they cannot.
${marker ? `\n${marker}\n` : ''}

--- PREVIOUS CONVERSATION ---
${transcript}
--- END PREVIOUS CONVERSATION ---

--- ${kind === 'continue' && !question ? 'REQUEST' : 'SIDE QUESTION'} ---
${request}`.slice(0, SIDE_FALLBACK_PROMPT_MAX_LENGTH);
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

  function conversationIdentity(value) {
    try {
      const segments = new URL(String(value)).pathname.split('/').filter(Boolean);
      for (let index = segments.length - 2; index >= 0; index -= 1) {
        if (segments[index] === 'c' && segments[index + 1]) return segments[index + 1];
      }
      return '';
    } catch (_error) {
      return '';
    }
  }

  function sanitizeConversationIdentity(value) {
    const identity = String(value == null ? '' : value).trim();
    return /^[a-z0-9_-]{1,200}$/iu.test(identity) ? identity : '';
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

  function urlWithNewChatJob(value, jobId) {
    if (!isValidJobId(jobId)) return '';
    try {
      const source = new URL(String(value));
      const url = new URL('/', source.origin);
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
    const targetFingerprint = String(raw.targetFingerprint == null ? '' : raw.targetFingerprint)
      .slice(0, TARGET_FINGERPRINT_MAX_LENGTH);
    const rawContextFingerprint = String(raw.contextFingerprint == null ? '' : raw.contextFingerprint);
    const contextFingerprint = /^\d{1,6}:\d{1,12}:[0-9a-f]{8}:[0-9a-f]{8}$/u.test(rawContextFingerprint)
      ? rawContextFingerprint
      : '';
    const sourceConversation = conversationIdentity(sourceUrl);
    const branchConversation = sanitizeConversationIdentity(raw.branchConversation);
    const branchReloadFrom = isValidJobId(raw.branchReloadFrom) ? String(raw.branchReloadFrom) : '';
    const fallbackTranscript = String(raw.fallbackTranscript == null ? '' : raw.fallbackTranscript)
      .replace(/\r\n?/gu, '\n')
      .slice(0, SIDE_FALLBACK_TRANSCRIPT_MAX_LENGTH)
      .trim();
    const fallbackMode = raw.fallbackMode === true && Boolean(fallbackTranscript);
    return {
      version: 1,
      createdAt,
      sourceUrl,
      sourceRoute: routeKey(sourceUrl),
      sourceConversation,
      kind,
      locator: sanitizeLocator(raw.locator),
      targetFingerprint,
      contextFingerprint,
      question,
      // Ask in new chat is an automatic workflow: a stale or malformed saved
      // preference must never turn it back into a review-and-send step.
      autoSend: kind === 'ask' ? true : raw.autoSend === true,
      branchClickAttempted: !fallbackMode && raw.branchClickAttempted === true,
      branchConversation: branchConversation && branchConversation !== sourceConversation ? branchConversation : '',
      branchReloadFrom,
      fallbackMode,
      fallbackTranscript,
      questionInserted: raw.questionInserted === true,
      baselineUserCount: clampInteger(raw.baselineUserCount, -1, -1, 100_000),
      sendAttempted: raw.sendAttempted === true,
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

  function isMountedAndNotHidden(element) {
    if (!element || !element.isConnected || element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    const hiddenParent = element.closest && element.closest('[hidden], [aria-hidden="true"], [inert], [data-state="closed"]');
    if (hiddenParent) return false;
    try {
      const view = element.ownerDocument && element.ownerDocument.defaultView;
      for (let current = element; view && current && current.nodeType === 1; current = current.parentElement) {
        const style = view.getComputedStyle(current);
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')) return false;
      }
    } catch (_error) {
      // A mounted element inside the strongly scoped picker is still usable
      // when computed style is temporarily unavailable during a rerender.
    }
    return true;
  }

  function closestUserTurn(node) {
    const element = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!element || typeof element.closest !== 'function') return null;
    const primary = element.closest(TURN_SELECTOR);
    if (primary) return roleOfTurn(primary) === 'user' ? primary : null;
    const roleNode = element.closest('[data-message-author-role="user"]');
    return roleNode ? roleNode.closest('article') || roleNode : null;
  }

  function isEditableComposer(element) {
    if (!element || element.nodeType !== 1 || !element.matches(LOCAL_COMPOSER_SELECTOR) ||
      element.closest(`#${UI_ROOT_ID}`) || element.disabled || element.readOnly ||
      element.getAttribute('aria-disabled') === 'true') return false;
    if (element.tagName !== 'TEXTAREA') {
      const editable = lowerText(element.getAttribute('contenteditable'));
      if (!(element.isContentEditable || editable === 'true' || editable === 'plaintext-only')) return false;
    }
    return isProbablyVisible(element);
  }

  function findComposerInScope(scope, preferredTarget = null) {
    if (!scope || typeof scope.querySelectorAll !== 'function') return null;
    const target = preferredTarget && (preferredTarget.nodeType === 1 ? preferredTarget : preferredTarget.parentElement);
    const direct = target && (target.matches(LOCAL_COMPOSER_SELECTOR)
      ? target
      : target.closest && target.closest(LOCAL_COMPOSER_SELECTOR));
    if (direct && (scope === direct || scope.contains(direct)) && isEditableComposer(direct)) return direct;
    return [...scope.querySelectorAll(LOCAL_COMPOSER_SELECTOR)].find(isEditableComposer) || null;
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

  function normalizeComposerPayload(value) {
    return String(value == null ? '' : value)
      .replace(/\r\n?/gu, '\n')
      .replace(/[\u2028\u2029]/gu, '\n')
      .replace(/\u00a0/gu, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/gu, '')
      .replace(/[ \t]+$/gmu, '')
      .trim();
  }

  function composerTextSemanticallyEquals(composer, value) {
    return Boolean(composer && normalizeComposerPayload(getComposerText(composer)) === normalizeComposerPayload(value));
  }

  function fallbackTransferMarker(transferId) {
    return isValidJobId(transferId) ? `[Workflow Toolkit transfer ${transferId}]` : '';
  }

  function fallbackDraftTextMatches(actualValue, expectedValue, transferId) {
    const rawActual = String(actualValue == null ? '' : actualValue);
    const rawExpected = String(expectedValue == null ? '' : expectedValue);
    if (rawExpected.length > SIDE_FALLBACK_PROMPT_MAX_LENGTH ||
      rawActual.length > SIDE_FALLBACK_PROMPT_MAX_LENGTH * 2 + 4_096) return false;
    const actual = normalizeComposerPayload(rawActual);
    const expected = normalizeComposerPayload(rawExpected);
    if (!actual || !expected) return false;
    const marker = fallbackTransferMarker(transferId);
    if (!marker || !actual.includes(marker) || !expected.includes(marker)) return false;
    if (actual === expected) return true;
    const editorCanonical = (value) => value
      .normalize('NFC')
      .replace(/[\u061C\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069]/gu, '')
      .replace(/\n(?:[ \t]*\n)+/gu, '\n');
    return editorCanonical(actual) === editorCanonical(expected);
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

  function setComposerText(composer, value, win, maximumLength = QUESTION_MAX_LENGTH, verifier = null) {
    if (!composer || !win) return false;
    const limit = clampInteger(maximumLength, QUESTION_MAX_LENGTH, 1, SIDE_FALLBACK_PROMPT_MAX_LENGTH);
    const text = String(value == null ? '' : value).slice(0, limit);
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
    const insertedTextIsValid = inserted && (typeof verifier === 'function'
      ? verifier(composer, text) === true
      : getComposerText(composer) === text);
    if (!insertedTextIsValid) {
      composer.textContent = text;
    }
    dispatchInput(composer, win, text);
    return typeof verifier === 'function' ? verifier(composer, text) === true : composerTextEquals(composer, text);
  }

  function composerScope(composer) {
    if (!composer) return null;
    const form = composer.closest('form');
    if (form) return form;
    const editTurn = closestUserTurn(composer);
    if (editTurn) return editTurn;
    let ancestor = composer.parentElement;
    for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
      if (SEND_BUTTON_SELECTORS.some((selector) => ancestor.querySelector(selector))) return ancestor;
    }
    return composer.closest('main') || composer.ownerDocument;
  }

  function findSendButton(doc, composer = findComposer(doc)) {
    if (!doc || !composer) return null;
    const scope = composerScope(composer) || doc;
    for (const selector of SEND_BUTTON_SELECTORS) {
      const button = [...scope.querySelectorAll(selector)].find(isProbablyVisible);
      if (button) return button;
    }
    const editTurn = closestUserTurn(composer);
    if (!editTurn) return null;
    const form = composer.closest('form');
    const candidates = [...doc.querySelectorAll(SUBMISSION_CONTROL_SELECTOR)].filter((control) => {
      if (!isProbablyVisible(control) || control.closest(`#${UI_ROOT_ID}`)) return false;
      const associatedForm = control.form || control.closest('form');
      return form && associatedForm === form || editTurn.contains(control);
    });
    return candidates.find((control) => isEditSubmissionControl(control, composer)) || null;
  }

  function isEditSubmissionControl(control, composer, suppliedEditTurn = null) {
    const editTurn = suppliedEditTurn || closestUserTurn(composer);
    if (!control || !composer || !editTurn || !isProbablyVisible(control) ||
      control.closest(`#${UI_ROOT_ID}`)) return false;
    const form = composer.closest('form');
    const associatedForm = control.form || control.closest('form');
    if (!(form && associatedForm === form) && !editTurn.contains(control)) return false;
    if (control.matches(SEND_BUTTON_SELECTORS.join(', '))) return true;
    const label = lowerText(`${accessibleText(control)} ${control.value || ''}`);
    const testId = lowerText(control.getAttribute('data-testid'));
    if (/\b(?:cancel|discard|close|regenerate|retry|branch|edit)\b/iu.test(label) &&
      !/\b(?:send|submit|resend)\b/iu.test(label)) return false;
    if (/\b(?:send|submit|resend)\b/iu.test(testId) && !/\b(?:cancel|discard)\b/iu.test(testId)) return true;
    if (control.matches('button[type="submit"], input[type="submit"]') &&
      !/\b(?:cancel|discard|close)\b/iu.test(label)) return true;
    return /^(?:send|resend|submit|save\s*(?:&|and)\s*(?:send|submit)|send\s+message|send\s+prompt)$/iu.test(label);
  }

  function extractModelLevel(value) {
    const text = lowerText(separateAdjacentLevelBadge(value))
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
    const text = lowerText(separateAdjacentLevelBadge(value)).replace(/[–—·|/()]+/gu, ' ').replace(/\s+/gu, ' ');
    if (!text || /^(?:configure|settings?|automatic switching)\b/iu.test(text) || isModelUpsellLabel(text) || /\bhigh school\b/iu.test(text)) return '';
    if (options.allowBareEffort === true) {
      if (/^standard(?:\s+standard)?(?:\s+reasoning)?$/iu.test(text)) return 'medium';
      if (/^extended(?:\s+extended)?(?:\s+reasoning)?$/iu.test(text)) return 'high';
      if (/^heavy(?:\s+heavy)?(?:\s+reasoning)?$/iu.test(text)) return 'extra-high';
    }
    const prefixedEffort = text.match(/^(?:(?:model|reasoning effort|thinking time|intelligence level)\s*:?\s*|(?:(?:gpt[-\s]?)?\d+(?:\.\d+)+|o\d+(?:[-.][\w]+)*)\s+)(instant|fast|auto|standard|medium|extended|high|heavy|extra\s*-?\s*high|ultra)\b/iu);
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
    const match = firstLine.match(ROUTE_OVERRIDE_PATTERN);
    if (!match) return null;
    const token = lowerText(match[1]).replace(/\s*-\s*|\s+/gu, '-');
    if (token === 'extra-high' || token === 'x-high' || token === 'xhigh') return 'extra-high';
    if (token === 'pro-standard') return 'pro';
    if (token === 'highest') return 'max';
    return token;
  }

  function attachmentByteSizeFromText(value) {
    const match = String(value == null ? '' : value).match(/\b(\d+(?:\.\d+)?)\s*(bytes?|[kmgt]i?b)\b/iu);
    if (!match) return 0;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount < 0) return 0;
    const unit = lowerText(match[2]);
    const multiplier = unit.startsWith('t') ? 1024 ** 4
      : unit.startsWith('g') ? 1024 ** 3
        : unit.startsWith('m') ? 1024 ** 2
          : unit.startsWith('k') ? 1024
            : 1;
    return Math.round(amount * multiplier);
  }

  function attachmentNameFromLabel(value) {
    const label = normalizeText(value);
    if (!label) return '';
    const segments = label.split('|').map((part) => part.trim()).filter(Boolean);
    for (const rawSegment of segments) {
      const segment = rawSegment
        .replace(/^(?:(?:remove|delete|open|preview|download)\s+)?(?:the\s+)?(?:file|attachment)\s*:?\s*/iu, '')
        .replace(/\s+\(?(?:\d+(?:\.\d+)?\s*(?:bytes?|[kmgt]i?b))\)?$/iu, '')
        .trim();
      const match = segment.match(/([\p{L}\p{N}][^/\\|\n]{0,180}\.[a-z0-9]{1,12})$/iu);
      if (match) return match[1].trim();
    }
    return '';
  }

  function attachmentKind(name, mime = '', label = '') {
    const lowerName = lowerText(name);
    const lowerMime = lowerText(mime);
    const lowerLabel = lowerText(label);
    const extensionMatch = lowerName.match(/\.([a-z0-9]{1,12})$/iu);
    const extension = extensionMatch ? extensionMatch[1] : '';
    if (lowerMime.startsWith('image/') || /^(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/u.test(extension)) return 'image';
    if (lowerMime.startsWith('audio/') || /^(?:aac|flac|m4a|mp3|ogg|wav|wma)$/u.test(extension)) return 'audio-video';
    if (lowerMime.startsWith('video/') || /^(?:avi|m4v|mkv|mov|mp4|mpeg|mpg|webm|wmv)$/u.test(extension)) return 'audio-video';
    if (/\b(?:zip|compressed|archive)\b/u.test(lowerMime) || /^(?:7z|bz2|gz|rar|tar|tgz|xz|zip)$/u.test(extension)) return 'archive';
    if (/^(?:csv|db|db3|json|jsonl|ndjson|numbers|ods|parquet|sqlite|sqlite3|sql|tsv|xls|xlsb|xlsm|xlsx)$/u.test(extension) ||
      /(?:\b(?:json|ndjson|csv|tab-separated|database|sqlite|parquet|excel)\b|spreadsheet)/u.test(`${lowerMime} ${lowerLabel}`)) return 'structured-data';
    if (/^(?:c|cc|cpp|cs|css|dart|ex|exs|go|h|hpp|html|ipynb|java|js|jsx|kt|kts|lua|m|php|pl|py|r|rb|rs|scala|sh|sol|swift|toml|ts|tsx|vue|xml|ya?ml)$/u.test(extension) ||
      /\b(?:source code|notebook|javascript|typescript|python|shellscript)\b/u.test(`${lowerMime} ${lowerLabel}`)) return 'code';
    if (/^(?:doc|docx|epub|key|md|odt|pages|pdf|ppt|pptx|rtf|tex|txt)$/u.test(extension) ||
      /\b(?:pdf|document|presentation|powerpoint|word processing|plain text)\b/u.test(`${lowerMime} ${lowerLabel}`)) return 'document';
    return 'unknown';
  }

  function buildAttachmentProfile(values = [], countHint = 0) {
    const source = Array.isArray(values) ? values.slice(0, 100) : [];
    const items = source.map((value) => {
      const record = value && typeof value === 'object' ? value : { label: value };
      const label = normalizeText(record.label || record.text || record.name || '');
      const name = normalizeText(record.name || attachmentNameFromLabel(label)).slice(0, 220);
      const mime = lowerText(record.mime || record.type || '').slice(0, 120);
      const numericSize = Number(record.size);
      const size = Number.isFinite(numericSize) && numericSize >= 0
        ? Math.round(numericSize)
        : attachmentByteSizeFromText(`${record.size || ''} ${label}`);
      return {
        key: normalizeText(record.key || '').slice(0, 240),
        name,
        mime,
        size,
        kind: attachmentKind(name, mime, label),
        label: label.slice(0, 240),
      };
    });
    const count = Math.max(clampInteger(countHint, 0, 0, 100), items.length);
    const kinds = [...new Set(items.map((item) => item.kind).filter(Boolean))].sort();
    const complexKinds = new Set(['archive', 'audio-video', 'code', 'structured-data']);
    const complexCount = items.filter((item) => complexKinds.has(item.kind)).length;
    const largeCount = items.filter((item) => item.size >= 10 * 1024 * 1024).length;
    const sensitiveCount = items.filter((item) => /\b(?:contract|lease|legal|medical|diagnos\w*|radiology|lab\s+results?|medications?|prescriptions?|health(?:\s+records?)?|bloodwork|bank(?:\s+statements?)?|mortgage|loans?|investments?|insurance(?:\s+polic(?:y|ies))?|tax|financial|security|audit|patient|payroll|ssn|pii)\b/iu.test(
      `${item.name} ${item.label}`.replace(/[_-]+/gu, ' '),
    )).length;
    return {
      count,
      items,
      kinds,
      describedCount: items.length,
      unknownCount: Math.max(0, count - items.filter((item) => item.kind !== 'unknown').length),
      complexCount,
      largeCount,
      sensitiveCount,
      totalBytes: items.reduce((sum, item) => sum + item.size, 0),
    };
  }

  function normalizeAttachmentProfile(context = {}) {
    const supplied = context.attachmentProfile && typeof context.attachmentProfile === 'object'
      ? context.attachmentProfile
      : null;
    if (supplied && Array.isArray(supplied.items)) {
      return buildAttachmentProfile(supplied.items, Math.max(
        clampInteger(context.attachmentCount, 0, 0, 100),
        clampInteger(supplied.count, 0, 0, 100),
      ));
    }
    return buildAttachmentProfile(context.attachmentLabels || [], context.attachmentCount);
  }

  function combineAttachmentProfiles(...profiles) {
    const items = [];
    const stableKeys = new Set();
    const fallbackKeys = new Set();
    let unnamedCount = 0;
    for (const profile of profiles) {
      if (!profile || typeof profile !== 'object') continue;
      const sourceItems = Array.isArray(profile.items) ? profile.items : [];
      unnamedCount += Math.max(0, clampInteger(profile.count, 0, 0, 100) - sourceItems.length);
      const currentFallbackKeys = new Set();
      for (const item of sourceItems) {
        const stableKey = normalizeText(item.key || '');
        const fallbackKey = lowerText(item.name || item.label || `${item.mime}|${item.size}`);
        if (stableKey) {
          if (stableKeys.has(stableKey)) continue;
          stableKeys.add(stableKey);
        } else if (fallbackKey && fallbackKeys.has(fallbackKey)) {
          continue;
        }
        if (fallbackKey) currentFallbackKeys.add(fallbackKey);
        items.push(item);
      }
      for (const key of currentFallbackKeys) fallbackKeys.add(key);
    }
    return buildAttachmentProfile(items, Math.min(100, items.length + unnamedCount));
  }

  function strongerRouteLevel(...values) {
    let strongest = '';
    for (const value of values) {
      const level = extractModelLevel(value || '');
      if (level && modelLevelRank(level) > modelLevelRank(strongest)) strongest = level;
    }
    return strongest;
  }

  function explicitlyReferencesOlderMaterials(value) {
    const text = normalizeText(value).toLocaleLowerCase('en-US');
    if (!text) return false;
    const material = String.raw`(?:attachments?|uploads?|files?|documents?|pdfs?|spreadsheets?|workbooks?|worksheets?|sheets?|csvs?|datasets?|slide\s+decks?|presentations?|images?|screenshots?|diagrams?|tables?|charts?)`;
    const action = String.raw`(?:compare|review|analy[sz]e|summari[sz]e|use|open|read|explain)`;
    return [
      new RegExp(String.raw`^${action}\s+(?:all|every)\s+(?:the\s+)?(?:(?:uploaded|attached|provided|shared)\s+)?${material}(?:\s+(?:so\s+far|above|earlier|previously|(?:from|in)\s+(?:this|the|our|whole|entire|full)\s+(?:chat|conversation|thread)|(?:i|we|you)\s+(?:uploaded|attached|provided|shared)(?:\s+(?:here|above))?))?[?.!]*$`, 'iu'),
      new RegExp(String.raw`^${action}\s+(?:the\s+)?(?:first|earliest|oldest|original)\s+(?:uploaded\s+)?${material}(?:\s+(?:here|above|in\s+(?:this|the|our)\s+(?:chat|conversation|thread)))?[?.!]*$`, 'iu'),
      new RegExp(String.raw`^compare\s+(?:the\s+)?first\s+and\s+last\s+${material}[?.!]*$`, 'iu'),
      new RegExp(String.raw`^what\s+was\s+in\s+(?:the\s+)?(?:first|earliest|oldest|original)\s+(?:uploaded|attached|provided|shared)\s+${material}[?.!]*$`, 'iu'),
      new RegExp(String.raw`\b(?:first|earliest|oldest|original)\s+${material}\s+(?:i|we|you)\s+(?:uploaded|attached|provided|shared)\b`, 'iu'),
      new RegExp(String.raw`^${action}\b.{0,80}\b(?:earlier|previous|older)\s+${material}[?.!]*$`, 'iu'),
      new RegExp(String.raw`^${action}\b.{0,80}\b${material}\s+from\s+(?:the\s+)?(?:whole|entire|full)\s+(?:chat|conversation|thread)[?.!]*$`, 'iu'),
    ].some((pattern) => pattern.test(text));
  }

  function explicitlyReferencesOlderConversation(value) {
    const text = normalizeText(value).toLocaleLowerCase('en-US')
      .replace(/[“"][^”"\n]{0,500}[”"]/gu, ' quoted text ')
      .replace(/‘[^’\n]{0,500}’/gu, ' quoted text ')
      .replace(/`[^`\n]{0,500}`/gu, ' quoted text ');
    if (!text) return false;
    if (explicitlyReferencesOlderMaterials(text)) return true;
    return [
      /\b(?:go|look|refer|return)(?:ing)?\s+back\s+to\s+(?:the\s+)?(?:message|turn)\s*(?:#|number\s*)?\d+\b/iu,
      /\b(?:message|turn)\s*(?:#|number\s*)?\d+\s+(?:from|in)\s+(?:this|the|our)\s+(?:chat|conversation|thread|discussion)\b/iu,
      /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(?:messages?|turns?|questions?|requests?|tasks?|prompts?)\s+(?:ago|back)\b/iu,
      /\b(?:go|look|refer|return)(?:ing)?\s+back\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(?:messages?|turns?|questions?|requests?|tasks?|prompts?)\b/iu,
      /\b(?:go|look|refer|return)(?:ing)?\s+back(?:\s+to)?\s+(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:message|turn|question|request|task|prompt)\b/iu,
      /\b(?:continue|finish|resume|use|revisit|return\s+to)\s+(?:(?:the|our)\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:message|turn|question|request|task|prompt)\b/iu,
      /\b(?:our|your|my)\s+(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|earliest|original)\s+(?:message|turn|question|request|task|prompt|answer|response)\b/iu,
      /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:message|turn|question|request|task|prompt)\s+(?:from|in)\s+(?:this|the|our)\s+(?:chat|conversation|thread|discussion)\b/iu,
      /\b(?:message|turn|question|request|task|prompt)\s+(?:right\s+)?before\s+(?:the\s+)?last\b/iu,
      /\b(?:message|question|request|task|prompt|answer|response|instructions?|discussion|work|proof)\s+(?:from|at)\s+the\s+(?:very\s+)?beginning\b/iu,
      /\b(?:from|since|at|near)\s+the\s+(?:very\s+)?(?:start|beginning|top)\s+of\s+(?:this|the|our)\s+(?:chat|conversation|thread|discussion)\b/iu,
      /\b(?:continue|finish|resume|use|apply|repeat|revisit|return\s+to)\s+(?:(?:the|that|our|your)\s+)?(?:message|question|request|task|prompt|answer|response|instructions?|work|proof|problem)\b.{0,80}\b(?:at|from)\s+the\s+(?:very\s+)?(?:start|beginning)\b/iu,
      /\b(?:earlier|previously|before)\s+in\s+(?:this|the|our)\s+(?:chat|conversation|thread|discussion)\b/iu,
      /\b(?:continue|finish|resume|use|revisit|return\s+to|go\s+back\s+to)\s+(?:(?:the|that|our)\s+)?(?:earlier|previous|prior|old)\s+(?:task|request|problem|question|prompt|instructions?|work|discussion|approach|method)\b/iu,
      /\b(?:continue|finish|resume)\s+what\s+(?:we|you)\s+(?:were|was)\s+(?:doing|working\s+on|discussing)\s+before\b/iu,
      /\b(?:way|much|far)\s+(?:back|earlier)\s+in\s+(?:this|the|our)\s+(?:chat|conversation|thread|discussion)\b/iu,
      /\b(?:our|this|the\s+current|current)\s+(?:whole|entire|full)\s+(?:chat|conversation|thread|discussion|history)\b/iu,
      /\b(?:summari[sz]e|review|use|consider|recap|continue\s+using|look\s+at|read|based\s+on)\b.{0,80}\b(?:(?:our|this|the|the\s+current|current)\s+)?(?:whole|entire|full)\s+(?:chat|conversation|thread|discussion|history|context)\b/iu,
      /\b(?:summari[sz]e|review|use|consider|recap|continue\s+using|look\s+at|read)\b.{0,80}\b(?:our|this|the|current)\s+(?:chat|conversation|thread|discussion)\s+history\b/iu,
      /\b(?:everything|all)\s+(?:(?:that\s+)?(?:we|you)\s+)?(?:have\s+)?(?:discussed|said|written|covered|done|decided|used)\s*(?:so\s+far|above|earlier)?\b/iu,
      /\b(?:use|consider|review|summari[sz]e|recap|continue\s+using|based\s+on)\b.{0,80}\b(?:everything|all)\s+(?:above|earlier|so\s+far|previous\s+messages?)\b/iu,
      /\b(?:all|every)\s+(?:earlier|previous|prior)\s+(?:messages?|turns?|questions?|requests?|answers?|responses?)\b/iu,
      /\b(?:recap|summary|review)\s+(?:of\s+)?(?:this|the|our)\s+(?:chat|conversation|thread|discussion)\b/iu,
    ].some((pattern) => pattern.test(text));
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

    const originalNormalized = normalizeText(raw);
    const topicResetMatch = originalNormalized.match(/^(?:(?:new|unrelated|separate)\s+(?:question|topic)|changing\s+(?:the\s+)?(?:question|topics?)|on\s+(?:an?\s+)?unrelated\s+note)\s*[.:,;!?—–-]\s*(.+)$/iu);
    const normalized = normalizeText(topicResetMatch ? topicResetMatch[1] : originalNormalized);
    const topicReset = Boolean(topicResetMatch);
    const olderMaterialLongRangeReference = !topicReset && explicitlyReferencesOlderMaterials(normalized);
    const longRangeContextReference = !topicReset && explicitlyReferencesOlderConversation(raw);
    const wholeConversationReference = !topicReset && /\b(?:(?:our|this|the\s+current|current)\s+(?:whole|entire|full)\s+(?:chat|conversation|thread|discussion|history)|(?:summari[sz]e|review|use|consider|recap|continue\s+using|look\s+at|read|based\s+on)\b.{0,80}\b(?:(?:our|this|the|the\s+current|current)\s+)?(?:whole|entire|full)\s+(?:chat|conversation|thread|discussion|history|context)|(?:summari[sz]e|review|use|consider|recap|continue\s+using|look\s+at|read)\b.{0,80}\b(?:our|this|the|current)\s+(?:chat|conversation|thread|discussion)\s+history|(?:everything|all)\s+(?:(?:that\s+)?(?:we|you)\s+)?(?:have\s+)?(?:discussed|said|written|covered|done|decided|used)|(?:recap|summary|review)\s+(?:of\s+)?(?:this|the|our)\s+(?:chat|conversation|thread|discussion))\b/iu.test(originalNormalized);
    const currentAttachments = normalizeAttachmentProfile(context);
    const historicalAttachments = context.historicalAttachmentProfile && typeof context.historicalAttachmentProfile === 'object'
      ? buildAttachmentProfile(context.historicalAttachmentProfile.items || [], context.historicalAttachmentProfile.count)
      : buildAttachmentProfile(context.historicalAttachmentLabels || [], context.historicalAttachmentCount);
    const archivedAttachments = context.archivedAttachmentProfile && typeof context.archivedAttachmentProfile === 'object'
      ? buildAttachmentProfile(context.archivedAttachmentProfile.items || [], context.archivedAttachmentProfile.count)
      : buildAttachmentProfile();
    const hasPriorConversation = context.hasPriorConversation === true || Boolean(
      context.previousLevel || context.conversationLevel || context.assistantContextLevel || context.awaitingConfirmation,
    ) || historicalAttachments.count > 0 || archivedAttachments.count > 0;
    const previousLevel = strongerRouteLevel(
      context.previousLevel,
      context.conversationLevel,
      context.assistantContextLevel,
      longRangeContextReference && (!olderMaterialLongRangeReference || wholeConversationReference)
        ? context.archivedConversationLevel
        : '',
    );
    const archivedMeaningfulTurnCount = clampInteger(context.archivedMeaningfulTurnCount, 0, 0, 100_000);
    const archivedSampledTextLength = clampInteger(context.archivedSampledTextLength, 0, 0, 100_000_000);
    if (!normalized && currentAttachments.count === 0) {
      return { target: 'instant', score: 0, confidence: 0.94, explicit: false, reasons: ['empty prompt'] };
    }

    const lower = normalized.toLocaleLowerCase('en-US');
    if (/^(?:(?:(?:can|could|would|will)\s+you|i\s+(?:need|want)\s+you\s+to)\s+)?(?:please\s+)?(?:(?:try|attempt)\s+(?:to\s+)?(?:solve|prove|disprove|resolve)|try\s+solving|find\s+a\s+proof\s+of|(?:solve|prove|disprove|resolve))\b.{0,100}\b(?:riemann hypothesis|p\s*(?:versus|vs\.?|=)\s*np|navier[\s-]stokes (?:existence|equations?)|birch and swinnerton-dyer conjecture)\b/iu.test(lower)) {
      return {
        target: 'pro',
        score: 100,
        confidence: 0.98,
        explicit: false,
        reasons: ['named open research problem requires the strongest available reasoning'],
      };
    }
    const classificationSource = topicReset ? normalized : raw;
    const sample = classificationSource.length <= 24_000
      ? classificationSource
      : `${classificationSource.slice(0, 12_000)}\n${classificationSource.slice(-12_000)}`;
    const sampleLower = sample.toLocaleLowerCase('en-US');
    const wordCount = (sample.match(/[\p{L}\p{N}_]+/gu) || []).length;
    const codeLineCount = sample.split(/\r?\n/u).filter((line) => /^\s{4,}|[{}();]|=>|\b(?:const|let|var|def|class|function|import|SELECT)\b/u.test(line)).length;
    const reasons = [];
    const strongGroups = new Set();
    let score = 12;
    let highStakes = false;
    let debuggingWork = false;
    let formalReasoning = false;
    let longHorizon = false;
    let expertWork = false;
    let longRangeMinimumLevel = '';
    const behaviorPreservation = /\bwithout\s+changing\s+(?:behavior|behaviour|semantics|output)\b|\bpreserve\s+(?:the\s+)?(?:exact\s+)?(?:behavior|behaviour|semantics|output)\b/iu.test(sampleLower);
    const answerVerification = requiresAnswerVerification(raw, context);

    const acknowledgment = USER_ACKNOWLEDGMENT_PATTERN;
    const affirmativeConfirmation = !topicReset && context.awaitingConfirmation === true && (
      /^(?:(?:yes|yeah|yep|okay|ok|sure|absolutely|definitely|of\s+course)(?:\s+thing)?(?:[,;:]?\s+(?:please|do\s+(?:it|that)|go\s+ahead|continue|proceed))?|please|go\s+ahead|do\s+it|sounds\s+good(?:\s+to\s+me)?|that\s+works)[?.!\s]*$/iu.test(lower) ||
      /^(?:(?:yes|yeah|yep|okay|ok|sure|absolutely|definitely|of\s+course)(?:\s+thing)?|go\s+ahead)(?:\s*[,;:]\s*|\s+(?:and|but)\s+)(?:(?:and|but)\s+)?\S.+$/iu.test(lower)
    );
    const simpleTransform = /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:make|rewrite|rephrase|paraphrase|proofread|shorten|summari[sz]e|translate|format|spell|capitalize|lowercase|edit)\b.{0,160}$/iu;
    const compoundReasoning = /\b(?:and|but|then|also)\b.{0,100}\b(?:analy[sz]e|assess|evaluate|verify|validate|confirm|check|compare|recommend|justify|explain|flag|identify|find|solve|decide|detect|review|calculate|ensure|audit|inspect|test|tell)\b|\b(?:weakness(?:es)?|risks?|risky|dangerous|secure|security|thread[\s-]?safe|injection|vulnerabilit\w*|trade-?offs?|edge cases?|hidden assumptions?|better|more accurate|riemann hypothesis|p\s+(?:versus|vs\.?)\s+np)\b|\bwithout\s+changing\s+(?:behavior|behaviour|semantics|output)\b|^(?:please\s+)?make\s+sure\b|^(?:please\s+)?make\s+(?:a|an)\s+(?:plan|strategy|argument|recommendation|decision)\b/iu;
    const continuation = /^(?:why(?:\s+(?:not|though))?|how(?:\s+(?:so|exactly|did\s+you\s+know))?|really|seriously|correct|right|wrong|sources?|evidence|proof|examples?|meaning|where\s+did\s+you\s+get\s+that|what\s+do\s+you\s+mean|i(?:['’]m|\s+am)\s+(?:lost|confused)|(?:i\s+)?(?:still\s+)?(?:(?:do\s+not|don['’]?t)\s+(?:follow|understand|get\s+it))|(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:elaborate(?:\s+(?:more|on\s+that))?|go\s+deeper|clarify|show\s+(?:me\s+)?the\s+steps)|clarify\s+that|say\s+that\s+another\s+way|put\s+that\s+differently|break\s+that\s+down|go\s+(?:over\s+that\s+again|through\s+it\s+once\s+more)|expand\s+on\s+that|explain\s+(?:further|why|your\s+reasoning)|show\s+your\s+work|walk\s+me\s+through\s+your\s+logic|continue(?: and (?:finish|complete) it)?|continue\s+from\s+there|go on|fix (?:that|it)|try again|prove (?:it|that)|finish (?:that|it)|run\s+through\s+that\s+again|walk\s+me\s+through\s+it\s+again|where\s+did\s+that\s+come\s+from|source\s+for\s+that|cite\s+that|recalculate (?:that|this|it)|re[\s-]?evaluate (?:the\s+)?(?:answer|result|that|this|it)|check your logic|your answer and mine disagree|(?:do\s+not|don['’]?t)\s+make\s+mistakes|answer\s+carefully)[?.!]*$/iu;
    const simpleFact = /^(?:(?:define\s+[\p{L}\p{N}'’.-]+(?:\s+[\p{L}\p{N}'’.-]+){0,3}|what\s+(?:color\s+is|(?:planet|country|city|animal|element|number|day|month|year)\s+is|is\s+the\s+(?:capital|largest|smallest|tallest|longest)\b)\s*.{1,80}|how\s+(?:many|much|long|far|old)\b.{1,100}|who\s+(?:wrote|created|invented|painted|discovered)\s+.{1,100}|when\s+did\s+.{1,100}\s+(?:end|begin|start|happen|occur)|where\s+is\s+.{1,100})|(?:define|explain|what(?:['’]s|\s+(?:is|are)))\b.{1,120}\b(?:in simple terms|in one sentence)|what\s+does\b.{0,140}\bmean)[?.!]*$/iu;
    const simpleMath = /^(?:what is|calculate|compute)?\s*[\d\s()+\-*/^%.=]+\??$/iu;
    const simpleAdministrative = /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:confirm\s+(?:the\s+)?proof\s+of\s+delivery|confirm\s+(?:that\s+)?(?:(?:the|my|your|our|their)\s+)?email\s+address|(?:is|are)\s+(?:this|that|these|those)\s+correct\s+(?:spelling|spellings|grammar|wording|words?)|(?:(?:check|recheck|double[\s-]?check|verify|confirm|validate)\b|tell\s+me\s+(?:whether|if)\b).{0,100}\b(?:weather|temperature|email|inbox|work email|phone number|shipping address|address|appointment time|meeting time|meeting room|booking time|train time|train schedule|bus schedule|booking date|date|coupon code|username|password|file path|file name|solution file|url|link|sentence|translation|reservation|spelling|word|capitalization|verb tense|door|grocery list|customer name|order status|calendar|menu|paragraph|box)\b)\b/iu;
    const shortWriting = /\b(?:one|two|three|\d+)[\s-]+(?:sentence|line|word)s?\b|\bshort\s+(?:email|reply|message|paragraph)\b/iu;
    const technical = /\b(?:code|program|function|algorithm|python|javascript|typescript|rust|java|sql|regex|api|database|equation|solve|theorem|prove|proof|derive|rigorous(?:ly)?|quantum|relativity|cryptograph\w*|oauth|cors|access[\s-]?control|denial of service|halting problem|riemann hypothesis|p\s+(?:versus|vs\.?)\s+np|square root|math|physics|chemistry|research|study|analyze|analysis)\b/iu;
    const normalAnalysis = /\b(?:compare|contrast|plan|recommend|trade-?offs?|pros and cons|evaluate|analy[sz]e|strategy|outline)\b/iu;
    const advancedFactTopic = /\b(?:halting problem|riemann hypothesis|p\s+(?:versus|vs\.?|=)\s+np|navier[\s-]stokes|birch and swinnerton-dyer|quantum|relativity|formal verification)\b/iu;
    const safeSimpleFact = simpleFact.test(lower) && wordCount <= 24 && !advancedFactTopic.test(lower) && !compoundReasoning.test(lower);
    const safeSimpleTransform = simpleTransform.test(lower) && !compoundReasoning.test(lower) && !technical.test(lower) && !normalAnalysis.test(lower);
    const safeShortWriting = shortWriting.test(lower) && wordCount <= 35 && !technical.test(lower) && !normalAnalysis.test(lower) && !compoundReasoning.test(lower);
    // Ignore quoted payloads when deciding whether a prompt refers back to the
    // conversation. For example, translating “Where did that number come
    // from?” is a standalone transform, not a follow-up to earlier math.
    const contextProbe = lower
      .replace(/[“"][^”"\n]{0,500}[”"]/gu, ' quoted text ')
      .replace(/‘[^’\n]{0,500}’/gu, ' quoted text ')
      .replace(/`[^`\n]{0,500}`/gu, ' quoted text ');
    const contextualReference = /\b(?:this|that|them|their|these|those)\b|\b(?:first|second|third|last|next|previous|other)\s+(?:step|part|point|example|sentence|bullet|item|message|option|answer|result|paragraph|section|equation|formula|file|document|image|table|chart|one)\b/iu;
    const contextualLead = /^(?:(?:can|could|would|will|do|does|did|is|are|should)\b|(?:please\s+)?(?:explain|check|verify|review|fix|help|compare|continue|finish|redo|retry|try|solve|show|tell|change)\b|(?:what|why|how|which)\b)/iu;
    const simpleUiAction = /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:(?:check|uncheck|select|click|tick|press|open|close|copy|confirm)\s+(?:(?:this|that|the)\s+)?(?:[\p{L}\p{N}_-]+\s+){0,2}(?:box|checkbox|button|option|setting|link|dialog|text|menu)|check\s+(?:if|whether)\s+(?:this|that|it)\s+is\s+(?:the\s+)?(?:(?:right|left)\s+)?(?:button|option|link)|confirm\s+(?:this|that|the)?\s*email)\b/iu;
    const metalinguisticVerification = /^what does\b.{0,160}\b(?:verify|verification|check|confirm|answer)\b.{0,160}\bmean\b/iu.test(lower);
    const routineOperationalCheck = /\bproof\s+of\s+concept\b.{0,60}\b(?:builds?|runs?|works?)\b/iu.test(lower);
    const implicitContextFollowUp = /^(?:(?:what\s+(?:should\s+i\s+(?:do|change\s+here)|do\s+(?:i|we)\s+do\s+now|now|next)|(?:now|then)\s+what|(?:okay[,]?\s+)?(?:so\s+)?then\s+what|so\s+what\s+now|and\s+then|where\s+do\s+we\s+go\s+from\s+here)|which\s+one|(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:explain\s+more|do\s+the\s+next\s+one|continue\s+from\s+there)|(?:please\s+)?try\s+(?:a\s+)?different\s+approach|your answer and mine disagree)[?.!]*$/iu;
    const genericCheckFollowUp = /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:(?:check|verify|review)(?:\s+(?:this|that|it|again|once\s+more|(?:my|your|the)\s+(?:answer|result|solution|calculation|reasoning|work|proof)))?|recheck(?:\s+(?:this|that|it))?|double[\s-]?check(?:\s+(?:this|that|it))?)[?.!]*$/iu;
    const explicitContextTask = /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:improve|show|summari[sz]e|translate|rewrite|rephrase|shorten|format|simplify|continue|finish|apply|use|reuse|calculate|recalculate|solve|check|verify|explain|review|fix|change|compare)\b.{0,120}\b(?:this|that|it|them|these|those|answer|response|result|solution|code|proof|reasoning|matrix|equation|formula|fix|assumptions?|approach|function)\b/iu;
    const contextualRevision = /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?make\s+(?:this|that|it)\s+(?:better|clearer|shorter|simpler|more\s+(?:accurate|concise|formal|detailed|readable))[?.!]*$/iu;
    // Indexed references must be phrased as an action/question. A bare “line
    // 4” or “Part B” may be a bus route or a product name.
    const indexedContextTask = /^(?:(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:explain|review|check|verify|solve|do|continue|redo|show|use|apply|change|fix)\b.{0,80}\b(?:(?:line|paragraph|section|step|part|equation|formula|figure|table|chart|option|answer|result)\s*(?:number\s*)?(?:[a-z]|\d+|one|two|three|four|five|first|second|third|fourth|fifth)|(?:first|second|third|fourth|fifth|last|next|previous)\s+(?:line|paragraph|section|step|part|equation|formula|figure|table|chart|option|answer|result))|(?:does?|is|are)\s+(?:the\s+)?(?:equation|formula|step|result|answer)\s*(?:number\s*)?(?:[a-z]|\d+)\s+(?:still\s+)?(?:hold|work|apply|change|correct|valid|true|false)\b|what\s+does\s+the\s+(?:(?:first|second|third|fourth|fifth|last|next|previous)\s+(?:line|paragraph|section|step|equation|formula|figure|table|chart|option|answer|result)|(?:line|paragraph|section|step|equation|formula|figure|table|chart|option|answer|result)\s*(?:number\s*)?(?:[a-z]|\d+))\s+mean\b|(?:what|how)\s+about\s+(?:part|option)\s+[a-z0-9]+)\b/iu;
    const definiteContextObject = /\b(?:that|this|those|these)\s+(?:answer|response|result|solution|calculation|proof|reasoning|code|function|error|fix|approach|assumptions?|equation|formula|matrix|attachments?|uploads?|files?|documents?|pdfs?|spreadsheets?|workbooks?|worksheets?|sheets?|csvs?|datasets?|slide\s+decks?|presentations?|images?|screenshots?|diagrams?|tables?|charts?|paragraph|section|step)\b|\bthe\s+(?:answer(?!\s+key\b)|response|result|solution|calculation|reasoning|error|fix|approach|assumptions?|equation|formula|paragraph|section|step)\b/iu;
    const namedMaterialReference = /\b(?:(?:attached|uploaded|earlier|previous|this|that)\s+(?:attachments?|uploads?|files?|documents?|pdfs?|spreadsheets?|workbooks?|worksheets?|sheets?|csvs?|datasets?|slide\s+decks?|presentations?|images?|screenshots?|diagrams?|tables?|charts?)|the\s+(?:(?:attached|uploaded|earlier|previous)\s+)?(?:attachments?|uploads?|files?|documents?|pdfs?|spreadsheets?|workbooks?|worksheets?|sheets?|csvs?|datasets?|slide\s+decks?|presentations?|images?|screenshots?|diagrams?|tables?|charts?)|(?:open|read|review|analy[sz]e|use|using|summari[sz]e|explain|check|verify|compare|from)\s+(?:the|this|that|those|these|attached|uploaded|earlier|previous)\s+(?:attachments?|uploads?|files?|documents?|pdfs?|spreadsheets?|workbooks?|worksheets?|sheets?|csvs?|datasets?|slide\s+decks?|presentations?|images?|screenshots?|diagrams?|tables?|charts?)|what\s+do(?:es)?\s+(?:the|this|that|these|those)\s+(?:attachments?|uploads?|files?|documents?|pdfs?|spreadsheets?|workbooks?|worksheets?|sheets?|csvs?|datasets?|slide\s+decks?|presentations?|images?|screenshots?|diagrams?|tables?|charts?)\s+(?:say|show|contain|mean))\b/iu;
    const genericMaterialCompound = /\b(?:attachment\s+theory|file\s+system|document\s+object\s+model|table\s+of\s+contents|image\s+sensor|spreadsheet\s+software)\b/iu;
    const literalQuotedTextTransform = /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:rewrite|rephrase|paraphrase|proofread|shorten|summari[sz]e|translate|format|spell|capitalize|lowercase|edit)\s+(?:the\s+)?(?:text|phrase|word|name|filename|file\s+name|string|sentence)\b/iu.test(lower);
    const filenameProbe = literalQuotedTextTransform ? contextProbe : lower;
    const filenameMentioned = (name) => {
      if (!name || name.length < 3) return false;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      return new RegExp(`(?:^|[^\\p{L}\\p{N}_.-])${escaped}(?=$|[^\\p{L}\\p{N}_.-]|\\.(?=\\s|$))`, 'iu').test(filenameProbe);
    };
    const matchingKnownAttachments = combineAttachmentProfiles(
      buildAttachmentProfile(historicalAttachments.items.filter((item) => filenameMentioned(lowerText(item.name)))),
      buildAttachmentProfile(archivedAttachments.items.filter((item) => filenameMentioned(lowerText(item.name)))),
    );
    const mentionsKnownAttachment = matchingKnownAttachments.count > 0;
    const explicitOlderMaterialReference = explicitlyReferencesOlderMaterials(contextProbe);
    const explicitPriorWorkReference = [
      /\b(?:previous|earlier|prior|above|last)\s+(?:answers?|responses?|results?|solutions?|calculations?|proofs?|reasoning|code|formulas?|equations?|work|analysis|approaches?|steps?|questions?|instructions?|explanations?|messages?|discussion|context)\b/iu,
      /\b(?:answers?|responses?|results?|solutions?|calculations?|proofs?|reasoning|code|formulas?|equations?|work|analysis|approaches?|steps?|questions?|instructions?|explanations?|messages?)\s+(?:above|earlier|previously|from\s+before)\b/iu,
      /\b(?:your|our)\s+(?:(?:previous|earlier|last)\s+)?(?:answers?|responses?|results?|solutions?|calculations?|proofs?|reasoning|code|formulas?|equations?|work|analysis|approaches?|steps?|questions?|instructions?|explanations?)\b/iu,
      /\b(?:we|you)\s+(?:derived|calculated|proved|solved|wrote|explained|discussed|decided|recommended|used|said)\b/iu,
      /\bwhat\s+you\s+(?:said|wrote|calculated|explained|recommended)\s+(?:earlier|above|before)\b/iu,
      /\b(?:finish|continue|complete|extend|revise|correct)\s+(?:the|that|our|your)\s+(?:answer|response|solution|calculation|proof|reasoning|code|formula|equation|work|analysis|approach|step|instructions?|explanation)\b/iu,
    ].some((pattern) => pattern.test(contextProbe));
    const materialContextReference = namedMaterialReference.test(contextProbe) && !genericMaterialCompound.test(contextProbe) ||
      mentionsKnownAttachment;
    const currentMaterialReference = currentAttachments.count > 0 &&
      /\b(?:attachments?|uploads?|files?|documents?|pdfs?|spreadsheets?|workbooks?|worksheets?|sheets?|csvs?|datasets?|slide\s+decks?|presentations?|images?|screenshots?|diagrams?|tables?|charts?)\b/iu.test(contextProbe);
    const startsCurrentAttachmentTask = currentMaterialReference &&
      !mentionsKnownAttachment && !explicitOlderMaterialReference && !explicitPriorWorkReference;
    const externalOrdinalTopic = /\b(?:the\s+)?(?:first|second|third|fourth|fifth|last|next|previous)\s+(?:file|document|image|table|step|section|paragraph|line|part|question|example|formula|equation|version)\s+(?:of|in|on|for)\s+(?!(?:this|that|these|those|our|your|previous|earlier|above)\b)|\b(?:the\s+)?(?:first|earliest|oldest|original)\s+(?:image\s+sensor|spreadsheet\s+format|pdf\s+specification)\b/iu.test(contextProbe);
    const ellipticalFollowUp = hasPriorConversation && wordCount <= 40 && [
      /^(?:same(?:\s+(?:thing|approach|method|format|style|analysis|calculation|proof|code))?\s+(?:but|for|with|using|on)\b|same[?.!]*$)/iu,
      /^(?:this|that)\s+one\s+too[?.!]*$/iu,
      /^repeat\s+(?:it|this|that|the\s+same|for|with|using)\b/iu,
      /^based\s+on\s+(?:the\s+)?(?:above|earlier|previous|prior)\b/iu,
      /^refactor\b.{0,120}\b(?:it|this|that|the\s+same\s+way|same\s+way)\b/iu,
      /^(?:actually\s*[,;:]?\s*)?(?:do|write|make|implement|convert|rewrite|refactor)\s+(?:it|this|that)\s+(?:in|with|using)\b/iu,
      /^(?:use|in|with)\s+(?:python|typescript|javascript|java|rust|c\+\+|c#|go|ruby|swift|kotlin|sql|comments?|type hints?|tests?|examples?)\b[?.!]*$/iu,
      /^(?:add|include)\s+(?:error handling|comments?|type hints?|tests?|logging|validation|citations?|examples?)\b[?.!]*$/iu,
      /^(?:try|use)\s+(?:the\s+)?(?:other|second|different|alternative)\s+(?:method|approach|way|option|one)\b[?.!]*$/iu,
      /^(?:the\s+)?(?:first|second|third|fourth|fifth|last|next|other)\s+one[?.!]*$/iu,
      /^(?:part|step|section|question)\s*(?:number\s*)?(?:[a-z]|\d+)\s*(?:please)?[?.!]*$/iu,
      /^(?:be\s+more\s+(?:specific|detailed|concise|clear|rigorous)|(?:one|another)\s+more\s+example|(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:expand|elaborate))(?:\s+(?:more|on\s+it))?[?.!]*$/iu,
      /^(?:(?:make\s+it\s+)?(?:shorter|longer|simpler|clearer|faster|slower|formal|casual|professional|more\s+(?:concise|formal|casual|specific|detailed|rigorous)|less\s+(?:formal|technical|verbose))|(?:more|less)\s+(?:detail|detailed|concise|formal|technical|verbose)|(?:formal|casual|professional)\s+tone)(?:\s+please)?[?.!]*$/iu,
      /^(?:again|how\s+come|next|keep\s+going|try\s+(?:it\s+)?once\s+more|step[\s-]+by[\s-]+step|in\s+simpler\s+terms|one\s+more|more\s+examples?)(?:\s+please)?[?.!]*$/iu,
      /^(?:now\s+)?(?:(?:with|without|using)\s+(?:comments?|tests?|examples?|citations?|type\s+hints?|error\s+handling|logging|validation)|no\s+(?:comments?|tests?|examples?|citations?))(?:\s+please)?[?.!]*$/iu,
      /^(?:(?:use|as)\s+(?:bullets?|a\s+(?:table|list)|markdown)|only\s+show\s+(?:me\s+)?(?:the\s+)?(?:code|answer|result|steps?))(?:\s+please)?[?.!]*$/iu,
      /^(?:do\s+it\s+)?(?:the\s+)?other\s+(?:way|method|approach|format|style)(?:\s+please)?[?.!]*$/iu,
      /^(?:fix|correct)\s+(?:the\s+)?(?:errors?|mistakes?|bugs?)|^remove\s+(?:the\s+)?(?:errors?|mistakes?|bugs?|comments?|tests?|examples?|citations?)(?:\s+please)?[?.!]*$/iu,
      /^(?:do|finish|complete)\s+(?:the\s+)?rest(?:\s+please)?[?.!]*$/iu,
      /^same\s+thing(?:\s+please)?[?.!]*$/iu,
      /^(?:please\s+)?(?:do|write|create|generate|draft|try|redo|run|test|deploy|compile|execute|debug|optimi[sz]e|document|lint|implement|build|complete|secure|benchmark|profile|ship|analy[sz]e|inspect|read|audit|open|process)\s+(?:it|them|this|that)\b.{0,80}[?.!]*$/iu,
      /^(?:please\s+)?make\s+(?:it|them|this|that)(?:\s+please)?[?.!]*$/iu,
      /^(?:what\s+(?:does|did)\s+it\s+say|what\s+is\s+(?:in|inside)\s+it|(?:does|did)\s+it\s+mention\b.{1,80}|where\s+does\s+it\s+mention\b.{1,80}|find\b.{1,80}\bin\s+it|search\s+it\s+for\b.{1,80}|extract\b.{1,80}\bfrom\s+it|list\s+what\s+is\s+in\s+it|tell\s+me\s+what\s+it\s+says)[?.!]*$/iu,
      /^(?:proceed|go\s+ahead|go\s+for\s+it|please\s+do|yes\s+please|yes[,]?\s+do\s+(?:it|that)|(?:okay|ok|sure|sounds\s+good)[,;:]?\s+do\s+it|carry\s+on|let['’]?s\s+do\s+it)[?.!]*$/iu,
      /^(?:whatever\s+you\s+think\s+is\s+best|choose\s+for\s+me|pick\s+(?:one|for\s+me)|you\s+decide|which\s+one\s+do\s+you\s+recommend|what\s+do\s+you\s+recommend|what\s+would\s+you\s+do|use\s+your\s+best\s+judg(?:e)?ment)[?.!]*$/iu,
      /^no[,;:]?\s+(?:use|do|pick|choose|try|make|write|create|run|apply)\b.{1,100}[?.!]*$/iu,
      /^(?:pick|choose|use|do|try)\s+(?:the\s+)?(?:first|second|third|other|next|previous|alternative)\s+(?:one|option|method|approach|version|choice)(?:\s+instead)?[?.!]*$/iu,
      /^(?:use|try|choose|pick)\s+[\p{L}\p{N}+#.-]+\s+instead[?.!]*$/iu,
      /^(?:tell\s+me\s+more|more\s+please|details|why\s+exactly|(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?be\s+clearer|i\s+(?:am|['’]m)\s+still\s+confused)[?.!]*$/iu,
      /^(?:(?:using|based on)\s+(?:this|that|these|those)\b|(?:now|then)\s+(?:solve|calculate|find|derive|evaluate|simplify|substitute|continue|do)\b)/iu,
      /^(?:what\s+(?:happens?\s+when|if|about)|does\s+(?:this|that)\s+change\s+if)\s+[a-z](?:\s*(?:=|==|≠|!=|<=|>=|<|>)\s*[-+]?\w+(?:\.\w+)?|\s+is\s+(?:positive|negative|zero|null|true|false))\b/iu,
      /^(?:so|then)\s+(?:is|are|does?)\s+[a-z]\s+(?:positive|negative|zero|null|true|false)\b/iu,
      /^what\s+does\s+[a-z]\s+(?:represent|mean|stand\s+for)\b/iu,
      /^(?:(?:what|how)\s+about|(?:and|then)\s+for)\s+(?:the\s+)?(?:other|next|previous|first|second|third)\s+(?:one|case|option|part)\b/iu,
      /^(?:where\s+did\s+(?:this|that)(?:\s+(?:number|value|term|coefficient|factor|formula|assumption))?\s+come\s+from|(?:what|which)\s+(?:assumption|formula|equation|method|rule)\s+did\s+you\s+use)\b/iu,
      /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?show\s+(?:me\s+)?(?:the\s+)?(?:algebra|derivation|calculation|work|steps)\b/iu,
      /^(?:how\s+did\s+you\s+know\s+to|why\s+did\s+you)\s+(?:divide|multiply|subtract|add|cancel|factor|substitute|differentiate|integrate|choose|use|set)\b/iu,
      /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?explain\s+where\s+(?:the\s+)?(?:number\s+)?[-+]?\d+(?:\.\d+)?\s+came\s+from\b/iu,
      /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:calculate|find|derive|solve|do|explain|check|review)\s+(?:the\s+)?(?:next|other|remaining)\s+(?:value|case|one|part|option)\b/iu,
      /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:do|solve|explain|check|review)\s+(?:(?:part|option)\s+)?[a-z0-9][?.!]*$/iu,
      /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:(?:explain|simplify)(?:\s+(?:this|that|it))?|go\s+over\s+(?:this|that|it)|(?:give|show)\s+(?:me\s+)?(?:another|one\s+more)\s+example|repeat\s+(?:this|that|it))[?.!]*$/iu,
      /^(?:(?:what|how)\s+about)\s+(?:the\s+)?(?:last|next|other|previous)\s+(?:example|case)\b/iu,
      /^(?:(?:what|how)\s+about\s+(?:the\s+)?(?:item|bullet|point|example)\s+(?:[a-z]|\d+)|(?:and|what\s+about)\s+(?:if|when)\s+[a-z]\s+(?:is\s+)?(?:positive|negative|zero|null|true|false))\b/iu,
      /^(?:(?:what|how)\s+about\b.{1,120}|what\s+if\b.{1,120}|and\b.{1,120})[?.!]*$/iu,
      /^(?:(?:does|will|would|can|could)\s+it\s+work\b.{0,100}|should\s+i\s+(?:sign|take|use|keep|remove)\s+it\b.{0,100}|can\s+i\s+(?:deploy|take|use|move|delete|send)\s+it\b.{0,100}|where\s+should\s+i\s+(?:put|place|save|store)\s+it\b.{0,100}|what\s+should\s+i\s+do\s+with\s+it\b.{0,100}|what\s+is\s+it|how\s+does\s+it\s+work|why\s+is\s+it\s+(?:wrong|incorrect)|what\s+about\s+it)[?.!]*$/iu,
    ].some((pattern) => pattern.test(contextProbe));
    const contextDependent = mentionsKnownAttachment || explicitOlderMaterialReference || affirmativeConfirmation || !topicReset && (
      longRangeContextReference ||
      continuation.test(contextProbe) || implicitContextFollowUp.test(contextProbe) || genericCheckFollowUp.test(contextProbe) ||
      !externalOrdinalTopic && (explicitContextTask.test(contextProbe) || indexedContextTask.test(contextProbe) || definiteContextObject.test(contextProbe)) ||
      contextualRevision.test(contextProbe) || materialContextReference || ellipticalFollowUp ||
      !externalOrdinalTopic && contextualReference.test(contextProbe) && contextualLead.test(contextProbe) ||
      /^(?:now\s+)?(?:apply|use)\s+(?:that|this|the\s+same)\b|^(?:now\s+)?calculate\s+(?:it|that|this)\b|\b(?:its|their)\s+(?:determinant|value|meaning|effect|result|output)\b/iu.test(contextProbe)
    );
    const contextualTransform = contextDependent && (
      safeSimpleTransform || /\b(?:turn|convert)\b.{0,80}\b(?:into|to)\b.{0,40}\b(?:bullets?|table|list|spanish|english)\b/iu.test(contextProbe)
    );
    const ambiguousFollowUp = wordCount <= 40 && !simpleAdministrative.test(lower) && !simpleUiAction.test(lower) && contextDependent;
    let uncertainBase = false;

    if (acknowledgment.test(lower)) score = 4;
    else if (simpleMath.test(lower)) score = 6;
    else if (safeSimpleFact) score = 12;
    else if (safeSimpleTransform || simpleAdministrative.test(lower) || simpleUiAction.test(lower) || safeShortWriting) score = 12;
    else if (/\b(?:write|rewrite|summari[sz]e|translate|draft|edit)\b/iu.test(lower)) score = 18;
    else if (technical.test(lower) || /\b(?:architecture|concurrency|distributed system|security review|threat model)\b/iu.test(lower)) score = 28;
    else if (normalAnalysis.test(lower)) score = 24;
    else {
      score = wordCount > 80 ? 36 : wordCount > 45 ? 28 : 24;
      uncertainBase = true;
      reasons.push('unclear complexity favored the safer level');
    }

    if (answerVerification) {
      score = Math.max(score, 40);
      reasons.push('verify a supplied answer before explaining');
      strongGroups.add('supplied-answer verification');
    }

    if (longRangeContextReference && (archivedMeaningfulTurnCount >= 20 || archivedSampledTextLength >= 20_000)) {
      longRangeMinimumLevel = archivedMeaningfulTurnCount >= 80 || archivedSampledTextLength >= 80_000
        ? 'extra-high'
        : 'high';
      score = Math.max(score, longRangeMinimumLevel === 'extra-high' ? 62 : 44);
      strongGroups.add('large whole-conversation context');
      reasons.push('large whole-conversation context');
    }

    const attachmentCount = currentAttachments.count;
    let attachmentMinimumLevel = '';
    if (attachmentCount > 0) {
      score = Math.max(score, 24);
      reasons.push('attached material');
      attachmentMinimumLevel = 'medium';
      if (attachmentCount >= 2) {
        score = Math.max(score, 34 + Math.min(12, (attachmentCount - 2) * 4));
        strongGroups.add('multiple attachments');
        reasons.push('multiple attachments');
      }
      if (attachmentCount >= 6) {
        score = Math.max(score, 62);
        strongGroups.add('many attachments');
        reasons.push('many attachments');
        attachmentMinimumLevel = 'extra-high';
      }
      if (currentAttachments.complexCount > 0) {
        score = Math.max(score, 40);
        strongGroups.add('complex attachment type');
        reasons.push('complex attachment type');
        attachmentMinimumLevel = modelLevelRank(attachmentMinimumLevel) < ROUTE_LEVEL_RANK.high ? 'high' : attachmentMinimumLevel;
      }
      if (currentAttachments.complexCount >= 3) {
        score = Math.max(score, 62);
        strongGroups.add('several complex attachments');
        attachmentMinimumLevel = 'extra-high';
      }
      if (currentAttachments.kinds.length >= 3) {
        score += 8;
        strongGroups.add('mixed attachment types');
        reasons.push('mixed attachment types');
      }
      if (currentAttachments.largeCount > 0 || currentAttachments.totalBytes >= 25 * 1024 * 1024) {
        score = Math.max(score, 44);
        strongGroups.add('large attached material');
        reasons.push('large attached material');
        attachmentMinimumLevel = modelLevelRank(attachmentMinimumLevel) < ROUTE_LEVEL_RANK.high ? 'high' : attachmentMinimumLevel;
      }
      if (currentAttachments.sensitiveCount > 0) {
        score = Math.max(score, 44);
        highStakes = true;
        strongGroups.add('sensitive attached material');
        reasons.push('sensitive attached material');
        attachmentMinimumLevel = modelLevelRank(attachmentMinimumLevel) < ROUTE_LEVEL_RANK.high ? 'high' : attachmentMinimumLevel;
      }
      if (currentAttachments.unknownCount > 0) {
        score = Math.max(score, 40);
        strongGroups.add('unknown attachment type');
        reasons.push('unknown attachment type favored the safer level');
        attachmentMinimumLevel = modelLevelRank(attachmentMinimumLevel) < ROUTE_LEVEL_RANK.high ? 'high' : attachmentMinimumLevel;
      }
      const difficultAttachmentTask = /\b(?:audit|debug|diagnose|solve|calculate|reconcile|cross[\s-]?reference|compare\s+(?:across|all|the)|resolve\s+(?:conflicts?|contradictions?)|verify\s+(?:the\s+)?(?:calculations?|formulas?|claims?|answers?|data)|find\s+(?:inconsistencies|contradictions|errors)|read\s+(?:handwritten|every)|(?:analy[sz]e|interpret)\s+(?:(?:this|that|the|an?)\s+)?(?:[\p{L}-]+\s+){0,2}(?:chart|diagram|scan|data|results?|x[\s-]?ray|mri|image))\b/iu.test(lower);
      if (difficultAttachmentTask) {
        score = Math.max(score + 8, 44);
        strongGroups.add('difficult attachment analysis');
        reasons.push('difficult attachment analysis');
        attachmentMinimumLevel = modelLevelRank(attachmentMinimumLevel) < ROUTE_LEVEL_RANK.high ? 'high' : attachmentMinimumLevel;
      }
      if (!normalized && (currentAttachments.unknownCount > 0 || attachmentCount > 1)) {
        score = Math.max(score, 40);
        attachmentMinimumLevel = modelLevelRank(attachmentMinimumLevel) < ROUTE_LEVEL_RANK.high ? 'high' : attachmentMinimumLevel;
        reasons.push('attachment-only request favored the safer level');
      }
    }

    let contextualMinimumLevel = strongerRouteLevel(attachmentMinimumLevel, longRangeMinimumLevel);
    let inheritedContext = false;
    const useConversationContext = contextDependent && !metalinguisticVerification &&
      !simpleAdministrative.test(lower) && !simpleUiAction.test(lower) &&
      (!contextualTransform || hasPriorConversation) && !startsCurrentAttachmentTask;
    if (useConversationContext || answerVerification && !topicReset) {
      const baseMinimum = answerVerification ? 'high'
        : continuation.test(lower) && !hasPriorConversation ? 'high'
          : 'medium';
      let inheritedLevel = topicReset ? '' : previousLevel;
      if (contextualTransform && !wholeConversationReference && modelLevelRank(inheritedLevel) > ROUTE_LEVEL_RANK.high) inheritedLevel = 'high';
      const contextFloor = strongerRouteLevel(baseMinimum, inheritedLevel);
      contextualMinimumLevel = strongerRouteLevel(contextualMinimumLevel, contextFloor);
      inheritedContext = Boolean(!topicReset && previousLevel && hasPriorConversation);
      score = Math.max(score, answerVerification || continuation.test(lower) && !hasPriorConversation ? 40 : 24);
      reasons.push(answerVerification
        ? 'recheck the previous answer at High or above'
        : inheritedContext ? 'follow-up inherited relevant conversation difficulty' : 'uncertain follow-up kept a safer context level');

      let historical = historicalAttachments;
      if (mentionsKnownAttachment) historical = matchingKnownAttachments;
      else if (explicitOlderMaterialReference || wholeConversationReference) {
        historical = combineAttachmentProfiles(historicalAttachments, archivedAttachments);
      } else if (currentMaterialReference) historical = buildAttachmentProfile();
      else if (materialContextReference && historical.count === 0) historical = archivedAttachments;
      if (historical.count > 0) {
        reasons.push('follow-up uses earlier attached material');
        contextualMinimumLevel = strongerRouteLevel(contextualMinimumLevel, 'medium');
        if (historical.count >= 2 || historical.complexCount > 0 || historical.largeCount > 0 || historical.sensitiveCount > 0) {
          contextualMinimumLevel = strongerRouteLevel(contextualMinimumLevel, 'high');
          score = Math.max(score, 44);
          strongGroups.add('earlier attached material');
        }
        if (historical.count >= 6 || historical.complexCount >= 3) {
          contextualMinimumLevel = strongerRouteLevel(contextualMinimumLevel, 'extra-high');
          score = Math.max(score, 62);
          strongGroups.add('many earlier attachments');
        }
      }
    } else if (ambiguousFollowUp && !contextualTransform && !metalinguisticVerification) {
      contextualMinimumLevel = strongerRouteLevel(contextualMinimumLevel, 'medium');
      score = Math.max(score, 24);
      reasons.push('uncertain follow-up kept a safer context level');
    }

    const addSignal = (pattern, points, code, strong = true) => {
      if (!pattern.test(sampleLower)) return false;
      score += points;
      reasons.push(code);
      if (strong) strongGroups.add(code);
      return true;
    };

    debuggingWork = addSignal(/\b(?:debug|bug|failing test|failure|exception|stack trace|traceback|segmentation fault|root cause)\b|(?:type|reference|syntax|runtime|value)error\s*:/iu, 14, 'debugging');
    formalReasoning = addSignal(/\b(?:prove|derive|derivation|rigorous(?:ly)?|formal correctness|correctness argument|justify every)\b|\b(?:write|give|show|construct|explain|review)\b.{0,80}\bproof\b/iu, 14, 'formal reasoning');
    addSignal(/\b(?:architecture|concurren(?:cy|t)|race condition|thread[\s-]?safe(?:ty)?|secure|security|injection|vulnerabilit\w*|threat model|performance|scalab(?:le|ility)|migration|rollback|distributed system|multi-tenant)\b/iu, 14, 'architecture or risk');
    addSignal(/\b(?:synthesi[sz]e|systematic review|primary sources?|conflicting (?:evidence|studies)|multiple sources?|citations?|cite (?:the )?(?:official|primary))\b/iu, 10, 'source synthesis');
    if (!metalinguisticVerification && !routineOperationalCheck && !simpleAdministrative.test(lower) && !simpleUiAction.test(lower)) {
      addSignal(/\b(?:verify|verification|tests?|test suite|edge cases?|double[\s-]?check|exhaustive|benchmarks?|every case|correctness)\b|\bwithout\s+changing\s+(?:behavior|behaviour|semantics|output)\b/iu, 10, 'verification');
    }

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

    const personalHighStakes = /\b(?:my|i|me)\b.{0,80}\b(?:medical|medicine|medication|dose|dosage|symptom|diagnosis|legal|lawsuit|contract|tax|investment|financial|stocks?|warfarin|pregnan|chest pain|emergency room|\ber\b|cancer)\b|\b(?:can i take|should i take|can i sue)\b/iu.test(sampleLower);
    const medicalDecision = /\b(?:dose|dosage|medication|medication list|medicine|drug|symptoms?|diagnosis|lab results?|radiology|medical imag\w*|x[\s-]?ray|mri|ct scan|pregnan\w*|warfarin|ibuprofen|tylenol|acetaminophen|alcohol|chest pain|heart attack|stroke|sepsis|meningitis|blood clot|headache|mole|cancer|ambulance|emergency room|\ber\b)\b/iu.test(sampleLower) &&
      /\b(?:warning signs?|signs?|symptoms?|safe|serious|abnormalit\w*|cancer|go|call|take|use|stop|start|increase|decrease|mix|combine|summari[sz]e|analy[sz]e|explain|interpret|review|should|can|could)\b/iu.test(sampleLower);
    const legalDecision = /\b(?:contract|lease|agreement|lawsuit|legal|tax|lawyer|landlord|employer|evict\w*|arrest\w*|fire[ds]?)\b/iu.test(sampleLower) &&
      /\b(?:need|rights?|enforceable|valid|legal|liable|liability|landlord|employer|evict\w*|arrest\w*|fire[ds]?|sign|sue|file|owe|should|can|could)\b/iu.test(sampleLower);
    const financialDecision = /\b(?:stocks?|shares?|investment|portfolio|crypto|bitcoin|nft|fraud|scam|mortgage|loan|retirement)\b/iu.test(sampleLower) &&
      /\b(?:safe|scam|fraud|report|buy|sell|invest|trade|withdraw|refinance|should|can i|could i)\b/iu.test(sampleLower);
    const securityAction = /\b(?:safe|sufficient|correct(?:ly)?|uses?|store|commit|expose|prevent|protect|implement|design|encrypt|hash(?:er|ing)?|verif(?:y|ier|ication)|analy[sz]e|assess|review|audit|check|sanitize|escape|cause)\b/iu.test(sampleLower);
    const coreSecurityTerm = /\b(?:passwords?|credentials?|api keys?|secret keys?|(?:api|access|refresh|auth|session|bearer|secret) tokens?|md5|sha-?1|bcrypt|argon2|jwt|tls|aes(?:-gcm)?|encryption|cryptograph\w*|crypto|authentication|authorization|oauth|openid connect|session cookies?|access[\s-]?control|cors|denial of service|prompt injection|sql injection|xss|csrf|vulnerabilit\w*|security)\b/iu.test(sampleLower);
    const runtimeSecurityRisk = /\b(?:localstorage|eval)\b/iu.test(sampleLower) &&
      /\b(?:passwords?|credentials?|tokens?|secrets?|keys?|auth\w*|user input|user data|safe|secure|injection)\b/iu.test(sampleLower);
    const injectionDefense = /\b(?:html|sql|user input)\b/iu.test(sampleLower) &&
      /\b(?:sanitize|escape|injection)\b/iu.test(sampleLower);
    const secureTarget = /\bsecure\b/iu.test(sampleLower) && /\b(?:make|design|implement|keep|ensure|is|are|review|assess)\b/iu.test(sampleLower);
    const securityDecision = !simpleAdministrative.test(lower) && !simpleUiAction.test(lower) &&
      (securityAction && (coreSecurityTerm || runtimeSecurityRisk || injectionDefense) || secureTarget);
    const sensitiveDocumentReview = /\b(?:contract|lease|medical report|lab results?)\b.{0,100}\b(?:flag|identify|find|review|check)\b.{0,80}\b(?:risks?|risky|dangerous|clauses?|findings?)\b|\b(?:flag|identify|find|review|check)\b.{0,80}\b(?:risks?|risky|dangerous|clauses?|findings?)\b.{0,100}\b(?:contract|lease|medical report|lab results?)\b/iu.test(sampleLower);
    if (personalHighStakes || medicalDecision || legalDecision || financialDecision || /\bcan i sue\b/iu.test(sampleLower) || sensitiveDocumentReview) {
      score += 12;
      highStakes = true;
      reasons.push('personal high-stakes question');
      strongGroups.add('personal high-stakes question');
    }
    if (securityDecision) {
      highStakes = true;
      reasons.push('security-sensitive work');
      strongGroups.add('security-sensitive work');
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
      if (!strongGroups.size && !highStakes && !answerVerification && !debuggingWork) {
        score -= 8;
        reasons.push('speed priority');
      } else {
        reasons.push('brief response without lowering reasoning');
      }
    }

    score = Math.max(0, Math.min(100, score));
    let target = score < 20
      ? 'instant'
      : score < 40
        ? 'medium'
        : score < 60
          ? 'high'
          : score < 80
            ? 'extra-high'
            : 'pro';

    const boundaries = [20, 40, 60, 80];
    const margin = Math.min(...boundaries.map((boundary) => Math.abs(score - boundary)));
    const confidence = Math.max(0.45, Math.min(0.94, 0.58 + Math.min(margin, 10) * 0.018 + Math.min(strongGroups.size, 3) * 0.045));

    if (highStakes && modelLevelRank(target) < ROUTE_LEVEL_RANK.high) target = 'high';
    if (debuggingWork && modelLevelRank(target) < ROUTE_LEVEL_RANK.high) target = 'high';
    if (formalReasoning && modelLevelRank(target) < ROUTE_LEVEL_RANK.high) target = 'high';
    if (behaviorPreservation && technical.test(lower) && modelLevelRank(target) < ROUTE_LEVEL_RANK.high) target = 'high';
    if (answerVerification && modelLevelRank(target) < ROUTE_LEVEL_RANK.high) target = 'high';

    const targetBeforeUncertainty = target;
    const upperBoundary = { instant: 20, medium: 40, high: 60, 'extra-high': 80 }[target];
    const saferTarget = { instant: 'medium', medium: 'high', high: 'extra-high', 'extra-high': 'pro' }[target];
    const uncertaintyBand = target === 'medium' ? 6 : 4;
    let uncertaintyPromotionCandidate = false;
    if (!answerVerification && upperBoundary && saferTarget && upperBoundary - score >= 1 &&
      upperBoundary - score <= uncertaintyBand) {
      target = saferTarget;
      uncertaintyPromotionCandidate = true;
    }
    if (modelLevelRank(target) >= ROUTE_LEVEL_RANK['extra-high'] && strongGroups.size < 2) target = 'high';
    if (modelLevelRank(target) >= ROUTE_LEVEL_RANK.pro && (
      strongGroups.size < 3 || !(longHorizon || expertWork || (highStakes && strongGroups.has('source synthesis')))
    )) {
      target = 'extra-high';
    }
    if (contextualMinimumLevel && modelLevelRank(target) < modelLevelRank(contextualMinimumLevel)) {
      target = contextualMinimumLevel;
    }

    const uncertaintyEscalated = uncertaintyPromotionCandidate &&
      modelLevelRank(target) > modelLevelRank(targetBeforeUncertainty);
    if (uncertaintyEscalated) reasons.unshift('uncertainty safety margin chose the higher level');
    return {
      target,
      score,
      confidence: inheritedContext ? Math.max(confidence, 0.82) : confidence,
      explicit: false,
      inherited: inheritedContext,
      strict: answerVerification,
      minimumLevel: answerVerification ? 'high' : '',
      uncertain: uncertaintyEscalated || uncertainBase,
      reasons: reasons.length ? reasons : [score < 20 ? 'short everyday request' : 'general complexity'],
    };
  }

  function maxRouteRank(maxSetting) {
    if (maxSetting === 'high') return ROUTE_LEVEL_RANK.high;
    if (maxSetting === 'extra-high') return ROUTE_LEVEL_RANK['extra-high'];
    return Number.POSITIVE_INFINITY;
  }

  function elementPickerLevel(element, options = {}) {
    if (!element || typeof element !== 'object') return '';
    const visibleFirst = options.trigger === true
      ? [
        element.getAttribute && element.getAttribute('aria-label'),
        element.innerText,
        element.textContent,
        element.getAttribute && element.getAttribute('title'),
      ]
      : [
        element.innerText,
        element.textContent,
        element.getAttribute && element.getAttribute('aria-label'),
        element.getAttribute && element.getAttribute('title'),
      ];
    const signals = [...new Set(visibleFirst.map(normalizeText).filter(Boolean))];
    for (const signal of signals) {
      const level = extractPickerLevel(signal, { allowBareEffort: options.allowBareEffort === true });
      if (level) return level;
    }
    return extractPickerLevel(accessibleText(element), { allowBareEffort: options.allowBareEffort === true });
  }

  function optionLevel(option) {
    if (typeof option === 'string') return extractPickerLevel(option, { allowBareEffort: true });
    if (!option || typeof option !== 'object') return '';
    return option.level
      ? extractModelLevel(option.level)
      : option.nodeType === 1
        ? elementPickerLevel(option, { allowBareEffort: true })
        : extractPickerLevel(option.label || option.text || '', { allowBareEffort: true });
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
    if (elementPickerLevel(button, { trigger: true })) return true;
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
      'button[data-testid="model-switcher-dropdown-button"]',
      'button[aria-label*="model" i]',
    ];
    const localPreferred = [
      ...preferred,
      'button[data-testid*="intelligence"]',
      'button[aria-label*="intelligence" i]',
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
        return Boolean(elementPickerLevel(button, { trigger: true }));
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
    const primary = findModelPicker(doc, composer);
    const explicitPreferred = [
      'button[data-testid*="reasoning"]',
      'button[data-testid*="thinking-time"]',
      'button[data-testid*="intelligence"]',
      'button[aria-label*="reasoning effort" i]',
      'button[aria-label*="thinking time" i]',
      'button[aria-label*="intelligence level" i]',
    ];
    const genericPreferred = [
      '[data-composer-surface="true"] button.__composer-pill[aria-haspopup="menu"][id^="radix-"]',
      'button.__composer-pill[aria-haspopup="menu"][id^="radix-"]',
    ];
    const findDistinct = (candidateScopes, selectors, allowGenericPopup, requireLevel = false) => {
      for (const scope of candidateScopes) {
        for (const selector of selectors) {
          const candidates = [...scope.querySelectorAll(selector)].filter((button) =>
            button !== primary && isPlausiblePickerButton(button, allowGenericPopup));
          const candidate = requireLevel
            ? candidates.find((button) => Boolean(elementPickerLevel(button, { trigger: true })))
            : candidates[0];
          if (candidate) return candidate;
        }
      }
      return null;
    };
    const nonLocalScopes = scopes.filter((scope) => !localScopes.includes(scope));
    const preferred = findDistinct(localScopes, explicitPreferred, true) ||
      findDistinct(localScopes, genericPreferred, true, true) ||
      findDistinct(nonLocalScopes, explicitPreferred, false) ||
      findDistinct(nonLocalScopes, genericPreferred, false, true);
    if (preferred) return preferred;
    for (const scope of localScopes) {
      const candidate = [...scope.querySelectorAll('button')].find((button) => {
        if (button === primary || !isProbablyVisible(button) || button.closest(`#${UI_ROOT_ID}`)) return false;
        return Boolean(elementPickerLevel(button, { trigger: true }));
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
    const isCandidate = (candidate) => {
      if (excluded.has(candidate) || candidate === picker || candidate.contains(picker) || !isProbablyVisible(candidate) ||
        candidate.closest('[data-state="closed"], [aria-hidden="true"], [hidden]') || candidate.closest(`#${UI_ROOT_ID}`)) return false;
      if (candidate.disabled || candidate.closest('[aria-disabled="true"], [data-disabled="true"], :disabled')) return false;
      const outerOption = candidate.closest(MODEL_OPTION_CONTAINER_SELECTOR);
      if (outerOption && isModelUpsellLabel(accessibleText(outerOption))) return false;
      if (outerOption && outerOption !== candidate &&
        elementPickerLevel(outerOption, { allowBareEffort }) === elementPickerLevel(candidate, { allowBareEffort })) return false;
      return !isModelUpsellLabel(accessibleText(candidate)) && Boolean(elementPickerLevel(candidate, { allowBareEffort }));
    };
    const recognized = candidates.filter(isCandidate);
    if (recognized.length || root.nodeType !== 1 || root.matches('html, body, main')) return recognized;

    // ChatGPT sometimes renders a new popover with clickable plain div/span
    // rows before accessibility roles or test IDs are attached. This fallback
    // is intentionally limited to the already-scoped, newly changed menu root.
    const textRows = uniqueElements([...root.querySelectorAll('div, span, p, strong')].slice(0, 500).filter((candidate) => {
      if (!isCandidate(candidate)) return false;
      const level = elementPickerLevel(candidate, { allowBareEffort });
      return ![...candidate.children].some((child) =>
        elementPickerLevel(child, { allowBareEffort }) === level);
    }));
    const distinctLevels = new Set(textRows.map(optionLevel).filter(Boolean));
    return distinctLevels.size >= 2 ? textRows : [];
  }

  function currentIntelligenceOptions(doc, picker = null) {
    if (!doc) return [];
    const controlledIds = new Set(normalizeText(picker && picker.getAttribute('aria-controls')).split(/\s+/u).filter(Boolean));
    const pickerId = normalizeText(picker && picker.id);
    const roots = [...doc.querySelectorAll('[data-testid="composer-intelligence-picker-content"]')]
      .filter(isMountedAndNotHidden)
      .map((root) => {
        const menu = root.closest('[data-radix-menu-content][role="menu"], [role="menu"], [role="listbox"]');
        const controlledAncestor = [...controlledIds].some((id) => {
          const controlled = doc.getElementById(id);
          return controlled && (controlled === root || controlled.contains(root));
        });
        let score = 0;
        if (controlledAncestor || menu && controlledIds.has(normalizeText(menu.id))) score += 100;
        if (menu && pickerId && normalizeText(menu.getAttribute('aria-labelledby')).split(/\s+/u).includes(pickerId)) score += 100;
        if (menu && menu.getAttribute('data-state') === 'open') score += 20;
        return { root, score };
      })
      .sort((left, right) => right.score - left.score);

    const bestScore = roots.length ? roots[0].score : -1;
    const eligibleRoots = roots.filter(({ score }) => score === bestScore);
    if (eligibleRoots.length > 1) return [];

    for (const { root } of eligibleRoots) {
      const rowSelector = '[role="menuitemradio"], [role="radio"], [role="option"], [data-radix-collection-item], button';
      const allRows = [...root.querySelectorAll(rowSelector)].filter((row) => {
        if (!isMountedAndNotHidden(row) || row.closest(`#${UI_ROOT_ID}`) ||
          row.matches('[aria-disabled="true"], [data-disabled], :disabled') || isModelUpsellLabel(accessibleText(row))) return false;
        const level = elementPickerLevel(row, { allowBareEffort: true });
        if (!level) return false;
        const outerRow = row.parentElement && row.parentElement.closest(rowSelector);
        return !outerRow || !root.contains(outerRow) ||
          elementPickerLevel(outerRow, { allowBareEffort: true }) !== level;
      });
      if (allRows.length) {
        const grouped = new Map();
        for (const row of allRows) {
          const group = row.closest('[role="group"], [role="radiogroup"]') || root;
          if (!grouped.has(group)) grouped.set(group, []);
          grouped.get(group).push(row);
        }
        const groupedRows = [...grouped.values()].map((rows) => ({
          rows,
          distinct: new Set(rows.map(optionLevel).filter(Boolean)).size,
          checked: rows.some((row) => row.matches('[aria-checked="true"], [aria-selected="true"], [data-state="checked"]')),
        })).sort((left, right) => right.distinct - left.distinct || Number(right.checked) - Number(left.checked) || right.rows.length - left.rows.length);
        if (groupedRows[0] && groupedRows[0].rows.length) return groupedRows[0].rows;
      }
      const fallback = findModelOptions(root, picker) || [];
      if (fallback.length) return fallback;
    }
    return [];
  }

  function activePowerSlider(doc, picker = null) {
    if (!doc) return null;
    const candidates = [...doc.querySelectorAll(
      '[data-testid="composer-model-picker-slider-simple-view"][data-active="true"] [aria-keyshortcuts~="ArrowLeft"][aria-keyshortcuts~="ArrowRight"]',
    )].filter((candidate) => isProbablyVisible(candidate) && !candidate.closest('[inert], [aria-hidden="true"], [hidden]') &&
      !candidate.closest('[data-state="closed"]') && !candidate.closest(`#${UI_ROOT_ID}`));
    if (!picker) return candidates.length === 1 ? candidates[0] : null;
    const controlledIds = new Set(normalizeText(picker.getAttribute('aria-controls')).split(/\s+/u).filter(Boolean));
    const pickerId = normalizeText(picker.id);
    const associated = candidates.filter((candidate) => {
      const menu = candidate.closest('[data-radix-menu-content][role="menu"], [role="menu"], [role="listbox"]');
      if (!menu) return false;
      return controlledIds.has(normalizeText(menu.id)) || pickerId &&
        normalizeText(menu.getAttribute('aria-labelledby')).split(/\s+/u).includes(pickerId);
    });
    return associated.length === 1 ? associated[0] : null;
  }

  function powerSliderLevel(control) {
    if (!control || !control.ownerDocument) return '';
    const descriptions = normalizeText(control.getAttribute('aria-describedby')).split(/\s+/u).filter(Boolean)
      .map((id) => control.ownerDocument.getElementById(id))
      .filter(Boolean)
      .map((node) => normalizeText(node.textContent));
    return extractModelLevel(descriptions.join(' ')) || elementPickerLevel(control, { allowBareEffort: true });
  }

  function findInstantOption(root, picker = null, excluded = new Set()) {
    return findModelOptions(root, picker, excluded).find((candidate) => {
      const level = optionLevel(candidate);
      return level === 'instant' || level === 'auto';
    }) || null;
  }

  function actionControlIsUsable(control) {
    return Boolean(control && control.isConnected && !control.closest(`#${UI_ROOT_ID}`) &&
      !control.closest('nav, aside, header, form, [data-testid*="composer" i]') &&
      !control.matches(':disabled, [aria-disabled="true"], [data-disabled], [inert]'));
  }

  function turnMessageIds(turn) {
    if (!turn) return new Set();
    return new Set(collectMatches(turn, '[data-message-id]')
      .map((node) => normalizeText(node.getAttribute('data-message-id')))
      .filter(Boolean));
  }

  function responseActionScopes(turn) {
    if (!turn || !turn.ownerDocument) return [];
    const doc = turn.ownerDocument;
    const scopes = [turn];
    const messageIds = turnMessageIds(turn);

    if (messageIds.size) {
      for (const node of doc.querySelectorAll('[data-message-id]')) {
        if (messageIds.has(normalizeText(node.getAttribute('data-message-id')))) scopes.push(node);
      }
    }

    // ChatGPT sometimes renders the response toolbar beside the turn rather
    // than inside it. A wrapper containing only this turn is still a safe
    // search boundary; main/body and multi-turn containers are not.
    let ancestor = turn.parentElement;
    for (let depth = 0; ancestor && depth < 4; depth += 1, ancestor = ancestor.parentElement) {
      if (ancestor.matches('main, body, html, nav, aside, header, form')) break;
      const containedTurns = ancestor.querySelectorAll(TURN_SELECTOR);
      if (containedTurns.length !== 1 || containedTurns[0] !== turn) break;
      scopes.push(ancestor);
    }

    return uniqueElements(scopes).filter((scope) => scope.isConnected && !scope.closest(`#${UI_ROOT_ID}`));
  }

  function responseActionRow(control) {
    if (!control || !control.closest) return null;
    const explicit = control.closest(
      '[data-testid*="message-actions" i], [data-testid*="turn-actions" i], [data-testid*="response-actions" i], [data-testid*="response-toolbar" i]',
    );
    if (explicit) return explicit;
    const group = control.closest('[role="group"]');
    if (!group) return null;
    return group.querySelector(
      '[data-testid*="copy" i], [data-testid*="feedback" i], [data-testid*="good-response" i], [data-testid*="bad-response" i], [aria-label^="Copy" i], [aria-label*="Read aloud" i]',
    ) ? group : null;
  }

  function moreControlScore(control, scopes, messageIds) {
    if (!actionControlIsUsable(control)) return -1;
    const testId = lowerText(control.getAttribute('data-testid'));
    const label = lowerText(control.getAttribute('aria-label'));
    const title = lowerText(control.getAttribute('title'));
    const text = normalizeText(control.textContent);
    const iconTestIds = [...control.querySelectorAll('[data-testid]')]
      .map((node) => lowerText(node.getAttribute('data-testid')))
      .join(' ');
    const ownerId = normalizeText((control.closest('[data-message-id]') || control).getAttribute('data-message-id'));
    const scoped = scopes.some((scope) => scope === control || scope.contains(control));
    const linked = Boolean(ownerId && messageIds.has(ownerId));
    const exactPattern = /^(?:more|more actions|more options|message actions|response actions)$/u;
    const exactLabel = exactPattern.test(label) || exactPattern.test(title);
    const strongTestId = /(?:more[-_ ]?turn|turn[-_ ]?actions[-_ ]?(?:menu|more|overflow)|message[-_ ]?actions[-_ ]?(?:menu|more|overflow)|response[-_ ]?actions[-_ ]?(?:menu|more|overflow))/u.test(testId);
    const genericOverflowTestId = /(?:^|[-_ ])(?:overflow|ellipsis)(?:$|[-_ ])/u.test(testId);
    const ellipsisIcon = /(?:ellipsis|overflow|more[-_ ]?(?:horizontal|vertical)?)/u.test(iconTestIds);
    const ellipsisText = /^(?:\.\.\.|…|⋯)$/u.test(text);
    const menuTrigger = lowerText(control.getAttribute('aria-haspopup')) === 'menu';
    const actionRow = responseActionRow(control);

    if (!scoped && !linked) return -1;
    if (!strongTestId && !actionRow) return -1;
    if (!exactLabel && !strongTestId && !(actionRow && (genericOverflowTestId || ellipsisIcon || ellipsisText || menuTrigger))) return -1;
    if (/(?:copy|share|feedback|good-response|bad-response|read-aloud|regenerate|edit|send)/u.test(testId) ||
      /^(?:copy|share|good response|bad response|read aloud|regenerate|edit|send)$/u.test(label)) return -1;

    let score = 0;
    if (linked) score += 100;
    if (scoped) score += 60;
    if (exactLabel) score += 50;
    if (strongTestId) score += 45;
    if (actionRow && genericOverflowTestId) score += 35;
    if (actionRow && ellipsisIcon) score += 35;
    if (actionRow && menuTrigger) score += 20;
    if (actionRow && ellipsisText) score += 15;
    return score;
  }

  function findMoreButton(turn, suppliedScopes = null, suppliedMessageIds = null) {
    if (!turn || !turn.ownerDocument) return null;
    const scopes = suppliedScopes || responseActionScopes(turn);
    const messageIds = suppliedMessageIds || turnMessageIds(turn);
    const selector = [
      'button',
      '[role="button"]',
      '[tabindex][aria-haspopup="menu"]',
    ].join(', ');
    const candidates = uniqueElements([
      ...scopes.flatMap((scope) => collectMatches(scope, selector)),
    ]).map((control, index) => ({
      control,
      index,
      score: moreControlScore(control, scopes, messageIds),
    })).filter(({ control, score }) => score >= 45 && isMountedAndNotHidden(control));
    if (!candidates.length) return null;
    candidates.sort((left, right) => right.score - left.score || right.index - left.index);
    if (candidates[1] && candidates[1].score === candidates[0].score) return null;
    return candidates[0].control;
  }

  function isBranchLabel(value) {
    const text = lowerText(value).replace(/[.!…]+$/gu, '');
    return text === 'branch in new chat' || text === 'branch in a new chat' || text.startsWith('branch in new chat ') || text.startsWith('branch in a new chat ');
  }

  function findBranchAction(root, excluded = new Set()) {
    if (!root) return null;
    const candidates = [...root.querySelectorAll('[role="menuitem"], [role="option"], [data-radix-collection-item], button, a')];
    const matches = candidates.filter((candidate) => !excluded.has(candidate) && !candidate.closest(`#${UI_ROOT_ID}`) &&
      !candidate.matches(':disabled, [aria-disabled="true"], [data-disabled]') && isProbablyVisible(candidate) &&
      isBranchLabel(accessibleText(candidate)));
    const distinct = matches.filter((candidate) => !matches.some((other) => other !== candidate && candidate.contains(other)));
    return distinct.length === 1 ? distinct[0] : null;
  }

  function findDirectBranchAction(turn, suppliedScopes = null) {
    if (!turn) return null;
    const scopes = suppliedScopes || responseActionScopes(turn);
    const matches = uniqueElements(scopes.flatMap((scope) => [
      ...collectMatches(scope, '[aria-label*="branch" i], [title*="branch" i], [data-testid*="branch" i], button, [role="button"], a'),
    ])).filter((candidate) => {
      const testId = lowerText(candidate.getAttribute('data-testid'));
      const nativeBranchId = /(?:branch.*(?:turn|message|response).*action|(?:turn|message|response).*branch.*action)/u.test(testId);
      return actionControlIsUsable(candidate) && isMountedAndNotHidden(candidate) &&
        (nativeBranchId || responseActionRow(candidate)) && isBranchLabel(accessibleText(candidate));
    });
    const distinct = matches.filter((candidate) => !matches.some((other) => other !== candidate && candidate.contains(other)));
    return distinct.length === 1 ? distinct[0] : null;
  }

  function clearBranchTargetMarks(doc) {
    if (!doc) return;
    for (const target of doc.querySelectorAll('.cgs-branch-target')) target.classList.remove('cgs-branch-target');
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
      let pollTimer = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (observer) observer.disconnect();
        if (timeoutTimer) win.clearTimeout(timeoutTimer);
        if (checkTimer) win.clearTimeout(checkTimer);
        if (pollTimer) win.clearInterval(pollTimer);
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
        observer.observe(root, {
          childList: true,
          subtree: true,
          attributes: options.attributes === true,
          characterData: options.characterData === true,
        });
      }
      if (options.pollInterval) {
        const interval = clampInteger(options.pollInterval, 125, 50, 2_000);
        pollTimer = win.setInterval(check, interval);
      }
      timeoutTimer = win.setTimeout(() => {
        check();
        if (!settled) finish(null);
      }, timeout);
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

  function waitForConversationChange(win, before, timeout = 15_000) {
    if (!before) return Promise.resolve('');
    return new Promise((resolve) => {
      const startedAt = Date.now();
      let lastIdentity = '';
      let stableChecks = 0;
      const interval = win.setInterval(() => {
        const current = conversationIdentity(win.location.href);
        if (current && current !== before) {
          if (current === lastIdentity) stableChecks += 1;
          else {
            lastIdentity = current;
            stableChecks = 1;
          }
          if (stableChecks >= 2) {
            win.clearInterval(interval);
            resolve(current);
            return;
          }
        } else {
          lastIdentity = '';
          stableChecks = 0;
        }
        if (Date.now() - startedAt >= timeout) {
          win.clearInterval(interval);
          resolve('');
        }
      }, 125);
    });
  }

  function waitForStableComposer(doc, win, previousComposer = null, timeout = 20_000, options = {}) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      let lastCandidate = null;
      let stableChecks = 0;
      const interval = win.setInterval(() => {
        const elapsed = Date.now() - startedAt;
        const candidate = findComposer(doc);
        if (candidate && candidate.isConnected) {
          // Before navigation is confirmed, reusing the source composer is not
          // enough to prove that a branch exists. Once the caller has confirmed
          // a distinct conversation, ChatGPT may retain the same SPA node.
          if (!options.allowReused && previousComposer && candidate === previousComposer && previousComposer.isConnected) {
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
    if (!turn) return;
    for (const type of ['pointerover', 'pointerenter', 'pointermove', 'mouseover', 'mouseenter', 'mousemove']) {
      try {
        turn.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, view: win }));
      } catch (_error) {
        // Pointer event support differs across browser/userscript combinations.
      }
    }
  }

  function branchTargetIsStillLatest(doc, turn, expectedTargetFingerprint = '', expectedContextFingerprint = '') {
    if (!turn || !turn.isConnected || hasActiveGeneration(doc)) return false;
    const turns = getTurns(doc);
    if (!turns.length || turns[turns.length - 1] !== turn || getLatestCompletedAssistantTurn(doc) !== turn) return false;
    if (expectedTargetFingerprint && assistantTurnFingerprint(turn) !== expectedTargetFingerprint) return false;
    return !expectedContextFingerprint || conversationContextFingerprint(doc, turn) === expectedContextFingerprint;
  }

  async function clickNativeBranch(
    doc,
    win,
    turn,
    expectedConversation = '',
    expectedTargetFingerprint = '',
    expectedContextFingerprint = '',
    actionTimeout = 6_000,
  ) {
    const discoveryTimeout = clampInteger(actionTimeout, 6_000, 100, 20_000);
    const locator = getTurnLocator(turn, doc);
    const stillExpected = () => !expectedConversation || conversationIdentity(win.location.href) === expectedConversation;
    const resolveTarget = (verifyFingerprints = false) => {
      if (!stillExpected()) return null;
      const candidates = uniqueElements([getLatestCompletedAssistantTurn(doc), locateTurn(doc, locator)]);
      return candidates.find((candidate) => branchTargetIsStillLatest(
        doc,
        candidate,
        verifyFingerprints ? expectedTargetFingerprint : '',
        verifyFingerprints ? expectedContextFingerprint : '',
      )) || null;
    };
    const targetStillExpected = () => Boolean(resolveTarget(true));
    if (!stillExpected()) return { ok: false, attempted: false, reason: 'The source conversation changed before branching.' };
    if (!targetStillExpected()) return { ok: false, attempted: false, reason: 'The source chat changed before branching. Nothing was sent.' };
    let lastRevealedTurn = null;
    let lastRevealAt = 0;
    const revealActions = (force = false) => {
      const liveTurn = resolveTarget(false);
      if (!liveTurn) return null;
      const now = Date.now();
      const nodeChanged = liveTurn !== lastRevealedTurn;
      if (!force && !nodeChanged && now - lastRevealAt < 750) return liveTurn;
      if (nodeChanged) {
        try {
          liveTurn.scrollIntoView({ block: 'center', behavior: 'auto' });
        } catch (_error) {
          try { liveTurn.scrollIntoView(); } catch (_secondError) { /* A rerender can detach it between checks. */ }
        }
      }
      lastRevealedTurn = liveTurn;
      lastRevealAt = now;
      liveTurn.classList.add('cgs-branch-target');
      const roleNode = liveTurn.matches(ROLE_SELECTOR) ? liveTurn : liveTurn.querySelector(ROLE_SELECTOR);
      for (const target of uniqueElements([liveTurn, roleNode])) dispatchHover(target, win);
      const nativeAction = [...liveTurn.querySelectorAll(
        '[data-testid*="copy" i], [aria-label^="Copy" i], [role="group"] button',
      )].find((candidate) => actionControlIsUsable(candidate));
      if (nativeAction && typeof nativeAction.focus === 'function') {
        try { nativeAction.focus({ preventScroll: true }); } catch (_error) { try { nativeAction.focus(); } catch (_secondError) { /* Optional reveal only. */ } }
      }
      return liveTurn;
    };
    let liveTurn = revealActions(true);
    if (!liveTurn) return { ok: false, attempted: false, reason: 'The source chat changed before branching. Nothing was sent.' };

    let actionScopes = responseActionScopes(liveTurn);
    const directBranch = findDirectBranchAction(liveTurn, actionScopes);
    if (directBranch) {
      if (!targetStillExpected()) return { ok: false, attempted: false, reason: 'The source chat changed before branching. Nothing was sent.' };
      try {
        directBranch.click();
        clearBranchTargetMarks(doc);
        return { ok: true, attempted: true };
      } catch (_error) {
        return { ok: false, attempted: true, reason: 'ChatGPT did not confirm whether the automatic branch action was accepted.' };
      }
    }

    const mountedMenuRoots = () => [...doc.querySelectorAll(
      '[data-radix-popper-content-wrapper], [data-radix-menu-content], [data-slot="dropdown-menu-content"], [role="menu"]',
    )].filter((root) => isMountedAndNotHidden(root));
    const openMenuBranchActions = () => uniqueElements(mountedMenuRoots()
      .map((root) => findBranchAction(root)).filter(Boolean));
    if (openMenuBranchActions().length) {
      try {
        doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      } catch (_error) {
        // The visibility check below still fails closed.
      }
      const closed = await waitForCondition(() => openMenuBranchActions().length === 0, {
        root: doc.documentElement,
        win,
        timeout: 1_000,
        attributes: true,
      });
      if (!closed) return { ok: false, attempted: false, fallback: true, reason: 'ChatGPT’s open response menu could not be reused.' };
      if (!targetStillExpected()) return { ok: false, attempted: false, reason: 'The source chat changed before branching. Nothing was sent.' };
    }
    const menuRootsBeforeOpen = new Set(mountedMenuRoots());

    let moreButton = findMoreButton(liveTurn, actionScopes, turnMessageIds(liveTurn));
    if (!moreButton) {
      moreButton = await waitForCondition(() => {
        liveTurn = revealActions();
        if (!liveTurn) return null;
        actionScopes = responseActionScopes(liveTurn);
        const direct = findDirectBranchAction(liveTurn, actionScopes);
        if (direct) return { kind: 'branch', control: direct };
        const more = findMoreButton(liveTurn, actionScopes, turnMessageIds(liveTurn));
        return more ? { kind: 'more', control: more } : null;
      }, {
        root: doc.documentElement,
        win,
        timeout: discoveryTimeout,
        attributes: true,
        pollInterval: 250,
      });
      if (moreButton && moreButton.kind === 'branch') {
        if (!targetStillExpected()) return { ok: false, attempted: false, reason: 'The source chat changed before branching. Nothing was sent.' };
        try {
          moreButton.control.click();
          clearBranchTargetMarks(doc);
          return { ok: true, attempted: true };
        } catch (_error) {
          return { ok: false, attempted: true, reason: 'ChatGPT did not confirm whether the automatic branch action was accepted.' };
        }
      }
      moreButton = moreButton && moreButton.control;
    }
    if (!moreButton) return { ok: false, attempted: false, fallback: true, reason: 'ChatGPT’s response actions were unavailable.' };
    if (!targetStillExpected()) return { ok: false, attempted: false, reason: 'The source chat changed before branching. Nothing was sent.' };
    try {
      moreButton.click();
    } catch (_error) {
      return { ok: false, attempted: false, fallback: true, reason: 'ChatGPT did not open the response menu.' };
    }

    const branchAction = await waitForCondition(
      () => {
        if (!stillExpected()) return null;
        const controlledId = normalizeText(moreButton.getAttribute('aria-controls'));
        const controlledMenu = controlledId ? doc.getElementById(controlledId) : null;
        if (controlledMenu && controlledMenu.isConnected) return findBranchAction(controlledMenu);
        const triggerId = normalizeText(moreButton.id);
        const menuRoots = mountedMenuRoots();
        const linkedRoots = triggerId ? menuRoots.filter((candidate) =>
          normalizeText(candidate.getAttribute('aria-labelledby')).split(/\s+/u).includes(triggerId)) : [];
        const newlyOpenedRoots = menuRoots.filter((candidate) => !menuRootsBeforeOpen.has(candidate));
        const triggerStateIsExposed = moreButton.hasAttribute('aria-expanded') || moreButton.hasAttribute('data-state');
        const triggerIsOpen = moreButton.getAttribute('aria-expanded') === 'true' || moreButton.getAttribute('data-state') === 'open';
        const roots = linkedRoots.length ? linkedRoots : (!triggerStateIsExposed || triggerIsOpen ? newlyOpenedRoots : []);
        const menuActions = uniqueElements(roots.map((candidate) => findBranchAction(candidate)).filter(Boolean));
        return menuActions.length === 1 ? menuActions[0] : null;
      }, {
      root: doc.documentElement,
      win,
      timeout: Math.max(1_000, Math.min(5_000, discoveryTimeout)),
      attributes: true,
      pollInterval: 125,
    });
    if (!branchAction) return { ok: false, attempted: false, fallback: true, reason: 'ChatGPT’s Branch action was unavailable.' };
    if (!targetStillExpected()) return { ok: false, attempted: false, reason: 'The source chat changed before branching. Nothing was sent.' };
    try {
      branchAction.click();
    } catch (_error) {
      return { ok: false, attempted: true, reason: 'ChatGPT did not confirm whether the automatic branch action was accepted.' };
    }
    clearBranchTargetMarks(doc);
    return { ok: true, attempted: true };
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
            <span><strong>Adaptive Auto for every message</strong><small>On Send—including after editing an earlier message—a fast local heuristic uses your message, attachment type/size/count, and only the conversation that will remain in that branch. It never reads attachment contents or sends anything elsewhere. Hold Alt while sending to bypass it once.</small></span>
            <input type="checkbox" data-cgs-setting="adaptiveRouting" aria-label="Choose a model level for every message">
          </label>
          <label class="cgs-setting">
            <span><strong>Maximum Auto level</strong><small>“Highest available” allows Extra High and Pro when the prompt has multiple hard-task signals. Prefix a prompt with <code>!route:high</code>, <code>!route:pro</code>, or <code>!route:max</code> for a one-message override; this safety cap still applies.</small></span>
            <select data-cgs-setting="autoMaxLevel" aria-label="Maximum Adaptive Auto level"><option value="high">High</option><option value="extra-high">Extra High</option><option value="highest">Highest available</option></select>
          </label>
          <label class="cgs-setting">
            <span><strong>Open side questions in</strong><small>A side window keeps the original instructions visible. Small screens use a tab. Fresh-chat continuation always switches this tab.</small></span>
            <select data-cgs-setting="openMode" aria-label="Open side questions in"><option value="popup">Side window</option><option value="tab">New tab</option></select>
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
        <section class="cgs-dialog" role="dialog" aria-modal="false" aria-labelledby="cgs-dialog-title">
          <h2 id="cgs-dialog-title">Ask in new chat</h2>
          <p>Write your question here. The new chat will remember the whole conversation so far, and you can keep reading or scrolling the original while you type.</p>
          <textarea id="cgs-question" aria-label="Question for new chat" placeholder="What are you stuck on?"></textarea>
          <div class="cgs-dialog-actions">
            <button class="cgs-secondary" type="button" data-cgs-action="cancel-question">Cancel</button>
            <button class="cgs-primary" type="button" data-cgs-action="submit-question">Ask in new chat</button>
          </div>
        </section>
      </div>

      <div id="cgs-recovery-backdrop" hidden>
        <section class="cgs-dialog" role="region" aria-labelledby="cgs-recovery-title">
          <h2 id="cgs-recovery-title">Couldn’t finish automatically</h2>
          <p class="cgs-recovery-note" id="cgs-recovery-reason"></p>
          <p>Your question was never added to the original conversation. You can safely close this window or try the automatic step again.</p>
          <textarea id="cgs-recovery-question" aria-label="Saved side question" readonly></textarea>
          <div class="cgs-dialog-actions">
            <button class="cgs-secondary" type="button" data-cgs-action="close-recovery">Close</button>
            <button class="cgs-primary" type="button" data-cgs-action="retry-branch">Try again</button>
          </div>
        </section>
      </div>

      <button id="cgs-selection-pill" type="button" data-cgs-action="ask-selection" hidden>Ask in new chat</button>
      <div id="cgs-toast" role="status" aria-live="polite" hidden></div>
    `;
    doc.body.append(root);

    return root;
  }

  function decorateTurn(doc, turn, options = null) {
    const streaming = options && Object.prototype.hasOwnProperty.call(options, 'streamingTurn')
      ? isTurnStreaming(turn, doc, options.streamingTurn)
      : isTurnStreaming(turn, doc);
    if (!turn || !isAssistantTurn(turn) || streaming || turn.querySelector(`.${TURN_BUTTON_CLASS}`)) return false;
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
    const reloadPage = typeof options.reloadPage === 'function'
      ? options.reloadPage
      : () => {
        win.location.reload();
        return true;
      };
    const freshResponseTimeout = clampInteger(options.freshResponseTimeout, 5 * 60 * 1000, 500, 10 * 60 * 1000);
    const freshStabilityMs = clampInteger(options.freshStabilityMs, 650, 20, 5_000);
    const routingDiscoveryTimeout = clampInteger(options.routingDiscoveryTimeout, 2_500, 50, 10_000);
    const branchNavigationTimeout = clampInteger(options.branchNavigationTimeout, 15_000, 250, 60_000);
    const branchComposerTimeout = clampInteger(options.branchComposerTimeout, 20_000, 250, 60_000);
    const branchActionTimeout = clampInteger(options.branchActionTimeout, 6_000, 100, 20_000);
    const sideSendAckTimeout = clampInteger(options.sideSendAckTimeout, 8_000, 250, 60_000);
    const state = {
      pageInstanceId: isValidJobId(options.pageInstanceId) ? String(options.pageInstanceId) : createJobId(),
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
      branchConversation: '',
      branchClickAttempted: false,
      sideSendAttempted: false,
      sideLaunchPromise: null,
      sideAutomationActive: false,
      incomingRunPromise: null,
      incomingRecoveryAction: false,
      autoEnsurePromise: null,
      adaptiveSendPromise: null,
      activeAdaptiveSnapshot: null,
      pendingAdaptiveSend: null,
      replayingSend: false,
      submitReplayPermit: null,
      composingComposer: null,
      pendingEditSession: null,
      pendingEditMenuSource: null,
      nextEditSessionId: 1,
      lastRouteDecision: null,
      adaptiveCancelled: false,
      conversationMutationVersion: 0,
      conversationMutationHistory: [],
      conversationRoutingCache: null,
      editConversationRoutingCache: new Map(),
      conversationRoutingBuilds: 0,
      routingComputedVisibility: new WeakMap(),
      historicalAttachmentCache: new WeakMap(),
      attachmentScopeIds: new WeakMap(),
      nextAttachmentScopeId: 1,
      dockUpdateTimer: null,
      dockPositionFrame: null,
      dockResizeObserver: null,
      dockObservedSurface: null,
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
          const route = state.lastRouteDecision;
          const prefix = route.manual ? 'Manual' : 'Auto';
          const keptDifferentLevel = route.target && route.target !== 'max' &&
            modelLevelRank(route.target) !== modelLevelRank(route.level) &&
            /\b(?:unavailable|unconfirmed|used current|could not|no compatible)\b/iu.test(route.reason || '');
          badge.textContent = keptDifferentLevel
            ? `${prefix} wanted ${modelLevelLabel(route.target)} · used ${modelLevelLabel(route.level)}`
            : `${prefix} → ${modelLevelLabel(route.level)}`;
          badge.title = route.reason || 'Last per-message routing choice';
        } else {
          badge.textContent = 'Adaptive Auto';
          badge.title = 'Each send is classified locally from the message, attachment metadata, and relevant conversation context; no extra request is used';
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
        const decorationContext = state.settings.showTurnButtons && !isReadOnlyChatPage(win.location.href)
          ? { streamingTurn: inferredStreamingTurn(doc) }
          : null;
        for (const scanRoot of roots) processRoot(scanRoot, decorationContext);
        scheduleDockAvailability();
      };
      if (typeof win.requestIdleCallback === 'function') win.requestIdleCallback(run, { timeout: 350 });
      else win.setTimeout(run, 40);
    }

    function processRoot(root, decorationContext = null) {
      if (!root || (root.closest && root.closest(`#${UI_ROOT_ID}`))) return;
      if (state.settings.hideStartWriting) cleanStartWriting(root);
      if (state.settings.showTurnButtons && !isReadOnlyChatPage(win.location.href)) {
        for (const turn of potentialTurnsFromRoot(root)) decorateTurn(doc, turn, decorationContext);
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
        clearDockPosition(dock);
        observeDockSurface(null);
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
      if (dock.hidden) {
        clearDockPosition(dock);
        observeDockSurface(null);
      } else {
        scheduleDockPosition();
      }
    }

    function clearDockPosition(dock = element('#cgs-dock')) {
      if (!dock) return;
      dock.style.removeProperty('right');
      dock.style.removeProperty('bottom');
      delete dock.dataset.cgsPositionSuppressed;
      dock.removeAttribute('aria-hidden');
    }

    function observeDockSurface(surface) {
      if (state.dockObservedSurface === surface) return;
      state.dockObservedSurface = surface || null;
      if (state.dockResizeObserver) state.dockResizeObserver.disconnect();
      if (!surface || typeof win.ResizeObserver !== 'function') return;
      if (!state.dockResizeObserver) {
        state.dockResizeObserver = new win.ResizeObserver(() => scheduleDockPosition());
      }
      try { state.dockResizeObserver.observe(surface); } catch (_error) { /* ignore */ }
    }

    function dockViewport() {
      const visual = win.visualViewport;
      return {
        width: Number(visual && visual.width) || Number(win.innerWidth) || Number(doc.documentElement.clientWidth) || 0,
        height: Number(visual && visual.height) || Number(win.innerHeight) || Number(doc.documentElement.clientHeight) || 0,
        offsetLeft: Number(visual && visual.offsetLeft) || 0,
        offsetTop: Number(visual && visual.offsetTop) || 0,
      };
    }

    function usableDockSurface(composer, viewport) {
      if (!composer || typeof composer.getBoundingClientRect !== 'function') return null;
      const candidates = uniqueElements([composer.closest('form'), composer]);
      for (const candidate of candidates) {
        let rect;
        try { rect = candidate.getBoundingClientRect(); } catch (_error) { continue; }
        const width = Number(rect.width) || Number(rect.right) - Number(rect.left);
        const height = Number(rect.height) || Number(rect.bottom) - Number(rect.top);
        const top = Number(rect.top) - viewport.offsetTop;
        const bottom = Number(rect.bottom) - viewport.offsetTop;
        const right = Number(rect.right) - viewport.offsetLeft;
        if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(top) ||
          !Number.isFinite(bottom) || !Number.isFinite(right) || width <= 0 || height <= 0 ||
          bottom <= 0 || top >= viewport.height || right <= 0) continue;
        return { element: candidate, rect: { top: Math.max(0, top), right } };
      }
      return null;
    }

    function updateDockPosition() {
      state.dockPositionFrame = null;
      const dock = element('#cgs-dock');
      if (!dock || dock.hidden) return;
      const viewport = dockViewport();
      const composer = findComposer(doc);
      if (!composer) {
        clearDockPosition(dock);
        observeDockSurface(null);
        return;
      }
      const surface = usableDockSurface(composer, viewport);
      if (!surface) {
        observeDockSurface(composer.closest('form') || composer);
        dock.dataset.cgsPositionSuppressed = 'true';
        dock.setAttribute('aria-hidden', 'true');
        return;
      }
      observeDockSurface(surface.element);
      let dockRect = null;
      try { dockRect = dock.getBoundingClientRect(); } catch (_error) { /* ignore */ }
      const position = chooseDockPosition(surface.rect, {
        width: dockRect && dockRect.width,
        height: dockRect && dockRect.height,
      }, viewport);
      if (!position) {
        dock.dataset.cgsPositionSuppressed = 'true';
        dock.setAttribute('aria-hidden', 'true');
        return;
      }
      dock.style.right = `${position.right}px`;
      dock.style.bottom = `${position.bottom}px`;
      if (position.hidden) {
        dock.dataset.cgsPositionSuppressed = 'true';
        dock.setAttribute('aria-hidden', 'true');
      } else {
        delete dock.dataset.cgsPositionSuppressed;
        dock.removeAttribute('aria-hidden');
        try {
          const placed = dock.getBoundingClientRect();
          const avoided = surface.element.getBoundingClientRect();
          const measurable = placed.width > 0 && placed.height > 0 && avoided.width > 0 && avoided.height > 0;
          const overlaps = measurable && placed.left < avoided.right && placed.right > avoided.left &&
            placed.top < avoided.bottom && placed.bottom > avoided.top;
          if (overlaps) {
            dock.dataset.cgsPositionSuppressed = 'true';
            dock.setAttribute('aria-hidden', 'true');
          }
        } catch (_error) { /* ignore */ }
      }
    }

    function scheduleDockPosition() {
      if (state.dockPositionFrame != null) return;
      const schedule = typeof win.requestAnimationFrame === 'function'
        ? win.requestAnimationFrame.bind(win)
        : (callback) => win.setTimeout(callback, 16);
      state.dockPositionFrame = schedule(updateDockPosition);
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

    function activeConversationTurns(suppliedTurns = null, options = {}) {
      const turns = Array.isArray(suppliedTurns) ? suppliedTurns : getTurns(doc);
      const hiddenRoots = [...doc.querySelectorAll(
        '[hidden], [aria-hidden="true"], [inert], [data-state="closed"], [style], ' +
        '[class~="hidden"], [class~="invisible"], [class~="sr-only"], [class~="visually-hidden"]',
      )].filter((root) => {
        const explicitlyHidden = root.hidden || root.getAttribute('aria-hidden') === 'true' ||
          root.hasAttribute('inert') || root.getAttribute('data-state') === 'closed' ||
          inlineStyleHidesContent(root.getAttribute('style')) || classTokensHideContent(root.getAttribute('class'));
        if (!explicitlyHidden) return false;
        if (!root.matches(`${TURN_SELECTOR}, ${ROLE_SELECTOR}`) &&
          !root.querySelector(`${TURN_SELECTOR}, ${ROLE_SELECTOR}`)) return false;
        const containedTurns = getTurns(root);
        return containedTurns.length > 0 && (root.matches(TURN_SELECTOR) || containedTurns.length < turns.length);
      });
      const anchorIndex = clampInteger(options.anchorIndex, turns.length, 0, turns.length);
      const computedCandidates = new Set(turns.slice(Math.max(0, anchorIndex - 40), anchorIndex));
      let recentUsers = 0;
      let recentAssistants = 0;
      for (let index = anchorIndex - 1; index >= 0 && (recentUsers < 12 || recentAssistants < 12); index -= 1) {
        const turn = turns[index];
        const role = roleOfTurn(turn);
        if (role === 'user' && recentUsers < 12) {
          computedCandidates.add(turn);
          recentUsers += 1;
        } else if (role === 'assistant' && recentAssistants < 12) {
          computedCandidates.add(turn);
          recentAssistants += 1;
        }
      }
      const turnSet = new Set(turns);
      const attachmentSelector = [
        '[data-file-id]', '[data-attachment-id]', '[data-testid*="file-pill"]',
        '[aria-label*="remove file" i]', '[aria-label*="remove attachment" i]',
        '[data-testid*="attachment"]', 'a[download]', 'a[href^="sandbox:"]',
      ].join(', ');
      for (const node of doc.querySelectorAll(attachmentSelector)) {
        const primary = node.closest(TURN_SELECTOR);
        const roleNode = primary ? null : node.closest(ROLE_SELECTOR);
        const turn = primary || roleNode && (roleNode.closest('article') || roleNode);
        if (turnSet.has(turn)) computedCandidates.add(turn);
      }
      if (explicitlyReferencesOlderConversation(options.referenceText || '')) {
        for (const turn of turns.slice(0, anchorIndex)) computedCandidates.add(turn);
      }
      const computedStyle = doc.defaultView && typeof doc.defaultView.getComputedStyle === 'function'
        ? doc.defaultView.getComputedStyle.bind(doc.defaultView)
        : null;
      const computedHiddenCache = new Map();
      const hasComputedHiddenAncestor = (turn) => {
        if (!computedStyle || !computedCandidates.has(turn)) return false;
        let current = turn;
        for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
          if (computedHiddenCache.has(current)) {
            if (computedHiddenCache.get(current)) return true;
            continue;
          }
          if (!current.hasAttribute('style') && !classMayControlVisibility(current.getAttribute('class'))) {
            computedHiddenCache.set(current, false);
            continue;
          }
          let hidden = false;
          try {
            const style = computedStyle(current);
            hidden = style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' ||
              style.contentVisibility === 'hidden';
          } catch (_error) {
            hidden = false;
          }
          computedHiddenCache.set(current, hidden);
          state.routingComputedVisibility.set(current, hidden);
          if (hidden) return true;
          if (current === doc.body || current === doc.documentElement) break;
        }
        return false;
      };
      return turns.filter((turn) => {
        if (!turn || !turn.isConnected || turn.hidden || turn.getAttribute('aria-hidden') === 'true' ||
          turn.hasAttribute('inert') || turn.getAttribute('data-state') === 'closed' ||
          inlineStyleHidesContent(turn.getAttribute('style')) || classTokensHideContent(turn.getAttribute('class')) ||
          hiddenRoots.some((root) => root.contains(turn))) return false;
        if (hasComputedHiddenAncestor(turn)) return false;
        return true;
      });
    }

    function userTurnLocator(turn) {
      if (!turn) return null;
      const testId = normalizeText(turn.getAttribute('data-testid'));
      const stableTestId = /^conversation-turn-[\w-]+$/u.test(testId) ? testId : '';
      return {
        testId: stableTestId,
        turnIndex: stableTestId ? -1 : getTurns(doc).indexOf(turn),
      };
    }

    function locateUserTurn(locator) {
      if (!locator || typeof locator !== 'object') return null;
      const testId = normalizeText(locator.testId);
      if (/^conversation-turn-[\w-]+$/u.test(testId)) {
        const exact = doc.querySelector(`[data-testid="${testId}"]`);
        if (exact && roleOfTurn(exact) === 'user') return exact;
      }
      const index = clampInteger(locator.turnIndex, -1, -1, 100_000);
      if (index < 0) return null;
      const turns = getTurns(doc);
      return index >= 0 && roleOfTurn(turns[index]) === 'user' ? turns[index] : null;
    }

    function activeEditSession() {
      const session = state.pendingEditSession;
      if (!session) return null;
      const now = Date.now();
      let expired = false;
      if (!session.composerRef) {
        expired = now - session.startedAt > 15_000;
      } else if (session.composerRef.isConnected) {
        session.disconnectedAt = 0;
      } else {
        if (!session.disconnectedAt) session.disconnectedAt = now;
        expired = now - session.disconnectedAt > 5_000;
      }
      if (session.path !== conversationPath() || expired || !locateUserTurn(session.turnLocator)) {
        state.pendingEditSession = null;
        return null;
      }
      return session;
    }

    function clearEditSession(sessionId = 0) {
      if (!state.pendingEditSession) return;
      if (!sessionId || state.pendingEditSession.id === sessionId) state.pendingEditSession = null;
    }

    function editableUserMessageText(turn) {
      if (!turn) return '';
      const roleNode = turn.matches('[data-message-author-role="user"]')
        ? turn
        : turn.querySelector('[data-message-author-role="user"]') || turn;
      const preferred = [...roleNode.querySelectorAll(
        '[data-message-content], [data-testid="user-message"], [data-testid*="user-message-content"]',
      )].filter((node) => !node.parentElement || !node.parentElement.closest(
        '[data-message-content], [data-testid="user-message"], [data-testid*="user-message-content"]',
      ));
      const candidates = preferred.map(readableNodeText).filter(Boolean);
      return (candidates.sort((left, right) => right.length - left.length)[0] || readableNodeText(turn))
        .slice(0, QUESTION_MAX_LENGTH);
    }

    function editPortalControlLabel(control) {
      return lowerText(`${accessibleText(control)} ${control && control.value || ''}`);
    }

    function isPortalCancelControl(control) {
      return /^(?:cancel|discard(?: edit)?)$/iu.test(editPortalControlLabel(control));
    }

    function isPortalSendControl(control) {
      if (!control) return false;
      if (control.matches(SEND_BUTTON_SELECTORS.join(', '))) return true;
      return /^(?:send(?:\s+(?:message|prompt))?|resend|submit|save\s*(?:&|and)\s*(?:send|submit))$/iu.test(
        editPortalControlLabel(control),
      );
    }

    function editPortalScope(composer) {
      if (!composer) return null;
      const form = composer.closest('form');
      const dialog = composer.closest(
        '[role="dialog"], [data-radix-dialog-content], [data-slot*="dialog"], [data-testid*="edit"], [data-state="open"][data-slot*="popover"]',
      );
      if (dialog) return dialog;
      let ancestor = composer.parentElement;
      for (let depth = 0; ancestor && depth < 5; depth += 1, ancestor = ancestor.parentElement) {
        const controls = [...ancestor.querySelectorAll(SUBMISSION_CONTROL_SELECTOR)];
        if (controls.some(isPortalCancelControl) && controls.some(isPortalSendControl)) return ancestor;
      }
      return form;
    }

    function hasEditPortalEvidence(composer, session) {
      if (!isEditableComposer(composer) || !session) return false;
      const turn = locateUserTurn(session.turnLocator);
      if (!turn) return false;
      if (closestUserTurn(composer) === turn) return true;
      const draft = getComposerText(composer);
      const sourceMatches = Boolean(session.sourceDraft &&
        composerTextSemanticallyEquals(composer, session.sourceDraft));
      const scope = editPortalScope(composer);
      if (!scope || scope.matches('main, body, html')) return false;
      const form = composer.closest('form');
      const controls = uniqueElements([
        ...scope.querySelectorAll(SUBMISSION_CONTROL_SELECTOR),
        ...(form ? [...doc.querySelectorAll(SUBMISSION_CONTROL_SELECTOR)].filter((control) => control.form === form) : []),
      ]).filter((control) => isProbablyVisible(control) && !control.closest(`#${UI_ROOT_ID}`));
      const hasCancel = controls.some(isPortalCancelControl);
      const hasExactSend = controls.some(isPortalSendControl);
      const controlled = [...session.controlledIds].some((id) => {
        const root = doc.getElementById(id);
        return root && (root === scope || root.contains(composer));
      });
      const markerNodes = [];
      for (let current = composer; current && markerNodes.length < 8; current = current.parentElement) markerNodes.push(current);
      const markerText = markerNodes.flatMap((node) => [
        node.getAttribute('data-testid'), node.getAttribute('data-slot'),
      ]).filter(Boolean).join(' ');
      const editMarked = controlled || /(?:message|prompt)[-_ ]?edit(?:or|ing|[-_ ]dialog)?|edit(?:or|ing)?[-_ ]?(?:message|prompt)/iu.test(markerText);
      return hasCancel && hasExactSend && (sourceMatches || editMarked) &&
        Boolean(draft || session.sourceDraft === '');
    }

    function sessionPortalControl(control, composer, expectedAction = 'send') {
      const session = activeEditSession();
      if (!control || !composer || !session || session.composerRef !== composer ||
        !composer.isConnected || !hasEditPortalEvidence(composer, session)) return false;
      const scope = editPortalScope(composer);
      const form = composer.closest('form');
      const associated = Boolean(scope && scope.contains(control) || form && control.form === form);
      if (!associated || !isProbablyVisible(control) || control.closest(`#${UI_ROOT_ID}`)) return false;
      if (expectedAction === 'cancel') return isPortalCancelControl(control);
      return isPortalSendControl(control);
    }

    function editSurfaceBaselineState(composer) {
      const scope = editPortalScope(composer);
      const form = composer && composer.closest('form');
      const controls = scope ? uniqueElements([
        ...scope.querySelectorAll(SUBMISSION_CONTROL_SELECTOR),
        ...(form ? [...doc.querySelectorAll(SUBMISSION_CONTROL_SELECTOR)].filter((control) => control.form === form) : []),
      ]) : [];
      const markerNodes = [];
      for (let current = composer; current && markerNodes.length < 8; current = current.parentElement) markerNodes.push(current);
      const markerText = markerNodes.flatMap((node) => [
        node.getAttribute('data-testid'), node.getAttribute('data-slot'),
      ]).filter(Boolean).join(' ');
      return {
        draft: getComposerText(composer),
        hasCancel: controls.some(isPortalCancelControl),
        editMarked: /(?:message|prompt)[-_ ]?edit(?:or|ing|[-_ ]dialog)?|edit(?:or|ing)?[-_ ]?(?:message|prompt)/iu.test(markerText),
      };
    }

    function baselineComposerBecameEditSurface(composer, session) {
      const baseline = session && session.baselinePositions && session.baselinePositions.get(composer);
      if (!baseline || !composer || !composer.isConnected) return false;
      const current = editSurfaceBaselineState(composer);
      return current.hasCancel && !baseline.editState.hasCancel ||
        current.editMarked && !baseline.editState.editMarked ||
        normalizeComposerPayload(baseline.editState.draft) !== normalizeComposerPayload(session.sourceDraft) &&
          composerTextSemanticallyEquals(composer, session.sourceDraft);
    }

    function baselineComposerMovedIntoEditSurface(composer, session) {
      const baseline = session && session.baselinePositions && session.baselinePositions.get(composer);
      if (!baseline || !composer || !composer.isConnected) return false;
      const currentForm = composer.closest('form');
      const moved = composer.parentElement !== baseline.parent || currentForm !== baseline.form ||
        currentForm && currentForm.parentElement !== baseline.formParent;
      return Boolean(moved && hasEditPortalEvidence(composer, session));
    }

    function cancelBelongsToEditSurface(control, actionTurn = null) {
      const session = activeEditSession();
      const sessionTurn = session && locateUserTurn(session.turnLocator);
      const activeSurface = state.activeAdaptiveSnapshot && state.activeAdaptiveSnapshot.surface;
      const activeTurn = activeSurface && activeSurface.kind === 'edit' ? surfaceTurn(activeSurface) : null;
      if (actionTurn) {
        if (actionTurn === sessionTurn || actionTurn === activeTurn) return true;
        const localComposer = findComposerInScope(actionTurn, control);
        return Boolean(localComposer && isEditableComposer(localComposer));
      }
      if (!session || !session.composerRef || !session.composerRef.isConnected) return false;
      const composerForm = session.composerRef.closest('form');
      const controlForm = control.form || control.closest('form');
      if (composerForm && composerForm === controlForm) return true;
      const composerPortal = editPortalScope(session.composerRef);
      return Boolean(composerPortal && composerPortal !== doc && composerPortal.contains(control));
    }

    function bindEditSession(session) {
      if (!session || state.pendingEditSession !== session) return;
      const turn = locateUserTurn(session.turnLocator);
      if (!turn) {
        clearEditSession(session.id);
        return;
      }
      const candidates = [...doc.querySelectorAll(LOCAL_COMPOSER_SELECTOR)].filter(isEditableComposer);
      const eligible = candidates.filter((composer) =>
        closestUserTurn(composer) === turn ||
        (!session.baselineComposers.has(composer) || baselineComposerMovedIntoEditSurface(composer, session) ||
          baselineComposerBecameEditSurface(composer, session)) &&
          hasEditPortalEvidence(composer, session));
      if (eligible.length === 1) {
        session.composerRef = eligible[0];
        session.formRef = eligible[0].closest('form');
      }
    }

    function startEditSession(turn, trigger = null) {
      if (!turn) return null;
      const baselineComposers = [...doc.querySelectorAll(LOCAL_COMPOSER_SELECTOR)].filter(isEditableComposer);
      const session = {
        id: state.nextEditSessionId,
        path: conversationPath(),
        startedAt: Date.now(),
        turnLocator: userTurnLocator(turn),
        sourceDraft: editableUserMessageText(turn),
        controlledIds: new Set(normalizeText(
          `${trigger && trigger.getAttribute('aria-controls') || ''} ${trigger && trigger.getAttribute('aria-owns') || ''}`,
        ).split(/\s+/u).filter(Boolean)),
        baselineComposers: new Set(baselineComposers),
        baselinePositions: new Map(baselineComposers.map((composer) => {
          const form = composer.closest('form');
          return [composer, {
            parent: composer.parentElement,
            form,
            formParent: form && form.parentElement,
            editState: editSurfaceBaselineState(composer),
          }];
        })),
        composerRef: null,
        formRef: null,
        disconnectedAt: 0,
      };
      state.nextEditSessionId += 1;
      state.pendingEditSession = session;
      win.setTimeout(() => bindEditSession(session), 0);
      win.setTimeout(() => bindEditSession(session), 100);
      win.setTimeout(() => bindEditSession(session), 500);
      return session;
    }

    function rememberEditMenuSource(turn, trigger) {
      if (!turn || !trigger) return;
      const menuSelector = '[role="menu"], [role="listbox"], [data-radix-menu-content], [data-slot*="dropdown-menu"], [data-state][data-slot*="popover"]';
      state.pendingEditMenuSource = {
        path: conversationPath(),
        startedAt: Date.now(),
        turnLocator: userTurnLocator(turn),
        triggerRef: trigger,
        controlledIds: normalizeText(
          `${trigger.getAttribute('aria-controls') || ''} ${trigger.getAttribute('aria-owns') || ''}`,
        ).split(/\s+/u).filter(Boolean),
        menuStates: new Map([...doc.querySelectorAll(menuSelector)].map((menu) => [menu, {
          hidden: menu.hidden === true,
          ariaHidden: normalizeText(menu.getAttribute('aria-hidden')),
          state: normalizeText(menu.getAttribute('data-state')),
        }])),
      };
    }

    function editMenuSourceTurn(control) {
      const pending = state.pendingEditMenuSource;
      if (!pending || pending.path !== conversationPath() || Date.now() - pending.startedAt > 10_000) {
        state.pendingEditMenuSource = null;
        return null;
      }
      const menu = control && control.closest(
        '[role="menu"], [role="listbox"], [data-radix-menu-content], [data-slot*="dropdown-menu"], [data-state="open"][data-slot*="popover"]',
      );
      if (!menu) return null;
      const controlled = pending.controlledIds.some((id) => {
        const root = doc.getElementById(id);
        return root && root.contains(control);
      }) || normalizeText(
        `${pending.triggerRef && pending.triggerRef.getAttribute('aria-controls') || ''} ${pending.triggerRef && pending.triggerRef.getAttribute('aria-owns') || ''}`,
      ).split(/\s+/u).filter(Boolean).some((id) => {
        const root = doc.getElementById(id);
        return root && root.contains(control);
      });
      const triggerId = normalizeText(pending.triggerRef && pending.triggerRef.id);
      const labelledByTrigger = triggerId && normalizeText(menu.getAttribute('aria-labelledby'))
        .split(/\s+/u).includes(triggerId);
      const previousMenuState = pending.menuStates.get(menu);
      const newlyOpenedMenu = Date.now() - pending.startedAt <= 3_000 && pending.triggerRef && pending.triggerRef.isConnected && (
        !previousMenuState || previousMenuState.hidden && !menu.hidden ||
        previousMenuState.ariaHidden === 'true' && normalizeText(menu.getAttribute('aria-hidden')) !== 'true' ||
        previousMenuState.state === 'closed' && normalizeText(menu.getAttribute('data-state')) === 'open'
      );
      if (!controlled && !labelledByTrigger && !newlyOpenedMenu) return null;
      return locateUserTurn(pending.turnLocator);
    }

    function retainedTurnsBefore(editTurn, referenceText = '') {
      if (!editTurn) return activeConversationTurns();
      const turns = getTurns(doc);
      const index = turns.indexOf(editTurn);
      if (index < 0) return [];
      const active = new Set(activeConversationTurns(turns, { anchorIndex: index, referenceText }));
      return turns.slice(0, index).filter((turn) => active.has(turn));
    }

    function retainedPrefixChangedSince(snapshot, editTurn) {
      if (!snapshot || snapshot.conversationVersion === state.conversationMutationVersion) return false;
      const history = state.conversationMutationHistory.filter((entry) =>
        entry.version > snapshot.conversationVersion);
      if (!history.length || history[0].version > snapshot.conversationVersion + 1) return true;
      const retainedAtCapture = Array.isArray(snapshot.retainedPrefixTurns)
        ? snapshot.retainedPrefixTurns
        : retainedTurnsBefore(editTurn, snapshot.draft || '');
      const prefixTurns = new Set(retainedAtCapture);
      if (history.some((entry) => entry.structural === true)) {
        const current = retainedTurnsBefore(editTurn, snapshot.draft || '');
        if (current.length !== retainedAtCapture.length ||
          current.some((turn, index) => turn !== retainedAtCapture[index])) return true;
      }
      return history.some((entry) => entry.turns.some((turn) => prefixTurns.has(turn)));
    }

    function submissionSurface(composer, options = {}) {
      if (!isEditableComposer(composer)) return null;
      const directTurn = closestUserTurn(composer);
      const suppliedTurn = options.editTurn && roleOfTurn(options.editTurn) === 'user'
        ? options.editTurn
        : locateUserTurn(options.turnLocator);
      const editTurn = directTurn || suppliedTurn;
      const kind = editTurn ? 'edit' : 'primary';
      const locator = editTurn ? userTurnLocator(editTurn) : null;
      const key = editTurn
        ? `edit:${locator && (locator.testId || locator.turnIndex)}`
        : 'primary';
      return {
        kind,
        key,
        sessionId: kind === 'edit' ? clampInteger(options.sessionId, 0, 0, Number.MAX_SAFE_INTEGER) : 0,
        composerRef: composer,
        formRef: composer.closest('form'),
        submitterRef: options.submitter || null,
        turnLocator: locator,
      };
    }

    function surfaceTurn(surface) {
      return surface && surface.kind === 'edit' ? locateUserTurn(surface.turnLocator) : null;
    }

    function composerMatchesSurface(composer, surface) {
      if (!composer || !surface) return false;
      if (surface.kind === 'primary') return !closestUserTurn(composer);
      const expectedTurn = surfaceTurn(surface);
      const session = surface.sessionId && activeEditSession();
      const sessionMatch = session && session.id === surface.sessionId && (
        session.composerRef === composer ||
        session.formRef && composer.closest('form') === session.formRef
      );
      return Boolean(expectedTurn && closestUserTurn(composer) === expectedTurn ||
        expectedTurn && surface.formRef && surface.formRef.isConnected && composer.closest('form') === surface.formRef ||
        expectedTurn && sessionMatch);
    }

    function resolveSurfaceComposer(surface, expectedDraft = null, allowAnyText = false) {
      if (!surface) return null;
      const original = surface.composerRef;
      if (original && original.isConnected && isEditableComposer(original) && composerMatchesSurface(original, surface) &&
        (allowAnyText || expectedDraft == null || composerTextEquals(original, expectedDraft))) return original;
      if (surface.kind === 'primary') {
        const primary = findComposer(doc);
        if (!primary || closestUserTurn(primary)) return null;
        return allowAnyText || expectedDraft == null || composerTextEquals(primary, expectedDraft) ? primary : null;
      }
      const turn = surfaceTurn(surface);
      if (!turn) return null;
      const candidates = [];
      if (surface.formRef && surface.formRef.isConnected) {
        const formComposer = findComposerInScope(surface.formRef);
        if (formComposer) candidates.push(formComposer);
      }
      candidates.push(...turn.querySelectorAll(LOCAL_COMPOSER_SELECTOR));
      const session = surface.sessionId && activeEditSession();
      if (session && session.id === surface.sessionId && session.composerRef && session.composerRef.isConnected) {
        candidates.push(session.composerRef);
      }
      const visible = uniqueElements(candidates).filter((candidate) =>
        isEditableComposer(candidate) && composerMatchesSurface(candidate, surface));
      if (expectedDraft != null) {
        const matching = visible.filter((candidate) => composerTextEquals(candidate, expectedDraft));
        if (matching.length === 1) return matching[0];
      }
      if (allowAnyText && visible.length === 1) return visible[0];
      if (session && session.id === surface.sessionId && session.composerRef && !session.composerRef.isConnected) {
        const remounted = [...doc.querySelectorAll(LOCAL_COMPOSER_SELECTOR)].filter((candidate) =>
          isEditableComposer(candidate) && !session.baselineComposers.has(candidate) &&
          hasEditPortalEvidence(candidate, session) &&
          (expectedDraft == null || composerTextEquals(candidate, expectedDraft)));
        if (remounted.length === 1) {
          session.composerRef = remounted[0];
          session.formRef = remounted[0].closest('form');
          return remounted[0];
        }
      }
      return null;
    }

    function interactionSurface(target, options = {}) {
      const node = target && (target.nodeType === 1 ? target : target.parentElement);
      if (!node) return null;
      const session = activeEditSession();
      const form = options.form || node.form || node.closest && node.closest('form');
      let composer = node.matches && node.matches(LOCAL_COMPOSER_SELECTOR) && isEditableComposer(node)
        ? node
        : node.closest && node.closest(LOCAL_COMPOSER_SELECTOR);
      if (!isEditableComposer(composer)) composer = form && findComposerInScope(form, node);
      const directTurn = closestUserTurn(node);
      if (!composer && directTurn) composer = findComposerInScope(directTurn, node);
      if (!composer && session && session.composerRef &&
        sessionPortalControl(node, session.composerRef, 'send')) composer = session.composerRef;
      if (!composer) return null;
      const primary = findComposer(doc);
      const composerTurn = directTurn || closestUserTurn(composer);
      const sessionTurn = session && locateUserTurn(session.turnLocator);
      let editTurn = composerTurn;
      if (!editTurn && session && sessionTurn) {
        const composerForm = composer.closest('form');
        const bound = session.composerRef === composer ||
          session.formRef && composerForm && session.formRef === composerForm;
        const eligibleComposer = !session.baselineComposers.has(composer) ||
          baselineComposerMovedIntoEditSurface(composer, session) ||
          baselineComposerBecameEditSurface(composer, session);
        const newlyMounted = (!session.composerRef || !session.composerRef.isConnected) &&
          Date.now() - session.startedAt <= 15_000 &&
          eligibleComposer && hasEditPortalEvidence(composer, session);
        if (bound || newlyMounted) {
          editTurn = sessionTurn;
          session.composerRef = composer;
          session.formRef = composerForm;
        }
      }
      if (!editTurn && (composer !== primary || !findSendButton(doc, composer))) return null;
      return submissionSurface(composer, {
        editTurn,
        sessionId: editTurn && sessionTurn === editTurn ? session.id : 0,
        submitter: options.submitter || null,
      });
    }

    function sendControlForSurface(surface, composer) {
      const saved = surface && surface.submitterRef;
      if (saved && saved.isConnected && isProbablyVisible(saved)) {
        if (surface.kind === 'edit' && (isEditSubmissionControl(saved, composer, surfaceTurn(surface)) ||
          sessionPortalControl(saved, composer, 'send'))) return saved;
        if (surface.kind === 'primary' && saved === findSendButton(doc, composer)) return saved;
      }
      if (surface && surface.kind === 'edit') {
        const editTurn = surfaceTurn(surface);
        const form = composer.closest('form');
        const local = [...doc.querySelectorAll(SUBMISSION_CONTROL_SELECTOR)].find((control) => {
          const associatedForm = control.form || control.closest('form');
          return (form && associatedForm === form || editTurn && editTurn.contains(control)) &&
            isEditSubmissionControl(control, composer, editTurn);
        });
        if (local) return local;
        const portal = [...doc.querySelectorAll(SUBMISSION_CONTROL_SELECTOR)].find((control) =>
          sessionPortalControl(control, composer, 'send'));
        if (portal) return portal;
      }
      return findSendButton(doc, composer);
    }

    function attachmentStateFromScope(scope, options = {}) {
      if (!scope || typeof scope.querySelectorAll !== 'function') {
        return { count: 0, signature: '', profile: buildAttachmentProfile() };
      }
      const selectors = [
        '[data-file-id]',
        '[data-attachment-id]',
        '[data-testid*="file-pill"]',
        '[aria-label*="remove file" i]',
        '[aria-label*="remove attachment" i]',
        '[data-testid*="attachment"]',
        'a[download]',
        'a[href^="sandbox:"]',
      ];
      const rawNodes = uniqueElements(selectors.flatMap((selector) => [...scope.querySelectorAll(selector)]))
        .filter((node) => (options.includeHidden === true || isProbablyVisible(node)) && !node.closest(`#${UI_ROOT_ID}`))
        .filter((node) => {
          const testId = lowerText(node.getAttribute('data-testid'));
          const ariaLabel = lowerText(node.getAttribute('aria-label'));
          const title = lowerText(node.getAttribute('title'));
          if (/\b(?:attachment|file)[-_ ]?(?:add|button|picker|upload)\b|\b(?:add|upload)[-_ ]?(?:attachment|file)\b/iu.test(testId) ||
            /^(?:add|attach|upload)(?:\s+(?:a|the))?\s+(?:file|files|attachment|attachments)?\b/iu.test(`${ariaLabel} ${title}`.trim())) return false;
          const ownLabel = normalizeText([
            ariaLabel,
            title,
            node.getAttribute('data-file-name'),
            node.getAttribute('data-filename'),
            node.getAttribute('data-name'),
            [...node.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent).join(' '),
          ].filter(Boolean).join('|'));
          const label = normalizeText([
            testId,
            ownLabel,
            node.textContent,
          ].filter(Boolean).join('|'));
          const stable = node.hasAttribute('data-file-id') || node.hasAttribute('data-attachment-id') ||
            /file-pill/iu.test(node.getAttribute('data-testid') || '') ||
            /remove (?:file|attachment)/iu.test(node.getAttribute('aria-label') || '');
          const genericAttachment = /attachment/iu.test(node.getAttribute('data-testid') || '');
          if (genericAttachment && !stable && !attachmentNameFromLabel(ownLabel)) {
            if (node.querySelector('[data-file-id], [data-attachment-id], [data-testid*="file-pill"]')) return false;
            const fileCardWithPreview = /(?:attachment|file)[-_ ]?(?:card|item|pill)\b/iu.test(testId) &&
              node.querySelector('img, figure');
            if (!fileCardWithPreview) return false;
          }
          return true;
        });
      const stableAnchorSelector = '[data-file-id], [data-attachment-id], [data-testid*="file-pill"]';
      const genericAnchorSelector = '[data-testid*="attachment"]';
      const removeSelector = '[aria-label*="remove file" i], [aria-label*="remove attachment" i]';
      const genericAnchor = (node) => {
        const ancestors = [];
        let candidate = node.closest(genericAnchorSelector);
        while (candidate && (candidate === scope || scope.contains(candidate))) {
          ancestors.push(candidate);
          const parent = candidate.parentElement;
          candidate = parent && parent.closest(genericAnchorSelector);
        }
        const removalOwner = ancestors.find((ancestor) => ancestor.querySelector(removeSelector));
        if (removalOwner) return removalOwner;
        const scored = ancestors.map((ancestor, index) => {
          const testId = lowerText(ancestor.getAttribute('data-testid'));
          let score = /(?:attachment|file)[-_ ]?(?:card|item|pill)\b/iu.test(testId) ? 40 : 0;
          if (/\b(?:preview|thumbnail|thumb|icon|button|list|tray|menu)\b/iu.test(testId)) score -= 30;
          return { ancestor, index, score };
        }).sort((left, right) => right.score - left.score || right.index - left.index);
        return scored[0] && scored[0].ancestor || node;
      };
      const anchors = uniqueElements(rawNodes.map((node) =>
        node.closest(stableAnchorSelector) || genericAnchor(node) || node));
      const nodeRecords = [];
      const seenKeys = new Set();
      const idlessNames = new Set();
      const stableNames = new Set();
      for (const [index, node] of anchors.entries()) {
        const label = normalizeText([
          node.getAttribute('data-file-id'),
          node.getAttribute('data-attachment-id'),
          node.getAttribute('data-file-name'),
          node.getAttribute('data-filename'),
          node.getAttribute('data-name'),
          node.getAttribute('data-testid'),
          node.getAttribute('aria-label'),
          node.getAttribute('title'),
          node.getAttribute('download'),
          node.getAttribute('href'),
          node.querySelector('img[alt]') && node.querySelector('img[alt]').getAttribute('alt'),
          node.textContent,
        ].filter(Boolean).join('|')).slice(0, 240);
        const name = normalizeText(
          node.getAttribute('data-file-name') || node.getAttribute('data-filename') ||
          node.getAttribute('data-name') || node.getAttribute('download') || attachmentNameFromLabel(label),
        ).slice(0, 220);
        const id = normalizeText(node.getAttribute('data-file-id') || node.getAttribute('data-attachment-id'));
        const normalizedName = lowerText(name);
        const key = id ? `id:${id}` : name ? `name:${lowerText(name)}` : `node:${index}`;
        if (seenKeys.has(key) || !id && normalizedName && (idlessNames.has(normalizedName) || stableNames.has(normalizedName))) continue;
        seenKeys.add(key);
        if (normalizedName) {
          if (id) stableNames.add(normalizedName);
          else idlessNames.add(normalizedName);
        }
        nodeRecords.push({
          key,
          name,
          label,
          mime: node.getAttribute('data-mime-type') || node.getAttribute('data-file-type') || '',
          size: node.getAttribute('data-file-size') || node.getAttribute('data-size') || attachmentByteSizeFromText(label),
        });
      }

      const fileRecords = [];
      for (const input of scope.querySelectorAll('input[type="file"]')) {
        const liveInput = Boolean(normalizeText(input.value)) ||
          /\b(?:uploading|pending|processing)\b/iu.test(`${input.getAttribute('data-state') || ''} ${input.getAttribute('aria-label') || ''}`) ||
          input.getAttribute('aria-busy') === 'true';
        if (!liveInput) continue;
        let files = [];
        try { files = [...(input.files || [])]; } catch (_error) { files = []; }
        for (const file of files.slice(0, 100)) {
          fileRecords.push({ name: file.name, mime: file.type, size: file.size, label: file.name });
        }
      }
      const combined = [...nodeRecords];
      const knownNames = new Set(nodeRecords.map((item) => lowerText(item.name)).filter(Boolean));
      for (const file of fileRecords) {
        if (nodeRecords.length && file.name && knownNames.has(lowerText(file.name))) {
          const existing = combined.find((item) => lowerText(item.name) === lowerText(file.name));
          if (existing) {
            existing.mime = existing.mime || file.mime;
            existing.size = Number(existing.size) || file.size;
          }
        } else if (!nodeRecords.length) {
          combined.push(file);
        }
      }
      const profile = buildAttachmentProfile(combined, nodeRecords.length || fileRecords.length);
      const signature = profile.items.map((item) => [item.key, item.name, item.mime, item.size, item.kind].join('|'))
        .sort().join('\n');
      return { count: profile.count, signature, profile };
    }

    function attachmentState(composer, surface = null) {
      const localScope = surface && surface.kind === 'edit'
        ? editPortalScope(composer) || composerScope(composer)
        : composerScope(composer);
      const local = attachmentStateFromScope(localScope);
      const editTurn = surface && surface.kind === 'edit'
        ? surfaceTurn(surface)
        : closestUserTurn(composer);
      if (!editTurn || localScope === editTurn) return local;
      const retained = attachmentStateFromScope(editTurn, { includeHidden: true });
      const profile = mergeAttachmentProfiles(local.profile, retained.profile);
      const signature = profile.items.map((item) => [item.key, item.name, item.mime, item.size, item.kind].join('|'))
        .sort().join('\n');
      return { count: profile.count, signature, profile };
    }

    function historicalAttachmentState(turn, shouldScan = true) {
      if (!turn) return buildAttachmentProfile();
      if (state.historicalAttachmentCache.has(turn)) return state.historicalAttachmentCache.get(turn);
      let profile = shouldScan
        ? attachmentStateFromScope(turn, { includeHidden: true }).profile
        : buildAttachmentProfile();
      if (profile.items.length) {
        let scopeId = state.attachmentScopeIds.get(turn);
        if (!scopeId) {
          scopeId = state.nextAttachmentScopeId;
          state.nextAttachmentScopeId += 1;
          state.attachmentScopeIds.set(turn, scopeId);
        }
        profile = buildAttachmentProfile(profile.items.map((item, index) => ({
          ...item,
          key: item.key && item.key.startsWith('id:')
            ? item.key
            : `turn:${scopeId}:${item.key || index}`,
        })), profile.count);
      }
      state.historicalAttachmentCache.set(turn, profile);
      return profile;
    }

    function attachmentProfileFromText(value) {
      const text = String(value == null ? '' : value).slice(0, 20_000);
      const filenameAtEnd = /([^/\\|\n]{1,180}\.(?:pdf|docx?|pptx?|xlsx?|xlsm|numbers|csv|tsv|jsonl?|parquet|sql|db|sqlite|ipynb|zip|7z|rar|tar|gz|png|jpe?g|webp|gif|txt|md|py|js|jsx|ts|tsx|java|rs|go))\s*["'’”`)]*[.!?]?\s*$/iu;
      const cleanCandidate = (raw) => {
        const source = String(raw == null ? '' : raw)
          .trim()
          .replace(/^(?:is|as|named|called)\s+/iu, '')
          .replace(/^["'‘“`(]+/u, '');
        const match = source.match(filenameAtEnd);
        return match ? match[1].trim().slice(0, 220) : '';
      };
      const evidencePatterns = [
        /\b(?:attached|uploaded|provided)\b(?:\s+(?:the\s+)?(?:file|attachment|document|spreadsheet|image|dataset))?\s*(?:is|as|named|called|:|-)?\s*(.+)$/iu,
        /\b(?:from|inside|in)\s+(?:the\s+|this\s+|that\s+)?(?:file\s+|document\s+|spreadsheet\s+|dataset\s+)?(.+)$/iu,
        /^(?:please\s+)?(?:remove|delete|open|preview|download|read|review|analy[sz]e|inspect|check|compare|use)\s+(?:the\s+|this\s+|that\s+)?(?:file\s+|attachment\s+|document\s+|spreadsheet\s+|image\s+|dataset\s+)?(.+)$/iu,
      ];
      const sentenceLead = /^(?:create|make|write|generate|rename|call|explain|summari[sz]e|translate|what|why|how|when|where|who|i|we|you|they|he|she|it)\b/iu;
      const names = [];
      for (const rawLine of text.split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line || !filenameAtEnd.test(line)) continue;
        let name = '';
        for (const pattern of evidencePatterns) {
          const match = line.match(pattern);
          if (!match) continue;
          name = cleanCandidate(match[1]);
          if (name) break;
        }
        if (!name && !sentenceLead.test(line)) name = cleanCandidate(line);
        if (name) names.push(name);
      }
      const uniqueNames = [...new Map(names.map((name) => [lowerText(name), name])).values()].slice(0, 50);
      return buildAttachmentProfile(uniqueNames.map((name) => ({ name, label: name })), uniqueNames.length);
    }

    function mergeAttachmentProfiles(...profiles) {
      return combineAttachmentProfiles(...profiles);
    }

    function assistantTextContextLevel(value) {
      const text = boundedHeadTailSample(value, 12_000);
      if (!text) return '';
      const codeLines = text.split(/\r?\n/u).filter((line) => /^\s{4,}|[{}();]|=>|\b(?:const|let|def|class|function|import|SELECT)\b/u.test(line)).length;
      if (codeLines >= 25 || /\b(?:formal proof|threat model|race condition|stack trace|diagnosis|contract clause|security vulnerability|derive(?:d|s)? the equation)\b/iu.test(text)) return 'high';
      if (text.length >= 3_000 || codeLines >= 8 || /\b(?:equation|algorithm|architecture|calculation|proof|source code|lab results?)\b/iu.test(text)) return 'medium';
      return '';
    }

    function assistantContextLevel(allTurns = getTurns(doc), options = {}) {
      const assistants = allTurns.filter((turn) => roleOfTurn(turn) === 'assistant');
      const stopButton = options.ignoreActiveGeneration === true ? null : [...doc.querySelectorAll(
        'button[data-testid="stop-button"], button[data-testid*="stop-generating"], button[aria-label^="Stop generating" i], button[aria-label^="Stop streaming" i]',
      )].find(isProbablyVisible);
      const assistantAcknowledgment = /^(?:you(?:['’]re|\s+are)\s+welcome|no\s+problem|happy\s+to\s+help|glad\s+(?:that\s+)?helped|sure|okay|ok|of\s+course|anytime)[.!,\s]*$/iu;
      const userAcknowledgment = USER_ACKNOWLEDGMENT_PATTERN;
      let latestCompletedText = '';
      const textOptions = options.textOptions || {};
      for (let index = assistants.length - 1; index >= 0; index -= 1) {
        const turn = assistants[index];
        const explicitlyStreaming = turn.matches('[data-is-streaming="true"], [data-streaming="true"], .result-streaming') ||
          turn.querySelector('[data-is-streaming="true"], [data-streaming="true"], .result-streaming');
        if (explicitlyStreaming || stopButton && index === assistants.length - 1) continue;
        const text = extractAssistantHandoff(turn, {
          ...textOptions,
          headTailSampleLength: 12_000,
        });
        if (!latestCompletedText) latestCompletedText = text;
        if (!assistantAcknowledgment.test(normalizeText(text))) return assistantTextContextLevel(text);
        const allTurnIndex = allTurns.indexOf(turn);
        let precedingUser = null;
        for (let candidateIndex = allTurnIndex - 1; candidateIndex >= 0; candidateIndex -= 1) {
          if (roleOfTurn(allTurns[candidateIndex]) === 'user') {
            precedingUser = allTurns[candidateIndex];
            break;
          }
        }
        if (precedingUser && !userAcknowledgment.test(normalizeText(readableNodeText(precedingUser, textOptions)))) return '';
      }
      return assistantTextContextLevel(latestCompletedText);
    }

    function latestCompletedAssistantText(allTurns = getTurns(doc), options = {}) {
      const assistants = allTurns.filter((turn) => roleOfTurn(turn) === 'assistant');
      const stopButton = options.ignoreActiveGeneration === true ? null : [...doc.querySelectorAll(
        'button[data-testid="stop-button"], button[data-testid*="stop-generating"], button[aria-label^="Stop generating" i], button[aria-label^="Stop streaming" i]',
      )].find(isProbablyVisible);
      const textOptions = options.textOptions || {};
      for (let index = assistants.length - 1; index >= 0; index -= 1) {
        const turn = assistants[index];
        const explicitlyStreaming = turn.matches('[data-is-streaming="true"], [data-streaming="true"], .result-streaming') ||
          turn.querySelector('[data-is-streaming="true"], [data-streaming="true"], .result-streaming');
        if (explicitlyStreaming || stopButton && index === assistants.length - 1) continue;
        return extractAssistantHandoff(turn, {
          ...textOptions,
          headTailSampleLength: 4_000,
        });
      }
      return '';
    }

    function transferredConversationRoutingState(value, referenceText = '') {
      const raw = String(value == null ? '' : value);
      const match = raw.match(/--- PREVIOUS CONVERSATION ---\s*\n([\s\S]*?)\n--- END PREVIOUS CONVERSATION ---/u);
      if (!match) return null;
      const transcript = match[1].slice(0, SIDE_FALLBACK_TRANSCRIPT_MAX_LENGTH);
      const blocks = [...transcript.matchAll(/(?:^|\n\n)(USER|ASSISTANT):\s*\n([\s\S]*?)(?=\n\n(?:USER|ASSISTANT):\s*\n|$)/gu)]
        .map((entry, index) => ({ role: lowerText(entry[1]), text: entry[2].trim(), index }));
      const allUsers = blocks.filter((block) => block.role === 'user');
      if (!allUsers.length) return null;
      const archivedMaterials = mergeAttachmentProfiles(
        ...blocks.map((block) => attachmentProfileFromText(block.text)),
      );
      let archivedConversationLevel = '';
      if (explicitlyReferencesOlderConversation(referenceText)) {
        for (const block of allUsers) {
          const attachments = attachmentProfileFromText(block.text);
          const decision = classifyPrompt(boundedHeadTailSample(block.text, 16_000), { attachmentProfile: attachments });
          const target = decision.target === 'max' ? 'pro' : extractModelLevel(decision.target);
          archivedConversationLevel = strongerRouteLevel(archivedConversationLevel, target);
        }
      }
      let level = '';
      let materials = buildAttachmentProfile();
      let hasMeaningfulTurn = false;
      const acknowledgment = USER_ACKNOWLEDGMENT_PATTERN;
      const users = allUsers.filter((block) =>
        !acknowledgment.test(normalizeText(block.text)) || attachmentProfileFromText(block.text).count > 0)
        .slice(-6);
      const archivedMeaningfulTurnCount = allUsers.filter((block) =>
        !acknowledgment.test(normalizeText(block.text)) || attachmentProfileFromText(block.text).count > 0).length;
      for (let userIndex = 0; userIndex < users.length; userIndex += 1) {
        const block = users[userIndex];
        const attachments = attachmentProfileFromText(block.text);
        const decision = classifyPrompt(boundedHeadTailSample(block.text, 16_000), {
          previousLevel: level,
          attachmentProfile: attachments,
          hasPriorConversation: hasMeaningfulTurn,
          historicalAttachmentProfile: materials,
        });
        if (acknowledgment.test(normalizeText(block.text))) {
          materials = mergeAttachmentProfiles(materials, attachments);
          continue;
        }
        materials = decision.inherited ? mergeAttachmentProfiles(materials, attachments) : attachments;
        const target = decision.target === 'max' ? 'pro' : extractModelLevel(decision.target);
        if (target) level = target;
        hasMeaningfulTurn = true;
        const nextUserIndex = users[userIndex + 1] ? users[userIndex + 1].index : blocks.length;
        const generatedMaterials = mergeAttachmentProfiles(...blocks
          .filter((candidate) => candidate.role === 'assistant' && candidate.index > block.index && candidate.index < nextUserIndex)
          .map((candidate) => attachmentProfileFromText(candidate.text)));
        materials = mergeAttachmentProfiles(materials, generatedMaterials);
      }
      const assistantAcknowledgment = /^(?:you(?:['’]re|\s+are)\s+welcome|no\s+problem|happy\s+to\s+help|glad\s+(?:that\s+)?helped|sure|okay|ok|of\s+course|anytime)[.!,\s]*$/iu;
      const assistants = blocks.filter((block) => block.role === 'assistant');
      const userAcknowledgment = USER_ACKNOWLEDGMENT_PATTERN;
      let latestAssistant = null;
      for (let assistantIndex = assistants.length - 1; assistantIndex >= 0; assistantIndex -= 1) {
        const candidate = assistants[assistantIndex];
        if (!assistantAcknowledgment.test(normalizeText(candidate.text))) {
          latestAssistant = candidate;
          break;
        }
        const precedingUser = [...blocks.slice(0, candidate.index)].reverse().find((block) => block.role === 'user');
        if (precedingUser && !userAcknowledgment.test(normalizeText(precedingUser.text))) break;
      }
      return {
        hasPriorConversation: true,
        conversationLevel: level,
        archivedConversationLevel,
        assistantContextLevel: latestAssistant ? assistantTextContextLevel(latestAssistant.text) : '',
        awaitingConfirmation: assistants.length > 0 && assistantInvitesContinuation(assistants[assistants.length - 1].text),
        latestAssistantText: assistants.length > 0 ? boundedHeadTailSample(assistants[assistants.length - 1].text, 4_000) : '',
        archivedMeaningfulTurnCount,
        archivedSampledTextLength: transcript.length,
        historicalAttachmentProfile: materials,
        archivedAttachmentProfile: archivedMaterials,
      };
    }

    function conversationRoutingState(beforeTurn = null, referenceText = '') {
      const path = conversationPath();
      const includeArchivedDifficulty = explicitlyReferencesOlderConversation(referenceText);
      const cached = state.conversationRoutingCache;
      if (!beforeTurn && cached && cached.path === path && cached.version === state.conversationMutationVersion &&
        (!includeArchivedDifficulty || cached.includesArchivedDifficulty)) {
        return cached.value;
      }
      const boundaryLocator = beforeTurn ? userTurnLocator(beforeTurn) : null;
      const boundaryKey = boundaryLocator
        ? `${path}|${boundaryLocator.testId || boundaryLocator.turnIndex}|archive:${includeArchivedDifficulty ? 1 : 0}`
        : '';
      const editCached = boundaryKey && state.editConversationRoutingCache.get(boundaryKey);
      if (editCached && editCached.version === state.conversationMutationVersion) return editCached.value;
      state.conversationRoutingBuilds += 1;
      const routingTextOptions = {
        checkComputedVisibility: true,
        visibilityState: state.routingComputedVisibility,
        computedVisibilityCache: new Map(),
      };
      const allTurns = beforeTurn
        ? retainedTurnsBefore(beforeTurn, referenceText)
        : activeConversationTurns(null, { referenceText });
      const turns = allTurns.filter((turn) => roleOfTurn(turn) === 'user');
      const materialTurnSet = new Set(allTurns.filter((turn) => {
        const role = roleOfTurn(turn);
        return role === 'user' || role === 'assistant';
      }));
      const attachmentCandidateSelector = [
        '[data-file-id]', '[data-attachment-id]', '[data-testid*="file-pill"]',
        '[aria-label*="remove file" i]', '[aria-label*="remove attachment" i]',
        '[data-testid*="attachment"]', 'a[download]', 'a[href^="sandbox:"]',
      ].join(', ');
      const attachmentCandidates = new Set();
      for (const node of doc.querySelectorAll(attachmentCandidateSelector)) {
        const primary = node.closest(TURN_SELECTOR);
        const roleNode = primary ? null : node.closest(ROLE_SELECTOR);
        const turn = primary || roleNode && (roleNode.closest('article') || roleNode);
        if (materialTurnSet.has(turn)) attachmentCandidates.add(turn);
      }
      const attachmentProfiles = new Map([...attachmentCandidates].map((turn) => [
        turn,
        historicalAttachmentState(turn, true),
      ]));
      const archivedMaterials = mergeAttachmentProfiles(...attachmentProfiles.values());
      let level = '';
      let archivedConversationLevel = '';
      let materials = buildAttachmentProfile();
      let hasMeaningfulTurn = false;
      let archivedMeaningfulTurnCount = 0;
      let archivedSampledTextLength = 0;
      const acknowledgment = USER_ACKNOWLEDGMENT_PATTERN;
      const recent = [];
      if (includeArchivedDifficulty) {
        for (const turn of turns) {
          const prompt = boundedHeadTailSample(readableNodeText(turn, routingTextOptions), 16_000);
          const attachments = attachmentProfiles.get(turn) || buildAttachmentProfile();
          if (!prompt || acknowledgment.test(normalizeText(prompt)) && attachments.count === 0) continue;
          archivedMeaningfulTurnCount += 1;
          archivedSampledTextLength += prompt.length;
          const decision = classifyPrompt(prompt, { attachmentProfile: attachments });
          const target = decision.target === 'max' ? 'pro' : extractModelLevel(decision.target);
          archivedConversationLevel = strongerRouteLevel(archivedConversationLevel, target);
        }
      }
      for (let index = turns.length - 1; index >= 0 && recent.length < 6; index -= 1) {
        const turn = turns[index];
        const prompt = boundedHeadTailSample(readableNodeText(turn, routingTextOptions), 16_000);
        const attachments = attachmentProfiles.get(turn) || buildAttachmentProfile();
        if (!prompt || acknowledgment.test(normalizeText(prompt)) && attachments.count === 0) continue;
        recent.unshift({ turn, prompt, attachments, turnIndex: allTurns.indexOf(turn) });
      }
      for (let recentIndex = 0; recentIndex < recent.length; recentIndex += 1) {
        const { prompt, attachments, turnIndex } = recent[recentIndex];
        const decision = classifyPrompt(prompt, {
          previousLevel: level,
          attachmentProfile: attachments,
          hasPriorConversation: hasMeaningfulTurn,
          historicalAttachmentProfile: materials,
        });
        if (acknowledgment.test(normalizeText(prompt))) {
          materials = mergeAttachmentProfiles(materials, attachments);
          continue;
        }
        if (decision.inherited) materials = mergeAttachmentProfiles(materials, attachments);
        else materials = attachments;
        const target = decision.target === 'max' ? 'pro' : extractModelLevel(decision.target);
        if (target) level = target;
        hasMeaningfulTurn = true;
        const nextTurnIndex = recent[recentIndex + 1] ? recent[recentIndex + 1].turnIndex : allTurns.length;
        const generatedMaterials = mergeAttachmentProfiles(...allTurns
          .slice(turnIndex + 1, nextTurnIndex)
          .filter((turn) => roleOfTurn(turn) === 'assistant')
          .map((turn) => attachmentProfiles.get(turn) || buildAttachmentProfile()));
        materials = mergeAttachmentProfiles(materials, generatedMaterials);
      }
      const latestAssistantText = latestCompletedAssistantText(allTurns, {
        ignoreActiveGeneration: Boolean(beforeTurn),
        textOptions: routingTextOptions,
      });
      const value = {
        hasPriorConversation: turns.length > 0,
        conversationLevel: level,
        archivedConversationLevel,
        retainedTurns: beforeTurn ? allTurns : null,
        assistantContextLevel: assistantContextLevel(allTurns, {
          ignoreActiveGeneration: Boolean(beforeTurn),
          textOptions: routingTextOptions,
        }),
        awaitingConfirmation: assistantInvitesContinuation(latestAssistantText),
        latestAssistantText,
        archivedMeaningfulTurnCount,
        archivedSampledTextLength,
        historicalAttachmentProfile: materials,
        archivedAttachmentProfile: archivedMaterials,
      };
      if (!beforeTurn) {
        state.conversationRoutingCache = {
          path,
          version: state.conversationMutationVersion,
          includesArchivedDifficulty: includeArchivedDifficulty,
          value,
        };
      } else if (boundaryKey) {
        state.editConversationRoutingCache.set(boundaryKey, {
          version: state.conversationMutationVersion,
          value,
        });
      }
      return value;
    }

    function activeToolState(composer) {
      const primaryComposer = findComposer(doc);
      const scopes = uniqueElements([
        composerScope(composer),
        closestUserTurn(composer) && primaryComposer && primaryComposer !== composer
          ? composerScope(primaryComposer)
          : null,
      ]);
      if (!scopes.length) return { signature: '', special: '' };
      const specialPattern = /\b(?:agent(?: mode)?|deep research|canvas|create (?:an )?image|image generation|video generation|voice mode|record mode)\b/iu;
      const routingControlCandidates = [
        findModelPicker(doc, composer), findReasoningPicker(doc, composer),
      ];
      if (primaryComposer && primaryComposer !== composer) {
        routingControlCandidates.push(
          findModelPicker(doc, primaryComposer),
          findReasoningPicker(doc, primaryComposer),
        );
      }
      const routingControls = new Set(routingControlCandidates.filter(Boolean));
      const active = uniqueElements(scopes.flatMap((scope) => [...scope.querySelectorAll(
        '[aria-pressed="true"], [aria-checked="true"], [data-state="active"], [data-state="on"], [data-state="checked"], [data-selected="true"]',
      )])).filter((node) => isProbablyVisible(node) && !node.closest(`#${UI_ROOT_ID}`) && !routingControls.has(node));
      const ambiguousSpecial = uniqueElements(scopes.flatMap((scope) =>
        [...scope.querySelectorAll('button, [role="button"], [data-testid*="tool"], [data-testid*="mode"]')]))
        .filter((node) => isProbablyVisible(node) && !node.closest(`#${UI_ROOT_ID}`) &&
          node.getAttribute('aria-pressed') !== 'false' && node.getAttribute('aria-checked') !== 'false' &&
          !['off', 'closed', 'inactive'].includes(lowerText(node.getAttribute('data-state'))) && specialPattern.test(accessibleText(node)));
      const labels = uniqueElements([...active, ...ambiguousSpecial]).map(accessibleText).filter(Boolean).sort();
      const special = labels.find((label) => specialPattern.test(label)) || '';
      return { signature: labels.join('\n'), special };
    }

    function captureSendSnapshot(composer = findComposer(doc), suppliedSurface = null) {
      if (!composer) return null;
      const surface = suppliedSurface || interactionSurface(composer) || submissionSurface(composer);
      if (!surface) return null;
      const editTurn = surfaceTurn(surface);
      if (surface.kind === 'edit' && !editTurn) return null;
      const attachments = attachmentState(composer, surface);
      const tools = activeToolState(composer);
      const draft = getComposerText(composer);
      const conversation = conversationRoutingState(editTurn, draft);
      return {
        path: conversationPath(),
        conversationVersion: state.conversationMutationVersion,
        surface,
        draft,
        attachmentCount: attachments.count,
        attachmentSignature: attachments.signature,
        attachmentProfile: attachments.profile,
        hasPriorConversation: conversation.hasPriorConversation,
        conversationLevel: conversation.conversationLevel,
        archivedConversationLevel: conversation.archivedConversationLevel,
        retainedPrefixTurns: editTurn ? conversation.retainedTurns : null,
        assistantContextLevel: conversation.assistantContextLevel,
        awaitingConfirmation: conversation.awaitingConfirmation,
        latestAssistantText: conversation.latestAssistantText,
        archivedMeaningfulTurnCount: conversation.archivedMeaningfulTurnCount,
        archivedSampledTextLength: conversation.archivedSampledTextLength,
        historicalAttachmentProfile: conversation.historicalAttachmentProfile,
        archivedAttachmentProfile: conversation.archivedAttachmentProfile,
        toolSignature: tools.signature,
        specialMode: tools.special,
      };
    }

    function validateSendSnapshot(snapshot) {
      if (!snapshot || conversationPath() !== snapshot.path) return { ok: false, reason: 'The conversation changed while Auto was choosing.' };
      if (snapshot.surface && snapshot.surface.kind === 'edit') {
        const editTurn = surfaceTurn(snapshot.surface);
        if (!editTurn) return { ok: false, reason: 'The edited message was closed while Auto was choosing.' };
        if (hasActiveGeneration(doc)) {
          return { ok: false, reason: 'ChatGPT started generating while Auto was choosing.' };
        }
        if (snapshot.conversationVersion !== state.conversationMutationVersion) {
          if (retainedPrefixChangedSince(snapshot, editTurn)) {
            return { ok: false, reason: 'The earlier conversation changed while Auto was choosing.' };
          }
          snapshot.conversationVersion = state.conversationMutationVersion;
        }
      } else if (snapshot.conversationVersion !== state.conversationMutationVersion) {
        return { ok: false, reason: 'The conversation changed while Auto was choosing.' };
      }
      const composer = snapshot.surface
        ? resolveSurfaceComposer(snapshot.surface, null, true)
        : findComposer(doc);
      let draftMatches = false;
      if (composer) {
        try {
          draftMatches = typeof snapshot.draftValidator === 'function'
            ? snapshot.draftValidator(composer, snapshot.draft) === true
            : composerTextEquals(composer, snapshot.draft);
        } catch (_error) {
          draftMatches = false;
        }
      }
      if (!composer || !draftMatches) {
        return { ok: false, reason: 'Your draft changed while Auto was choosing.' };
      }
      const attachments = attachmentState(composer, snapshot.surface);
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

    function armSubmitReplayPermit(composer, kind, draftValidator = null, surface = null) {
      const form = composer && composer.closest('form');
      if (!composer) return;
      state.submitReplayPermit = {
        form,
        knownForms: new Set(doc.querySelectorAll('form')),
        surfaceKey: surface && surface.key || '',
        path: conversationPath(),
        draft: getComposerText(composer),
        draftValidator: typeof draftValidator === 'function' ? draftValidator : null,
        kind,
        consumed: false,
        expiresAt: Date.now() + 3_000,
      };
    }

    function consumeSubmitReplayPermit(event, composer, surface = null) {
      const permit = state.submitReplayPermit;
      if (!permit) return false;
      if (Date.now() > permit.expiresAt) {
        state.submitReplayPermit = null;
        return false;
      }
      if (!event || conversationPath() !== permit.path) return false;
      const sameSurface = permit.surfaceKey && surface && surface.key === permit.surfaceKey;
      const exactForm = event.target === permit.form;
      if (!exactForm && !sameSurface) return false;
      if (permit.consumed) return 'duplicate';
      const currentDraft = getComposerText(composer);
      if (currentDraft) {
        let draftMatches = currentDraft === permit.draft;
        if (!draftMatches && permit.draftValidator) {
          try { draftMatches = permit.draftValidator(composer, permit.draft) === true; } catch (_error) { draftMatches = false; }
        }
        if (!draftMatches) return false;
      }
      if (!exactForm && sameSurface) permit.form = event.target;
      permit.consumed = true;
      return 'allow';
    }

    function mountedEditReplayCandidate(form, submitter = null) {
      const permit = state.submitReplayPermit;
      const activeSurface = state.activeAdaptiveSnapshot && state.activeAdaptiveSnapshot.surface;
      if (!state.replayingSend || !permit || permit.consumed || permit.form && permit.form.isConnected ||
        !form || !form.isConnected || permit.knownForms && permit.knownForms.has(form) ||
        !activeSurface || activeSurface.kind !== 'edit' || !permit.surfaceKey ||
        activeSurface.key !== permit.surfaceKey || conversationPath() !== permit.path) return null;
      const composers = [...form.querySelectorAll(LOCAL_COMPOSER_SELECTOR)].filter(isEditableComposer);
      if (composers.length !== 1) return null;
      const composer = composers[0];
      const controls = [...form.querySelectorAll(SUBMISSION_CONTROL_SELECTOR)]
        .filter((control) => isProbablyVisible(control) && !control.closest(`#${UI_ROOT_ID}`));
      const sendControls = controls.filter(isPortalSendControl);
      if (!controls.some(isPortalCancelControl) || sendControls.length !== 1 || submitter !== sendControls[0]) return null;
      let draftMatches = getComposerText(composer) === permit.draft;
      if (!draftMatches && permit.draftValidator) {
        try { draftMatches = permit.draftValidator(composer, permit.draft) === true; } catch (_error) { draftMatches = false; }
      }
      return draftMatches ? { composer, surface: activeSurface } : null;
    }

    async function replayNativeSend(snapshot, decision, selectedLevel, manual = false, reason = '') {
      let validation = validateSendSnapshot(snapshot);
      if (!validation.ok) {
        if (!snapshot.silent) toast(`${validation.reason} Review it and press Send again.`, 7_000);
        return false;
      }
      if (state.adaptiveCancelled) {
        if (!snapshot.silent) toast('Adaptive send cancelled. Your draft is unchanged.');
        return false;
      }
      const runBeforeReplay = async (context) => {
        if (typeof snapshot.beforeReplay !== 'function') return true;
        const originalSnapshot = snapshot;
        const ready = await snapshot.beforeReplay(context);
        if (state.adaptiveCancelled) return false;
        if (!ready) return false;
        if (ready && typeof ready === 'object' && ready.refreshSnapshot === true) {
          const refreshComposer = ready.composer && ready.composer.isConnected
            ? ready.composer
            : snapshot.surface
              ? resolveSurfaceComposer(snapshot.surface, null, true)
              : findComposer(doc);
          const refreshedSurface = snapshot.surface && refreshComposer
            ? {
              ...snapshot.surface,
              composerRef: refreshComposer,
              formRef: refreshComposer.closest('form'),
            }
            : null;
          const refreshed = captureSendSnapshot(refreshComposer, refreshedSurface);
          if (!refreshed || refreshed.path !== originalSnapshot.path ||
            refreshed.attachmentCount !== originalSnapshot.attachmentCount ||
            refreshed.attachmentSignature !== originalSnapshot.attachmentSignature ||
            refreshed.toolSignature !== originalSnapshot.toolSignature ||
            refreshed.specialMode !== originalSnapshot.specialMode) return false;
          refreshed.beforeReplay = null;
          refreshed.silent = originalSnapshot.silent;
          refreshed.fallbackToCurrentModel = originalSnapshot.fallbackToCurrentModel;
          refreshed.draftValidator = originalSnapshot.draftValidator;
          snapshot = refreshed;
        }
        validation = validateSendSnapshot(snapshot);
        if (state.adaptiveCancelled) return false;
        if (!validation.ok) {
          if (!snapshot.silent) toast(`${validation.reason} Review it and press Send again.`, 7_000);
          return false;
        }
        return true;
      };
      const sendButton = snapshot.surface
        ? sendControlForSurface(snapshot.surface, validation.composer)
        : findSendButton(doc, validation.composer);
      if (sendButton) {
        if (sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') {
          if (!snapshot.silent) toast('ChatGPT’s Send control is not ready. Your draft was not sent.', 7_000);
          return false;
        }
        if (typeof snapshot.beforeReplay === 'function') {
          if (!await runBeforeReplay({ composer: validation.composer, sendButton })) return false;
          const currentSendButton = snapshot.surface
            ? sendControlForSurface(snapshot.surface, validation.composer)
            : findSendButton(doc, validation.composer);
          if (!currentSendButton || currentSendButton.disabled || currentSendButton.getAttribute('aria-disabled') === 'true') return false;
          if (state.adaptiveCancelled) return false;
          armSubmitReplayPermit(validation.composer, 'adaptive-replay', snapshot.draftValidator, snapshot.surface);
          state.replayingSend = true;
          try { currentSendButton.click(); } finally { state.replayingSend = false; }
          if (snapshot.surface && snapshot.surface.sessionId) {
            win.setTimeout(() => clearEditSession(snapshot.surface.sessionId), 3_250);
          }
          rememberRoute(selectedLevel, decision, manual, reason);
          return true;
        }
        if (state.adaptiveCancelled) return false;
        armSubmitReplayPermit(validation.composer, 'adaptive-replay', snapshot.draftValidator, snapshot.surface);
        state.replayingSend = true;
        try { sendButton.click(); } finally { state.replayingSend = false; }
        if (snapshot.surface && snapshot.surface.sessionId) {
          win.setTimeout(() => clearEditSession(snapshot.surface.sessionId), 3_250);
        }
        rememberRoute(selectedLevel, decision, manual, reason);
        return true;
      }
      const form = validation.composer.closest('form');
      if (form && typeof form.requestSubmit === 'function') {
        if (typeof snapshot.beforeReplay === 'function') {
          if (!await runBeforeReplay({ composer: validation.composer, form })) return false;
        }
        const currentForm = validation.composer.closest('form');
        if (!currentForm || !currentForm.isConnected || typeof currentForm.requestSubmit !== 'function') return false;
        if (state.adaptiveCancelled) return false;
        armSubmitReplayPermit(validation.composer, 'adaptive-replay', snapshot.draftValidator, snapshot.surface);
        state.replayingSend = true;
        try { currentForm.requestSubmit(); } catch (_error) { return false; } finally { state.replayingSend = false; }
        if (snapshot.surface && snapshot.surface.sessionId) {
          win.setTimeout(() => clearEditSession(snapshot.surface.sessionId), 3_250);
        }
        rememberRoute(selectedLevel, decision, manual, reason);
        return true;
      }
      if (!snapshot.silent) toast('ChatGPT’s Send control changed. Your draft is ready; press Send again.', 7_000);
      return false;
    }

    function routingIsStrict(decision) {
      return Boolean(decision && (decision.explicit || decision.strict));
    }

    function programmaticClick(node) {
      if (!node || typeof node.click !== 'function') return false;
      try {
        node.click();
        return true;
      } catch (_error) {
        return false;
      }
    }

    function modelControlMenuRoots(picker) {
      const roots = [];
      const controlledIds = normalizeText(picker && picker.getAttribute('aria-controls')).split(/\s+/u).filter(Boolean);
      for (const id of controlledIds) {
        const controlled = doc.getElementById(id);
        if (controlled) roots.push(controlled);
      }
      const pickerId = normalizeText(picker && picker.id);
      if (pickerId) {
        for (const candidate of doc.querySelectorAll('[aria-labelledby]')) {
          if (normalizeText(candidate.getAttribute('aria-labelledby')).split(/\s+/u).includes(pickerId)) roots.push(candidate);
        }
      }
      roots.push(...doc.querySelectorAll('[data-testid="composer-intelligence-picker-content"]'));
      return uniqueElements(roots);
    }

    function modelControlActivationSnapshot(picker) {
      return {
        expanded: normalizeText(picker && picker.getAttribute('aria-expanded')),
        state: normalizeText(picker && picker.getAttribute('data-state')),
        roots: modelControlMenuRoots(picker).map((root) => ({
          root,
          connected: root.isConnected,
          hidden: root.hidden === true,
          ariaHidden: normalizeText(root.getAttribute('aria-hidden')),
          state: normalizeText(root.getAttribute('data-state')),
          visible: isProbablyVisible(root),
        })),
      };
    }

    function modelControlActivationChanged(picker, before) {
      const after = modelControlActivationSnapshot(picker);
      if (after.expanded !== before.expanded || after.state !== before.state || after.roots.length !== before.roots.length) return true;
      return after.roots.some((entry, index) => {
        const previous = before.roots[index];
        return !previous || entry.root !== previous.root || entry.connected !== previous.connected || entry.hidden !== previous.hidden ||
          entry.ariaHidden !== previous.ariaHidden || entry.state !== previous.state || entry.visible !== previous.visible;
      });
    }

    function dispatchModelControlPointer(node) {
      if (!node || typeof node.dispatchEvent !== 'function') return false;
      let rect = null;
      try { rect = node.getBoundingClientRect && node.getBoundingClientRect(); } catch (_error) { rect = null; }
      const clientX = rect && Number.isFinite(rect.left) ? rect.left + Math.max(0, rect.width || 0) / 2 : 0;
      const clientY = rect && Number.isFinite(rect.top) ? rect.top + Math.max(0, rect.height || 0) / 2 : 0;
      const dispatchPointer = (type, buttons) => {
        const EventConstructor = typeof win.PointerEvent === 'function' ? win.PointerEvent : win.MouseEvent;
        if (typeof EventConstructor !== 'function') return;
        const init = {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: win,
          button: 0,
          buttons,
          clientX,
          clientY,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        };
        node.dispatchEvent(new EventConstructor(type, init));
      };
      try {
        dispatchPointer('pointerdown', 1);
        dispatchPointer('pointerup', 0);
        return true;
      } catch (_error) {
        return false;
      }
    }

    function activateModelControl(node) {
      if (!node || typeof node.dispatchEvent !== 'function') return false;
      const before = modelControlActivationSnapshot(node);
      const pointerDispatched = dispatchModelControlPointer(node);
      if (!modelControlActivationChanged(node, before)) return programmaticClick(node);
      return pointerDispatched;
    }

    function modelControlOpenedAfter(picker, before) {
      const after = modelControlActivationSnapshot(picker);
      if (after.expanded === 'true' || after.state === 'open') return picker;
      const openedRoot = after.roots.find((entry) => {
        if (!entry.connected || entry.hidden || entry.ariaHidden === 'true' || entry.state === 'closed') return false;
        const previous = before.roots.find((candidate) => candidate.root === entry.root);
        return !previous || previous.hidden !== entry.hidden || previous.ariaHidden !== entry.ariaHidden ||
          previous.state !== entry.state || previous.visible !== entry.visible;
      });
      return openedRoot && openedRoot.root || null;
    }

    async function openModelControl(node, snapshot = null, deadline = Date.now() + 1_500) {
      if (!node || typeof node.dispatchEvent !== 'function') return false;
      if (node.getAttribute('aria-expanded') === 'true' || node.getAttribute('data-state') === 'open') return true;
      const canContinue = () => !state.adaptiveCancelled && (!snapshot || validateSendSnapshot(snapshot).ok);
      const waitForOpen = (before, maximumWait) => {
        const remaining = Math.max(0, deadline - Date.now());
        const immediate = modelControlOpenedAfter(node, before);
        if (immediate || remaining < 50) return Promise.resolve(immediate);
        return waitForCondition(() => modelControlOpenedAfter(node, before), {
          root: doc.documentElement,
          win,
          timeout: Math.min(maximumWait, remaining),
          attributes: true,
        });
      };

      let before = modelControlActivationSnapshot(node);
      const pointerDispatched = dispatchModelControlPointer(node);
      const immediatePointerOpen = modelControlOpenedAfter(node, before);
      if (pointerDispatched && immediatePointerOpen) return true;
      if (!canContinue()) return false;

      before = modelControlActivationSnapshot(node);
      try { node.focus({ preventScroll: true }); } catch (_error) { try { node.focus(); } catch (_focusError) { /* ignore */ } }
      try {
        node.dispatchEvent(new win.KeyboardEvent('keydown', {
          key: 'ArrowDown',
          code: 'ArrowDown',
          bubbles: true,
          cancelable: true,
          composed: true,
        }));
      } catch (_error) {
        return false;
      }
      if (await waitForOpen(before, 120)) return true;
      if (!canContinue()) return false;

      // Legacy controls may still be ordinary buttons. ChatGPT's current
      // BasicTrigger ignores click, so this never substitutes for the
      // pointer/ArrowDown path above; it only preserves older layouts.
      before = modelControlActivationSnapshot(node);
      return Boolean(programmaticClick(node) && await waitForOpen(before, 350));
    }

    function controlledModelMenu(picker) {
      const ids = normalizeText(picker && picker.getAttribute('aria-controls')).split(/\s+/u).filter(Boolean);
      const controlled = ids.map((id) => doc.getElementById(id)).find((node) => node && node.isConnected && isProbablyVisible(node) &&
        !node.matches('[data-state="closed"], [aria-hidden="true"], [hidden]')) || null;
      if (controlled) return controlled;
      const pickerId = normalizeText(picker && picker.id);
      if (!pickerId) return null;
      return [...doc.querySelectorAll(`${MODEL_MENU_ROOT_SELECTOR}, [aria-labelledby]`)].find((node) =>
        normalizeText(node.getAttribute('aria-labelledby')).split(/\s+/u).includes(pickerId) &&
        node.isConnected && isProbablyVisible(node) && !node.matches('[data-state="closed"], [aria-hidden="true"], [hidden]')) || null;
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
      if (current && (current.getAttribute('aria-expanded') === 'true' || current.getAttribute('data-state') === 'open')) {
        activateModelControl(current);
      }
    }

    async function routeAndReplay(snapshot, decision, manual = false, silent = false, routingStage = 0, pickerAttempt = 0, discoveryDeadline = 0) {
      const target = manual ? decision.target : cappedTarget(decision.target);
      const targetRank = modelLevelRank(target);
      const strictMinimumRank = routingIsStrict(decision)
        ? modelLevelRank(decision.minimumLevel || target)
        : -1;
      const activeDiscoveryDeadline = discoveryDeadline || Date.now() + routingDiscoveryTimeout;
      const routingComposer = () => snapshot.surface
        ? resolveSurfaceComposer(snapshot.surface, null, true)
        : findComposer(doc);
      const routingPickerCandidates = () => {
        const composer = routingComposer();
        const preferred = targetRank >= ROUTE_LEVEL_RANK.pro
          ? [findModelPicker(doc, composer), findReasoningPicker(doc, composer)]
          : [findReasoningPicker(doc, composer), findModelPicker(doc, composer)];
        return uniqueElements(preferred);
      };
      const pickerCandidates = routingPickerCandidates();
      let picker = pickerCandidates[pickerAttempt] || null;
      const currentRoutingPicker = (expectedLevel = '') => {
        const refreshed = routingPickerCandidates();
        if (expectedLevel) {
          const reflected = uniqueElements([picker && picker.isConnected ? picker : null, ...refreshed]).find((candidate) => {
            const level = extractModelLevel(accessibleText(candidate));
            return level === expectedLevel || expectedLevel === 'instant' && level === 'auto';
          });
          if (reflected) return reflected;
        }
        if (picker && picker.isConnected) return picker;
        return refreshed[pickerAttempt] || refreshed[0] || null;
      };
      const current = extractModelLevel(accessibleText(picker));
      const hasAlternatePicker = pickerCandidates.length > pickerAttempt + 1;
      const replayWithCurrentModel = async (reason) => {
        if (!snapshot.fallbackToCurrentModel || routingIsStrict(decision) || state.adaptiveCancelled) return false;
        const validation = validateSendSnapshot(snapshot);
        if (!validation.ok) return false;
        closeModelMenu(picker);
        const reflected = extractModelLevel(accessibleText(currentRoutingPicker()));
        return replayNativeSend(
          snapshot,
          decision,
          reflected || current || 'unknown',
          manual,
          `${reason}; used current model`,
        );
      };

      if (snapshot.specialMode) {
        if (routingIsStrict(decision) && modelLevelRank(current) < strictMinimumRank) {
          if (!silent) toast(`${snapshot.specialMode} did not expose a confirmed ${modelLevelLabel(target)}-or-stronger level. Your accuracy-checked draft was not sent.`, 8_000);
          return false;
        }
        if (!silent) toast(`Adaptive Auto kept the current model because ${snapshot.specialMode} controls model compatibility.`);
        return replayNativeSend(snapshot, decision, current || 'unknown', manual, `kept current for ${snapshot.specialMode}`);
      }
      if (picker && target !== 'max' && (
        current === target || target === 'instant' && current === 'auto' || modelLevelRank(current) === targetRank && targetRank === 0
      )) {
        return replayNativeSend(snapshot, decision, current || target, manual);
      }
      if (!picker) {
        if (routingIsStrict(decision)) {
          if (!silent) toast(`Adaptive Auto could not find ChatGPT’s model control for the requested ${modelLevelLabel(target)} level. Your draft was not sent.`, 8_000);
          return false;
        }
        if (target === 'instant' && snapshot.fallbackToCurrentModel) {
          return replayWithCurrentModel('model control unavailable');
        }
        if (target === 'instant') {
          if (!silent) toast(`Adaptive Auto could not find ChatGPT’s model control for the requested ${modelLevelLabel(target)} level. Your draft was not sent.`, 8_000);
          return false;
        }
        if (!silent) toast('Adaptive Auto could not access this account’s model control, so this message used the current model.', 6_000);
        return replayNativeSend(snapshot, decision, current || 'unknown', manual, 'model control unavailable; used current');
      }

      const preexistingMenuRoots = new Set(visibleModelMenuRoots(picker));
      const mutatedMenuRoots = new Set();
      const collectMutatedRoot = (node) => {
        let currentNode = node && (node.nodeType === 1 ? node : node.parentElement);
        for (let depth = 0; currentNode && depth < 6; depth += 1, currentNode = currentNode.parentElement) {
          if (currentNode.matches('html, body, main') || currentNode.closest(`#${UI_ROOT_ID}`)) break;
          if (currentNode === picker || currentNode.contains(picker)) continue;
          mutatedMenuRoots.add(currentNode);
        }
      };
      let menuMutationObserver = null;
      if (win.MutationObserver) {
        menuMutationObserver = new win.MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (mutation.type === 'attributes') collectMutatedRoot(mutation.target);
            else for (const node of mutation.addedNodes) collectMutatedRoot(node);
          }
        });
        menuMutationObserver.observe(doc.body || doc.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['aria-hidden', 'data-state', 'hidden', 'class', 'style', 'role'],
        });
      }
      if (!await openModelControl(picker, snapshot, activeDiscoveryDeadline)) {
        if (menuMutationObserver) menuMutationObserver.disconnect();
        if (state.adaptiveCancelled) {
          if (!silent) toast('Adaptive send cancelled. Your draft is unchanged.');
          return false;
        }
        const activationValidation = validateSendSnapshot(snapshot);
        if (!activationValidation.ok) {
          if (!silent) toast(`${activationValidation.reason} It was not sent.`, 7_000);
          return false;
        }
        if (hasAlternatePicker) {
          return routeAndReplay(snapshot, decision, manual, silent, routingStage, pickerAttempt + 1, activeDiscoveryDeadline);
        }
        if (routingIsStrict(decision)) {
          if (!silent) toast(`ChatGPT’s model control could not be opened for the requested ${modelLevelLabel(target)} level. Your draft was not sent.`, 8_000);
          return false;
        }
        if (target === 'instant') {
          if (snapshot.fallbackToCurrentModel) return replayWithCurrentModel('model control could not be opened');
          if (!silent) toast('Adaptive Auto chose Instant but could not activate it. Your draft was not sent.', 8_000);
          return false;
        }
        return replayNativeSend(snapshot, decision, current || 'unknown', manual, 'model control could not be opened; used current');
      }
      const discoverVisibleOptions = () => {
        // Prefer the stable root used by ChatGPT's current unified
        // Intelligence picker before considering other concurrently visible
        // menus (Tools, attachments, sidebar actions, and similar portals).
        const currentOptions = currentIntelligenceOptions(doc, picker);
        if (currentOptions.length) return currentOptions;
        const slider = activePowerSlider(doc, picker);
        if (slider) return [slider];
        const controlled = controlledModelMenu(picker);
        const composer = findComposer(doc);
        const roots = uniqueElements([
          ...visibleModelMenuRoots(picker).filter((root) => root === controlled || !preexistingMenuRoots.has(root)),
          ...mutatedMenuRoots,
        ]).filter((root) => root && root.isConnected && isProbablyVisible(root) &&
          !root.closest('[data-state="closed"], [aria-hidden="true"], [hidden]') &&
          root !== picker && !root.contains(picker) && (!composer || !root.contains(composer)));
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
      };
      const remainingDiscoveryTime = Math.max(0, activeDiscoveryDeadline - Date.now());
      const options = remainingDiscoveryTime >= 50
        ? await waitForCondition(discoverVisibleOptions, {
          root: doc.documentElement,
          win,
          timeout: remainingDiscoveryTime,
          attributes: true,
        })
        : discoverVisibleOptions();
      if (menuMutationObserver) menuMutationObserver.disconnect();

      if (state.adaptiveCancelled) {
        closeModelMenu(picker);
        if (!silent) toast('Adaptive send cancelled. Your draft is unchanged.');
        return false;
      }
      const validation = validateSendSnapshot(snapshot);
      if (!validation.ok) {
        closeModelMenu(picker);
        if (!silent) toast(`${validation.reason} It was not sent.`, 7_000);
        return false;
      }

      const slider = activePowerSlider(doc, picker);
      if (slider && target !== 'max') {
        const targetMatches = (level) => level === target || target === 'instant' && level === 'auto';
        const targetSliderRank = modelLevelRank(target);
        let sliderControl = slider;
        for (let step = 0; sliderControl && step < 8; step += 1) {
          const pickerLevel = extractModelLevel(accessibleText(currentRoutingPicker()));
          const sliderLevel = powerSliderLevel(sliderControl) || pickerLevel || current;
          if (targetMatches(sliderLevel)) break;
          const sliderRank = modelLevelRank(sliderLevel);
          if (sliderRank < 0 || targetSliderRank < 0) break;
          const key = sliderRank > targetSliderRank ? 'ArrowLeft' : 'ArrowRight';
          const beforeLevel = sliderLevel;
          try { sliderControl.focus({ preventScroll: true }); } catch (_error) { try { sliderControl.focus(); } catch (_focusError) { /* ignore */ } }
          try {
            sliderControl.dispatchEvent(new win.KeyboardEvent('keydown', {
              key,
              code: key,
              bubbles: true,
              cancelable: true,
              composed: true,
            }));
          } catch (_error) {
            break;
          }
          sliderControl = await waitForCondition(() => {
            const next = activePowerSlider(doc, currentRoutingPicker() || picker);
            if (!next) return null;
            const nextPickerLevel = extractModelLevel(accessibleText(currentRoutingPicker()));
            const nextSliderLevel = powerSliderLevel(next);
            return (nextSliderLevel && nextSliderLevel !== beforeLevel) ||
              (nextPickerLevel && nextPickerLevel !== beforeLevel) ? next : null;
          }, {
            root: doc.documentElement,
            win,
            timeout: 500,
            attributes: true,
            characterData: true,
          });
        }
        const finalSlider = activePowerSlider(doc, currentRoutingPicker() || picker);
        const finalPicker = currentRoutingPicker(target);
        const finalSliderLevel = powerSliderLevel(finalSlider) || extractModelLevel(accessibleText(finalPicker));
        if (targetMatches(finalSliderLevel)) {
          closeModelMenu(finalPicker || picker);
          const sliderValidation = validateSendSnapshot(snapshot);
          if (!sliderValidation.ok) {
            if (!silent) toast(`${sliderValidation.reason} It was not sent.`, 7_000);
            return false;
          }
          const reason = `${decision.reasons && decision.reasons.slice(0, 2).join(' + ') || 'prompt complexity'}; Power slider`;
          return replayNativeSend(snapshot, decision, target === 'instant' && finalSliderLevel === 'auto' ? 'auto' : target, manual, reason);
        }
      }
      const exactTargetOptions = target === 'max' ? [] : (options || []).filter((option) => {
        const level = optionLevel(option);
        return level === target || target === 'instant' && level === 'auto';
      });
      const exactTargetVisible = target === 'max' || exactTargetOptions.length > 0;
      if (exactTargetOptions.length > 1) {
        if (snapshot.fallbackToCurrentModel && !routingIsStrict(decision)) {
          return replayWithCurrentModel('model menu was ambiguous');
        }
        closeModelMenu(picker);
        if (!silent) toast(`ChatGPT showed more than one ${modelLevelLabel(target)} control. Your draft was not sent.`, 8_000);
        return false;
      }
      if ((!options || !options.length || !exactTargetVisible) && hasAlternatePicker) {
        closeModelMenu(picker);
        return routeAndReplay(snapshot, decision, manual, silent, routingStage, pickerAttempt + 1, activeDiscoveryDeadline);
      }
      if (target === 'instant' && !exactTargetVisible) {
        if (snapshot.fallbackToCurrentModel) return replayWithCurrentModel('Instant was unavailable');
        closeModelMenu(picker);
        if (!silent) toast('Adaptive Auto chose Instant but could not activate it. Your draft was not sent.', 8_000);
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
        if (routingIsStrict(decision)) {
          closeModelMenu(picker);
          if (!silent) toast(`The requested ${modelLevelLabel(target)} level is not available in this account’s current model menu. Your draft was not sent.`, 8_000);
          return false;
        }
        if (snapshot.fallbackToCurrentModel) return replayWithCurrentModel('no compatible Auto level was available');
        closeModelMenu(picker);
        if (!silent) toast('Adaptive Auto could not find a compatible level. Your draft was not sent.', 8_000);
        return false;
      }
      if (!stagedThinkingChoice && decision.explicit && decision.target !== 'max' && choice.level !== target) {
        closeModelMenu(picker);
        if (!silent) toast(`${modelLevelLabel(target)} is not available as an exact option in the current picker. Your explicit-route draft was not sent.`, 8_000);
        return false;
      }
      if (!stagedThinkingChoice && decision.strict && modelLevelRank(choice.level) < strictMinimumRank) {
        closeModelMenu(picker);
        if (!silent) toast(`${modelLevelLabel(target)} or a stronger level is not available in the current picker. Your accuracy-checked draft was not sent.`, 8_000);
        return false;
      }

      let selectionConfirmed = choice.level === current;
      if (choice.level !== current) {
        programmaticClick(choice.element);
        await new Promise((resolve) => win.setTimeout(resolve, 100));
        selectionConfirmed = Boolean(await waitForCondition(() => {
          if (stagedThinkingChoice) {
            const effortPicker = findReasoningPicker(doc, routingComposer());
            if (effortPicker) return effortPicker;
            const basePicker = findModelPicker(doc, routingComposer());
            if (basePicker && /\bthinking\b/iu.test(accessibleText(basePicker))) return basePicker;
          }
          const updated = currentRoutingPicker(choice.level);
          const selected = extractModelLevel(accessibleText(updated));
          if (selected === choice.level || choice.level === 'instant' && selected === 'auto') return updated || doc.documentElement;
          return null;
        }, {
          root: doc.documentElement,
          win,
          timeout: 500,
          attributes: true,
        }));

        // If the trigger did not reflect the first click, reopen the current
        // Intelligence menu and check Radix's real checked row. This handles a
        // rerendered trigger and gives a still-unchecked exact row one retry.
        if (!selectionConfirmed && !stagedThinkingChoice && validateSendSnapshot(snapshot).ok) {
          const verificationPicker = currentRoutingPicker();
          if (verificationPicker) {
            const alreadyOpen = verificationPicker.getAttribute('aria-expanded') === 'true' ||
              verificationPicker.getAttribute('data-state') === 'open';
            if (alreadyOpen || await openModelControl(verificationPicker, snapshot, Date.now() + 1_200)) {
              const verificationOptions = await waitForCondition(() => {
                const found = currentIntelligenceOptions(doc, verificationPicker);
                return found.length ? found : null;
              }, {
                root: doc.documentElement,
                win,
                timeout: 400,
                attributes: true,
              });
              const matchesChoice = (option) => {
                const level = optionLevel(option);
                return level === choice.level || choice.level === 'instant' && level === 'auto';
              };
              const checkedChoice = (verificationOptions || []).find((option) =>
                matchesChoice(option) && option.matches('[aria-checked="true"], [data-state="checked"]'));
              if (checkedChoice) {
                selectionConfirmed = true;
                closeModelMenu(verificationPicker);
              } else {
                const retryChoice = (verificationOptions || []).find(matchesChoice);
                if (retryChoice) {
                  programmaticClick(retryChoice);
                  await new Promise((resolve) => win.setTimeout(resolve, 100));
                  selectionConfirmed = Boolean(await waitForCondition(() => {
                    const updated = currentRoutingPicker(choice.level);
                    const selected = extractModelLevel(accessibleText(updated));
                    return selected === choice.level || choice.level === 'instant' && selected === 'auto'
                      ? updated || doc.documentElement
                      : null;
                  }, {
                    root: doc.documentElement,
                    win,
                    timeout: 500,
                    attributes: true,
                  }));
                  closeModelMenu(verificationPicker);
                } else {
                  closeModelMenu(verificationPicker);
                }
              }
            }
          }
        }
      } else {
        closeModelMenu(picker);
      }

      const after = validateSendSnapshot(snapshot);
      if (!after.ok) {
        if (!silent) toast(`${after.reason} It was not sent.`, 7_000);
        return false;
      }
      const reflected = extractModelLevel(accessibleText(currentRoutingPicker(choice.level)));
      const confirmed = selectionConfirmed || reflected === choice.level || choice.level === 'instant' && reflected === 'auto';
      if (!confirmed) {
        if (target === 'instant') {
          if (hasAlternatePicker) {
            closeModelMenu(picker);
            return routeAndReplay(snapshot, decision, manual, silent, routingStage, pickerAttempt + 1, activeDiscoveryDeadline);
          }
          if (snapshot.fallbackToCurrentModel) return replayWithCurrentModel('Instant selection was not confirmed');
          closeModelMenu(picker);
          if (!silent) toast(`ChatGPT did not confirm ${modelLevelLabel(target)}. Your draft was not sent.`, 8_000);
          return false;
        }
        closeModelMenu(picker);
        if (routingIsStrict(decision)) {
          if (!silent) toast(`ChatGPT did not confirm ${modelLevelLabel(choice.level)}. Your draft was not sent.`, 8_000);
          return false;
        }
        if (!silent) toast('ChatGPT did not confirm the Auto switch, so this message used the current model.', 6_000);
        return replayNativeSend(snapshot, decision, reflected || current || 'unknown', manual, 'model switch unconfirmed; used current');
      }
      if (stagedThinkingChoice) {
        await waitForCondition(() => findReasoningPicker(doc, routingComposer()), {
          root: composerScope(routingComposer()) || doc.documentElement,
          win,
          timeout: 500,
          attributes: true,
        });
        if (state.adaptiveCancelled) {
          if (!silent) toast('Adaptive send cancelled. Your draft is unchanged.');
          return false;
        }
        const stagedValidation = validateSendSnapshot(snapshot);
        if (!stagedValidation.ok) {
          if (!silent) toast(`${stagedValidation.reason} It was not sent.`, 7_000);
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
      const suppliedSnapshot = options.snapshot && options.snapshot.path === conversationPath()
        ? options.snapshot
        : null;
      const composer = options.composer && options.composer.isConnected
        ? options.composer
        : suppliedSnapshot && suppliedSnapshot.surface
          ? resolveSurfaceComposer(suppliedSnapshot.surface, null, true)
          : findComposer(doc);
      const snapshot = suppliedSnapshot
        ? suppliedSnapshot
        : captureSendSnapshot(composer);
      if (!snapshot) return false;
      snapshot.draftValidator = typeof options.draftValidator === 'function' ? options.draftValidator : null;
      const suppliedBeforeReplay = typeof options.beforeReplay === 'function' ? options.beforeReplay : null;
      const guardedDraft = options.routingText == null
        ? buildAccuracyGuardedPrompt(snapshot.draft, QUESTION_MAX_LENGTH, snapshot)
        : snapshot.draft;
      let accuracyGuardApplied = false;
      if (guardedDraft !== snapshot.draft) {
        snapshot.beforeReplay = async (context) => {
          const liveComposer = context.composer && context.composer.isConnected
            ? context.composer
            : snapshot.surface
              ? resolveSurfaceComposer(snapshot.surface, snapshot.draft)
              : findComposer(doc);
          if (!liveComposer || !composerTextEquals(liveComposer, snapshot.draft) ||
            !setComposerText(liveComposer, guardedDraft, win) || !composerTextEquals(liveComposer, guardedDraft)) {
            if (!snapshot.silent) toast('The accuracy check could not be added safely. Your message was not sent.', 8_000);
            return false;
          }
          accuracyGuardApplied = true;
          const activeComposer = snapshot.surface
            ? resolveSurfaceComposer(snapshot.surface, guardedDraft)
            : findComposer(doc);
          if (!activeComposer || !activeComposer.isConnected || !composerTextEquals(activeComposer, guardedDraft)) {
            if (!snapshot.silent) toast('The message box changed while the accuracy check was added. Your message was not sent.', 8_000);
            return false;
          }
          let refreshComposer = activeComposer;
          if (suppliedBeforeReplay) {
            const ready = await suppliedBeforeReplay({
              ...context,
              composer: activeComposer,
              sendButton: snapshot.surface
                ? sendControlForSurface(snapshot.surface, activeComposer)
                : findSendButton(doc, activeComposer),
              form: activeComposer.closest('form'),
            });
            if (!ready) return false;
            if (typeof ready === 'object' && ready.composer && ready.composer.isConnected) {
              refreshComposer = ready.composer;
            }
          }
          return { refreshSnapshot: true, composer: refreshComposer };
        };
      } else {
        snapshot.beforeReplay = suppliedBeforeReplay;
      }
      snapshot.silent = options.silent === true;
      snapshot.fallbackToCurrentModel = options.fallbackToCurrentModel === true;
      state.adaptiveCancelled = false;

      const task = Promise.resolve().then(async () => {
        const transferredContext = options.routingText != null && !snapshot.hasPriorConversation
          ? transferredConversationRoutingState(snapshot.draft, options.routingText)
          : null;
        const inferredConversationLevel = strongerRouteLevel(
          snapshot.conversationLevel,
          transferredContext && transferredContext.conversationLevel,
        );
        const explicitDecision = classifyPrompt(options.routingText == null ? snapshot.draft : options.routingText, {
          previousLevel: inferredConversationLevel || (snapshot.surface && snapshot.surface.kind === 'edit'
            ? ''
            : previousRouteLevel()),
          attachmentCount: snapshot.attachmentCount,
          attachmentProfile: snapshot.attachmentProfile,
          hasPriorConversation: transferredContext ? true : snapshot.hasPriorConversation,
          conversationLevel: inferredConversationLevel,
          archivedConversationLevel: strongerRouteLevel(
            snapshot.archivedConversationLevel,
            transferredContext && transferredContext.archivedConversationLevel,
          ),
          assistantContextLevel: strongerRouteLevel(snapshot.assistantContextLevel, transferredContext && transferredContext.assistantContextLevel),
          awaitingConfirmation: snapshot.awaitingConfirmation || Boolean(transferredContext && transferredContext.awaitingConfirmation),
          latestAssistantText: transferredContext && transferredContext.latestAssistantText || snapshot.latestAssistantText,
          archivedMeaningfulTurnCount: Math.max(
            snapshot.archivedMeaningfulTurnCount || 0,
            transferredContext && transferredContext.archivedMeaningfulTurnCount || 0,
          ),
          archivedSampledTextLength: Math.max(
            snapshot.archivedSampledTextLength || 0,
            transferredContext && transferredContext.archivedSampledTextLength || 0,
          ),
          historicalAttachmentProfile: transferredContext
            ? mergeAttachmentProfiles(snapshot.historicalAttachmentProfile, transferredContext.historicalAttachmentProfile)
            : snapshot.historicalAttachmentProfile,
          archivedAttachmentProfile: transferredContext
            ? mergeAttachmentProfiles(snapshot.archivedAttachmentProfile, transferredContext.archivedAttachmentProfile)
            : snapshot.archivedAttachmentProfile,
        });
        const decision = explicitDecision;
        if (!state.settings.adaptiveRouting && !explicitDecision.explicit) {
          return replayNativeSend(snapshot, decision, extractModelLevel(accessibleText(findModelPicker(doc))) || 'unknown', false, 'Adaptive Auto disabled');
        }
        return routeAndReplay(snapshot, decision, false, options.silent === true);
      });
      state.adaptiveSendPromise = task;
      state.activeAdaptiveSnapshot = snapshot;
      syncSettingsUI();
      const rollbackAccuracyGuard = () => {
        if (!accuracyGuardApplied) return;
        const guardedComposer = snapshot.surface
          ? resolveSurfaceComposer(snapshot.surface, guardedDraft, true)
          : findComposer(doc);
        if (guardedComposer && composerTextEquals(guardedComposer, guardedDraft)) {
          setComposerText(guardedComposer, snapshot.draft, win);
        }
      };
      try {
        const sent = await task;
        if (!sent) rollbackAccuracyGuard();
        return sent;
      } catch (error) {
        rollbackAccuracyGuard();
        throw error;
      } finally {
        if (state.adaptiveSendPromise === task) state.adaptiveSendPromise = null;
        if (state.activeAdaptiveSnapshot === snapshot) state.activeAdaptiveSnapshot = null;
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

    function sideHandoffIsActive() {
      return Boolean(state.sideAutomationActive || state.incomingRunPromise || state.incomingJobId);
    }

    function openHandoff() {
      if (sideHandoffIsActive()) {
        toast('Finish the separate-chat question before starting a fresh-chat continuation.');
        return;
      }
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
      if (sideHandoffIsActive()) return false;
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
      if (sideHandoffIsActive()) {
        closeHandoff(false);
        toast('Finish the separate-chat question before starting a fresh-chat continuation.');
        return false;
      }
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
      pill.style.visibility = 'hidden';
      pill.hidden = false;
      const pillRect = pill.getBoundingClientRect();
      const position = chooseSelectionPillPosition(
        rect,
        {
          width: pillRect.width || pill.offsetWidth || SELECTION_PILL_FALLBACK_WIDTH,
          height: pillRect.height || pill.offsetHeight || SELECTION_PILL_FALLBACK_HEIGHT,
        },
        {
          width: Number(win.innerWidth) || doc.documentElement.clientWidth,
          height: Number(win.innerHeight) || doc.documentElement.clientHeight,
        },
      );
      pill.style.left = `${position.left}px`;
      pill.style.top = `${position.top}px`;
      pill.dataset.cgsPlacement = position.placement;
      pill.style.visibility = '';
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
      if (!conversationIdentity(sourceUrl)) {
        closeReservedWindow(reservation);
        toast('Save or send this conversation first so Workflow Toolkit can create a separate chat safely.', 7_000);
        return false;
      }
      const job = sanitizeJob({
        version: 1,
        createdAt: Date.now(),
        sourceUrl,
        kind: options.kind === 'continue' ? 'continue' : 'ask',
        locator,
        targetFingerprint: assistantTurnFingerprint(turn),
        contextFingerprint: conversationContextFingerprint(doc, turn),
        question: String(options.question || ''),
        autoSend: options.kind === 'continue' ? options.autoSend === true : true,
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
      toast(options.kind === 'continue' ? 'Opening a separate chat…' : 'Opening and sending your question in a separate chat…');
      return true;
    }

    function isExpectedBranchConversation(job, expectedConversation = state.branchConversation) {
      return Boolean(expectedConversation && expectedConversation !== job.sourceConversation &&
        conversationIdentity(win.location.href) === expectedConversation);
    }

    function fallbackDestinationStatus(job, expectedConversation = '') {
      if (!job || !job.fallbackMode || !job.fallbackTranscript || !job.branchReloadFrom ||
        job.branchReloadFrom === state.pageInstanceId || getTurns(doc).length || hasActiveGeneration(doc)) {
        return { ok: false, conversation: '' };
      }
      try {
        const current = new URL(String(win.location.href));
        const currentJobId = parseJobId(current.href);
        const launchWasCaptured = state.initialJobId === state.incomingJobId;
        const jobIsBound = currentJobId === state.incomingJobId || !currentJobId && launchWasCaptured;
        if (!isAllowedChatGPTUrl(current.href) || !jobIsBound) return { ok: false, conversation: '' };
        const conversation = conversationIdentity(current.href);
        const allowedConversation = job.branchConversation || sanitizeConversationIdentity(expectedConversation);
        if (!conversation) {
          const isNewChatRoute = current.pathname === '/' || current.pathname === '/new';
          return { ok: isNewChatRoute && !allowedConversation, conversation: '' };
        }
        if (!allowedConversation || conversation === job.sourceConversation || conversation !== allowedConversation) {
          return { ok: false, conversation };
        }
        return { ok: true, conversation };
      } catch (_error) {
        return { ok: false, conversation: '' };
      }
    }

    function isActiveFallbackDestination(job) {
      return fallbackDestinationStatus(job, job.branchConversation).ok;
    }

    async function bindFallbackConversation(job, expectedConversation = '') {
      const status = fallbackDestinationStatus(job, expectedConversation);
      if (!status.ok) return false;
      if (!status.conversation) return true;
      if (job.branchConversation) return job.branchConversation === status.conversation;

      const previousStateConversation = state.branchConversation;
      job.branchConversation = status.conversation;
      state.branchConversation = status.conversation;
      if (!await persistIncomingJob(job)) {
        job.branchConversation = '';
        state.branchConversation = previousStateConversation;
        return false;
      }
      const verified = fallbackDestinationStatus(job, job.branchConversation);
      return verified.ok && verified.conversation === status.conversation;
    }

    async function beginTranscriptFallback(job, turn) {
      if (!state.incomingJobId) {
        return { ok: false, reason: 'The separate-chat transfer was unavailable, so nothing was sent.' };
      }
      const resolveFallbackTurn = () => uniqueElements([
        getLatestCompletedAssistantTurn(doc),
        locateTurn(doc, job.locator),
        turn,
      ]).find((candidate) => branchTargetIsStillLatest(
        doc,
        candidate,
        job.targetFingerprint,
        job.contextFingerprint,
      )) || null;
      const liveTurn = resolveFallbackTurn();
      if (conversationIdentity(win.location.href) !== job.sourceConversation || !liveTurn) {
        return { ok: false, reason: 'The source chat changed before a separate chat could be prepared. Nothing was sent.' };
      }
      const transcript = serializeConversation(doc, liveTurn);
      if (!transcript) {
        return { ok: false, reason: 'The conversation could not be copied into a separate chat. Nothing was sent.' };
      }

      state.branchClickAttempted = false;
      state.branchConversation = '';
      state.sideSendAttempted = false;
      job.branchClickAttempted = false;
      job.branchConversation = '';
      job.branchReloadFrom = state.pageInstanceId;
      job.fallbackMode = true;
      job.fallbackTranscript = transcript;
      job.questionInserted = false;
      job.baselineUserCount = -1;
      job.sendAttempted = false;
      if (!await persistIncomingJob(job)) {
        return { ok: false, reason: 'Workflow Toolkit could not save the separate-chat transfer. Nothing was sent.' };
      }

      const verifiedTurn = resolveFallbackTurn();
      if (conversationIdentity(win.location.href) !== job.sourceConversation || !verifiedTurn) {
        job.fallbackMode = false;
        job.fallbackTranscript = '';
        job.branchReloadFrom = '';
        await persistIncomingJob(job);
        return { ok: false, reason: 'The source chat changed before the separate chat opened. Nothing was sent.' };
      }

      const targetUrl = urlWithNewChatJob(job.sourceUrl, state.incomingJobId);
      if (!targetUrl) {
        job.fallbackMode = false;
        job.fallbackTranscript = '';
        job.branchReloadFrom = '';
        await persistIncomingJob(job);
        return { ok: false, reason: 'Workflow Toolkit could not prepare the separate-chat address. Nothing was sent.' };
      }
      try {
        clearBranchTargetMarks(doc);
        const navigated = await Promise.resolve(navigateCurrent(targetUrl));
        if (navigated === false) throw new Error('navigation rejected');
      } catch (_error) {
        job.fallbackMode = false;
        job.fallbackTranscript = '';
        job.branchReloadFrom = '';
        await persistIncomingJob(job);
        return { ok: false, reason: 'The separate chat could not be opened. Nothing was sent.' };
      }
      toast('Opening and sending your question with the conversation context…');
      return { ok: true };
    }

    async function waitForFallbackSendAcknowledgement(job, baselineUserCount) {
      const marker = normalizeText(`[Workflow Toolkit transfer ${state.incomingJobId}]`);
      return waitForCondition(() => {
        const currentConversation = conversationIdentity(win.location.href);
        if (currentConversation === job.sourceConversation) return { status: 'drift' };
        const userTurns = getTurns(doc).filter((candidate) => roleOfTurn(candidate) === 'user');
        const matchingSentTurn = marker && userTurns.slice(baselineUserCount).some((candidate) =>
          normalizeText(readableNodeText(candidate)).includes(marker));
        // ChatGPT may use a provisional ID for the draft route and replace it
        // with the final conversation ID when Send is accepted. The unique
        // transfer marker is stronger evidence than the provisional ID.
        if (currentConversation && currentConversation !== job.sourceConversation && matchingSentTurn) {
          return { status: 'sent', conversation: currentConversation };
        }
        return null;
      }, {
        root: doc.documentElement,
        win,
        timeout: sideSendAckTimeout,
        attributes: true,
        characterData: true,
        pollInterval: 125,
      });
    }

    async function finishObservedFallbackSend(job, baselineUserCount) {
      const acknowledgement = await waitForFallbackSendAcknowledgement(job, baselineUserCount);
      if (!acknowledgement || acknowledgement.status !== 'sent') {
        showRecovery(
          job,
          acknowledgement && acknowledgement.status === 'drift'
            ? 'The chat changed after the automatic Send step. Check this window before doing anything else.'
            : 'ChatGPT did not show the question as a sent message. To prevent a duplicate, Workflow Toolkit stopped.',
          null,
          { canRetry: false },
        );
        return false;
      }
      state.branchConversation = acknowledgement.conversation;
      job.branchConversation = acknowledgement.conversation;
      await persistIncomingJob(job);
      toast('Side question sent in the separate chat.');
      return true;
    }

    function fallbackComposerHasPrompt(composer, prompt) {
      return Boolean(composer && fallbackDraftTextMatches(
        getComposerText(composer),
        prompt,
        state.incomingJobId,
      ));
    }

    async function stageFallbackPrompt(job, prompt) {
      const deadline = Date.now() + branchComposerTimeout;
      let expectedConversation = job.branchConversation || '';
      let stableComposer = null;
      let stableDraft = '';
      let stableRoute = '';
      let stableSince = 0;
      let invalidRouteSince = 0;
      let insertionArmedUntil = 0;
      let insertionArmedFromPath = '';
      let emptyComposer = null;
      let emptySince = 0;
      let writeAttempts = 0;
      let nextWriteAt = 0;
      let ownedMismatchSince = 0;
      let trustedInteraction = false;
      const markTrustedInteraction = (event) => {
        if (event && event.isTrusted) trustedInteraction = true;
      };
      doc.addEventListener('pointerdown', markTrustedInteraction, true);
      doc.addEventListener('keydown', markTrustedInteraction, true);

      try {
        while (Date.now() < deadline) {
          if (trustedInteraction) return { ok: false, reason: 'interaction' };
          let composer = findComposer(doc);
          const liveConversation = conversationIdentity(win.location.href);
          const inputArmedRouteChange = Date.now() <= insertionArmedUntil &&
            (insertionArmedFromPath === '/' || insertionArmedFromPath === '/new');
          if (!expectedConversation && liveConversation && inputArmedRouteChange &&
            (!composer || !getComposerText(composer).trim() || fallbackComposerHasPrompt(composer, prompt))) {
            expectedConversation = liveConversation;
          }

          const destination = fallbackDestinationStatus(job, expectedConversation);
          if (!destination.ok) {
            if (!invalidRouteSince) invalidRouteSince = Date.now();
            if (Date.now() - invalidRouteSince >= 750) return { ok: false, reason: 'destination' };
            await new Promise((resolve) => win.setTimeout(resolve, 100));
            continue;
          }
          invalidRouteSince = 0;
          if (expectedConversation && !await bindFallbackConversation(job, expectedConversation)) {
            return { ok: false, reason: 'destination' };
          }

          composer = findComposer(doc);
          if (!composer) {
            await new Promise((resolve) => win.setTimeout(resolve, 100));
            continue;
          }
          if (attachmentState(composer).count) return { ok: false, reason: 'attachment' };

          const existingDraft = getComposerText(composer).trim();
          if (existingDraft && !fallbackComposerHasPrompt(composer, prompt)) {
            const marker = fallbackTransferMarker(state.incomingJobId);
            const looksLikeHydratingTransfer = marker && normalizeComposerPayload(existingDraft).includes(marker);
            if (looksLikeHydratingTransfer) {
              if (!ownedMismatchSince) ownedMismatchSince = Date.now();
              if (Date.now() - ownedMismatchSince < 500) {
                await new Promise((resolve) => win.setTimeout(resolve, 80));
                continue;
              }
            }
            return { ok: false, reason: 'draft' };
          }
          ownedMismatchSince = 0;
          if (!existingDraft) {
            if (emptyComposer !== composer) {
              emptyComposer = composer;
              emptySince = Date.now();
              stableComposer = null;
              stableSince = 0;
            }
            if (Date.now() - emptySince < 120 || Date.now() < nextWriteAt) {
              await new Promise((resolve) => win.setTimeout(resolve, 80));
              continue;
            }
            if (writeAttempts >= 4) return { ok: false, reason: 'timeout' };

            const beforeConversation = conversationIdentity(win.location.href);
            const beforePath = conversationPath();
            const insertedComposer = composer;
            const accepted = setComposerText(
              composer,
              prompt,
              win,
              SIDE_FALLBACK_PROMPT_MAX_LENGTH,
              (candidate) => fallbackComposerHasPrompt(candidate, prompt),
            );
            writeAttempts += 1;
            insertionArmedUntil = Date.now() + 1_500;
            insertionArmedFromPath = beforeConversation ? '' : beforePath;
            nextWriteAt = Date.now() + Math.min(250 * (2 ** (writeAttempts - 1)), 1_000);
            const afterConversation = conversationIdentity(win.location.href);
            const currentComposer = findComposer(doc);
            const promptSurvived = fallbackComposerHasPrompt(insertedComposer, prompt) ||
              fallbackComposerHasPrompt(currentComposer, prompt);
            if (!expectedConversation && !beforeConversation && afterConversation &&
              afterConversation !== job.sourceConversation && (accepted || promptSurvived)) {
              expectedConversation = afterConversation;
            }
            if (expectedConversation && !await bindFallbackConversation(job, expectedConversation)) {
              return { ok: false, reason: 'destination' };
            }
            emptyComposer = null;
            emptySince = 0;
            stableComposer = null;
            stableSince = 0;
            await new Promise((resolve) => win.setTimeout(resolve, 80));
            continue;
          }

          emptyComposer = null;
          emptySince = 0;
          if (expectedConversation && !await bindFallbackConversation(job, expectedConversation)) {
            return { ok: false, reason: 'destination' };
          }
          composer = findComposer(doc);
          if (!composer || attachmentState(composer).count ||
            !fallbackComposerHasPrompt(composer, prompt)) {
            stableComposer = null;
            stableSince = 0;
            await new Promise((resolve) => win.setTimeout(resolve, 100));
            continue;
          }

          const sendButton = findSendButton(doc, composer);
          const sendReady = sendButton && !sendButton.disabled && sendButton.getAttribute('aria-disabled') !== 'true';
          const draft = getComposerText(composer);
          const route = routeKey(win.location.href);
          if (sendReady) {
            if (stableComposer !== composer || stableDraft !== draft || stableRoute !== route) {
              stableComposer = composer;
              stableDraft = draft;
              stableRoute = route;
              stableSince = Date.now();
            } else if (Date.now() - stableSince >= 240) {
              return { ok: true, composer, sendButton, draft };
            }
          } else {
            stableComposer = null;
            stableDraft = '';
            stableRoute = '';
            stableSince = 0;
          }
          await new Promise((resolve) => win.setTimeout(resolve, 80));
        }
        return { ok: false, reason: 'timeout' };
      } finally {
        doc.removeEventListener('pointerdown', markTrustedInteraction, true);
        doc.removeEventListener('keydown', markTrustedInteraction, true);
      }
    }

    async function runTranscriptFallbackJob(job) {
      const baselineUserCount = job.baselineUserCount >= 0 ? job.baselineUserCount : 0;
      if (state.sideSendAttempted || job.sendAttempted) {
        return finishObservedFallbackSend(job, baselineUserCount);
      }
      if (!state.incomingJobId || !job.branchReloadFrom || job.branchReloadFrom === state.pageInstanceId) {
        showRecovery(job, 'The new-chat transfer could not be verified, so the message box was left untouched.', null, { canRetry: false });
        return false;
      }

      let composer = await waitForCondition(() => {
        const destination = fallbackDestinationStatus(job, job.branchConversation);
        return destination.ok && findComposer(doc);
      }, {
        root: doc.documentElement,
        win,
        timeout: branchComposerTimeout,
        attributes: true,
        characterData: true,
        pollInterval: 125,
      });
      if (!composer || !fallbackDestinationStatus(job, job.branchConversation).ok) {
        showRecovery(job, 'A blank new chat could not be verified, so nothing was inserted or sent.', null, { canRetry: false });
        return false;
      }
      const prompt = buildSideFallbackPrompt(job.fallbackTranscript, job.question, job.kind, state.incomingJobId);
      if (!prompt) {
        showRecovery(job, 'The saved conversation context was unavailable, so nothing was inserted or sent.', null, { canRetry: false });
        return false;
      }
      if (!job.questionInserted) {
        job.questionInserted = true;
        job.baselineUserCount = baselineUserCount;
        if (!await persistIncomingJob(job) || !fallbackDestinationStatus(job, job.branchConversation).ok) {
          showRecovery(job, 'The side question could not be staged safely. Nothing was sent.', null, { canRetry: false });
          return false;
        }
      }
      const staged = await stageFallbackPrompt(job, prompt);
      if (!staged.ok) {
        const reason = staged.reason === 'attachment'
          ? 'The new chat already has an attachment. Workflow Toolkit left it untouched.'
          : staged.reason === 'draft'
            ? 'The new chat already has a different draft. Workflow Toolkit left it untouched.'
            : staged.reason === 'destination'
              ? 'The new chat changed before the question could be sent. Nothing was sent.'
              : 'ChatGPT’s new message box did not stay ready long enough to send the question.';
        showRecovery(job, reason, null, { canRetry: staged.reason === 'timeout' });
        return false;
      }
      composer = staged.composer;
      if (!job.autoSend) {
        composer.focus();
        toast('Separate chat ready — review the transferred context and press Send.');
        return true;
      }
      let sendIntentPersisted = false;
      const sent = await smartRouteAndSend({
        composer,
        silent: true,
        routingText: job.question,
        fallbackToCurrentModel: true,
        draftValidator: (candidate) => fallbackComposerHasPrompt(candidate, prompt),
        beforeReplay: async () => {
          const currentComposer = findComposer(doc);
          const currentSendButton = currentComposer && findSendButton(doc, currentComposer);
          if (!isActiveFallbackDestination(job) || !currentComposer || !fallbackComposerHasPrompt(currentComposer, prompt) ||
            attachmentState(currentComposer).count || !currentSendButton || currentSendButton.disabled ||
            currentSendButton.getAttribute('aria-disabled') === 'true') return false;
          if (!await bindFallbackConversation(job, job.branchConversation)) return false;
          if (!await markSideSendAttempted(job)) return false;
          sendIntentPersisted = true;
          const persistedComposer = findComposer(doc);
          const persistedSendButton = persistedComposer && findSendButton(doc, persistedComposer);
          if (isActiveFallbackDestination(job) && persistedComposer &&
            fallbackComposerHasPrompt(persistedComposer, prompt) &&
            !attachmentState(persistedComposer).count && persistedSendButton &&
            !persistedSendButton.disabled && persistedSendButton.getAttribute('aria-disabled') !== 'true') {
            return { refreshSnapshot: true, composer: persistedComposer };
          }
          const restaged = await stageFallbackPrompt(job, prompt);
          return restaged.ok ? { refreshSnapshot: true, composer: restaged.composer } : false;
        },
      });
      if (sent) return finishObservedFallbackSend(job, baselineUserCount);
      if (sendIntentPersisted && getTurns(doc).filter((turn) => roleOfTurn(turn) === 'user').length > baselineUserCount) {
        return finishObservedFallbackSend(job, baselineUserCount);
      }
      showRecovery(
        job,
        sendIntentPersisted
          ? 'The verified message changed after the Send step was saved. To prevent a duplicate, Workflow Toolkit stopped.'
          : 'The automatic model step was interrupted before Send. The question was not sent.',
        null,
        { canRetry: !sendIntentPersisted },
      );
      return false;
    }

    async function waitForSideSendAcknowledgement(job, expectedConversation, baselineUserCount) {
      return waitForCondition(() => {
        if (!isExpectedBranchConversation(job, expectedConversation)) return { status: 'drift' };
        const userCount = getTurns(doc).filter((turn) => roleOfTurn(turn) === 'user').length;
        if (userCount > baselineUserCount) return { status: 'sent' };
        return null;
      }, {
        root: doc.documentElement,
        win,
        timeout: sideSendAckTimeout,
        attributes: true,
        characterData: true,
      });
    }

    async function markSideSendAttempted(job) {
      state.sideSendAttempted = true;
      job.sendAttempted = true;
      if (await persistIncomingJob(job)) return true;
      if (state.incomingJobId) {
        await deleteTrackedJob(state.incomingJobId);
        state.incomingJobId = '';
      }
      return false;
    }

    async function finishObservedSideSend(job, expectedConversation, baselineUserCount) {
      const acknowledgement = await waitForSideSendAcknowledgement(job, expectedConversation, baselineUserCount);
      if (!acknowledgement || acknowledgement.status !== 'sent') {
        showRecovery(
          job,
          acknowledgement && acknowledgement.status === 'drift'
            ? 'The conversation changed after a Send action. Check the separate chat before doing anything else.'
            : 'ChatGPT did not show the question as a new message. To avoid sending it twice, Workflow Toolkit stopped.',
          state.recoveryTurn,
          { canRetry: false },
        );
        return false;
      }
      toast('Side question sent in the separate chat.');
      return true;
    }

    async function stageNativeBranchQuestion(job, expectedConversation, baselineUserCount, outgoingQuestion = job.question) {
      const deadline = Date.now() + branchComposerTimeout;
      let stableComposer = null;
      let stableDraft = '';
      let stableSince = 0;
      let emptyComposer = null;
      let emptySince = 0;
      let writeAttempts = 0;
      let nextWriteAt = 0;
      let trustedInteraction = false;
      const markTrustedInteraction = (event) => {
        if (event && event.isTrusted) trustedInteraction = true;
      };
      doc.addEventListener('pointerdown', markTrustedInteraction, true);
      doc.addEventListener('keydown', markTrustedInteraction, true);

      try {
        while (Date.now() < deadline) {
          if (trustedInteraction) return { ok: false, reason: 'interaction' };
          if (!isExpectedBranchConversation(job, expectedConversation)) return { ok: false, reason: 'destination' };
          const userCount = getTurns(doc).filter((turn) => roleOfTurn(turn) === 'user').length;
          if (userCount > baselineUserCount || hasActiveGeneration(doc)) return { ok: false, sent: true };

          const composer = findComposer(doc);
          if (!composer) {
            await new Promise((resolve) => win.setTimeout(resolve, 100));
            continue;
          }
          if (attachmentState(composer).count) return { ok: false, reason: 'attachment' };
          const draft = getComposerText(composer).trim();
          if (draft && !composerTextEquals(composer, outgoingQuestion)) return { ok: false, reason: 'draft' };

          if (!draft) {
            if (emptyComposer !== composer) {
              emptyComposer = composer;
              emptySince = Date.now();
            }
            if (Date.now() - emptySince < 120 || Date.now() < nextWriteAt) {
              await new Promise((resolve) => win.setTimeout(resolve, 80));
              continue;
            }
            if (writeAttempts >= 3) return { ok: false, reason: 'timeout' };
            setComposerText(composer, outgoingQuestion, win);
            writeAttempts += 1;
            nextWriteAt = Date.now() + Math.min(250 * (2 ** (writeAttempts - 1)), 750);
            emptyComposer = null;
            emptySince = 0;
            stableComposer = null;
            stableSince = 0;
            await new Promise((resolve) => win.setTimeout(resolve, 80));
            continue;
          }

          emptyComposer = null;
          emptySince = 0;
          const sendButton = findSendButton(doc, composer);
          const sendReady = sendButton && !sendButton.disabled && sendButton.getAttribute('aria-disabled') !== 'true';
          const liveDraft = getComposerText(composer);
          if (sendReady) {
            if (stableComposer !== composer || stableDraft !== liveDraft) {
              stableComposer = composer;
              stableDraft = liveDraft;
              stableSince = Date.now();
            } else if (Date.now() - stableSince >= 240) {
              return { ok: true, composer, sendButton, draft: liveDraft };
            }
          } else {
            stableComposer = null;
            stableDraft = '';
            stableSince = 0;
          }
          await new Promise((resolve) => win.setTimeout(resolve, 80));
        }
        return { ok: false, reason: 'timeout' };
      } finally {
        doc.removeEventListener('pointerdown', markTrustedInteraction, true);
        doc.removeEventListener('keydown', markTrustedInteraction, true);
      }
    }

    async function fillQuestion(job, fromRecovery = false, expectedConversation = state.branchConversation) {
      if (!job.question) {
        if (fromRecovery) closeRecovery();
        toast('Branch ready.');
        return true;
      }
      if (!isExpectedBranchConversation(job, expectedConversation)) {
        showRecovery(job, 'The separate-chat safety check changed before the question could be inserted. Nothing was sent.', state.recoveryTurn, { canRetry: false });
        return false;
      }
      const currentUserCount = () => getTurns(doc).filter((turn) => roleOfTurn(turn) === 'user').length;
      const baselineUserCount = job.baselineUserCount >= 0 ? job.baselineUserCount : currentUserCount();
      if (state.sideSendAttempted || job.sendAttempted) {
        return finishObservedSideSend(job, expectedConversation, baselineUserCount);
      }
      if (job.questionInserted && currentUserCount() > baselineUserCount) {
        await markSideSendAttempted(job);
        return finishObservedSideSend(job, expectedConversation, baselineUserCount);
      }
      const outgoingQuestion = job.kind === 'ask'
        ? buildAccuracyGuardedPrompt(job.question)
        : job.question;
      if (!job.questionInserted) {
        job.questionInserted = true;
        job.baselineUserCount = baselineUserCount;
        if (!await persistIncomingJob(job) || !isExpectedBranchConversation(job, expectedConversation)) {
          showRecovery(job, 'The question could not be staged safely in the verified separate chat. Nothing was sent.', state.recoveryTurn, { canRetry: false });
          return false;
        }
      }
      let staged = await stageNativeBranchQuestion(job, expectedConversation, baselineUserCount, outgoingQuestion);
      if (staged.sent) {
        await markSideSendAttempted(job);
        return finishObservedSideSend(job, expectedConversation, baselineUserCount);
      }
      if (!staged.ok) {
        const reason = staged.reason === 'attachment'
          ? 'The separate chat already has an attachment. Workflow Toolkit left it untouched.'
          : staged.reason === 'draft'
            ? 'The separate chat already has a different draft. Workflow Toolkit left it untouched.'
            : staged.reason === 'destination'
              ? 'The conversation changed before the question could be sent. Nothing was sent.'
              : staged.reason === 'interaction'
                ? 'The automatic step stopped because you interacted with the separate chat. Nothing was sent.'
                : 'ChatGPT’s message box did not stay ready long enough to send the question.';
        showRecovery(job, reason, state.recoveryTurn, { canRetry: ['timeout', 'interaction'].includes(staged.reason) });
        return false;
      }
      let composer = staged.composer;

      if (fromRecovery) closeRecovery();

      if (!job.autoSend) {
        toast(job.kind === 'continue' ? 'Branch ready — your draft was carried over.' : 'Side question ready — review it and press Send.');
        composer.focus();
        return true;
      }
      let sendIntentPersisted = false;
      const routingToolSignature = activeToolState(composer).signature;
      for (let routingAttempt = 0; routingAttempt < 2; routingAttempt += 1) {
        let trustedRoutingInteraction = false;
        const markTrustedRoutingInteraction = (event) => {
          if (event && event.isTrusted) trustedRoutingInteraction = true;
        };
        doc.addEventListener('pointerdown', markTrustedRoutingInteraction, true);
        doc.addEventListener('keydown', markTrustedRoutingInteraction, true);
        let sent;
        try {
          sent = await smartRouteAndSend({
            composer,
            silent: true,
            fallbackToCurrentModel: true,
            routingText: job.question,
            beforeReplay: async () => {
              const currentComposer = findComposer(doc);
              const currentSendButton = currentComposer && findSendButton(doc, currentComposer);
              if (!isExpectedBranchConversation(job, expectedConversation) ||
                currentUserCount() > baselineUserCount || hasActiveGeneration(doc) ||
                !currentComposer || !composerTextEquals(currentComposer, outgoingQuestion) ||
                attachmentState(currentComposer).count || !currentSendButton ||
                currentSendButton.disabled || currentSendButton.getAttribute('aria-disabled') === 'true') return false;
              if (!await markSideSendAttempted(job)) return false;
              sendIntentPersisted = true;
              const persistedComposer = findComposer(doc);
              const persistedSendButton = persistedComposer && findSendButton(doc, persistedComposer);
              if (isExpectedBranchConversation(job, expectedConversation) &&
                currentUserCount() === baselineUserCount && !hasActiveGeneration(doc) &&
                persistedComposer && composerTextEquals(persistedComposer, outgoingQuestion) &&
                !attachmentState(persistedComposer).count && persistedSendButton &&
                !persistedSendButton.disabled && persistedSendButton.getAttribute('aria-disabled') !== 'true') return true;
              const restaged = await stageNativeBranchQuestion(job, expectedConversation, baselineUserCount, outgoingQuestion);
              return restaged.ok ? { refreshSnapshot: true, composer: restaged.composer } : false;
            },
          });
        } finally {
          doc.removeEventListener('pointerdown', markTrustedRoutingInteraction, true);
          doc.removeEventListener('keydown', markTrustedRoutingInteraction, true);
        }
        if (sent) return finishObservedSideSend(job, expectedConversation, baselineUserCount);
        if (sendIntentPersisted && currentUserCount() > baselineUserCount) {
          return finishObservedSideSend(job, expectedConversation, baselineUserCount);
        }
        if (sendIntentPersisted || routingAttempt || state.adaptiveCancelled || trustedRoutingInteraction ||
          !isExpectedBranchConversation(job, expectedConversation) ||
          currentUserCount() > baselineUserCount || hasActiveGeneration(doc)) break;

        const remountedComposer = findComposer(doc);
        if (remountedComposer && (getComposerText(remountedComposer).trim() ||
          activeToolState(remountedComposer).signature !== routingToolSignature)) break;
        staged = await stageNativeBranchQuestion(job, expectedConversation, baselineUserCount, outgoingQuestion);
        if (staged.sent) {
          await markSideSendAttempted(job);
          return finishObservedSideSend(job, expectedConversation, baselineUserCount);
        }
        if (!staged.ok || activeToolState(staged.composer).signature !== routingToolSignature) break;
        composer = staged.composer;
      }
      showRecovery(
        job,
        sendIntentPersisted
          ? 'The verified question changed after the Send step was saved. To avoid a duplicate, Workflow Toolkit stopped.'
          : 'The automatic model step was interrupted before Send. The question was not sent.',
        state.recoveryTurn,
        { canRetry: !sendIntentPersisted },
      );
      return false;
    }

    function showRecovery(job, reason, turn = state.recoveryTurn, options = {}) {
      state.recoveryJob = job;
      state.recoveryTurn = turn || state.recoveryTurn;
      if (state.recoveryTurn && state.recoveryTurn.isConnected) state.recoveryTurn.classList.add('cgs-branch-target');
      element('#cgs-recovery-reason').textContent = reason;
      const question = element('#cgs-recovery-question');
      question.value = job.question || '(No saved question.)';
      element('[data-cgs-action="retry-branch"]').hidden = options.canRetry === false;
      element('#cgs-recovery-backdrop').hidden = false;
    }

    function closeRecovery() {
      element('#cgs-recovery-backdrop').hidden = true;
      clearBranchTargetMarks(doc);
      state.recoveryJob = null;
      state.recoveryTurn = null;
    }

    function turnMatchesBranchJob(turn, job) {
      if (!turn || !isAssistantTurn(turn)) return false;
      if (job.targetFingerprint && assistantTurnFingerprint(turn) !== job.targetFingerprint) return false;
      return !job.contextFingerprint || conversationContextFingerprint(turn.ownerDocument, turn) === job.contextFingerprint;
    }

    async function persistIncomingJob(job) {
      if (!state.incomingJobId) return true;
      const normalized = sanitizeJob(job);
      return Boolean(normalized && await storageSet(`${JOB_PREFIX}${state.incomingJobId}`, normalized));
    }

    async function requestVerifiedBranchReload(job) {
      if (!state.incomingJobId) {
        showRecovery(job, 'The separate chat opened, but its reload handoff was unavailable. Nothing was sent.', state.recoveryTurn, { canRetry: false });
        return false;
      }
      job.branchReloadFrom = state.pageInstanceId;
      if (!await persistIncomingJob(job) || !isExpectedBranchConversation(job, state.branchConversation)) {
        showRecovery(job, 'The separate chat changed or its reload handoff could not be saved. Nothing was sent.', state.recoveryTurn, { canRetry: false });
        return false;
      }
      const targetUrl = urlWithJob(canonicalPageUrl(win.location.href), state.incomingJobId);
      if (!targetUrl) {
        showRecovery(job, 'Workflow Toolkit could not prepare the verified separate-chat reload. Nothing was sent.', state.recoveryTurn, { canRetry: false });
        return false;
      }
      try {
        win.history.replaceState(win.history.state, '', targetUrl);
        if (reloadPage() === false) throw new Error('reload rejected');
      } catch (_error) {
        showRecovery(job, 'The separate chat could not be reloaded for verification. Nothing was sent.', state.recoveryTurn, { canRetry: false });
        return false;
      }
      toast('Verifying the separate chat before sending…');
      return true;
    }

    async function runIncomingJobCore(job) {
      state.branchClickAttempted = state.branchClickAttempted || job.branchClickAttempted;
      state.branchConversation = state.branchConversation || job.branchConversation;
      state.sideSendAttempted = state.sideSendAttempted || job.sendAttempted;
      if (job.fallbackMode) {
        state.sideAutomationActive = true;
        let completed;
        try {
          completed = await runTranscriptFallbackJob(job);
        } finally {
          state.sideAutomationActive = false;
        }
        if (completed) await finishIncomingJob();
        return completed;
      }
      let currentConversation = conversationIdentity(win.location.href);
      if (!state.branchConversation && state.branchClickAttempted && currentConversation && currentConversation !== job.sourceConversation) {
        state.branchConversation = currentConversation;
        job.branchConversation = currentConversation;
        if (!await persistIncomingJob(job)) {
          showRecovery(job, 'The separate chat was found, but Workflow Toolkit could not save its identity safely. Nothing was sent.', state.recoveryTurn, { canRetry: false });
          return false;
        }
      }
      let resumingConfirmedBranch = Boolean(
        state.branchConversation && currentConversation === state.branchConversation && currentConversation !== job.sourceConversation,
      );
      let beforeComposer = findComposer(doc);

      if (!resumingConfirmedBranch) {
        if (!currentConversation || currentConversation !== job.sourceConversation) {
          showRecovery(job, 'The safety check could not confirm that this window is on the source or verified separate conversation. Nothing was sent.', state.recoveryTurn, { canRetry: false });
          return false;
        }
        if (!state.branchClickAttempted) {
          const turn = await waitForCondition(() => {
            if (conversationIdentity(win.location.href) !== job.sourceConversation) return null;
            if (hasActiveGeneration(doc)) return null;
            const candidate = getLatestCompletedAssistantTurn(doc);
            const turns = getTurns(doc);
            return candidate && turns[turns.length - 1] === candidate ? candidate : null;
          }, {
            root: doc.documentElement,
            win,
            timeout: 15_000,
            attributes: true,
            characterData: true,
          });
          if (!turn) {
            showRecovery(job, 'The newest completed response did not become ready, so Workflow Toolkit did not branch or send anything.');
            return false;
          }
          if (conversationIdentity(win.location.href) !== job.sourceConversation) {
            showRecovery(job, 'The source conversation changed before the newest response could be saved. Nothing was branched or sent.', state.recoveryTurn, { canRetry: false });
            return false;
          }
          job.locator = getTurnLocator(turn, doc);
          job.targetFingerprint = assistantTurnFingerprint(turn);
          job.contextFingerprint = conversationContextFingerprint(doc, turn);
          if (!await persistIncomingJob(job)) {
            showRecovery(job, 'Workflow Toolkit could not safely update the saved whole-chat target. Nothing was branched or sent.', state.recoveryTurn, { canRetry: false });
            return false;
          }
          if (conversationIdentity(win.location.href) !== job.sourceConversation ||
            !branchTargetIsStillLatest(doc, turn, job.targetFingerprint, job.contextFingerprint)) {
            showRecovery(job, 'The source chat changed before branching. Nothing was sent.', state.recoveryTurn, { canRetry: false });
            return false;
          }
          state.recoveryTurn = turn;
          beforeComposer = findComposer(doc);
          state.branchClickAttempted = true;
          job.branchClickAttempted = true;
          if (!await persistIncomingJob(job)) {
            state.branchClickAttempted = false;
            job.branchClickAttempted = false;
            showRecovery(job, 'Workflow Toolkit could not save the branch step safely. Nothing was branched or sent.', turn, { canRetry: false });
            return false;
          }
          const clickResult = await clickNativeBranch(
            doc,
            win,
            turn,
            job.sourceConversation,
            job.targetFingerprint,
            job.contextFingerprint,
            branchActionTimeout,
          );
          if (!clickResult.ok) {
            if (clickResult.fallback && !clickResult.attempted) {
              const fallbackResult = await beginTranscriptFallback(job, turn);
              if (fallbackResult.ok) return false;
              showRecovery(job, fallbackResult.reason, turn, { canRetry: false });
              return false;
            }
            if (!clickResult.attempted) {
              state.branchClickAttempted = false;
              job.branchClickAttempted = false;
              if (!await persistIncomingJob(job)) {
                showRecovery(job, 'The response menu changed and Workflow Toolkit could not safely reset the saved branch step.', turn, { canRetry: false });
                return false;
              }
            }
            showRecovery(job, clickResult.reason, turn);
            return false;
          }
        }
        const changedConversation = await waitForConversationChange(win, currentConversation, branchNavigationTimeout);
        if (!changedConversation) {
          showRecovery(job, 'ChatGPT did not confirm a separate conversation after the automatic branch action. Try again only checks for the result; it will not click Branch twice.');
          return false;
        }
        state.branchConversation = changedConversation;
        job.branchConversation = changedConversation;
        if (!await persistIncomingJob(job)) {
          showRecovery(job, 'The separate chat opened, but Workflow Toolkit could not save its verified identity. Nothing was sent.', state.recoveryTurn, { canRetry: false });
          return false;
        }
        clearBranchTargetMarks(doc);
        state.recoveryTurn = null;
        currentConversation = changedConversation;
        resumingConfirmedBranch = true;
      }

      const expectedConversation = state.branchConversation;
      if (!resumingConfirmedBranch || !isExpectedBranchConversation(job, expectedConversation)) {
        showRecovery(job, 'The separate-chat identity changed before its context could be verified. Nothing was sent.', state.recoveryTurn, { canRetry: false });
        return false;
      }
      if (!job.branchReloadFrom || job.branchReloadFrom === state.pageInstanceId) {
        await requestVerifiedBranchReload(job);
        return false;
      }
      await new Promise((resolve) => win.setTimeout(resolve, 500));
      if (!isExpectedBranchConversation(job, expectedConversation)) {
        showRecovery(job, 'The conversation changed while the separate chat was loading. Nothing was sent.', state.recoveryTurn, { canRetry: false });
        return false;
      }
      const inheritedTurn = await waitForCondition(() => {
        if (!isExpectedBranchConversation(job, expectedConversation)) return null;
        const candidate = locateTurn(doc, job.locator);
        return turnMatchesBranchJob(candidate, job) ? candidate : null;
      }, {
        root: doc.documentElement,
        win,
        timeout: branchComposerTimeout,
        attributes: true,
        characterData: true,
      });
      if (!inheritedTurn || !isExpectedBranchConversation(job, expectedConversation)) {
        showRecovery(
          job,
          isExpectedBranchConversation(job, expectedConversation)
            ? 'The separate chat opened, but its inherited conversation context could not be verified. Nothing was sent.'
            : 'The conversation changed before its inherited context could be verified. Nothing was sent.',
          state.recoveryTurn,
          { canRetry: isExpectedBranchConversation(job, expectedConversation) },
        );
        return false;
      }
      const branchComposer = await waitForStableComposer(doc, win, beforeComposer, branchComposerTimeout, { allowReused: true });
      if (!branchComposer || !isExpectedBranchConversation(job, expectedConversation) ||
        !turnMatchesBranchJob(locateTurn(doc, job.locator), job)) {
        showRecovery(
          job,
          isExpectedBranchConversation(job, expectedConversation)
            ? 'The separate chat opened, but its message box or inherited context did not stay ready.'
            : 'The conversation changed before its message box became ready. Nothing was sent.',
          state.recoveryTurn,
          { canRetry: isExpectedBranchConversation(job, expectedConversation) },
        );
        return false;
      }
      state.sideAutomationActive = true;
      let completed;
      try {
        completed = await fillQuestion(job, false, expectedConversation);
      } finally {
        state.sideAutomationActive = false;
      }
      if (completed) await finishIncomingJob();
      return completed;
    }

    function runIncomingJob(job) {
      if (state.incomingRunPromise) return state.incomingRunPromise;
      const guarded = Promise.resolve(runIncomingJobCore(job)).finally(() => {
        if (state.incomingRunPromise === guarded) state.incomingRunPromise = null;
      });
      state.incomingRunPromise = guarded;
      return guarded;
    }

    function clearIncomingJobState() {
      state.incomingJobId = '';
      state.branchConversation = '';
      state.branchClickAttempted = false;
      state.sideSendAttempted = false;
      try {
        if (parseJobId(win.location.href)) {
          win.history.replaceState(win.history.state, '', canonicalPageUrl(win.location.href));
        }
      } catch (_error) {
        // The fragment contains only a random handoff ID.
      }
    }

    async function finishIncomingJob() {
      const jobId = state.incomingJobId;
      if (jobId) await deleteTrackedJob(jobId);
      clearIncomingJobState();
    }

    async function withIncomingJobLock(jobId, task, messages = {}) {
      const lockManager = win.navigator && win.navigator.locks;
      if (!isValidJobId(jobId) || !lockManager || typeof lockManager.request !== 'function') {
        if (messages.unsupported !== '') {
          toast(messages.unsupported || 'This browser cannot safely lock the separate-chat handoff, so Workflow Toolkit did not send anything.', 8_000);
        }
        return { acquired: false, value: false, reason: 'unsupported' };
      }
      try {
        return await lockManager.request(
          `${JOB_LOCK_PREFIX}${jobId}`,
          { mode: 'exclusive', ifAvailable: true },
          async (lock) => {
            if (!lock) {
              if (messages.busy !== '') {
                toast(messages.busy || 'This side question is already opening in another window. Nothing was sent here.', 7_000);
              }
              return { acquired: false, value: false, reason: 'busy' };
            }
            return { acquired: true, value: await task(), reason: '' };
          },
        );
      } catch (_error) {
        if (messages.error !== '') {
          toast(messages.error || 'Workflow Toolkit could not safely lock this separate-chat handoff. Nothing was sent.', 8_000);
        }
        return { acquired: false, value: false, reason: 'error' };
      }
    }

    async function consumeIncomingJob(capturedJobId = '') {
      const jobId = isValidJobId(capturedJobId) ? capturedJobId : parseJobId(win.location.href);
      if (!jobId) return;
      const consumeLockedJob = async () => {
        // Read only after acquiring the lock so a second page cannot run a
        // stale copy after the first page advances or completes the job.
        const raw = await storageGet(`${JOB_PREFIX}${jobId}`, null);
        const job = sanitizeJob(raw);
        if (!job) {
          await deleteTrackedJob(jobId);
          clearIncomingJobState();
          toast('This Workflow Toolkit branch request expired. Return to the original chat and try again.');
          return false;
        }
        state.incomingJobId = jobId;
        state.branchClickAttempted = job.branchClickAttempted;
        state.branchConversation = job.branchConversation;
        state.sideSendAttempted = job.sendAttempted;
        return runIncomingJob(job);
      };
      let blankRootLaunch = false;
      try {
        blankRootLaunch = !conversationIdentity(win.location.href) && new URL(String(win.location.href)).pathname === '/';
      } catch (_error) {
        blankRootLaunch = false;
      }
      const attempts = blankRootLaunch ? 12 : 1;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const outcome = await withIncomingJobLock(jobId, consumeLockedJob, {
          busy: attempt === attempts - 1 ? undefined : '',
        });
        if (outcome.acquired || outcome.reason !== 'busy') return outcome.value;
        await new Promise((resolve) => win.setTimeout(resolve, 125));
      }
      return false;
    }

    async function retryIncomingJob() {
      if (state.incomingRecoveryAction) {
        toast('A recovery action is already running for this side question.');
        return false;
      }
      state.incomingRecoveryAction = true;
      try {
        const jobId = state.incomingJobId;
        if (!isValidJobId(jobId)) {
          toast('This separate-chat handoff can no longer be retried safely. Return to the original chat and ask again.');
          return false;
        }
        const outcome = await withIncomingJobLock(jobId, async () => {
          if (state.incomingJobId !== jobId) return false;
          const job = sanitizeJob(await storageGet(`${JOB_PREFIX}${jobId}`, null));
          if (!job) {
            closeRecovery();
            await finishIncomingJob();
            toast('This Workflow Toolkit branch request expired. Return to the original chat and try again.');
            return false;
          }
          if (state.incomingJobId !== jobId) return false;
          state.branchClickAttempted = job.branchClickAttempted;
          state.branchConversation = job.branchConversation;
          state.sideSendAttempted = job.sendAttempted;
          closeRecovery();
          return runIncomingJob(job);
        }, {
          busy: 'Another window is already finishing this side question. Nothing was sent here.',
        });
        return outcome.value;
      } finally {
        state.incomingRecoveryAction = false;
      }
    }

    async function closeIncomingJob() {
      if (state.incomingRunPromise || state.incomingRecoveryAction) {
        toast('The automatic side-chat step is already running. Wait for it to finish before closing this copy.', 7_000);
        return false;
      }
      state.incomingRecoveryAction = true;
      try {
        const jobId = state.incomingJobId;
        closeRecovery();
        if (!isValidJobId(jobId)) {
          clearIncomingJobState();
          return true;
        }
        const outcome = await withIncomingJobLock(jobId, async () => {
          if (state.incomingJobId !== jobId) return false;
          await finishIncomingJob();
          return true;
        }, { busy: '', unsupported: '', error: '' });
        if (!outcome.acquired) {
          // Never delete shared job state without its lock. This page can still
          // detach safely while the owner finishes in the other window.
          clearIncomingJobState();
          toast('Closed this window’s copy. Another window is already handling the side question.', 7_000);
        }
        return outcome.acquired;
      } finally {
        state.incomingRecoveryAction = false;
      }
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

    function sameSendIntent(left, right) {
      return Boolean(left && right && left.path === right.path &&
        left.surface && right.surface && left.surface.key === right.surface.key &&
        (left.surface.sessionId || 0) === (right.surface.sessionId || 0) &&
        left.conversationVersion === right.conversationVersion &&
        left.draft === right.draft && left.attachmentSignature === right.attachmentSignature &&
        left.toolSignature === right.toolSignature);
    }

    function launchAdaptiveTask(composer, snapshot) {
      smartRouteAndSend({ composer, snapshot }).catch((error) => {
        if (win.console && typeof win.console.error === 'function') win.console.error('[ChatGPT Workflow Toolkit] Adaptive send failed:', error);
        toast('Adaptive Auto hit an unexpected error. Your draft was kept; press Alt+Send to bypass it.', 8_000);
      }).finally(() => {
        const pending = state.pendingAdaptiveSend;
        if (!pending) return;
        state.pendingAdaptiveSend = null;
        const validation = validateSendSnapshot(pending.snapshot);
        if (!validation.ok) return;
        state.adaptiveCancelled = false;
        launchAdaptiveTask(validation.composer, pending.snapshot);
      });
    }

    function beginAdaptiveSend(event, composer, options = {}) {
      if (state.replayingSend) return false;
      const surface = options.surface || submissionSurface(composer, { submitter: options.submitter });
      if (!surface) return false;
      const bypass = options.altKey || event && event.altKey;
      if (bypass) {
        if (adaptiveApplies(composer)) armSubmitReplayPermit(composer, 'alt-bypass', null, surface);
        return false;
      }
      if (!adaptiveApplies(composer)) return false;
      state.submitReplayPermit = null;
      const snapshot = captureSendSnapshot(composer, surface);
      if (!snapshot || !snapshot.draft.trim() && snapshot.attachmentCount === 0) return false;
      if (event) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      if (surface.kind === 'edit' && hasActiveGeneration(doc)) {
        toast('Wait for ChatGPT to finish before resending an edited message.', 7_000);
        return true;
      }
      if (state.adaptiveSendPromise) {
        const queued = state.pendingAdaptiveSend && state.pendingAdaptiveSend.snapshot;
        const retryAfterCancellation = state.adaptiveCancelled && !sameSendIntent(snapshot, queued);
        if (retryAfterCancellation ||
          !sameSendIntent(snapshot, state.activeAdaptiveSnapshot) && !sameSendIntent(snapshot, queued)) {
          state.adaptiveCancelled = true;
          state.pendingAdaptiveSend = { snapshot };
        }
        return true;
      }
      launchAdaptiveTask(composer, snapshot);
      return true;
    }

    function onAdaptiveClick(event) {
      if (state.replayingSend) return;
      const control = event.target && event.target.closest && event.target.closest(
        `${SUBMISSION_CONTROL_SELECTOR}, [role="menuitem"]`,
      );
      if (!control || control.closest(`#${UI_ROOT_ID}`)) return;
      const label = lowerText(`${accessibleText(control)} ${control.value || ''}`);
      const testId = lowerText(control.getAttribute('data-testid'));
      const actionTurn = closestUserTurn(control);
      const moreActionLabel = [
        control.getAttribute('aria-label'),
        control.getAttribute('title'),
        control.textContent,
        accessibleText(control),
      ].some((value) => /^(?:more|more actions|more options|message actions|response actions)(?:\s*(?:\.\.\.|…|⋯))*$/iu.test(normalizeText(value)));
      if (actionTurn && (moreActionLabel ||
        /(?:more|menu)[-_ ]?(?:actions?|button)|message[-_ ]?actions?/iu.test(testId))) {
        rememberEditMenuSource(actionTurn, control);
        return;
      }
      const editAction = (/\bedit(?: message)?\b/iu.test(label) || /edit[-_ ]?(?:message|prompt)/iu.test(testId)) &&
        !/\b(?:send|submit|resend)\b/iu.test(label);
      const editActionTurn = actionTurn || editAction && editMenuSourceTurn(control);
      if (editActionTurn && editAction &&
        !/\b(?:send|submit|resend)\b/iu.test(label)) {
        state.pendingEditMenuSource = null;
        startEditSession(editActionTurn, control);
        return;
      }
      if (/\b(?:cancel|discard)(?:\s+edit)?\b/iu.test(label) &&
        !/\b(?:send|submit|resend)\b/iu.test(label) && cancelBelongsToEditSurface(control, actionTurn)) {
        clearEditSession();
        if (state.activeAdaptiveSnapshot && state.activeAdaptiveSnapshot.surface &&
          state.activeAdaptiveSnapshot.surface.kind === 'edit') state.adaptiveCancelled = true;
        state.pendingAdaptiveSend = null;
        return;
      }
      const surface = interactionSurface(control, { submitter: control });
      if (!surface) return;
      const composer = resolveSurfaceComposer(surface, null, true);
      if (!composer) return;
      const validSend = surface.kind === 'edit'
        ? isEditSubmissionControl(control, composer, surfaceTurn(surface)) ||
          sessionPortalControl(control, composer, 'send')
        : control.matches(SEND_BUTTON_SELECTORS.join(', ')) && control === findSendButton(doc, composer);
      if (!validSend) return;
      if (state.sideAutomationActive) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      beginAdaptiveSend(event, composer, { surface, submitter: control });
    }

    function onAdaptiveKeyDown(event) {
      if (event.key === 'Escape' && state.adaptiveSendPromise) {
        state.adaptiveCancelled = true;
        state.pendingAdaptiveSend = null;
        const activeSurface = state.activeAdaptiveSnapshot && state.activeAdaptiveSnapshot.surface;
        const editSession = state.pendingEditSession;
        const preserveBoundEdit = Boolean(activeSurface && activeSurface.kind === 'edit' &&
          activeSurface.sessionId && editSession && editSession.id === activeSurface.sessionId &&
          editSession.composerRef && editSession.composerRef.isConnected);
        if (!preserveBoundEdit) clearEditSession();
        return;
      }
      if (event.key === 'Escape') clearEditSession();
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      const surface = interactionSurface(event.target);
      if (!surface) return;
      const composer = resolveSurfaceComposer(surface, null, true);
      if (!composer || !composerContainsTarget(composer, event.target) || state.composingComposer === composer) return;
      if (state.sideAutomationActive && !state.replayingSend) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.altKey) {
        beginAdaptiveSend(null, composer, { altKey: true, surface });
        return;
      }
      const sendButton = sendControlForSurface(surface, composer);
      if (!sendButton || sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') return;
      const activeDescendantId = normalizeText(composer.getAttribute('aria-activedescendant'));
      const activeDescendant = activeDescendantId ? doc.getElementById(activeDescendantId) : null;
      const ownedPopupIds = normalizeText(
        `${composer.getAttribute('aria-controls') || ''} ${composer.getAttribute('aria-owns') || ''}`,
      ).split(/\s+/u).filter(Boolean);
      const suggestionRoots = uniqueElements([
        surface.kind === 'edit' ? editPortalScope(composer) || composerScope(composer) : composerScope(composer),
        ...ownedPopupIds.map((id) => doc.getElementById(id)),
      ]);
      const selectedSuggestion = activeDescendant && isProbablyVisible(activeDescendant)
        ? activeDescendant
        : uniqueElements(suggestionRoots.flatMap((root) => [...root.querySelectorAll(
          '[role="option"][aria-selected="true"], [role="option"][data-highlighted], [role="menuitem"][data-highlighted]',
        )]))
        .find((node) => isProbablyVisible(node) && !node.closest(`#${UI_ROOT_ID}`));
      if (selectedSuggestion && !event.metaKey && !event.ctrlKey) return;
      beginAdaptiveSend(event, composer, { surface, submitter: sendButton });
    }

    function onAdaptiveSubmit(event) {
      const form = event.target && event.target.nodeType === 1 ? event.target : null;
      if (!form || !form.matches('form')) return;
      const submitter = event.submitter && event.submitter.nodeType === 1 ? event.submitter : null;
      if (state.submitReplayPermit && state.submitReplayPermit.form === form) {
        const exactComposer = findComposerInScope(form, submitter || form);
        const exactResult = consumeSubmitReplayPermit(event, exactComposer, null);
        if (exactResult === 'allow') return;
        if (exactResult === 'duplicate') {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
      }
      if (state.replayingSend) {
        let replaySurface = interactionSurface(submitter || form, { form, submitter });
        let replayComposer = replaySurface
          ? resolveSurfaceComposer(replaySurface, null, true)
          : findComposerInScope(form, submitter || form);
        if (!replaySurface) {
          const mounted = mountedEditReplayCandidate(form, submitter);
          if (mounted) {
            replaySurface = mounted.surface;
            replayComposer = mounted.composer;
          }
        }
        const replayResult = consumeSubmitReplayPermit(event, replayComposer, replaySurface);
        if (replayResult === 'allow') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (submitter) {
        const submitterLabel = lowerText(`${accessibleText(submitter)} ${submitter.value || ''}`);
        const submitterTestId = lowerText(submitter.getAttribute('data-testid'));
        if ((/\b(?:cancel|discard|close)(?:\s+edit)?\b/iu.test(submitterLabel) ||
          /(?:cancel|discard|close)[-_ ]?(?:edit|message|prompt)?/iu.test(submitterTestId)) &&
          !/\b(?:send|submit|resend)\b/iu.test(submitterLabel)) return;
      }
      const surface = interactionSurface(event.submitter || form, { form, submitter: event.submitter || null });
      if (!surface) return;
      const composer = resolveSurfaceComposer(surface, null, true);
      if (!composer || form !== composer.closest('form')) return;
      if (surface.kind === 'edit' && submitter &&
        !isEditSubmissionControl(submitter, composer, surfaceTurn(surface))) return;
      // ChatGPT may dispatch the actual form submit shortly after our
      // programmatic Send click returns. Let only that short-lived, exact
      // composer replay through while the broader side-job guard stays active.
      if (state.sideAutomationActive) {
        const replayResult = state.submitReplayPermit && state.submitReplayPermit.kind === 'adaptive-replay'
          ? consumeSubmitReplayPermit(event, composer, surface)
          : false;
        if (replayResult === 'allow') return;
        state.submitReplayPermit = null;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const replayResult = consumeSubmitReplayPermit(event, composer, surface);
      if (replayResult === 'allow') return;
      if (replayResult === 'duplicate') {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      beginAdaptiveSend(event, composer, { surface, submitter: event.submitter || null });
    }

    function onCompositionStart(event) {
      const surface = interactionSurface(event.target);
      const composer = surface && resolveSurfaceComposer(surface, null, true);
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
        if (state.sideLaunchPromise) {
          toast('The separate chat is already opening.');
          return;
        }
        const question = element('#cgs-question').value.trim();
        if (!question) {
          toast('Type the question you want to ask in the side chat.');
          return element('#cgs-question').focus();
        }
        const clickedTurn = state.activeTurn;
        const turn = getLatestCompletedAssistantTurn(doc, clickedTurn);
        const conversationTurns = getTurns(doc);
        const latestTurn = conversationTurns[conversationTurns.length - 1] || null;
        if (hasActiveGeneration(doc) || !turn || latestTurn !== turn) {
          toast('Wait for ChatGPT to finish the latest response so the new chat can remember everything so far.', 7_000);
          return;
        }
        const reservation = reserveBranchWindow();
        actionNode.disabled = true;
        const launchTask = launchBranch(turn, { kind: 'ask', question, autoSend: true, reservation });
        state.sideLaunchPromise = launchTask;
        try {
          const launched = await launchTask;
          if (launched) closeQuestion(false);
        } finally {
          if (state.sideLaunchPromise === launchTask) state.sideLaunchPromise = null;
          actionNode.disabled = false;
        }
      } else if (action === 'close-recovery') {
        await closeIncomingJob();
      } else if (action === 'retry-branch') {
        await retryIncomingJob();
      }
    }

    function onKeyDown(event) {
      if (event.key === 'Tab') {
        const activeModal = !element('#cgs-handoff-backdrop').hidden
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
          void closeIncomingJob();
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

    function mutationElement(node) {
      if (!node) return null;
      return node.nodeType === 1 ? node : node.parentElement;
    }

    function isToolkitMutationNode(node) {
      const target = mutationElement(node);
      return Boolean(target && (
        target.matches(`#${UI_ROOT_ID}, .${TURN_BUTTON_CLASS}, .cgs-turn-fallback-row`) ||
        target.closest(`#${UI_ROOT_ID}, .${TURN_BUTTON_CLASS}, .cgs-turn-fallback-row`)
      ));
    }

    function nodeIsInsideConversation(node) {
      const target = mutationElement(node);
      if (!target || isToolkitMutationNode(target)) return false;
      return Boolean(
        target.matches(`${TURN_SELECTOR}, ${ROLE_SELECTOR}`) ||
        target.closest(`${TURN_SELECTOR}, ${ROLE_SELECTOR}`),
      );
    }

    function nodeTouchesConversation(node) {
      const target = mutationElement(node);
      return Boolean(target && !isToolkitMutationNode(target) && (
        nodeIsInsideConversation(target) || target.querySelector(`${TURN_SELECTOR}, ${ROLE_SELECTOR}`)
      ));
    }

    function visibilityMutationChangesConversation(node, attributeName = '', oldValue = '') {
      const target = mutationElement(node);
      if (!target || isToolkitMutationNode(target)) return false;
      const recordedComputedVisibilityChanged = () => {
        if (!state.routingComputedVisibility.has(target) || typeof win.getComputedStyle !== 'function') return false;
        const previous = state.routingComputedVisibility.get(target);
        let current = false;
        try {
          const style = win.getComputedStyle(target);
          current = style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' ||
            style.contentVisibility === 'hidden';
        } catch (_error) {
          return false;
        }
        state.routingComputedVisibility.set(target, current);
        return previous !== current;
      };
      if (target.matches(`${TURN_SELECTOR}, ${ROLE_SELECTOR}`)) {
        if (attributeName === 'class') {
          return classTokensHideContent(oldValue) !== classTokensHideContent(target.getAttribute('class')) ||
            classMayControlVisibility(oldValue) !== classMayControlVisibility(target.getAttribute('class')) ||
            recordedComputedVisibilityChanged();
        }
        if (attributeName === 'style') {
          return inlineStyleHidesContent(oldValue) !== inlineStyleHidesContent(target.getAttribute('style')) ||
            recordedComputedVisibilityChanged();
        }
        return true;
      }
      if (target.closest(`${TURN_SELECTOR}, ${ROLE_SELECTOR}`)) {
        // Class/style churn inside code blocks and controls is common while a
        // response is hovered or highlighted; it is not a branch swap.
        if (attributeName === 'class') {
          return classTokensHideContent(oldValue) !== classTokensHideContent(target.getAttribute('class')) ||
            classMayControlVisibility(oldValue) !== classMayControlVisibility(target.getAttribute('class')) ||
            recordedComputedVisibilityChanged();
        }
        if (attributeName === 'style') {
          return inlineStyleHidesContent(oldValue) !== inlineStyleHidesContent(target.getAttribute('style')) ||
            recordedComputedVisibilityChanged();
        }
        return true;
      }
      const containedTurns = getTurns(target);
      if (!containedTurns.length) return false;
      const allTurns = getTurns(doc);
      // Modal menus may temporarily mark the entire app aria-hidden. That is
      // not a branch/context change; a hidden subset of turns is.
      return containedTurns.length < allTurns.length;
    }

    function nodeTouchesGenerationControl(node) {
      const target = mutationElement(node);
      if (!target) return false;
      const selector = 'button[data-testid="stop-button"], button[data-testid*="stop-generating"], button[aria-label^="Stop generating" i], button[aria-label^="Stop streaming" i]';
      return target.matches(selector) || Boolean(target.querySelector(selector));
    }

    function conversationTurnForNode(node, allowArticleFallback = false) {
      const target = mutationElement(node);
      if (!target) return null;
      const primary = target.matches(TURN_SELECTOR) ? target : target.closest(TURN_SELECTOR);
      if (primary) return primary;
      const roleNode = target.matches(ROLE_SELECTOR) ? target : target.closest(ROLE_SELECTOR);
      if (roleNode) return roleNode.closest('article') || roleNode;
      return allowArticleFallback ? target.closest('article') || target : null;
    }

    function nodeLooksLikeAttachment(node) {
      const target = mutationElement(node);
      if (!target) return false;
      const selector = '[data-file-id], [data-attachment-id], [data-testid*="attachment"], [data-testid*="file-pill"], [aria-label*="file" i], [aria-label*="attachment" i]';
      return target.matches(selector) || Boolean(target.closest(selector));
    }

    function nodeIsInsideLiveEditor(node) {
      const target = mutationElement(node);
      if (!target) return false;
      const editor = target.matches(LOCAL_COMPOSER_SELECTOR)
        ? target
        : target.closest(LOCAL_COMPOSER_SELECTOR);
      if (!editor || !editor.isConnected || editor.closest(`#${UI_ROOT_ID}`) || !closestUserTurn(editor)) return false;
      if (editor.tagName === 'TEXTAREA') return !editor.disabled && !editor.readOnly;
      const editable = lowerText(editor.getAttribute('contenteditable'));
      return editor.isContentEditable || editable === 'true' || editable === 'plaintext-only';
    }

    function evictHistoricalAttachmentCache(mutation) {
      const roleChanged = mutation.type === 'attributes' &&
        ['data-message-author-role', 'data-turn'].includes(mutation.attributeName);
      const nodes = [mutation.target, ...mutation.addedNodes, ...mutation.removedNodes];
      for (const node of nodes) {
        const turn = conversationTurnForNode(node, roleChanged && node === mutation.target);
        if (turn) state.historicalAttachmentCache.delete(turn);
      }
    }

    function mutationChangesConversation(mutation) {
      if (!mutation || isToolkitMutationNode(mutation.target)) return false;
      if ((mutation.type === 'characterData' || mutation.type === 'childList') &&
        nodeIsInsideLiveEditor(mutation.target)) return false;
      if (mutation.type === 'characterData') return nodeIsInsideConversation(mutation.target);
      if (mutation.type === 'attributes') {
        const name = mutation.attributeName || '';
        if (name === 'data-message-author-role' || name === 'data-turn') return true;
        if (name === 'hidden' || name === 'inert' || name === 'aria-hidden' || name === 'data-state' || name === 'style' || name === 'class') {
          return visibilityMutationChangesConversation(mutation.target, name, mutation.oldValue);
        }
        if (['data-is-streaming', 'data-streaming', 'data-file-id', 'data-attachment-id', 'data-file-name',
          'data-filename', 'data-name', 'data-mime-type', 'data-file-type', 'data-file-size', 'data-size'].includes(name)) {
          return nodeIsInsideConversation(mutation.target);
        }
        if (name === 'data-testid') {
          return nodeIsInsideConversation(mutation.target) || /^conversation-turn-/u.test(String(mutation.oldValue || ''));
        }
        if (name === 'aria-label' || name === 'title') {
          return nodeIsInsideConversation(mutation.target) && nodeLooksLikeAttachment(mutation.target);
        }
        return false;
      }
      const changed = [...mutation.addedNodes, ...mutation.removedNodes]
        .filter((node) => !isToolkitMutationNode(node));
      if (!changed.length) return false;
      return nodeIsInsideConversation(mutation.target) || changed.some((node) =>
        nodeTouchesConversation(node) || nodeTouchesGenerationControl(node));
    }

    function conversationMutationImpact(mutations) {
      const affectedTurns = new Set();
      let structural = false;
      const recordTurn = (turn) => {
        if (!turn) return false;
        affectedTurns.add(turn);
        return true;
      };
      for (const mutation of mutations) {
        const roleChanged = mutation.type === 'attributes' &&
          ['data-message-author-role', 'data-turn'].includes(mutation.attributeName);
        const visibilityChanged = mutation.type === 'attributes' &&
          ['hidden', 'inert', 'aria-hidden', 'data-state', 'style', 'class'].includes(mutation.attributeName);
        const targetTurn = conversationTurnForNode(mutation.target, roleChanged);
        const target = mutationElement(mutation.target);
        const membershipVisibilityChange = visibilityChanged && Boolean(target) && (
          target.matches(`${TURN_SELECTOR}, ${ROLE_SELECTOR}`) || !targetTurn
        );
        if (membershipVisibilityChange) structural = true;
        const targetRecorded = membershipVisibilityChange ? false : recordTurn(targetTurn);
        if (mutation.type !== 'childList') continue;
        let changedTurnRecorded = false;
        for (const node of mutation.addedNodes) {
          for (const turn of potentialTurnsFromRoot(node)) {
            if (recordTurn(turn)) {
              changedTurnRecorded = true;
              structural = true;
            }
          }
        }
        for (const node of mutation.removedNodes) {
          const removedTurns = potentialTurnsFromRoot(node);
          if (removedTurns.length) {
            structural = true;
            for (const turn of removedTurns) recordTurn(turn);
          }
        }
        if (!targetRecorded && !changedTurnRecorded &&
          [...mutation.addedNodes, ...mutation.removedNodes].some(nodeTouchesConversation)) structural = true;
      }
      return { structural, turns: [...affectedTurns] };
    }

    function observe() {
      state.observer = new win.MutationObserver((mutations) => {
        const pendingSession = state.pendingEditSession;
        if (pendingSession && (!pendingSession.composerRef || !pendingSession.composerRef.isConnected) &&
          mutations.some((mutation) => mutation.type === 'childList' && mutation.addedNodes.length > 0)) {
          const editSession = activeEditSession();
          bindEditSession(editSession);
        }
        let conversationChanged = false;
        const changedMutations = [];
        for (const mutation of mutations) {
          const changesConversation = mutationChangesConversation(mutation);
          if (changesConversation) {
            conversationChanged = true;
            changedMutations.push(mutation);
          }
          if (mutation.type === 'attributes') {
            const name = mutation.attributeName || '';
            const selectorRelevant = [
              'placeholder', 'aria-placeholder', 'data-placeholder', 'aria-label',
              'data-message-author-role', 'data-turn', 'data-testid', 'data-is-streaming', 'data-streaming',
            ].includes(name);
            const visibilityRelevant = changesConversation &&
              ['hidden', 'inert', 'aria-hidden', 'data-state', 'style', 'class'].includes(name);
            if (selectorRelevant || visibilityRelevant) scheduleScan(mutation.target);
          } else {
            for (const node of mutation.addedNodes) scheduleScan(node);
            if (mutation.removedNodes.length) scheduleScan(mutation.target);
          }
        }
        if (conversationChanged) {
          for (const mutation of mutations) evictHistoricalAttachmentCache(mutation);
          state.conversationMutationVersion += 1;
          const impact = conversationMutationImpact(changedMutations);
          state.conversationMutationHistory.push({
            version: state.conversationMutationVersion,
            structural: impact.structural,
            turns: impact.turns,
          });
          if (state.conversationMutationHistory.length > 100) {
            state.conversationMutationHistory.splice(0, state.conversationMutationHistory.length - 100);
          }
          state.conversationRoutingCache = null;
          state.editConversationRoutingCache.clear();
        }
      });
      state.observer.observe(doc.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeOldValue: true,
        characterData: true,
        attributeFilter: [
          'placeholder', 'aria-placeholder', 'data-placeholder', 'aria-label', 'title',
          'hidden', 'inert', 'aria-hidden', 'data-state', 'style', 'class',
          'data-message-author-role', 'data-turn', 'data-testid', 'data-is-streaming', 'data-streaming',
          'data-file-id', 'data-attachment-id', 'data-file-name', 'data-filename', 'data-name',
          'data-mime-type', 'data-file-type', 'data-file-size', 'data-size',
        ],
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
      doc.addEventListener('input', scheduleDockPosition, true);
      doc.addEventListener('click', onClick, true);
      doc.addEventListener('keydown', onKeyDown, true);
      doc.addEventListener('mouseup', onMouseUp, true);
      state.root.addEventListener('change', (event) => handleSettingChange(event.target));
      win.addEventListener('resize', scheduleDockPosition, { passive: true });
      if (win.visualViewport && typeof win.visualViewport.addEventListener === 'function') {
        win.visualViewport.addEventListener('resize', scheduleDockPosition, { passive: true });
        win.visualViewport.addEventListener('scroll', scheduleDockPosition, { passive: true });
      }
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
      captureSendSnapshot,
      attachmentProfileFromText,
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
    SIDE_FALLBACK_TRANSCRIPT_MAX_LENGTH,
    SELECTED_QUOTE_MAX_LENGTH,
    normalizeText,
    chooseDockPosition,
    chooseSelectionPillPosition,
    sanitizeSettings,
    getTurns,
    roleOfTurn,
    isAssistantTurn,
    getAssistantTurns,
    isTurnStreaming,
    getCompletedAssistantTurns,
    getLatestCompletedAssistantTurn,
    hasActiveGeneration,
    getTurnLocator,
    sanitizeLocator,
    locateTurn,
    closestAssistantTurn,
    quoteForPrompt,
    buildSelectedQuestion,
    requiresAnswerVerification,
    buildAccuracyGuardedPrompt,
    extractAssistantHandoff,
    assistantTurnFingerprint,
    conversationContextFingerprint,
    serializeConversation,
    buildSideFallbackPrompt,
    cleanStartWriting,
    restoreStartWriting,
    canonicalPageUrl,
    routeKey,
    conversationIdentity,
    isReadOnlyChatPage,
    isAllowedChatGPTUrl,
    isValidJobId,
    freshHandoffStorageKey,
    urlWithJob,
    urlWithNewChatJob,
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
    normalizeComposerPayload,
    fallbackDraftTextMatches,
    setComposerText,
    findSendButton,
    waitForConversationChange,
    waitForStableComposer,
    extractModelLevel,
    extractPickerLevel,
    modelLevelRank,
    modelLevelLabel,
    parseRouteOverride,
    buildAttachmentProfile,
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
