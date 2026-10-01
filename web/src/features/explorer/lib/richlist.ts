// Rich list arithmetic: how concentrated the supply is, by rank range, and how much of a balance is
// locked in nodes. Shares come from the server as percentages of the total supply.

export interface Holder {
  rank: number;
  share_pct: number;
}

export interface Bucket {
  key: string;
  label: string;
  /** First and last rank in the bucket, inclusive; `null` for everyone not on the list. */
  from: number | null;
  to: number | null;
  /** Percent of the total supply. */
  share: number;
  holders: number;
}

/** Rank boundaries of the buckets: #1, #2 to #10, #11 to #100, #101 to #1,000. */
const CUTS = [1, 10, 100, 1000] as const;

const fmt = (n: number) => new Intl.NumberFormat('en-US').format(n);

export function bucketLabel(from: number, to: number): string {
  return from === to ? `#${fmt(from)}` : `#${fmt(from)} to #${fmt(to)}`;
}

/** The listed holders split into rank buckets, plus the remainder of the supply held by everyone else. */
export function concentration(entries: readonly Holder[]): {
  buckets: Bucket[];
  listed: number;
  listedShare: number;
  top: (n: number) => number;
} {
  const sorted = [...entries].sort((a, b) => a.rank - b.rank);
  const listed = sorted.length;
  const buckets: Bucket[] = [];
  let prev = 0;
  for (const cut of CUTS) {
    if (prev >= listed) break;
    const to = Math.min(cut, listed);
    const slice = sorted.slice(prev, to);
    buckets.push({
      key: `r${prev + 1}-${to}`,
      label: bucketLabel(prev + 1, to),
      from: prev + 1,
      to,
      share: slice.reduce((s, e) => s + e.share_pct, 0),
      holders: slice.length,
    });
    prev = cut;
  }
  const listedShare = buckets.reduce((s, b) => s + b.share, 0);
  buckets.push({
    key: 'rest',
    label: 'Everyone else',
    from: null,
    to: null,
    share: Math.max(0, 100 - listedShare),
    holders: 0,
  });
  const top = (n: number) => sorted.slice(0, n).reduce((s, e) => s + e.share_pct, 0);
  return { buckets, listed, listedShare, top };
}

/** A share of the supply as a percentage with the digits that matter: `37.2%`, `0.12%`, `0.004%`. */
export const formatShare = (pct: number): string =>
  `${pct >= 10 ? pct.toFixed(1) : pct >= 0.1 ? pct.toFixed(2) : pct.toFixed(3)}%`;

/** Collateral locked by an address's nodes, never more than its balance. */
export function lockedSats(
  counts: { cumulus: number; nimbus: number; stratus: number },
  collateral: { cumulus: bigint; nimbus: bigint; stratus: bigint },
  balance: bigint,
): bigint {
  const locked =
    BigInt(counts.cumulus) * collateral.cumulus +
    BigInt(counts.nimbus) * collateral.nimbus +
    BigInt(counts.stratus) * collateral.stratus;
  return locked > balance ? balance : locked;
}
