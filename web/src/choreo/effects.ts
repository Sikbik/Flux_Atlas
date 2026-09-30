// The effect vocabulary between the choreographer and whatever draws it. The globe engine
// implements `EffectSink` (web/src/globe, later); the /dev/live inspector and tests use the
// recording sink. Every command corresponds to something that really happened on the network.
//
// Commands are imperative and fire at the moment the effect should start; durations are hints the
// renderer may scale. The renderer owns its own concurrency budgets (arcs, pulses); the
// choreographer owns timing, rate budgets, coalescing and priority.

import type { Tier } from '../api/generated/Tier';

/** P0 the Beat, P1 mine (selected, watched, owned), P2 network events, P3 ambient texture. */
export type Priority = 0 | 1 | 2 | 3;

export type Motion = 'full' | 'reduced' | 'off';

/** t = 0 of a block landing: producer flare, pillar and shockwave; the UI's beat ring pings. */
export interface BeatCmd {
  height: number;
  producer: number | null;
  producerTier: Tier | null;
  /** A second block inside the compact window: beams only, no shockwave. */
  compact: boolean;
  /** Reduced motion: a static ring flash at the producer, no shockwave. */
  reduced: boolean;
  /** The one-off reward-cut block (double shockwave, emission tint). */
  emission: boolean;
}

/** Beam from the producer up to the moon (the chain). */
export interface UplinkCmd {
  height: number;
  from: number | null;
  durationMs: number;
}

/** The moon's pieces flash as it accepts the block (the coinbase's outputs). */
export interface MoonFlareCmd {
  height: number;
  durationMs: number;
  compact: boolean;
}

/** Beam from the moon down to one payee, in tier order (Stratus, Nimbus, Cumulus). */
export interface DownlinkCmd {
  height: number;
  to: number | null;
  tier: Tier;
  /** FLUX, 8-decimal string. */
  amount: string;
  durationMs: number;
  /** 0-based launch order. */
  order: number;
  /** The payee is selected, watched or owned. */
  mine: boolean;
}

/** A payout arrived: payee pulse and amount chip; under reduced motion a static highlight. */
export interface PayoutLandedCmd {
  height: number;
  node: number | null;
  tier: Tier;
  amount: string;
  mine: boolean;
  /** Set under reduced motion: highlight the payee (marker and row) for this long instead of beams. */
  highlightMs: number | null;
}

/** The fourth coinbase output (0.5 FLUX plus fees) drifting off to the dev fund; no node. */
export interface DevFundCmd {
  height: number;
  amount: string;
}

/** A batch of heartbeat (confirm transaction) sparkles, sampled to the ambient budget. */
export interface HeartbeatsCmd {
  height: number | null;
  nodes: number[];
}

export type PulseKind =
  | 'joined'
  | 'left'
  | 'started'
  | 'confirmed'
  | 'status'
  | 'dos'
  | 'expired'
  | 'ip_changed'
  | 'located'
  | 'unreachable'
  | 'recovered'
  | 'installing'
  | 'instance_started'
  | 'instance_removed'
  | 'instance_updated';

/** A single-node effect (birth, implode, status flash, install arc, instance pop). */
export interface PulseCmd {
  node: number;
  kind: PulseKind;
  priority: Priority;
  tier: Tier | null;
}

/** Pre-aim reticles on the next block's payees. */
export interface AimCmd {
  height: number;
  payees: { tier: Tier; node: number | null }[];
  /** Expected time to the block, for the breathing tempo (last 5 s speed up). */
  etaMs: number;
  /** Payee nodes that are selected, watched or owned. */
  mine: number[];
}

export type AppPhase = 'pending' | 'confirmed' | 'expired' | 'upserted' | 'removed';

export interface AppCmd {
  app: string;
  phase: AppPhase;
  nodes: number[];
}

export interface LinksCmd {
  added: [number, number][];
  removed: [number, number][];
}

/** "+N more" for events coalesced out of a burst or dropped by a budget. Updates in place by `id`. */
export interface SummaryCmd {
  id: string;
  kind: string;
  count: number;
  /** True once the burst went quiet: the count is final. */
  final: boolean;
}

export interface ReorgCmd {
  forkHeight: number;
  fromHeight: number;
  toHeight: number;
  orphaned: number;
}

/** A short recap instead of replaying what played while nobody watched. */
export interface RecapCmd {
  reason: 'hidden' | 'catch_up';
  spanMs: number;
  blocks: number;
  lastHeight: number | null;
  events: number;
  byKind: Record<string, number>;
}

export interface EffectSink {
  beat(cmd: BeatCmd): void;
  uplink(cmd: UplinkCmd): void;
  moonFlare(cmd: MoonFlareCmd): void;
  downlink(cmd: DownlinkCmd): void;
  payoutLanded(cmd: PayoutLandedCmd): void;
  devFund(cmd: DevFundCmd): void;
  heartbeats(cmd: HeartbeatsCmd): void;
  pulse(cmd: PulseCmd): void;
  aim(cmd: AimCmd): void;
  clearAim(): void;
  app(cmd: AppCmd): void;
  links(cmd: LinksCmd): void;
  summary(cmd: SummaryCmd): void;
  reorg(cmd: ReorgCmd): void;
  recap(cmd: RecapCmd): void;
}

export type EffectName = keyof EffectSink;

export interface RecordedEffect {
  /** Monotonic record number (stable list key). */
  seq: number;
  /** Scheduler time when the command fired. */
  at: number;
  name: EffectName;
  cmd: unknown;
}

const NAMES: EffectName[] = [
  'beat',
  'uplink',
  'moonFlare',
  'downlink',
  'payoutLanded',
  'devFund',
  'heartbeats',
  'pulse',
  'aim',
  'clearAim',
  'app',
  'links',
  'summary',
  'reorg',
  'recap',
];

/** A sink that ignores everything. */
export const nullSink: EffectSink = Object.fromEntries(
  NAMES.map((n) => [n, () => {}]),
) as unknown as EffectSink;

/**
 * A sink that records commands (tests and the /dev/live inspector), optionally forwarding to
 * another sink.
 */
export function recordingSink(
  now: () => number,
  opts: { capacity?: number; forward?: EffectSink } = {},
): EffectSink & { log: RecordedEffect[]; counts: Record<string, number>; clear(): void } {
  const cap = opts.capacity ?? 500;
  const log: RecordedEffect[] = [];
  let seq = 0;
  const counts: Record<string, number> = {};
  const sink = { log, counts, clear: () => (log.length = 0) } as unknown as EffectSink & {
    log: RecordedEffect[];
    counts: Record<string, number>;
    clear(): void;
  };
  for (const name of NAMES) {
    (sink as unknown as Record<string, (cmd?: unknown) => void>)[name] = (cmd?: unknown) => {
      log.push({ seq: ++seq, at: now(), name, cmd });
      if (log.length > cap) log.shift();
      counts[name] = (counts[name] ?? 0) + 1;
      const f = opts.forward as unknown as Record<string, (c?: unknown) => void> | undefined;
      f?.[name]?.(cmd);
    };
  }
  return sink;
}
