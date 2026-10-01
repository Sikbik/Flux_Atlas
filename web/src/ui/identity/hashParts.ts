// Splitting long identifiers for display. The DOM keeps the full value (so a drag selection copies
// the whole hash); CSS shows only head and tail.

export interface HashParts {
  head: string;
  /** The hidden middle (selectable, not visible). */
  mid: string;
  tail: string;
}

/**
 * Splits a value into head, hidden middle and tail. Returns null when the value is short enough to
 * show in full (`head + tail + 1` characters or fewer, the same rule as `middleTruncate`).
 */
export function splitHash(value: string, head = 6, tail = 5): HashParts | null {
  if (value.length <= head + tail + 1) return null;
  return {
    head: value.slice(0, head),
    mid: value.slice(head, value.length - tail),
    tail: value.slice(value.length - tail),
  };
}

/** Splits a formatted decimal into the significant part and its trailing zeros: `9.00000000` -> `9.00` + `000000`. */
export function splitTrailingZeros(text: string, keepDecimals = 2): { main: string; dim: string } {
  const dot = text.indexOf('.');
  if (dot < 0) return { main: text, dim: '' };
  let end = text.length;
  while (end > dot + 1 + keepDecimals && text[end - 1] === '0') end--;
  return { main: text.slice(0, end), dim: text.slice(end) };
}
