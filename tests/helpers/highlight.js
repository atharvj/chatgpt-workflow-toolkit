'use strict';

// Exercise the selection UI instead of creating the removed footer controls.
module.exports = async function highlight(doc, node = doc.querySelector('[data-message-author-role="assistant"], [data-markdown-text-style="assistant-message"]'), suppliedRange = null) {
  const win = doc.defaultView;
  const range = suppliedRange || doc.createRange();
  if (!suppliedRange) range.selectNodeContents(node);
  range.getBoundingClientRect = () => ({ left: 50, top: 100, right: 240, bottom: 130, width: 190, height: 30 });
  const selection = win.getSelection();
  selection.removeAllRanges(); selection.addRange(range);
  node.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true }));
  await new Promise((resolve) => win.requestAnimationFrame(resolve));
  return doc.querySelector('#cgs-selection-pill');
};
