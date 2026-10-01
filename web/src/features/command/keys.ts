// Keyboard helpers shared by the command layer, the palette and the terminal.

export const isMac = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

/** The platform's command key as the key cap word (`cmd` or `ctrl`). */
export const modKeyLabel = (): 'cmd' | 'ctrl' => (isMac() ? 'cmd' : 'ctrl');

/** The option key as the key cap word (`option` or `alt`). */
export const altKeyLabel = (): 'option' | 'alt' => (isMac() ? 'option' : 'alt');

/** True when a keystroke aimed at `t` would type text (so single-key shortcuts must stay out of the way). */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (t as HTMLInputElement).type;
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color', 'image'].includes(
      type,
    );
  }
  return false;
}

/** True for the platform's command modifier (Cmd on macOS, Ctrl elsewhere). */
export const hasMod = (e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey'>): boolean =>
  isMac() ? e.metaKey : e.ctrlKey;

/** True when no modifier at all is held (Shift is allowed only when `allowShift`). */
export const bare = (
  e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  allowShift = false,
): boolean => !e.metaKey && !e.ctrlKey && !e.altKey && (allowShift || !e.shiftKey);
