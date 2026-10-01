// The one hidden thing in the palette: type "gm" and it finds a row that makes the moon say it back
// (achievement 24). The moon's four pieces flash in turn, bar first, a wave across it. It is not a block
// landing: no bead is left on the chain and no ring leaves, so nothing on the globe claims a block that
// did not happen. Pure data and a timed call on the effect sink, so it can be tested without a globe.

import type { EffectSink, MoonPiece } from '../../../choreo/effects';
import type { PaletteRow } from './types';

/** The action id `run.ts` knows the row by. */
export const GM_ACTION = 'egg.gm';

/** Whether the typed text is the greeting (case and spacing do not matter). */
export function isGm(text: string): boolean {
  return text.trim().toLowerCase() === 'gm';
}

/** The row: first in the list, said plainly, never saved under Recent. */
export function gmRow(): PaletteRow {
  return {
    id: 'egg:gm',
    group: 'commands',
    kind: 'egg',
    icon: 'egg',
    title: 'gm',
    sub: 'The moon says it back',
    chip: 'Hello',
    score: 100,
    action: { type: 'run', id: GM_ACTION },
  };
}

/** The pieces in the order a coinbase lists them: the dev fund bar, then Cumulus, Nimbus and Stratus. */
export const GM_PIECES: readonly MoonPiece[] = ['bar', 'smallHex', 'bigHex', 'cap'];
/** Time between one piece and the next. */
export const GM_STEP_MS = 120;
/** A beat for the palette to leave before the moon is looked at. */
export const GM_LEAD_MS = 260;
const FLASH_MS = 340;

type Later = (fn: () => void, ms: number) => unknown;

/**
 * Flashes the moon's pieces in turn. Under reduced motion it is one flash (the cap, the biggest piece);
 * with motion off it is nothing, and the achievement is still the visitor's.
 */
export function playGm(
  effects: Pick<EffectSink, 'moonFlare'> | undefined,
  height: number,
  motion: 'full' | 'reduced' | 'off',
  later: Later = (fn, ms) => setTimeout(fn, ms),
): void {
  if (!effects || motion === 'off') return;
  const pieces: readonly MoonPiece[] = motion === 'reduced' ? ['cap'] : GM_PIECES;
  pieces.forEach((piece, i) => {
    later(
      () => effects.moonFlare({ height, durationMs: FLASH_MS, compact: true, piece }),
      GM_LEAD_MS + i * GM_STEP_MS,
    );
  });
}
