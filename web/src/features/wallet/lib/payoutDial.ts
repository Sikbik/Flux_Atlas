// The payout dial's geometry: where every node's next payment sits on a ring that reads from now (the top)
// clockwise to the horizon (the top again), and what each mark stands for. Pure functions over the wallet's
// payouts; the drawing is `viz/PayoutDial.tsx`.
//
// A node is one dot while the fleet is small. A tier with many payments inside the horizon becomes a radial
// histogram instead (one bar per slice of time), because two hundred dots on one track are a smear, not a
// picture. Either way a mark is an item with a time range, a count and a total, so one tooltip, one keyboard
// path and one data table describe both.

import { PAY_TIERS, type PayTier, type WalletPayout } from '../types';
import { flux } from './money';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const TAU = Math.PI * 2;

export type DialHorizon = '6h' | '24h' | '72h';

export const DIAL_HORIZONS: readonly DialHorizon[] = ['6h', '24h', '72h'];

export interface HorizonSpec {
  ms: number;
  /** The label on a segmented control. */
  label: string;
  /** A tick every `minor` ms, a labelled one every `major`. */
  minor: number;
  major: number;
  /** How the horizon reads in a sentence ("the next 24 hours"). */
  phrase: string;
}

export const HORIZON: Record<DialHorizon, HorizonSpec> = {
  '6h': { ms: 6 * HOUR, label: '6 h', minor: 30 * MIN, major: HOUR, phrase: 'the next 6 hours' },
  '24h': { ms: DAY, label: '24 h', minor: HOUR, major: 6 * HOUR, phrase: 'the next 24 hours' },
  '72h': { ms: 3 * DAY, label: '3 d', minor: 3 * HOUR, major: DAY, phrase: 'the next 3 days' },
};

/** A tier with at most this many payments inside the horizon is drawn as dots; beyond it, as bars. */
export const DOT_LIMIT = 36;
/** Slices of time around the ring when a tier is drawn as bars. */
export const BIN_COUNT = 96;
/** The most nodes an item names (a bar can hold hundreds). */
export const ITEM_NODES = 6;

// ---- angles and paths -----------------------------------------------------------------------------

/** The angle (radians, clockwise from the top) of a time `offsetMs` from now on a ring of `horizonMs`. */
export function angleFor(offsetMs: number, horizonMs: number): number {
  return (offsetMs / horizonMs) * TAU;
}

export interface Point {
  x: number;
  y: number;
}

/** A point on a circle: angle 0 is the top, and angles grow clockwise. */
export function polar(cx: number, cy: number, r: number, angle: number): Point {
  return { x: cx + r * Math.sin(angle), y: cy - r * Math.cos(angle) };
}

const n2 = (v: number) => Math.round(v * 100) / 100;
const pt = (p: Point) => `${n2(p.x)} ${n2(p.y)}`;

/** An annular sector from radius `r0` to `r1` between two angles (each under a half turn): a bar, or a hit area. */
export function sectorPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return [
    `M${pt(polar(cx, cy, r0, a0))}`,
    `A${n2(r0)} ${n2(r0)} 0 ${large} 1 ${pt(polar(cx, cy, r0, a1))}`,
    `L${pt(polar(cx, cy, r1, a1))}`,
    `A${n2(r1)} ${n2(r1)} 0 ${large} 0 ${pt(polar(cx, cy, r1, a0))}`,
    'Z',
  ].join('');
}

/** A circular arc as a stroke path (clockwise from `a0` to `a1`). */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const sweep = Math.min(a1 - a0, TAU - 1e-4);
  const large = sweep > Math.PI ? 1 : 0;
  return `M${pt(polar(cx, cy, r, a0))}A${n2(r)} ${n2(r)} 0 ${large} 1 ${pt(polar(cx, cy, r, a0 + sweep))}`;
}

export interface DialTick {
  angle: number;
  /** The offset from now this tick stands for, ms. */
  offsetMs: number;
  /** A tick with a label (`+6h`). */
  major: boolean;
  label: string | null;
}

/** `+30m`, `+6h`, `+2d`: how far from now a tick is. */
export function offsetLabel(offsetMs: number): string {
  if (offsetMs % DAY === 0) return `+${offsetMs / DAY}d`;
  if (offsetMs % HOUR === 0) return `+${offsetMs / HOUR}h`;
  return `+${Math.round(offsetMs / MIN)}m`;
}

