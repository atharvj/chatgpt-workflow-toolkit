// ==UserScript==
// @name         ChatGPT Workflow Toolkit
// @namespace    https://github.com/atharvj/chatgpt-workflow-toolkit
// @version      1.4.12
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

  const VERSION = '1.4.12';
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
  const SEND_BUTTON_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send message"]',
    'button[aria-label^="Send"]',
  ];
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

  function requiresAnswerVerification(value) {
    const raw = String(value == null ? '' : value).slice(0, QUESTION_MAX_LENGTH);
    const withoutBom = raw.replace(/^\uFEFF/u, '');
    const overrideMatch = withoutBom.match(ROUTE_OVERRIDE_PATTERN);
    const prompt = overrideMatch
      ? withoutBom.slice(overrideMatch[0].length).replace(/^\s*(?::|;)?\s*/u, '')
      : raw;
    const fullText = lowerText(prompt);
    if (!fullText || /^(?:rewrite|rephrase|translate|edit|proofread|quote|summari[sz]e)\b/iu.test(fullText)) return false;
    const questionMarker = 'my question:';
    const markerIndex = fullText.lastIndexOf(questionMarker);
    const selectedContext = markerIndex >= 0 ? fullText.slice(0, markerIndex) : '';
    const text = markerIndex >= 0 ? fullText.slice(markerIndex + questionMarker.length).trim() : fullText;
    if (!text) return false;

    const claimedAnswer = /\b(?:the\s+)?(?:answer|result|solution|value|output)\s+(?:is|was|equals?|would be|should be|came out(?: to)?)\b/iu;
    const challengeLead = /^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:(?:explain|justify|why|how)\b|(?:tell|show) me\s+(?:why|how)\b|help me understand\s+(?:why|how)\b)|^i\s+(?:(?:still|really|just)\s+)?(?:do\s+not|don['’]?t|cannot|can['’]?t)\s+(?:get|understand|see|follow)\b/iu;
    const reverseClaimedAnswer = /\b(?:why|how)\s+(?:(?:is|was)\s+.{1,80}|(?:would|should|could)\s+.{1,80}\s+be)\s+(?:the\s+)?(?:answer|result|solution|value|output)\b(?:\s+(?:(?:to|for)\s+(?:this|the)\s+(?:question|problem|exercise|equation|case)|in\s+(?:this|the)\s+(?:problem|case|context|key)))?[?.!]*$/iu;
    const forwardAuxClaim = /\b(?:why|how)\s+(?:should|would|could)\s+(?:the\s+)?(?:answer|result|solution|value|output)\s+be\b/iu;
    const correctnessChallenge = /\b(?:why|how)\s+(?:(?:is|was|isn['’]?t|wasn['’]?t)\s+.{1,80}?\s+|.{1,80}?\s+(?:is|was|isn['’]?t|wasn['’]?t|would be|could be|should be)\s+|(?:can|could|should|would|can['’]?t|cannot)\s+.{1,80}?\s+be\s+)(?:correct|right|valid)\b(?:\s+(?:here|in (?:this|the) (?:problem|case|context)))?[?.!]*$/iu;
    const numericAnswerPiece = String.raw`[-+]?(?:\d+(?:[.,]\d+)?|\.\d+)(?:\s*(?:%|°(?:c|f)?|v|mv|kv|volts?|a|ma|ka|amps?|w|mw|kw|watts?|j|kj|n|pa|kpa|mpa|hz|khz|mhz|ghz|ohms?|m|cm|mm|km|in|ft|yd|mi|g|mg|kg|lbs?|oz|l|ml|s|ms|mins?|h|hrs?|(?:m|km)\/(?:s|h)))?`;
    const answerOnlyValue = new RegExp(String.raw`^${numericAnswerPiece}(?:\s*(?:and|or|,)\s*${numericAnswerPiece})*[?.!]*$`, 'iu');
    const derivationMatch = text.match(/\b(?:how|why)\b.{0,80}\b(?:(?:(?:did\s+)?(?:you|we|they)\s+)?(?:get|got|find|found|calculate|calculated|compute|computed|derive|derived|conclude|concluded|return|returned|produce|produced)|(?:you|we|they)\s+arrived at)\s+(.+?)$/iu);
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
    return selectedChallenge || deicticValueChallenge || challengeLead.test(text) && (
      claimedAnswer.test(text) || reverseClaimedAnswer.test(text) || forwardAuxClaim.test(text) || derivationChallenge || correctnessChallenge.test(text)
    );
  }

  function buildAccuracyGuardedPrompt(value, maximumLength = QUESTION_MAX_LENGTH) {
    const raw = String(value == null ? '' : value);
    if (!requiresAnswerVerification(raw)) return raw;
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
    const answerVerification = requiresAnswerVerification(raw);

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

    if (answerVerification) {
      score = Math.max(score, 40);
      reasons.push('verify a supplied answer before explaining');
      strongGroups.add('supplied-answer verification');
    }

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
          : score < 80
            ? 'extra-high'
            : 'pro';

    if (highStakes && modelLevelRank(target) < ROUTE_LEVEL_RANK.high) target = 'high';
    if (debuggingWork && modelLevelRank(target) < ROUTE_LEVEL_RANK.high) target = 'high';
    if (answerVerification && modelLevelRank(target) < ROUTE_LEVEL_RANK.high) target = 'high';
    if (modelLevelRank(target) >= ROUTE_LEVEL_RANK['extra-high'] && strongGroups.size < 2) target = 'high';
    if (modelLevelRank(target) >= ROUTE_LEVEL_RANK.pro && (
      strongGroups.size < 3 || !(longHorizon || expertWork || (highStakes && strongGroups.has('source synthesis')))
    )) {
      target = 'extra-high';
    }

    const boundaries = [20, 40, 60, 80];
    const margin = Math.min(...boundaries.map((boundary) => Math.abs(score - boundary)));
    const confidence = Math.max(0.45, Math.min(0.94, 0.58 + Math.min(margin, 10) * 0.018 + Math.min(strongGroups.size, 3) * 0.045));
    return {
      target,
      score,
      confidence,
      explicit: false,
      strict: answerVerification,
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
            <span><strong>Adaptive Auto for every message</strong><small>On Send, a fast local heuristic chooses the lowest likely-sufficient level your account exposes—from Instant through the strongest available option. It never sends your draft anywhere else. Hold Alt while sending to bypass it once. ChatGPT’s own automatic switching can still promote Instant to Medium.</small></span>
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
      replayingSend: false,
      submitReplayPermit: null,
      composingComposer: null,
      lastRouteDecision: null,
      adaptiveCancelled: false,
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

    function armSubmitReplayPermit(composer, kind, draftValidator = null) {
      const form = composer && composer.closest('form');
      if (!form) return;
      state.submitReplayPermit = {
        form,
        path: conversationPath(),
        draft: getComposerText(composer),
        draftValidator: typeof draftValidator === 'function' ? draftValidator : null,
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
      if (currentDraft) {
        let draftMatches = currentDraft === permit.draft;
        if (!draftMatches && permit.draftValidator) {
          try { draftMatches = permit.draftValidator(composer, permit.draft) === true; } catch (_error) { draftMatches = false; }
        }
        if (!draftMatches) return false;
      }
      state.submitReplayPermit = null;
      return true;
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
        if (!ready) return false;
        if (ready && typeof ready === 'object' && ready.refreshSnapshot === true) {
          const refreshed = captureSendSnapshot(ready.composer && ready.composer.isConnected
            ? ready.composer
            : findComposer(doc));
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
        if (!validation.ok) {
          if (!snapshot.silent) toast(`${validation.reason} Review it and press Send again.`, 7_000);
          return false;
        }
        return true;
      };
      const sendButton = findSendButton(doc, validation.composer);
      if (sendButton) {
        if (sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') {
          if (!snapshot.silent) toast('ChatGPT’s Send control is not ready. Your draft was not sent.', 7_000);
          return false;
        }
        if (typeof snapshot.beforeReplay === 'function') {
          if (!await runBeforeReplay({ composer: validation.composer, sendButton })) return false;
          const currentSendButton = findSendButton(doc, validation.composer);
          if (!currentSendButton || currentSendButton.disabled || currentSendButton.getAttribute('aria-disabled') === 'true') return false;
          armSubmitReplayPermit(validation.composer, 'adaptive-replay', snapshot.draftValidator);
          state.replayingSend = true;
          try { currentSendButton.click(); } finally { state.replayingSend = false; }
          rememberRoute(selectedLevel, decision, manual, reason);
          return true;
        }
        armSubmitReplayPermit(validation.composer, 'adaptive-replay', snapshot.draftValidator);
        state.replayingSend = true;
        try { sendButton.click(); } finally { state.replayingSend = false; }
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
        armSubmitReplayPermit(validation.composer, 'adaptive-replay', snapshot.draftValidator);
        state.replayingSend = true;
        try { currentForm.requestSubmit(); } catch (_error) { return false; } finally { state.replayingSend = false; }
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
      const activeDiscoveryDeadline = discoveryDeadline || Date.now() + routingDiscoveryTimeout;
      const routingPickerCandidates = () => {
        const preferred = targetRank >= ROUTE_LEVEL_RANK.pro
          ? [findModelPicker(doc), findReasoningPicker(doc)]
          : [findReasoningPicker(doc), findModelPicker(doc)];
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
        if (routingIsStrict(decision) && modelLevelRank(current) < targetRank) {
          if (!silent) toast(`${snapshot.specialMode} did not expose a confirmed ${modelLevelLabel(target)}-or-stronger level. Your accuracy-checked draft was not sent.`, 8_000);
          return false;
        }
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
      if (!stagedThinkingChoice && decision.strict && modelLevelRank(choice.level) < targetRank) {
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
            const effortPicker = findReasoningPicker(doc);
            if (effortPicker) return effortPicker;
            const basePicker = findModelPicker(doc);
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
        await waitForCondition(() => findReasoningPicker(doc), {
          root: composerScope(findComposer(doc)) || doc.documentElement,
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
      const composer = options.composer && options.composer.isConnected ? options.composer : findComposer(doc);
      const snapshot = captureSendSnapshot(composer);
      if (!snapshot) return false;
      snapshot.draftValidator = typeof options.draftValidator === 'function' ? options.draftValidator : null;
      const suppliedBeforeReplay = typeof options.beforeReplay === 'function' ? options.beforeReplay : null;
      const guardedDraft = options.routingText == null
        ? buildAccuracyGuardedPrompt(snapshot.draft)
        : snapshot.draft;
      if (guardedDraft !== snapshot.draft) {
        snapshot.beforeReplay = async (context) => {
          const liveComposer = context.composer && context.composer.isConnected ? context.composer : findComposer(doc);
          if (!liveComposer || !composerTextEquals(liveComposer, snapshot.draft) ||
            !setComposerText(liveComposer, guardedDraft, win) || !composerTextEquals(liveComposer, guardedDraft)) {
            if (!snapshot.silent) toast('The accuracy check could not be added safely. Your message was not sent.', 8_000);
            return false;
          }
          const activeComposer = findComposer(doc);
          if (!activeComposer || !activeComposer.isConnected || !composerTextEquals(activeComposer, guardedDraft)) {
            if (!snapshot.silent) toast('The message box changed while the accuracy check was added. Your message was not sent.', 8_000);
            return false;
          }
          let refreshComposer = activeComposer;
          if (suppliedBeforeReplay) {
            const ready = await suppliedBeforeReplay({
              ...context,
              composer: activeComposer,
              sendButton: findSendButton(doc, activeComposer),
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
        const explicitDecision = classifyPrompt(options.routingText == null ? snapshot.draft : options.routingText, {
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
      if (state.sideAutomationActive) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
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
      if (state.sideAutomationActive && !state.replayingSend) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
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
      if (state.replayingSend) return;
      // ChatGPT may dispatch the actual form submit shortly after our
      // programmatic Send click returns. Let only that short-lived, exact
      // composer replay through while the broader side-job guard stays active.
      if (state.sideAutomationActive) {
        if (state.submitReplayPermit && state.submitReplayPermit.kind === 'adaptive-replay' &&
          consumeSubmitReplayPermit(event, composer)) return;
        state.submitReplayPermit = null;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (consumeSubmitReplayPermit(event, composer)) return;
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
