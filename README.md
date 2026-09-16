# ChatGPT Workflow Toolkit

A lightweight userscript that adds separate contextual chats and small interface improvements to ChatGPT.

## Features

- Highlight a passage and **Ask in new chat**: automatically branch the whole chat, then send a question focused on that passage. Previous files and images stay in ChatGPT’s native history—not a text-only copy.
- Remove “Start writing.”
- Hide the “Share highlighted” selection button.
- Math highlights use source notation when available, otherwise compact display text with an instruction to check the original equations. Partial equations are included whole. **Show full highlight** expands the preview. This improves context, not a guarantee of correct answers.

Requires ChatGPT’s Branch action. Attachment availability and conversation limits still depend on ChatGPT.

The script uses page-window access only during automatic branching to open the result in the existing side window instead of another popup.

## Install

1. Install Tampermonkey or Violentmonkey.
2. Open the [userscript](https://raw.githubusercontent.com/atharvj/chatgpt-workflow-toolkit/main/chatgpt-workflow-toolkit.user.js) and confirm installation.
3. Reload [ChatGPT](https://chatgpt.com/).

Use the gear to choose a window/tab, toggle response and highlight buttons, or restore “Start writing” and “Share highlighted.” Math copying improvements are always enabled, without extra notices. Disable the older **ChatGPT Sidecar** userscript first if it is installed.
