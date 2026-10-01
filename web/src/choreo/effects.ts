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

/**
 * Which part of the Flux moon a flare lights. The symbol's four pieces are the four coinbase outputs:
 * the slanted bar is output 0 (the dev fund), the small hexagon Cumulus, the big hexagon Nimbus and the
 * cap Stratus (design 7.10.1). `all` is the moon receiving the block.
 */
export type MoonPiece = 'all' | 'bar' | 'smallHex' | 'bigHex' | 'cap';

/** The piece a payout beam leaves from. */
export type PayoutPiece = 'smallHex' | 'bigHex' | 'cap';

/** The coinbase outputs in the order every PoN coinbase lists them (output 0 to 3). */
export type CoinbaseOutput = 'dev' | 'cumulus' | 'nimbus' | 'stratus';

/**
 * The one constant that orders the relay (design 6.4 I): the moon fires its four outputs in coinbase
 * order, the dev fund first, then Cumulus, Nimbus and Stratus, `RELAY_MS.gap` apart. Flashes, beams,
 * chips and payout landings all derive from it.
 */
export const DOWNLINK_ORDER = [
  'dev',
  'cumulus',
  'nimbus',
  'stratus',
] as const satisfies readonly CoinbaseOutput[];

/** The moon piece for each coinbase output. */
export const PIECE_OF: {
  readonly dev: 'bar';
  readonly cumulus: 'smallHex';
  readonly nimbus: 'bigHex';
  readonly stratus: 'cap';
} = {
  dev: 'bar',
  cumulus: 'smallHex',
  nimbus: 'bigHex',
  stratus: 'cap',
};

/**
 * The relay's timeline in ms after the Beat (design 6.4 I), shared by the web choreographer and the
 * globe engine. Full motion: uplink leaves at 60 and flies 720 (the moon receives at 780); the first
 * output fires at 890 and the rest follow 130 ms apart (890, 1020, 1150, 1280); each piece flashes 60 ms
 * before its output leaves; the dev-fund chip leaves 60 ms after the bar's turn; a beam flies 900 ms and
 * lands 40 ms early (payouts at 1880, 2010, 2140); the next payees are aimed at 2600; everything has
 * faded by 2780. Reduced motion: uplink 380 ms (receive at 440), every downlink at 480, landed at 860.
 * A second block inside 3 s plays the compact version (uplink 300, downlinks 600, 60 ms apart).
 */
export const RELAY_MS = {
  up: 60,
  upDur: 720,
  recv: 780,
  fire: 890,
  gap: 130,
  downDur: 900,
  flashLead: 60,
  fundAfter: 60,
  landEarly: 40,
  aim: 2_600,
  end: 2_780,
  pieceFlashDur: 340,
  recvFlashDur: 900,
  reducedUpDur: 380,
  reducedRecv: 440,
  reducedFire: 480,
  reducedLand: 860,
  compactWindow: 3_000,
  compactUpDur: 300,
  compactDownDur: 600,
  compactGap: 60,
  compactRecvToFire: 40,
} as const;

/**
 * The moon accepts the block. Without `piece` (or with `all`) all four pieces flash, two rings leave the
 * moon and a bead is left on its chain; with a piece only that piece flashes (340 ms), just before its
 * output leaves.
 */
export interface MoonFlareCmd {
  height: number;
  durationMs: number;
  compact: boolean;
  piece?: MoonPiece;
}

/** Beam from the moon down to one payee, in coinbase order (Cumulus, Nimbus, Stratus). */
export interface DownlinkCmd {
  height: number;
  to: number | null;
  tier: Tier;
  /** The moon piece the beam leaves from (small hexagon Cumulus, big hexagon Nimbus, cap Stratus). */
  piece: PayoutPiece;
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
  /** The chip leaves the slanted bar (output 0). */
  piece: 'bar';
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
  /** `amount` (FLUX) is an optional extension for a label at the reticle. */
  payees: { tier: Tier; node: number | null; amount?: number }[];
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
