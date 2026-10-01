// A listed transaction's size is `null` when the server could not read it (never 0). Unknown stays
// unknown: it is labelled as such and left out of totals, which then read as "at least".

import { formatBytes } from '../../../lib/format';

/** The size for display: the bytes, or "Size unknown". */
export const txSizeText = (size: number | null): string =>
  size === null ? 'Size unknown' : formatBytes(size);

/** True when any of the sizes is unknown, so a total over the known ones is a floor. */
export function anyUnknownSize(sizes: Iterable<number | null>): boolean {
  for (const s of sizes) if (s === null) return true;
  return false;
}
