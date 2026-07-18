# ChatGPT Workflow Toolkit

A small userscript that adds better conversation tools to ChatGPT.

Its main feature, **Adaptive Auto for every message—including edited resends**, uses the prompt, attachment type/size/count, and only the relevant conversation context to choose the lowest likely-sufficient intelligence level. This can reduce wait time and unnecessary reasoning-token use. Answer checks require a confirmed High-or-stronger level and independent verification.

## Features

- Ask a side question in a separate chat with the whole conversation so far.
- Continue a laggy conversation in a fresh chat with an automatic handoff.
- Remove “Start writing.”

## Install

1. Install Tampermonkey or Violentmonkey.
2. Open the [userscript](https://raw.githubusercontent.com/atharvj/chatgpt-workflow-toolkit/main/chatgpt-workflow-toolkit.user.js) and confirm installation.
3. Reload [ChatGPT](https://chatgpt.com/).

Use the response buttons and the gear button for settings. Disable the older **ChatGPT Sidecar** userscript first if it is installed.
