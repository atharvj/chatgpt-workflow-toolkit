# ChatGPT Workflow Toolkit

A userscript built around **Adaptive Auto: model-effort routing for every message**. On each send—including edited resends—it uses the prompt, attachment difficulty, and relevant conversation context to choose the lowest likely-sufficient intelligence level. This aims to preserve accuracy while reducing wait time and unnecessary reasoning-token use; uncertain tasks favor stronger levels, while unavailable plan levels fall back without blocking normal messages.

## Features

- Adapt ChatGPT’s model effort separately for every message.
- Ask a side question in a separate chat with the whole conversation so far.
- Continue a laggy conversation in a fresh chat with an automatic handoff.
- Remove “Start writing.”

## Install

1. Install Tampermonkey or Violentmonkey.
2. Open the [userscript](https://raw.githubusercontent.com/atharvj/chatgpt-workflow-toolkit/main/chatgpt-workflow-toolkit.user.js) and confirm installation.
3. Reload [ChatGPT](https://chatgpt.com/).

Use the response buttons and the gear button for settings. Disable the older **ChatGPT Sidecar** userscript first if it is installed.
