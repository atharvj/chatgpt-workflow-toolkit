# ChatGPT Workflow Toolkit

A lightweight userscript for ChatGPT bookmarks, reading shortcuts, and separate contextual chats.

## Features

- **Bookmarks:** highlight a sentence and click ☆ Bookmark to return to that sentence later. Bookmark a whole answer from its action row to return to your preceding message instead. Manage saved bookmarks using ☆ beside Settings.
- **Return to where I was:** click ChatGPT’s down arrow, then ↩ beside Settings to return. Turn off **Jump to bottom instantly** for normal animated scrolling while still saving your place.
- Return and answer-level Ask buttons are always enabled. Click checkboxes directly to change settings. **Dark mode for toolkit panels** switches the toolkit’s boxes between light and dark independently of ChatGPT.
- Highlight a passage and **Ask in new chat**: automatically branch the whole chat, then send a question focused on that passage. Previous files and images stay in ChatGPT’s native history—not a text-only copy.
- Click **Ask in new chat** under an answer to ask about that entire answer instead. Ask and Bookmark sit beside its response actions.
- Remove “Start writing.”
- Hide the “Share highlighted” selection button.
- Automatically remove `utm_source=chatgpt.com` from external links, including new-tab, middle-click, and context-menu opening. Other query parameters and anchors stay unchanged. This cleans page links, not URLs opened directly by JavaScript or tracking added by the destination site.
- Remove the bottom Cookie preferences gap; Cookie preferences stays available in the toolkit’s settings.
- Math highlights use source notation when available, otherwise compact display text with an instruction to check the original equations. Partial equations are included whole. **Show full highlight** expands the preview. This improves context, not a guarantee of correct answers.

Requires ChatGPT’s Branch action. Supports **Open new branch → Branch in new Chat**; currently always chooses normal Chat, without automatic Work-mode detection. Attachment availability and conversation limits still depend on ChatGPT.

Bookmarks save labels and short text references per chat in your userscript manager’s browser storage (up to 100 per chat). Nothing is sent to ChatGPT. Older answers must be loaded to jump to bookmarks. Return restores saved scroll coordinates when a message is unloaded, then aligns it if it remounts; otherwise the position is approximate. The temporary return spot clears on reload or switching chats.

The script uses page-window access only during automatic branching to open the result in the existing side window instead of another popup.

## Install

1. Install Tampermonkey or Violentmonkey.
2. Open the [userscript](https://raw.githubusercontent.com/atharvj/chatgpt-workflow-toolkit/main/chatgpt-workflow-toolkit.user.js) and confirm installation.
3. Reload [ChatGPT](https://chatgpt.com/).

Use the gear for bookmarks, highlight buttons, scrolling, panel theme, interface cleanup, and side window/tab settings. Disable the older **ChatGPT Sidecar** userscript first if it is installed.
