// The operator leaderboard as rows the panel draws: one model per operator with every figure already turned into the
// words and shares the cells show. Pure.

import type { OperatorRow } from '../../../../api/generated/OperatorRow';
import type { OperatorsBy } from '../../../../api/generated/OperatorsBy';
import type { OperatorsDto } from '../../../../api/generated/OperatorsDto';
import { fluxToNumber, formatInt, shortAddress } from '../../../../lib/format';
import { shareText } from '../../../analytics/lib/concentration';
import { earnedOrNull } from '../../../earnings/basis';
import { isWalletAddress } from '../../../wallet/lib/address';
import { shortOrg } from './distributions';
import { TIER_KEYS, TIER_NAME, type TierKey } from './tiers';

/** Operators shown before "Show all". */
export const OPERATORS_SHOWN = 10;

/** Where a leaderboard column drops out: `compact` in a medium list, `narrow` too on a phone. */
export type ColumnHide = 'compact' | 'narrow';

/** A column of the leaderboard as far as its tracks are concerned: its width, and a narrower one for the tighter steps. */
export interface ColumnTrack {
  width: string;
  /** The width in the medium step (the providers gone). */
  mid?: string;
  /** The width in the narrowest step of a table (the countries gone as well). */
  low?: string;
  hide?: ColumnHide;
}

/**
 * The grid tracks of one row of the leaderboard when the columns marked in `hidden` are not shown: the rank, the name,
 * the columns that remain and the link at the end. They are the library's own tracks (see Leaderboard) with the
 * hidden columns taken out, so the cells that remain still line up with the header; a column may take a narrower width
 * in a tighter step, to leave the name room.
 */
export function listTracks(columns: readonly ColumnTrack[], hidden: readonly ColumnHide[] = []): string {
  const step = hidden.includes('narrow') ? 'low' : hidden.includes('compact') ? 'mid' : 'width';
  return [
    '2.25rem',
    'minmax(0, 1.5fr)',
    ...columns
      .filter((c) => !c.hide || !hidden.includes(c.hide))
      .map((c) =>
        step === 'low' ? (c.low ?? c.mid ?? c.width) : step === 'mid' ? (c.mid ?? c.width) : c.width,
      ),
    'auto',
  ].join(' ');
}

/** The section's id: `/nodes#operators` scrolls to it, and the tile under the hero does the same without leaving. */
export const OPERATORS_ID = 'operators';

export interface TierMixPart {
  tier: TierKey;
  count: number;
  /** 0..1 of the operator's nodes. */
  share: number;
}

export type ProblemKind = 'dos' | 'at-risk' | 'unreachable';

export interface Problem {
  kind: ProblemKind;
  count: number;
  /** In words, for a hover and a screen reader: `2 on the DoS list`. */
  text: string;
  /** As short as the row can show it: `2 DoS`; the other kinds read the same as `text`. */
  short: string;
}

/** The place or provider that holds most of an operator's nodes, and how much of the operator that is. */
export interface PlaceLeader {
  /** The name as the row shows it (a provider's registered name cut to the words that name it). */
  name: string;
  /** The name in full, for a hover title. */
  full: string;
  /** `43%`. */
  pct: string;
}

