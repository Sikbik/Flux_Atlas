// A tiny module-level bridge between the hotkeys (CommandLayer) and the palette host: the host registers
// how to close the palette (it knows whether the palette pushed its own history entry), and the hotkey
// says whether a key press opened it (and from then on keeps what is typed until the field exists, see
// typeAhead.ts). No React state: both sides are plain function calls.

import { startTypeAhead } from './typeAhead';

let closer: (() => void) | null = null;
let openedByKey = false;

export function registerPaletteCloser(fn: (() => void) | null): void {
  closer = fn;
}

/** Closes the palette the way the host would (history aware). False when no host is registered. */
export function closePaletteViaHost(): boolean {
  if (!closer) return false;
  closer();
  return true;
}

/** The next open came from the keyboard: keys typed before the field exists are kept for it. */
export function markOpenedByKey(): void {
  openedByKey = true;
  startTypeAhead();
}

/** Reads and clears how the palette was opened. */
export function takeOpenVia(): 'key' | 'url' {
  const v = openedByKey ? 'key' : 'url';
  openedByKey = false;
  return v;
}
