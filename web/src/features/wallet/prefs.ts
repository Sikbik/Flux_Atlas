// What the wallet workspace remembers about its viewer: the currency money is shown in, what hosting a node
// costs them, whether parallel assets count as income, and how the fleet table is set up. Local to this browser
// (`localStorage`, key `atlas.wallet.v1`) and never sent anywhere: a hosting cost is the viewer's own business.
// Every read and write is guarded, so a private window or a full disk means preferences last for the session.

import { create } from 'zustand';
import { type EarningsRange, isEarningsRange } from './lib/earnings';
import { type ColumnId, DEFAULT_COLUMNS, type GroupBy, isGroupBy, normalizeColumns } from './lib/fleet';
import { DEFAULT_CURRENCY, isCurrency } from './lib/money';
import { DIAL_HORIZONS, type DialHorizon } from './lib/payoutDial';
import { type HostingCosts, NO_COSTS } from './lib/projection';
import { type CurrencyCode, PAY_TIERS, type PayTier } from './types';

export type Density = 'comfortable' | 'compact';

export const KEY = 'atlas.wallet.v1';

/** A cost field never takes a number past this: a typo of a few extra digits must not wreck every figure. */
export const MAX_COST = 1_000_000;

interface Persisted {
  currency: CurrencyCode;
  costs: HostingCosts;
  includePa: boolean;
  columns: ColumnId[];
  density: Density;
  groupBy: GroupBy;
  earningsRange: EarningsRange;
  horizon: DialHorizon;
}

export interface WalletPrefs extends Persisted {
  setCurrency(c: CurrencyCode): void;
  setCost(tier: PayTier, perMonth: number): void;
  /** Replaces the whole set of costs at once (they are always stored in one currency). */
  setCosts(costs: HostingCosts): void;
  clearCosts(): void;
  setIncludePa(on: boolean): void;
  setColumns(ids: readonly ColumnId[]): void;
  setDensity(d: Density): void;
  setGroupBy(g: GroupBy): void;
  setEarningsRange(r: EarningsRange): void;
  setHorizon(h: DialHorizon): void;
}

const DEFAULTS: Persisted = {
  currency: DEFAULT_CURRENCY,
  costs: NO_COSTS,
  includePa: true,
  columns: [...DEFAULT_COLUMNS],
  density: 'comfortable',
  groupBy: 'none',
  earningsRange: '30d',
  horizon: '24h',
};

const cost = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(MAX_COST, v) : 0;

/** Reads what was stored; anything missing or malformed falls back to its default, piece by piece. */
export function parsePrefs(raw: string | null | undefined): Persisted {
  const out: Persisted = { ...DEFAULTS, columns: [...DEFAULTS.columns], costs: structuredCopy(NO_COSTS) };
  if (!raw) return out;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (isCurrency(v.currency)) out.currency = v.currency;
    const c = v.costs as { currency?: unknown; perNode?: Record<string, unknown> } | undefined;
    if (c && typeof c === 'object' && c.perNode && typeof c.perNode === 'object') {
      out.costs = {
        currency: isCurrency(c.currency) ? c.currency : out.currency,
        perNode: {
          cumulus: cost(c.perNode.cumulus),
          nimbus: cost(c.perNode.nimbus),
          stratus: cost(c.perNode.stratus),
        },
      };
    }
    if (typeof v.includePa === 'boolean') out.includePa = v.includePa;
    if (v.columns !== undefined) out.columns = normalizeColumns(v.columns);
    if (v.density === 'comfortable' || v.density === 'compact') out.density = v.density;
    if (isGroupBy(v.groupBy)) out.groupBy = v.groupBy;
    if (isEarningsRange(v.earningsRange)) out.earningsRange = v.earningsRange;
    if (typeof v.horizon === 'string' && (DIAL_HORIZONS as readonly string[]).includes(v.horizon))
      out.horizon = v.horizon as DialHorizon;
  } catch {
    // A corrupt entry is as good as none.
  }
  return out;
}

function structuredCopy(c: HostingCosts): HostingCosts {
  return { currency: c.currency, perNode: { ...c.perNode } };
}

function load(): Persisted {
  try {
    return parsePrefs(globalThis.localStorage?.getItem(KEY));
  } catch {
    return parsePrefs(null);
  }
}

function save(s: Persisted): void {
  try {
    globalThis.localStorage?.setItem(
      KEY,
      JSON.stringify({
        currency: s.currency,
        costs: s.costs,
        includePa: s.includePa,
        columns: s.columns,
        density: s.density,
        groupBy: s.groupBy,
        earningsRange: s.earningsRange,
        horizon: s.horizon,
      } satisfies Persisted),
    );
  } catch {
    // Storage unavailable (private mode, quota): preferences last for the session only.
  }
}

export const useWalletPrefs = create<WalletPrefs>()((set, get) => {
  const apply = (patch: Partial<Persisted>) => {
    set(patch);
    save(get());
  };
  return {
    ...load(),
    setCurrency: (currency) => apply({ currency }),
    setCost: (tier, perMonth) => {
      if (!PAY_TIERS.includes(tier)) return;
      const { costs, currency } = get();
      apply({
        costs: {
          currency: costs.currency || currency,
          perNode: { ...costs.perNode, [tier]: cost(perMonth) },
        },
      });
    },
    setCosts: (costs) =>
      apply({
        costs: {
          currency: isCurrency(costs.currency) ? costs.currency : get().currency,
          perNode: {
            cumulus: cost(costs.perNode.cumulus),
            nimbus: cost(costs.perNode.nimbus),
            stratus: cost(costs.perNode.stratus),
          },
        },
      }),
    clearCosts: () => apply({ costs: structuredCopy(NO_COSTS) }),
    setIncludePa: (includePa) => apply({ includePa }),
    setColumns: (ids) => apply({ columns: normalizeColumns(ids) }),
    setDensity: (density) => apply({ density }),
    setGroupBy: (groupBy) => apply({ groupBy }),
    setEarningsRange: (earningsRange) => apply({ earningsRange }),
    setHorizon: (horizon) => apply({ horizon }),
  };
});
