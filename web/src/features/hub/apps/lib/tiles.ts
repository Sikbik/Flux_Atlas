// The live line under each go-to tile of the hub. Each says one true thing, or nothing: a tile whose number is not
// known yet carries no caption instead of a zero. Pure.

import { formatInt } from '../../../../lib/format';
import type { RailRow } from './capacity';
import { fluxShort } from './economy';

/** App messages waiting for a block and installs under way, as the pending tile says them. */
export function pendingText(waiting: number, installing: number): string {
  if (waiting <= 0 && installing <= 0) return 'Nothing waiting';
  const parts: string[] = [];
  if (waiting > 0) parts.push(`${formatInt(waiting)} waiting`);
  if (installing > 0) parts.push(`${formatInt(installing)} installing`);
  return parts.join(', ');
}

/** The resource the apps lock the largest share of, as the capacity tile says it: `12.3% of CPU locked`. */
export function capacityTileText(rows: readonly RailRow[]): string | undefined {
  let best: RailRow | null = null;
  for (const r of rows) {
    if (r.share === null) continue;
    if (best === null || r.share > (best.share ?? 0)) best = r;
  }
  return best ? `${best.percent} of ${best.label} locked` : undefined;
}

/** `259K FLUX, 30 days`: what apps paid; nothing while the figure is not known. */
export function economyTileText(paid30d: number | null): string | undefined {
  return paid30d === null ? undefined : `${fluxShort(paid30d)} FLUX, 30 days`;
}

/** `1,396 owners`. */
export function ownersTileText(total: number | null): string | undefined {
  return total === null ? undefined : `${formatInt(total)} ${total === 1 ? 'owner' : 'owners'}`;
}

/** `82 countries`. */
export function countriesTileText(n: number | null): string | undefined {
  return n === null ? undefined : `${formatInt(n)} ${n === 1 ? 'country' : 'countries'}`;
}
