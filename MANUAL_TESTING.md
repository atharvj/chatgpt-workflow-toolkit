# Manual browser test checklist

Run these checks in a non-sensitive ChatGPT conversation after the automated test suite passes.

Sign in first. The native branch workflow is a logged-in ChatGPT web feature; logged-out ChatGPT supports only one conversation.

## Baseline

- Enable the userscript and reload `https://chatgpt.com/`.
- Confirm the **Continue in fresh chat** dock appears after the first completed response and ordinary scrolling, typing, streaming, copy, edit, retry, and voice controls still work.
- Grow the message box to several lines and resize the window; confirm the dock stays above the message box instead of covering it.
- Confirm the continuation action stays hidden on the blank home composer and while a response is streaming.
- Open DevTools and confirm Workflow Toolkit produces no errors and no network requests.

## Settings

- Click the in-page gear and confirm a centered settings modal opens above ChatGPT.
- Click inside the modal, its backdrop, and the covered page; confirm settings remains open.
- Confirm the close button and Escape each close the modal.
- Open the userscript menu and confirm **Open Workflow Toolkit settings…** is its only toolkit action and opens the same modal.
- Repeat at a narrow mobile viewport and confirm the modal remains centered and scrolls internally.

## Ask in new chat

- Ask ChatGPT for a numbered set of at least five instructions.
- Click **Ask in new chat** under the response and confirm the question form opens as a side panel without dimming or blocking the original chat.
- Scroll and read the original answer while typing a question about step 3 in the panel.
- Confirm the panel has no context or send checkbox: the whole conversation is always used and sending is automatic.
- Confirm a separate popup/tab is created, its URL changes to a different conversation ID, and the question sends automatically.
- Confirm the original tab remains at the same scroll position and has no new message.
- Ask a second follow-up in the new branch and confirm it understands the earlier conversation.
- Add another exchange to the original, click **Ask in new chat** on an older response, and confirm the separate chat still contains everything through the newest completed answer.

## Selected instruction

- Select part of one instruction in an assistant response.
- Confirm ChatGPT's native **Ask ChatGPT** control stays above the selection while the temporary **Ask in new chat** pill remains fully visible below it in light and dark mode.
- Open it and confirm the selected text is quoted, including multiline selections.
- Repeat near the left, right, and bottom edges of the viewport and confirm the pill remains visible.
- Select ordinary text outside an assistant response and confirm no pill appears.

## Continue in fresh chat

- Click **Continue in fresh chat** and confirm the dialog contains only “Are you sure you want to continue in fresh chat?”, **Cancel**, and **Yes**.
- Choose **Yes** and confirm Workflow Toolkit sends one handoff request, waits for ChatGPT's completed answer, then switches the current tab to a blank new chat.
- Confirm the handoff is filled and sent automatically in the new chat, with none of the old rendered turns present.
- In a chat that used named files/images, confirm the new chat asks once for those exact items if available, says it is okay if they are unavailable, and can still continue from the handoff.
- In a chat with no external materials, confirm the new chat does not ask for any.
- Put an unrelated draft or staged attachment in the old composer and confirm continuation refuses to overwrite or send it.
- Confirm the side-question popup/tab setting does not affect fresh continuation: continuation always switches the current tab.

## Adaptive Auto

- Confirm the dock badge says **Adaptive Auto** and the setting is enabled by default.
- With **Highest available** selected, send `Define osmosis in one sentence.` from High and confirm Workflow Toolkit selects Instant before sending exactly once.
- Send `Compare TCP and UDP for multiplayer networking.` and confirm it selects Medium when Medium is available.
- Paste a real traceback and ask for the root cause; confirm it selects High.
- Ask for a production multi-tenant authentication design with a threat model, concurrency risks, migration, rollback, tests, and security tradeoffs; confirm it selects Extra High or Ultra if exposed.
- Ask for an end-to-end repo-scale implementation with security review, exhaustive tests, benchmarks, and a formal correctness argument; confirm it can select a Pro-class option when the account exposes one.
- Change **Maximum Auto level** to High and confirm even the hardest prompt does not select above High. Repeat with Extra High.
- Manually choose High, then send `what is 2+2`; confirm Adaptive Auto still changes it to Instant. Hold Alt while sending when you intentionally want to preserve the current manual choice for one message.
- From Instant, send `I don't get why the answer is 12V and 4V.` Confirm Adaptive Auto selects High or a stronger available level and the sent message tells ChatGPT to verify that result before explaining it.
- Repeat without an available/confirmable High-or-stronger option and confirm the original draft remains unsent instead of falling back to Instant or Medium.
- Start a prompt with `!route:high`, send it, and confirm High is selected. Verify the same words later in ordinary prose do not count as an override.
- Hold Alt while clicking Send and confirm the current model is used without opening the picker.
- Press Shift+Enter and use an IME composition flow; confirm neither triggers a send. Confirm plain Enter and Ctrl/Cmd+Enter still route and send once.
- Enable Agent, Deep Research, Canvas, image/video generation, or voice/record mode when available; confirm Workflow Toolkit keeps that mode's current compatible model.
- Start a model switch, then immediately edit the draft or change an attachment; confirm Workflow Toolkit cancels sending and leaves the edited draft for review.
- On an account without a paid picker, confirm ordinary and high-stakes prompts report the picker as unavailable and still send once with the current model. Confirm an explicit `!route:high` draft remains unsent when High cannot be confirmed.
- If ChatGPT native automatic switching is enabled, confirm it may still promote Workflow Toolkit's Instant choice to Medium; disable native switching when testing exact selections.

## Start writing cleaner

- Navigate to a ChatGPT surface that displays the exact **Start writing** placeholder/control.
- Confirm that control disappears or its placeholder is cleared.
- Send a message containing the literal phrase “Start writing” and confirm the message remains visible.
- Disable the setting and confirm the changed placeholder/control is restored.

## Failure recovery

- Temporarily change `findMoreButton` and `findDirectBranchAction` locally so both return `null`.
- Start a side question and confirm the side window automatically switches to a blank chat, transfers the visible conversation transcript, and sends the question once.
- Confirm the original chat receives no draft or message and no “Could not find More actions” dialog appears.
- Confirm a long chat keeps its opening goal and newest response if the emergency transcript must be shortened.
- Block popups for `chatgpt.com`; confirm Workflow Toolkit reports the block and the original chat remains untouched.

## Performance

- Open a conversation with many turns and stream a long response.
- Confirm Workflow Toolkit adds one response action per assistant turn, does not add duplicate buttons after rerenders, and does not noticeably affect input or scrolling.
- Leave the tab open for several minutes and confirm there is no recurring CPU usage from Workflow Toolkit when the DOM is idle.
- Type continuously in a long chat and confirm Adaptive Auto does no classification or picker work until Send is pressed.
