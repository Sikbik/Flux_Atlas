// The rich list's movers as the landing and the rich list page show them: who gained and who lost the most
// balance over a window, who entered or left the ranking, and how the top-ten share has drifted. The server saves one
// snapshot of the ranking a day; with fewer than two there is nothing to compare, and that state is a designed one
// (tracking), never an empty list. Pure.

import type { RichConcentration } from '../../../../api/generated/RichConcentration';
import type { RichEntered } from '../../../../api/generated/RichEntered';
import type { RichLeft } from '../../../../api/generated/RichLeft';
import type { RichMove } from '../../../../api/generated/RichMove';
import type { RichMoversDto } from '../../../../api/generated/RichMoversDto';
import type { RichMoversWindow } from '../../../../api/generated/RichMoversWindow';
import { fluxToNumber, formatCompact } from '../../../../lib/format';
import { type KnownEntity, knownEntity } from '../../lib/entities';
import { DAY_MS } from './daily';

export interface MoverWindowOption {
  id: RichMoversWindow;
  label: string;
  /** "a day", "a week", "a month": for sentences. */
  phrase: string;
  ms: number;
}

export const MOVER_WINDOWS: readonly MoverWindowOption[] = [
  { id: '1d', label: '1D', phrase: 'a day', ms: DAY_MS },
  { id: '7d', label: '7D', phrase: 'a week', ms: 7 * DAY_MS },
  { id: '30d', label: '30D', phrase: 'a month', ms: 30 * DAY_MS },
];

export const windowOption = (w: string): MoverWindowOption =>
  MOVER_WINDOWS.find((o) => o.id === w) ?? (MOVER_WINDOWS[1] as MoverWindowOption);

// ---- rank shifts ------------------------------------------------------------------------------------------------

export type RankShift =
  | { kind: 'up' | 'down'; places: number }
  | { kind: 'same' }
  | { kind: 'new' }
  | { kind: 'gone' };

/** How an address moved on the ranking. A lower rank number is a higher place. */
export function rankShift(rank: number | null, prevRank: number | null): RankShift | null {
  if (rank === null && prevRank === null) return null;
  if (rank === null) return { kind: 'gone' };
  if (prevRank === null) return { kind: 'new' };
  if (rank === prevRank) return { kind: 'same' };
  return rank < prevRank
    ? { kind: 'up', places: prevRank - rank }
    : { kind: 'down', places: rank - prevRank };
}

/** "up 5 places", "down 1 place", "unchanged", "entered the list", "left the list". */
export function shiftText(s: RankShift | null): string {
  if (!s) return '';
  switch (s.kind) {
    case 'up':
    case 'down':
      return `${s.kind} ${s.places} ${s.places === 1 ? 'place' : 'places'}`;
    case 'same':
      return 'same rank';
    case 'new':
      return 'entered the list';
    case 'gone':
      return 'left the list';
  }
}

// ---- rows -------------------------------------------------------------------------------------------------------

export interface MoverRow {
  address: string;
  rank: number | null;
  prevRank: number | null;
  /** Balance now, FLUX (approximate: for scaling and compact text only). */
  flux: number;
  /** Balance change over the window, FLUX, signed. */
  deltaFlux: number;
  /** The change as a percent of the balance before, when there was one. */
  deltaPct: number | null;
  nodes: number;
  entity: KnownEntity | null;
  shift: RankShift | null;
}

function moverRow(m: RichMove): MoverRow | null {
  const now = fluxToNumber(m.balance);
  const before = fluxToNumber(m.prev_balance);
  const delta = fluxToNumber(m.delta) ?? (now !== null && before !== null ? now - before : null);
  if (now === null || delta === null) return null;
  return {
    address: m.address,
    rank: m.rank,
    prevRank: m.prev_rank,
    flux: now,
    deltaFlux: delta,
    deltaPct: before !== null && before > 0 ? (delta / before) * 100 : null,
    nodes: m.node_count,
    entity: knownEntity(m.address),
    shift: rankShift(m.rank, m.prev_rank),
  };
}

/** The `n` largest gains, then the `n` largest losses, whatever order the server sent them in. */
export function pickMovers(dto: Pick<RichMoversDto, 'gainers' | 'losers'>, n: number) {
  const rows = (list: readonly RichMove[]) => list.map(moverRow).filter((r): r is MoverRow => r !== null);
  const gainers = rows(dto.gainers)
    .filter((r) => r.deltaFlux > 0)
    .sort((a, b) => b.deltaFlux - a.deltaFlux)
    .slice(0, n);
  const losers = rows(dto.losers)
    .filter((r) => r.deltaFlux < 0)
    .sort((a, b) => a.deltaFlux - b.deltaFlux)
    .slice(0, n);
  return { gainers, losers };
}

export interface EnteredRow {
  address: string;
  rank: number;
  flux: number;
  nodes: number;
  entity: KnownEntity | null;
}

export interface LeftRow {
  address: string;
  prevRank: number;
  prevFlux: number;
  entity: KnownEntity | null;
}

