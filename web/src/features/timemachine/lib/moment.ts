// What the rest of the page is told about the moment on screen (the contract is features/chrome/archive.ts: the Beat
// and the status bar read it). The readings are the ones the archive chip speaks, so the two never disagree.

import type { ArchiveMoment } from '../../chrome/archive';
import { type Curve, readingAt } from './curve';
import type { ArchiveInfo } from './summary';

/**
 * The moment at the playhead `t`: the tip from the recorded history, and the node count as the chip says it (the
 * moment the globe shows once it has arrived, else the history's reading). A reading the recording does not hold
 * stays null; it is never a zero.
 */
export function momentAt(t: number, curve: Curve | null, info: ArchiveInfo | null): ArchiveMoment {
  const reading = curve ? readingAt(curve, t) : null;
  return { at: Math.round(t), tip: reading?.tip ?? null, nodes: info?.nodes ?? reading?.nodes ?? null };
}
