# ChatGPT Workflow Toolkit

ChatGPT Workflow Toolkit improves the whole conversation workflow: ask contextual questions in a separate native branch, move laggy chats into a lightweight fresh conversation, choose model effort per message, and remove the unwanted “Start writing” prompt.

It is a userscript; no Chrome extension or API key is required.

## Features

- **Continue lightweight** — prepare a compact handoff in the old conversation, then open a genuinely fresh side chat and paste it. The toolkit never reads the summary or clipboard.
- **Full-context continuation** — the lightweight dialog also offers a native branch when preserving every prior turn matters more than reducing chat weight.
- **Ask aside** — click the control below any ChatGPT response, enter a question, and continue asking follow-ups in the separate branch.
- **Ask about a selection** — select a step, sentence, or code fragment in a response and click the temporary **Ask aside** button. The selected excerpt is quoted in your question.
- **Keep the original visible** — desktop branches open in a narrow window on the right by default. A normal tab is used on small screens or when selected in settings.
- **Remove “Start writing”** — clears that exact placeholder/control without hiding matching words inside the conversation.
- **Adaptive Auto per message** — when you press Send, a local classifier chooses the lowest likely-sufficient level currently visible to your account: Instant for easy prompts, then Medium, High, Extra High/Ultra, or Pro-class options for increasingly difficult work.

