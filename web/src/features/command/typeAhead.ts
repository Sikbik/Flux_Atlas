// Type-ahead for the palette. The shortcut opens it through a router update and a render, and a fast typist
// is on the second letter by then: those keys would land on the page and be lost. From the shortcut until
// the palette's own field has the keyboard, this keeps the printable keys (and Backspace); the field takes
// them the moment it exists. Plain module state, like the bridge beside it: both sides are function calls.

/** How long a buffer may wait for a field to take it before it is dropped (an open that never happened). */
export const TYPE_AHEAD_MS = 1500;

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing'>;

/** The buffer after one key press, or null when the key is not text (a modifier, an arrow, Enter, a shortcut). */
export function applyKey(buffer: string, e: KeyLike): string | null {
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === 'Backspace') return buffer.slice(0, -1);
  return Array.from(e.key).length === 1 ? buffer + e.key : null;
}

let buffer = '';
let release: (() => void) | null = null;
let expire: ReturnType<typeof setTimeout> | null = null;

const inPalette = (t: EventTarget | null): boolean =>
  t instanceof Element && t.closest('.pal-layer') !== null;

function unlisten(): void {
  release?.();
  release = null;
}

function clear(): void {
  unlisten();
  if (expire !== null) clearTimeout(expire);
  expire = null;
  buffer = '';
}

/** Starts keeping keys (the palette is about to open). A second start begins again with nothing. */
export function startTypeAhead(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
): void {
  clear();
  const onKey = (e: KeyboardEvent) => {
    // The field has the keyboard now: its keys are its own, and the buffer waits for it to be taken.
    if (inPalette(e.target)) {
      unlisten();
      return;
    }
    if (e.key === 'Escape') {
      clear();
      return;
    }
    const next = applyKey(buffer, e);
    if (next === null) return;
    buffer = next;
    e.preventDefault();
    e.stopPropagation();
  };
  target.addEventListener('keydown', onKey as EventListener, true);
  release = () => target.removeEventListener('keydown', onKey as EventListener, true);
  expire = setTimeout(clear, TYPE_AHEAD_MS);
}

/** What was typed since the shortcut, once: the field that asks owns it, and nothing more is kept. */
export function drainTypeAhead(): string {
  const text = buffer;
  clear();
  return text;
}
