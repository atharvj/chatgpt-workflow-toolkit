# ChatGPT Workflow Toolkit

A lightweight userscript that adds better conversation tools to ChatGPT.

## Features

- Ask questions about any response in a separate, context-aware chat.
- Continue laggy conversations in a fresh chat with a compact handoff.
- Automatically choose a model/intelligence level for each message.
- Remove the “Start writing” prompt.
- Keep the original conversation open in a side window or tab.

## Install

1. Install Tampermonkey or Violentmonkey.
2. Open the [userscript](https://raw.githubusercontent.com/atharvj/chatgpt-workflow-toolkit/main/chatgpt-workflow-toolkit.user.js) and confirm installation.
3. Reload [ChatGPT](https://chatgpt.com/).

If **ChatGPT Sidecar** is installed, disable or remove it first.

Use the buttons added below ChatGPT responses and the gear button for settings. Adaptive Auto is a local heuristic and only uses models available to your account.

## Development

```sh
npm install
npm run check
```

[MIT License](./LICENSE)
