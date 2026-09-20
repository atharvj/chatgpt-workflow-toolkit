# ChatGPT Workflow Toolkit

A lightweight userscript for ChatGPT bookmarks, reading shortcuts, and separate contextual chats.

## Features

- **Bookmarks:** click ☆ Bookmark in an answer’s action row (highlight a passage first if you want), then give it a label. Open ☆ beside Settings to jump back to the original user message, rename, or remove a bookmark.
- **Return to where I was:** click ↓ beside the gear to jump instantly to the latest message, then ↩ to return. Recognized ChatGPT down arrows use the same action; unrecognized variants are left alone.
- Highlight a passage and **Ask in new chat**: automatically branch the whole chat, then send a question focused on that passage. Previous files and images stay in ChatGPT’s native history—not a text-only copy.
- Remove “Start writing.”
- Hide the “Share highlighted” selection button.
- Math highlights use source notation when available, otherwise compact display text with an instruction to check the original equations. Partial equations are included whole. **Show full highlight** expands the preview. This improves context, not a guarantee of correct answers.

Requires ChatGPT’s Branch action. Attachment availability and conversation limits still depend on ChatGPT.

Bookmarks save labels and short text references per chat in your userscript manager’s browser storage (up to 100 per chat). Nothing is sent to ChatGPT. Older answers must be loaded to jump to them. The temporary return spot clears on reload or switching chats.

The script uses page-window access only during automatic branching to open the result in the existing side window instead of another popup.

## Install

1. Install Tampermonkey or Violentmonkey.
2. Open the [userscript](https://raw.githubusercontent.com/atharvj/chatgpt-workflow-toolkit/main/chatgpt-workflow-toolkit.user.js) and confirm installation.
3. Reload [ChatGPT](https://chatgpt.com/).

Use the gear to toggle bookmarks, reading shortcuts, side-chat buttons, and interface cleanup, or choose a side window/tab. Disable the older **ChatGPT Sidecar** userscript first if it is installed.