ChatGPT officially supports [branching a conversation from a response](https://help.openai.com/en/articles/6825453-chatgpt-release-notes). The toolkit drives that native UI in a duplicated tab rather than copying the entire rendered transcript or calling an undocumented backend endpoint.

## Install

1. Install Tampermonkey or Violentmonkey in a Chromium-based browser.
2. Open the [raw userscript](https://raw.githubusercontent.com/atharvj/chatgpt-workflow-toolkit/main/chatgpt-workflow-toolkit.user.js), or create a new userscript and paste [`chatgpt-workflow-toolkit.user.js`](./chatgpt-workflow-toolkit.user.js) into it.
3. Sign in to ChatGPT. Native branching is available to logged-in web users; logged-out ChatGPT supports only one conversation.
4. Save the userscript, then reload `https://chatgpt.com/`.

If you manually installed the earlier **ChatGPT Sidecar** build, disable or remove it before enabling this renamed build. Userscript managers can treat the new name and namespace as a separate script; a compatibility guard prevents both builds from injecting controls at the same time.

For Greasy Fork, publish `chatgpt-workflow-toolkit.user.js` directly. It has no build step, remote library, tracking code, or `@connect` permission.

## Use

### Ask a side question

1. Click **Ask aside** below the response containing the instructions you are following.
2. Type the question. For example: `Why does step 4 use a volumetric flask here?`
3. Choose **Only through this response** for a short focused fork, or **Through latest response** to include the whole completed chat. A selected excerpt defaults to the latter because the quote identifies the older passage.
4. Click **Open side chat**.

The toolkit opens a duplicate of the current conversation, invokes ChatGPT's native **Branch in new chat** action at the chosen context point, and fills the question only after the new branch is stable. Automatic sending is off by default; enable it after confirming the workflow on your account. The original tab and its scroll position are untouched.

For a more precise question, select the relevant instruction first and click the small **Ask aside** pill above the selection.

### Continue a laggy conversation

Click **Continue lightweight**:

1. Choose **Prepare**. The toolkit places a compact handoff request in the current composer without sending it.
2. Review and send that request. When ChatGPT returns the handoff, use ChatGPT's normal **Copy** button.
3. Open **Continue lightweight** again, choose **Open fresh**, paste the handoff, add your next request, and send.

This extra copy/paste is intentional: the toolkit does not scrape ChatGPT output or read the clipboard. If you prefer exact full context and can accept the old history remaining attached, choose **Use full-context branch** instead.

[OpenAI's troubleshooting guidance](https://help.openai.com/en/articles/7996703) recommends trying a new chat when a long conversation becomes slow. A full native branch still contains all prior turns and can remain heavy; the compact-handoff path is the lag-focused option.

### Use Adaptive Auto

Adaptive Auto is enabled by default. Open Workflow Toolkit settings with the gear button to turn it off or limit its maximum to **High**, **Extra High**, or **Highest available**.

Classification happens only after a send action. It is local, bounded, and makes no second AI request. Simple facts, short rewrites, translations, and ordinary chat stay on Instant. Normal analysis and bounded coding generally use Medium. Debugging, rigorous proofs, and consequential questions can use High. Multiple independent signals—such as production architecture, security, formal verification, many constraints, or repo-scale work—are required before Extra High/Ultra or Pro-class choices are considered.

The model menu is read live on every needed switch, and only recognized, enabled-looking, non-upsell rows are eligible. **Ultra is used only if that exact unlisted/experimental label is actually exposed by ChatGPT**; otherwise the toolkit resolves to the closest suitable available choice. Availability varies by plan and workspace. OpenAI currently documents Instant, Medium, High, Extra High, and Pro availability in [GPT-5.6 in ChatGPT](https://help.openai.com/en/articles/20001354).

This is an English-oriented deterministic estimate, not a promise that a particular answer will be correct or globally optimal for speed, tokens, and accuracy. Non-English and very context-dependent prompts can be under- or over-routed. ChatGPT's own automatic switching may still promote an Instant selection to Medium. Disable native automatic switching if you want the toolkit's picker choice to be as exact as the web UI permits.

Useful one-message controls:

- Manually choose a level in ChatGPT's picker; Adaptive Auto preserves it for the next message, then resumes.
- Hold **Alt** while clicking Send to bypass Adaptive Auto once.
- Put `!route:instant`, `!route:medium`, `!route:high`, `!route:extra-high`, `!route:ultra`, `!route:pro`, or `!route:max` at the start of a prompt for an explicit choice. The configured maximum still applies.

## Settings

- **Adaptive Auto for every message** — classifies only when a message is sent and switches through ChatGPT's visible model menu when needed.
- **Maximum Auto level** — limits automatic choices to High, Extra High, or the strongest compatible option the account exposes.
- **Open branches in** — choose a right-side popup or a standard tab.
- **Send side questions automatically** — off by default; turn on only after verifying native branching on your account.
- **Show “Ask aside” on responses** — hides both permanent and selection controls when disabled.
- **Remove “Start writing”** — can be turned off to restore placeholders and controls changed by the toolkit.

The same actions are also available from the userscript manager's command menu.

## Privacy and performance

The toolkit is deliberately small in scope:

- It makes no network requests of its own.
- It does not intercept ChatGPT requests, call private endpoints, scrape the conversation in the background, or embed a second ChatGPT iframe.
- Full context transfer is handled by ChatGPT's native branch feature.
- Only the question you typed, an explicitly selected excerpt, a response position, and the source URL are placed in userscript storage for the cross-tab handoff.
- A branch handoff expires after five minutes and is deleted after successful insertion or an explicit discard. Orphaned jobs are swept on the next startup.
- One batched `MutationObserver` processes only new or changed page nodes. Temporary branch/model-menu observers are throttled and disconnected on completion; there is no permanent polling loop or per-keystroke classifier.
- Adaptive Auto reads only the current draft, attachment labels/count, active composer mode, and visible model labels. It does not read attachment contents or scan old conversation turns.

## Compatibility and recovery

ChatGPT is a frequently updated web app, so DOM automation can occasionally need a selector update. The toolkit fails safely: if it cannot find the native branch action, the duplicate window highlights the target response and shows the manual steps. Your original chat is never modified or replaced.

Adaptive Auto also depends on ChatGPT's English web model-picker markup; it does not use a private API. A web UI change can temporarily make a level unreachable even though the account has it.

If Adaptive Auto cannot reach or confirm the picker, it sends once with the current selection and reports that fallback. Only an explicit `!route:` request is fail-closed: it leaves the draft unsent when that requested level cannot be confirmed. If a draft, attachment, active tool, or conversation changes during a model switch, sending is cancelled for review. Agent, Deep Research, Canvas, image/video generation, and voice/record modes keep control of their compatible model.

Automatic menu clicking currently recognizes the English **Branch in new chat** label. On a localized ChatGPT interface, use the recovery prompt to select the equivalent native menu item manually.

The toolkit suppresses conversation controls on read-only `/share/` pages. Open the conversation from your signed-in chat history before branching it.

If the side window does not open, allow popups for `chatgpt.com` or select **New tab** in Workflow Toolkit settings.

## Development

Requires Node.js 20.19 or newer.

```sh
npm install
npm run check
```

The distributable file is the source file: no bundler is required.

See [`MANUAL_TESTING.md`](./MANUAL_TESTING.md) for the authenticated browser test checklist.

## License

[MIT](./LICENSE)