const enteredRow = (e: RichEntered): EnteredRow | null => {
  const flux = fluxToNumber(e.balance);
  return flux === null
    ? null
    : { address: e.address, rank: e.rank, flux, nodes: e.node_count, entity: knownEntity(e.address) };
};

const leftRow = (e: RichLeft): LeftRow | null => {
  const prevFlux = fluxToNumber(e.prev_balance);
  return prevFlux === null
    ? null
    : { address: e.address, prevRank: e.prev_rank, prevFlux, entity: knownEntity(e.address) };
};

// ---- the concentration trend -----------------------------------------------------------------------------------

export type ConcentrationKey = 'top10_pct' | 'top100_pct' | 'top1000_pct';

export interface ConcentrationTrend {
  /** Percent of the supply, oldest first. */
  values: number[];
  /** Unix ms of each day. */
  days: number[];
  first: number;
  last: number;
  /** Percentage points, `last - first`. */
  change: number;
  fromMs: number;
  toMs: number;
}

/** The share held by the largest 10 (or 100, or 1,000) addresses day by day; null with fewer than two days. */
export function concentrationTrend(
  points: readonly RichConcentration[] | undefined,
  key: ConcentrationKey = 'top10_pct',
): ConcentrationTrend | null {
  const ok = (points ?? [])
    .filter((p) => Number.isFinite(p[key]) && Number.isFinite(p.day_ms))
    .sort((a, b) => a.day_ms - b.day_ms);
  const a = ok[0];
  const b = ok[ok.length - 1];
  if (!a || !b || ok.length < 2) return null;
  return {
    values: ok.map((p) => p[key]),
    days: ok.map((p) => p.day_ms),
    first: a[key],
    last: b[key],
    change: b[key] - a[key],
    fromMs: a.day_ms,
    toMs: b.day_ms,
  };
}

/** "up 0.3 points" / "down 1.2 points" / "unchanged". */
export function trendText(change: number): string {
  const r = Math.round(Math.abs(change) * 10) / 10;
  if (r === 0) return 'unchanged';
  return `${change > 0 ? 'up' : 'down'} ${r.toFixed(1)} ${r === 1 ? 'point' : 'points'}`;
}

// ---- the view ---------------------------------------------------------------------------------------------------

export type MoversView =
  | {
      /** Fewer than two snapshots: nothing to compare yet. */
      state: 'tracking';
      snapshots: number;
      trend: null;
    }
  | {
      state: 'ready';
      window: RichMoversWindow;
      fromMs: number;
      toMs: number;
      /** The days the comparison really spans. */
      spanDays: number;
      /** The server has less history than the window asks for. */
      partial: boolean;
      gainers: MoverRow[];
      losers: MoverRow[];
      entered: EnteredRow[];
      left: LeftRow[];
      /** Nothing at all moved. */
      quiet: boolean;
      trend: ConcentrationTrend | null;
    };

/** Shapes a movers answer for the screen: a tracking state, or the top few of each list. */
export function moversView(dto: RichMoversDto, topN = 3): MoversView {
  if (dto.snapshots < 2 || dto.from_ms === null) {
    return { state: 'tracking', snapshots: Math.max(0, dto.snapshots), trend: null };
  }
  const { gainers, losers } = pickMovers(dto, topN);
  const entered = dto.entered
    .map(enteredRow)
    .filter((r): r is EnteredRow => r !== null)
    .sort((a, b) => a.rank - b.rank);
  const left = dto.left
    .map(leftRow)
    .filter((r): r is LeftRow => r !== null)
    .sort((a, b) => a.prevRank - b.prevRank);
  const spanMs = Math.max(0, dto.to_ms - dto.from_ms);
  const asked = windowOption(dto.window).ms;
  return {
    state: 'ready',
    window: windowOption(dto.window).id,
    fromMs: dto.from_ms,
    toMs: dto.to_ms,
    spanDays: Math.max(1, Math.round(spanMs / DAY_MS)),
    partial: spanMs < asked * 0.8,
    gainers,
    losers,
    entered,
    left,
    quiet:
      dto.gainers.length === 0 &&
      dto.losers.length === 0 &&
      dto.entered.length === 0 &&
      dto.left.length === 0,
    trend: concentrationTrend(dto.concentration),
  };
}

/** What a tracking state says, in two parts: a title and the reason. */
export function trackingNote(snapshots: number): { title: string; body: string } {
  if (snapshots <= 0) {
    return {
      title: 'Movers have not started tracking',
      body: 'The server saves one picture of the ranking a day and compares them. Nothing is saved yet.',
    };
  }
  return {
    title: 'One snapshot saved so far',
    body: 'Movers compare two daily pictures of the ranking, so the first comparison appears about a day after the first picture.',
  };
}

/** A signed, compact FLUX change: `+1.2M`, `-340K`, `+850`. */
export function signedFlux(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0';
  return `${n > 0 ? '+' : '-'}${formatCompact(Math.abs(n))}`;
}