export interface OperatorView {
  /** The ZelID or payment address the operator is keyed by (what the operator window opens). */
  key: string;
  rank: number;
  /** The key shortened for a row. */
  name: string;
  /** Set for a `by ZelID` row whose nodes report no ZelID, so the operator is a payment address: `no ZelID`. */
  grouping: string | null;
  /** `since Mar 2023`, from the earliest node. */
  since: string | null;
  nodes: number;
  share: number;
  shareText: string;
  tiers: TierMixPart[];
  /** The tier mix in words, for the strip a screen reader cannot see. */
  tiersText: string;
  countries: number;
  topCountry: PlaceLeader | null;
  providers: number;
  topProvider: PlaceLeader | null;
  /**
   * The run rate: FLUX a day at today's queue lengths, an estimate, on the viewer's basis (main chain, plus the
   * parallel assets it accrues when they count).
   */
  perDay: number | null;
  perDayText: string;
  /** The run rate's two parts, whatever the basis. */
  nativePerDay: number | null;
  paPerDay: number | null;
  /** 0..1 of the operator's confirmed and DoS-listed nodes that are healthy. */
  healthy: number;
  healthText: string;
  problems: Problem[];
  /** A `t1` or `t3` payment address the wallet window can open (the one most of the nodes are paid to). */
  walletAddress: string | null;
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** `since Mar 2023`; null when no node says when it began. */
export function sinceText(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return null;
  return `since ${MONTH.format(new Date(ms))}`;
}

/** FLUX a day without false precision: whole numbers from 10 up, a decimal below, `<0.1` for a sliver. */
export function perDayText(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return 'Unknown';
  if (n <= 0) return '0';
  if (n < 0.1) return '<0.1';
  const tenths = Math.round(n * 10) / 10;
  return tenths >= 10 ? formatInt(Math.round(n)) : tenths.toFixed(1);
}

/** `99.5%`; a share just short of all is never rounded up to `100%`. */
export function healthText(fraction: number): string {
  if (!Number.isFinite(fraction)) return 'Unknown';
  if (fraction >= 1) return '100%';
  return `${(Math.floor(Math.max(0, fraction) * 1000) / 10).toFixed(1)}%`;
}

function problems(r: Pick<OperatorRow, 'dos' | 'at_risk' | 'unreachable'>): Problem[] {
  const out: Problem[] = [];
  if (r.dos > 0)
    out.push({
      kind: 'dos',
      count: r.dos,
      text: `${formatInt(r.dos)} on the DoS list`,
      short: `${formatInt(r.dos)} DoS`,
    });
  if (r.at_risk > 0) {
    const text = `${formatInt(r.at_risk)} at risk`;
    out.push({ kind: 'at-risk', count: r.at_risk, text, short: text });
  }
  if (r.unreachable > 0) {
    const text = `${formatInt(r.unreachable)} unreachable`;
    out.push({ kind: 'unreachable', count: r.unreachable, text, short: text });
  }
  return out;
}

/** `212 Cumulus, 176 Nimbus, 48 Stratus` (a tier the operator has none of is left out). */
export function tiersText(tiers: readonly TierMixPart[]): string {
  const parts = tiers.filter((t) => t.count > 0).map((t) => `${formatInt(t.count)} ${TIER_NAME[t.tier]}`);
  return parts.length === 0 ? 'No nodes' : parts.join(', ');
}

/** Finland and `43%`: the operator's biggest place or provider, and how much of the operator it holds. */
function leader(
  name: string | null | undefined,
  nodes: number,
  of: number,
  short: (name: string) => string = (n) => n,
): PlaceLeader | null {
  if (!name) return null;
  return { name: short(name), full: name, pct: of > 0 ? `${Math.round((nodes / of) * 100)}%` : '' };
}

export function operatorView(r: OperatorRow, by: OperatorsBy, includePa = true): OperatorView {
  const tiers: TierMixPart[] = TIER_KEYS.map((tier) => ({
    tier,
    count: r.tiers[tier],
    share: r.nodes > 0 ? r.tiers[tier] / r.nodes : 0,
  }));
  const nativePerDay = fluxToNumber(r.native_per_day);
  const paPerDay = fluxToNumber(r.pa_per_day);
  const perDay = earnedOrNull(nativePerDay, paPerDay, includePa);
  return {
    key: r.key,
    rank: r.rank,
    name: shortAddress(r.key),
    grouping: by === 'zelid' && r.key_kind === 'address' ? 'no ZelID' : null,
    since: sinceText(r.first_active_ms),
    nodes: r.nodes,
    share: r.share,
    shareText: shareText(r.share),
    tiers,
    tiersText: tiersText(tiers),
    countries: r.countries,
    topCountry: leader(r.top_country?.name, r.top_country?.nodes ?? 0, r.nodes),
    providers: r.providers,
    topProvider: leader(r.top_provider?.label, r.top_provider?.nodes ?? 0, r.nodes, shortOrg),
    perDay,
    perDayText: perDayText(perDay),
    nativePerDay,
    paPerDay,
    healthy: r.healthy_pct,
    healthText: healthText(r.healthy_pct),
    problems: problems(r),
    walletAddress: isWalletAddress(r.top_address) ? r.top_address : null,
  };
}

/** The leaderboard's rows, in the server's rank order, with the run rate on the viewer's basis. */
export function operatorViews(dto: OperatorsDto | undefined, includePa = true): OperatorView[] {
  return dto ? dto.operators.map((r) => operatorView(r, dto.by, includePa)) : [];
}

/** The first `shown` rows, or all of them when `expanded`. */
export function visibleOperators<T>(rows: readonly T[], expanded: boolean, shown = OPERATORS_SHOWN): T[] {
  return expanded ? [...rows] : rows.slice(0, shown);
}

/** `1,205 operators run 6,848 nodes`. */
export function operatorsAside(dto: Pick<OperatorsDto, 'total_operators' | 'total_nodes'>): string {
  const ops = dto.total_operators;
  const nodes = dto.total_nodes;
  return `${formatInt(ops)} ${ops === 1 ? 'operator runs' : 'operators run'} ${formatInt(nodes)} ${nodes === 1 ? 'node' : 'nodes'}`;
}

/** What an operator is, by the grouping asked for. */
export const BY_LABEL: Record<OperatorsBy, string> = {
  zelid: 'ZelID',
  address: 'Payment address',
};
