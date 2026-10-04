// The rows of the two short lists of the hub, the newest apps and the ones about to expire, as text a row can show.
// The times are the server's estimates (block times counted back from the tip), so each is worded as one and the exact
// figure, the block, stands beside it. Pure.

import type { ExpiringApp } from '../../../../api/generated/ExpiringApp';
import type { NewestApp } from '../../../../api/generated/NewestApp';
import { formatInt } from '../../../../lib/format';
import { agoPhrase, blocksLeftText, estimateTitle, expiresSoon, inPhrase } from './time';

/** `12 running`, or `none running` (an app that has just been registered has no instance yet). */
export const runningText = (instances: number): string =>
  instances > 0 ? `${formatInt(instances)} running` : 'none running';

export interface NewRow {
  /** The app's key, which is what its window is opened with. */
  name: string;
  label: string;
  instances: number;
  running: string;
  /** `Registered about 3 hours ago`, or the block when the time is not known. */
  when: string;
  /** The estimate in full, for a tooltip; absent when there is none. */
  whenTitle: string | undefined;
}

export function newRows(list: readonly NewestApp[], nowMs: number): NewRow[] {
  return list.map((a) => {
    const known = a.time_ms !== null && Number.isFinite(a.time_ms);
    return {
      name: a.name,
      label: a.display_name || a.name,
      instances: a.instances,
      running: runningText(a.instances),
      when: known
        ? `Registered ${agoPhrase(a.time_ms as number, nowMs)}`
        : `Registered at block ${formatInt(a.height)}`,
      whenTitle: known ? `${estimateTitle(a.time_ms)}, block ${formatInt(a.height)}` : undefined,
    };
  });
}

export interface ExpiringRow {
  name: string;
  label: string;
  instances: number;
  running: string;
  /** `Expires in about 3 days`. */
  when: string;
  /** The exact figure: `86,400 blocks left`. */
  blocks: string;
  whenTitle: string | undefined;
  /** Within the hour by the estimate: the row says so with the status colour and an icon, not by colour alone. */
  soon: boolean;
}

export function expiringRows(list: readonly ExpiringApp[], nowMs: number): ExpiringRow[] {
  return list.map((a) => ({
    name: a.name,
    label: a.display_name || a.name,
    instances: a.instances,
    running: runningText(a.instances),
    when: `Expires ${inPhrase(a.expire_ms, nowMs)}`,
    blocks: blocksLeftText(a.blocks_left),
    whenTitle: `${estimateTitle(a.expire_ms)}, block ${formatInt(a.expire_height)}`,
    soon: expiresSoon(a.expire_ms, nowMs),
  }));
}
