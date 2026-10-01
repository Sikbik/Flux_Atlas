// `moon replay`: plays the last block's relay on the globe again. It feeds the real choreographer a
// block message built from the block the store already holds, so the replay is the same code path, the
// same timing and the same effects as a live block (producer flare, uplink, the moon's four pieces in
// coinbase order, the payout beams). Nothing is applied to the store: this only re-performs.

import type { BlockMsg } from '../../../api/generated/BlockMsg';
import type { LiveMsg } from '../../../api/generated/LiveMsg';
import type { NodeRef } from '../../../api/generated/NodeRef';
import type { Tier } from '../../../api/generated/Tier';
import type { AtlasRuntime } from '../../../app/runtime';
import { effectiveMotion, useUi } from '../../../store/ui';
import { track } from '../../achievements/events';

const TIERS: readonly Tier[] = ['unknown', 'cumulus', 'nimbus', 'stratus'];

function refOf(runtime: AtlasRuntime, id: number | null): NodeRef | null {
  if (id === null) return null;
  const t = runtime.store.nodes;
  const row = t.indexOf(id);
  if (row < 0) return null;
  return {
    id,
    outpoint: '',
    tier: TIERS[t.tier[row] ?? 0] ?? 'unknown',
    endpoint: t.endpoint(row) || null,
    lat: null,
    lon: null,
    country_code: null,
  };
}

/** The message for a block the store holds, as the server would have sent it (without the child events). */
export function replayMessage(runtime: AtlasRuntime): LiveMsg | null {
  const b = runtime.store.blocks.newest();
  if (!b) return null;
  const body: BlockMsg = {
    height: b.height,
    hash: b.hash,
    prev_hash: '',
    time_ms: b.timeMs,
    size: b.size,
    tx_count: b.txCount,
    producer: refOf(runtime, b.producer),
    payouts: [...b.payouts],
    heartbeats: [],
    confirms: [],
    starts: [],
    updates: [],
    transfers_over_threshold: [],
    reward: b.reward,
    fees: b.fees,
    dev_fund: b.devFund ?? '0',
  };
  return { seq: 0, observed_ms: runtime.clock.now(), event_ms: null, t: 'block', ...body };
}

/** Replays the newest block's relay; false when there is no block or motion is off. */
export function replayLastBlock(runtime: AtlasRuntime): boolean {
  if (effectiveMotion(useUi.getState().motion) === 'off') return false;
  const msg = replayMessage(runtime);
  if (!msg) return false;
  runtime.choreo.handle(msg);
  track({ type: 'moon', what: 'replay' });
  return true;
}