/** The ticks of a horizon: a hairline every `minor`, a labelled one every `major`; the end is the start, so it has none. */
export function dialTicks(horizon: DialHorizon): DialTick[] {
  const h = HORIZON[horizon];
  const out: DialTick[] = [];
  for (let t = 0; t < h.ms; t += h.minor) {
    const major = t % h.major === 0;
    out.push({
      angle: angleFor(t, h.ms),
      offsetMs: t,
      major,
      label: major && t > 0 ? offsetLabel(t) : null,
    });
  }
  return out;
}

// ---- the model ------------------------------------------------------------------------------------

export interface DialPayout {
  /** The node's collateral outpoint. */
  key: string;
  tier: PayTier;
  etaMs: number;
  /** FLUX. */
  amount: number;
  height: number;
}

/** One mark on the dial: a dot (one node) or a bar (the nodes paid within one slice of time). */
export interface DialItem {
  kind: 'dot' | 'bin';
  /** Stable while the data holds: `stratus:12` for a bar, the node key for a dot. */
  id: string;
  tier: PayTier;
  /** The time range it stands for, offsets from now in ms. */
  from: number;
  to: number;
  /** Where it sits: the middle of its range, and the range's two ends. */
  angle: number;
  a0: number;
  a1: number;
  count: number;
  /** FLUX paid in total. */
  amount: number;
  /** The soonest nodes (at most `ITEM_NODES`). */
  nodes: DialPayout[];
}

export interface DialTrack {
  tier: PayTier;
  /** The track's radius in the model's units. */
  r: number;
  /** The longest a bar may grow from the track. */
  reach: number;
  mode: 'dots' | 'bars';
  /** Payments inside the horizon on this track. */
  within: number;
  /** The most any slice holds (the bar scale). */
  peak: number;
}

export interface DialGeometry {
  /** The side of the square drawing; the centre is half of it. */
  size: number;
  /** The horizon ring. */
  rim: number;
  /** The empty centre, where the readout sits. */
  hub: number;
}

export const GEOMETRY: DialGeometry = { size: 440, rim: 192, hub: 84 };

export interface DialModel {
  horizon: DialHorizon;
  geometry: DialGeometry;
  /** Inner to outer: Cumulus, Nimbus, Stratus (only the tiers the wallet has). */
  tracks: DialTrack[];
  items: DialItem[];
  /** The soonest payment, if any lies ahead. */
  next: DialPayout | null;
  /** Payments inside the horizon, and beyond it. */
  within: number;
  later: number;
  total: number;
  /** Soonest payment beyond the horizon, if any. */
  laterNext: DialPayout | null;
}

/** The tracks' radii: a lone tier sits mid-ring, three share the ring evenly (inner tiers first). */
export function trackRadii(count: number, g: DialGeometry = GEOMETRY): { r: number; reach: number }[] {
  const outer = g.rim - 10;
  const inner = g.hub + 18;
  if (count <= 0) return [];
  if (count === 1) {
    const r = Math.round(inner + (outer - inner) * 0.4);
    return [{ r, reach: outer - r }];
  }
  const step = (outer - inner - 26) / (count - 1);
  return Array.from({ length: count }, (_, i) => {
    const r = Math.round(inner + step * i);
    return { r, reach: i === count - 1 ? outer - r : Math.max(10, Math.min(34, step - 8)) };
  });
}

/** Maps payments to dial payouts: the tier must earn, the time must be known; soonest first. */
export function toDialPayouts(payouts: readonly WalletPayout[]): DialPayout[] {
  const out: DialPayout[] = [];
  for (const p of payouts) {
    if (p.tier === 'unknown') continue;
    out.push({ key: p.node_key, tier: p.tier, etaMs: p.eta_ms, amount: flux(p.amount), height: p.height });
  }
  return out.sort((a, b) => a.etaMs - b.etaMs);
}

/**
 * Lays the payments out for a horizon. `nowMs` is the dial's now: payments in the past (a block just landed
 * and the list has not refreshed) are not drawn. The model is a function of its inputs, so it is rebuilt once a
 * block, not once a second.
 */
