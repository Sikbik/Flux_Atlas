// Type-to-find for menus and listboxes: keys typed in quick succession build one prefix, which
// `typeaheadIndex` (ui/internal/keys) then looks up. Pure, so the buffer rules are unit tested.

export interface TypeaheadState {
  /** The prefix typed so far (lower case). */
  buffer: string;
  /** Time of the last key, in ms. */
  at: number;
}

/** How long a pause ends the current prefix. */
export const TYPEAHEAD_RESET_MS = 600;

/**
 * True for a key that types one printable character (`a`, `7`, `-`, and Space) and is not a shortcut.
 * Callers treat Space as activation unless a prefix is already in progress.
 */
export function isTypeaheadKey(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean {
  return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
}

/** The buffer after `key` is typed at `now`: appended within the reset window, started over after it. */
export function nextTypeahead(
  prev: TypeaheadState,
  key: string,
  now: number,
  resetMs: number = TYPEAHEAD_RESET_MS,
): TypeaheadState {
  const fresh = now - prev.at > resetMs;
  return { buffer: `${fresh ? '' : prev.buffer}${key.toLowerCase()}`, at: now };
}

/** True while a prefix is in progress at `now` (so Space is a character, not an activation). */
export function typeaheadActive(
  state: TypeaheadState,
  now: number,
  resetMs: number = TYPEAHEAD_RESET_MS,
): boolean {
  return state.buffer !== '' && now - state.at <= resetMs;
}
