// `moon replay`: plays the last block's relay on the globe again. It feeds the real choreographer a
// block message built from the block the store already holds, so the replay is the same code path, the
// same timing and the same effects as a live block (producer flare, uplink, the moon's four pieces in
// coinbase order, the payout beams). Nothing is applied to the store: this only re-performs.
//
// The message is typed against the generated `BlockMsg`. Its fields split in two: the relay itself, which
// comes from the stored block, and the block's other child events (check-in ripples, joins, transfers,
// app payments, collateral spends). Those are separate stagings, not part of the relay, and replaying
// them would announce an app deploy or a node leaving a second time, so a replay carries none of them.
// `NoChildEvents` is derived from the generated type: when the backend adds a child event to `BlockMsg`,
// this file stops compiling until the new field is placed on one side or the other.

import type { BlockMsg } from '../../../api/generated/BlockMsg';
import type { LiveMsg } from '../../../api/generated/LiveMsg';
import type { NodeRef } from '../../../api/generated/NodeRef';
import type { Tier } from '../../../api/generated/Tier';
import type { AtlasRuntime } from '../../../app/runtime';
import { effectiveMotion, useUi } from '../../../store/ui';
import { track } from '../../achievements/events';

/** The fields of a block message that make up the relay. */
type RelayFields =
  | 'height'
  | 'hash'
  | 'prev_hash'
  | 'time_ms'
  | 'size'
  | 'tx_count'
  | 'producer'
  | 'payouts'
  | 'reward'
  | 'fees'
  | 'dev_fund';

/** Every other field of a block message: its child events, each a list. */
type ChildEvents = Omit<BlockMsg, RelayFields>;
type NoChildEvents = { [K in keyof ChildEvents]: never[] };

/** A replay performs the relay only: no other child event of the block is staged again. */
function noChildEvents(): NoChildEvents {
  return {
    heartbeats: [],
    confirms: [],
    starts: [],
    updates: [],
    transfers_over_threshold: [],
    app_payments: [],
    collateral_spent: [],
  };
}

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

/** The message for a block the store holds, as the server would have sent it, minus the other child events. */
export function replayMessage(runtime: AtlasRuntime): LiveMsg | null {
  const blocks = runtime.store.blocks.toArray();
  const b = blocks[0];
  if (!b) return null;
  const parent = blocks.find((x) => x.height === b.height - 1);
  const body: BlockMsg = {
    height: b.height,
    hash: b.hash,
    prev_hash: parent?.hash ?? '',
    time_ms: b.timeMs,
    size: b.size,
    tx_count: b.txCount,
    producer: refOf(runtime, b.producer),
    payouts: [...b.payouts],
    reward: b.reward,
    fees: b.fees,
    dev_fund: b.devFund ?? '0',
    ...noChildEvents(),
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