export function buildDial(
  payouts: readonly DialPayout[],
  nowMs: number,
  horizon: DialHorizon,
  geometry: DialGeometry = GEOMETRY,
): DialModel {
  const span = HORIZON[horizon].ms;
  const present = PAY_TIERS.filter((t) => payouts.some((p) => p.tier === t));
  const radii = trackRadii(present.length, geometry);
  const ahead = payouts.filter((p) => p.etaMs >= nowMs);
  const inside = ahead.filter((p) => p.etaMs - nowMs < span);
  const beyond = ahead.filter((p) => p.etaMs - nowMs >= span);

  const tracks: DialTrack[] = [];
  const items: DialItem[] = [];
  present.forEach((tier, i) => {
    const geo = radii[i] as { r: number; reach: number };
    const mine = inside.filter((p) => p.tier === tier);
    const mode: DialTrack['mode'] = mine.length <= DOT_LIMIT ? 'dots' : 'bars';
    let peak = 0;
    if (mode === 'dots') {
      for (const p of mine) {
        const off = p.etaMs - nowMs;
        const a = angleFor(off, span);
        items.push({
          kind: 'dot',
          id: p.key,
          tier,
          from: off,
          to: off,
          angle: a,
          a0: a,
          a1: a,
          count: 1,
          amount: p.amount,
          nodes: [p],
        });
      }
    } else {
      const slice = span / BIN_COUNT;
      const bins = new Map<number, DialPayout[]>();
      for (const p of mine) {
        const b = Math.min(BIN_COUNT - 1, Math.floor((p.etaMs - nowMs) / slice));
        const list = bins.get(b);
        if (list) list.push(p);
        else bins.set(b, [p]);
      }
      for (const [b, list] of [...bins].sort((x, y) => x[0] - y[0])) {
        peak = Math.max(peak, list.length);
        const from = b * slice;
        items.push({
          kind: 'bin',
          id: `${tier}:${b}`,
          tier,
          from,
          to: from + slice,
          angle: angleFor(from + slice / 2, span),
          a0: angleFor(from, span),
          a1: angleFor(from + slice, span),
          count: list.length,
          amount: list.reduce((s, p) => s + p.amount, 0),
          nodes: list.slice(0, ITEM_NODES),
        });
      }
    }
    tracks.push({ tier, r: geo.r, reach: geo.reach, mode, within: mine.length, peak });
  });
  items.sort((a, b) => a.from - b.from || a.tier.localeCompare(b.tier));

  return {
    horizon,
    geometry,
    tracks,
    items,
    next: ahead[0] ?? null,
    within: inside.length,
    later: beyond.length,
    total: payouts.length,
    laterNext: beyond[0] ?? null,
  };
}

/** A bar's length for a count: at least a stub, at most the track's reach. */
export function barLength(count: number, track: Pick<DialTrack, 'reach' | 'peak'>): number {
  if (count <= 0 || track.peak <= 0) return 0;
  const min = Math.min(4, track.reach);
  return min + (track.reach - min) * Math.sqrt(count / track.peak);
}

// ---- reading it -----------------------------------------------------------------------------------

const two = (n: number) => String(n).padStart(2, '0');

/** `14:32`: a clock time in UTC. */
export function clockUtc(ms: number): string {
  const d = new Date(ms);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** How long, in words a screen reader can say: `2 hours 14 minutes`, `45 seconds`. */
export function spokenSpan(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3_600);
  const m = Math.floor((total % 3_600) / 60);
  const s = total % 60;
  const part = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (d >= 1) return h ? `${part(d, 'day')} ${part(h, 'hour')}` : part(d, 'day');
  if (h >= 1) return m ? `${part(h, 'hour')} ${part(m, 'minute')}` : part(h, 'hour');
  if (m >= 1) return s && m < 5 ? `${part(m, 'minute')} ${part(s, 'second')}` : part(m, 'minute');
  return part(s, 'second');
}

/** The plain-words summary of a dial, for the figure's label and a screen reader. */
export function dialSummary(m: DialModel, nowMs: number): string {
  if (m.total === 0) return 'No payments are queued for this wallet.';
  const spec = HORIZON[m.horizon];
  const head = m.next ? `Next payment in ${spokenSpan(m.next.etaMs - nowMs)}.` : 'No payment is due soon.';
  const tail = m.later > 0 ? ` ${m.later} more after ${spec.phrase.replace('the next ', '')}.` : '';
  return `${head} ${m.within} of ${m.total} nodes are paid within ${spec.phrase}.${tail}`;
}

/** What one mark stands for, as one sentence (the slider's value text and the tooltip's title). */
export function describeItem(item: DialItem): string {
  if (item.kind === 'dot') {
    const n = item.nodes[0] as DialPayout;
    return `${item.tier} node, ${n.amount.toFixed(2)} FLUX in ${spokenSpan(item.from)}`;
  }
  const what = item.count === 1 ? 'payment' : 'payments';
  return `${item.count} ${item.tier} ${what} in ${spokenSpan(item.from)} to ${spokenSpan(item.to)}, ${item.amount.toFixed(2)} FLUX`;
}
