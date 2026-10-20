/**
 * Timeline gestures call preventDefault() on pointerdown (to avoid text selection), which also stops
 * the browser from moving focus. Blur any focused text field so keyboard shortcuts reach the app
 * instead of being typed into the field the user was just editing.
 */
export function blurTextFields() {
  const el = document.activeElement;
  if (el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) el.blur();
}
