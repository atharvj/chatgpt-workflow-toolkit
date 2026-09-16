# Manual browser test checklist

Run these checks in a non-sensitive ChatGPT conversation after the automated test suite passes.

Sign in first. The native branch workflow is a logged-in ChatGPT web feature; logged-out ChatGPT supports only one conversation.

## Baseline

- Enable the userscript and reload `https://chatgpt.com/`.
- Confirm the settings gear appears and ordinary scrolling, typing, streaming, copy, edit, retry, and voice controls still work.
- Grow the message box to several lines and resize the window; confirm the settings gear stays above the message box instead of covering it.
- Open DevTools and confirm Workflow Toolkit produces no errors and no network requests.

## Settings

- Click the in-page gear and confirm a centered settings modal opens above ChatGPT.
- Click inside the modal, its backdrop, and the covered page; confirm settings remains open.
- Confirm the close button and Escape each close the modal.
- Open the userscript menu and confirm **Open Workflow Toolkit settings…** is its only toolkit action and opens the same modal.
- Repeat at a narrow mobile viewport and confirm the modal remains centered and scrolls internally.
- Toggle **Hide Share highlighted** off/on: the native button should return/disappear immediately, including after changing the selection. Repeat for **Remove Start writing**.
- Toggle response buttons and highlight buttons separately; each should work independently of the other.
- Math copying improvements should always run, with no math-copy notices or math settings shown. Upgrading from saved preferences that disabled improvements or enabled notices must not restore those behaviors.
- Reload and confirm all settings persist. Upgrading an older installation with response buttons disabled should keep selection buttons disabled too until explicitly re-enabled.

## Ask in new chat

- Ask ChatGPT for a numbered set of at least five instructions.
- Click **Ask in new chat** under the response and confirm the question form opens as a side panel without dimming or blocking the original chat.
- Scroll and read the original answer while typing a question about step 3 in the panel.
- Confirm the panel has no context or send checkbox: the whole conversation is always used and sending is automatic.
- Confirm a separate popup/tab is created, its URL changes to a different conversation ID, and the question sends automatically.
- Confirm the original tab remains at the same scroll position and has no new message.
- Verify the latest response's closed three-dot menu opens automatically, including a pointer-down-driven menu. Confirm it opens once and creates only one branch; repeat after switching chats or resizing the window.
- With the first user-opened side window allowed but automatic extra popups blocked, confirm Branch's new-tab result loads in that existing side window and sends once. Repeat in tab mode. Update the userscript's page-window permission when prompted.
- Confirm ordinary links/new-tab actions behave normally again after success or failure. No popup interception should run in the original chat or while idle.
- Ask a second follow-up in the new branch and confirm it understands the earlier conversation.
- Add another exchange to the original, click **Ask in new chat** on an older response, and confirm the separate chat still contains everything through the newest completed answer.

## Selected instruction

- Select part of one instruction in an assistant response.
- Confirm **Share highlighted** is hidden, but normal **Share**, **Ask ChatGPT**, and **Ask in new chat** controls remain available. Repeat after changing the selection and after navigating to another chat.
- Confirm ChatGPT's native **Ask ChatGPT** control stays above the selection while the temporary **Ask in new chat** pill remains fully visible below it in light and dark mode.
- Open it and confirm the selected text appears in a separate preview, including multiline selections.
- Type a question and confirm the preview is unchanged. Submit and confirm the new message quotes only the selected passage, followed by your question (not a copied transcript).
- Leave the question blank and confirm Submit automatically asks for an explanation of the highlight.
- Upload a file and an image, add several exchanges, then highlight an older answer. Confirm the native branch includes the latest exchange and the attachment history, and ask a follow-up that requires the attachments. Check this live: DOM tests cannot verify ChatGPT’s server-side file access.
- Repeat near the left, right, and bottom edges of the viewport and confirm the pill remains visible.
- Select ordinary text outside an assistant response and confirm no pill appears.
- Highlight a mix of prose and rendered equations (fractions, subscripts, powers, sums, degree symbols). Confirm the preview contains each equation's source notation once, in order, and the outgoing message matches it.
- Start/end a highlight inside an equation. Confirm that equation is copied whole and neighboring unselected prose/equations are not included.
- Select ordinary prose again and confirm its text is unchanged. Confirm selecting math does not change the original rendered answer or composer.
- Repeat with HTML-only equations with no source annotation or MathML. Confirm each equation uses compact display text, not layout-induced line breaks, and the outgoing question asks the model to check the original equations for mathematical structure.
- Mix source-backed and HTML-only equations in one selection; confirm source-backed formulas still keep their notation.
- Click **Show full highlight**, then **Collapse highlight**. Confirm the full saved quote is unchanged and the last selected equation is included when sent, even if the preview is collapsed.
- An equation with neither source nor readable display text should remain unchanged, not become an invented transcription.

## Start writing cleaner

- Navigate to a ChatGPT surface that displays the exact **Start writing** placeholder/control.
- Confirm that control disappears or its placeholder is cleared.
- Send a message containing the literal phrase “Start writing” and confirm the message remains visible.
- Disable the setting and confirm the changed placeholder/control is restored.

## Failure recovery

- Temporarily change `findMoreButton` and `findDirectBranchAction` locally so both return `null`.
- Start a side question and confirm the side window says it could not identify the response's three-dot menu; it must not claim Branch is unavailable or send a text-only substitute. A menu that cannot open and an open menu without a recognized Branch action should have different error messages.
- Confirm the original chat receives no draft or message. Restore the selectors and retry; confirm only one native branch and one question are created.
- Confirm oversized highlights/questions show a size warning rather than being silently cut off.
- Block popups for `chatgpt.com`; confirm Workflow Toolkit reports the block and the original chat remains untouched.

## Performance

- Open a conversation with many turns and stream a long response.
- Confirm Workflow Toolkit adds one response action per assistant turn, does not add duplicate buttons after rerenders, and does not noticeably affect input or scrolling.
- Leave the tab open for several minutes and confirm there is no recurring CPU usage from Workflow Toolkit when the DOM is idle.

## Desktop browser compatibility

- On Windows Chrome or Edge with the userscript installed, allow popups for ChatGPT and run the side-question flow. Confirm the popup opens, branches, and sends without changing the original chat.
- Repeat with **New tab** selected and with popups blocked; confirm tab mode works and blocked popups produce a clear notice without sending in the source chat.
- These are live checks; mocked screen/platform tests do not establish real Windows browser compatibility.
