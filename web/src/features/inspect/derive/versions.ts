// Version arithmetic for the "latest" markers: FluxOS, fluxd and fluxbench use dotted numeric
// versions, so the latest is the highest one that a meaningful share of the network runs (a lone
// pre-release build on one dev node is not "latest").

import type { CountBucket } from '../../../api/generated/CountBucket';

export interface ParsedVersion {
  parts: number[];
  /** True for `-beta`, `-rc` and similar suffixes. */
  pre: boolean;
}

/** `8.20.0`, `v8.20.0` and `9.1.0-beta2` parse; names such as `jolly wombat` and `unknown` do not. */
export function parseVersion(v: string | null | undefined): ParsedVersion | null {
  if (!v) return null;
  const m = /^v?(\d+(?:\.\d+)*)(?:[-+](.*))?$/.exec(v.trim());
  if (!m) return null;
  return { parts: m[1]!.split('.').map(Number), pre: !!m[2] };
}

/** Negative when `a` is older than `b`; null when either is not a dotted version. */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  const n = Math.max(pa.parts.length, pb.parts.length);
  for (let i = 0; i < n; i++) {
    const d = (pa.parts[i] ?? 0) - (pb.parts[i] ?? 0);
    if (d !== 0) return d;
  }
  if (pa.pre !== pb.pre) return pa.pre ? -1 : 1;
  return 0;
}

/**
 * The latest release in a distribution: the highest parseable version carried by at least
 * `minCount` nodes (default: 3, or 0.1% of the network, whichever is larger).
 */
export function latestVersion(
  buckets: readonly CountBucket[],
  opts: { minCount?: number } = {},
): string | null {
  const total = buckets.reduce((a, b) => a + b.count, 0);
  const minCount = opts.minCount ?? Math.max(3, Math.ceil(total * 0.001));
  let best: string | null = null;
  const consider = (floor: number) => {
    for (const b of buckets) {
      if (b.count < floor || !parseVersion(b.key)) continue;
      if (best === null || (compareVersions(b.key, best) ?? 0) > 0) best = b.key;
    }
  };
  consider(minCount);
  if (best === null) consider(1);
  return best;
}

export type VersionStanding = 'latest' | 'behind' | 'ahead' | 'unknown';

/** Where a node's version stands against the latest release. */
export function versionStanding(version: string | null | undefined, latest: string | null): VersionStanding {
  if (!version || !latest) return 'unknown';
  const c = compareVersions(version, latest);
  if (c === null) return 'unknown';
  return c === 0 ? 'latest' : c > 0 ? 'ahead' : 'behind';
}

/** The most common value of a name-like distribution (ArcaneOS codenames, OS names), ignoring unknowns. */
export function mostCommon(buckets: readonly CountBucket[]): string | null {
  let best: CountBucket | null = null;
  for (const b of buckets) {
    if (b.key === 'unknown' || b.key === '') continue;
    if (!best || b.count > best.count) best = b;
  }
  return best?.key ?? null;
}

/** Share (0..1) of the network on a given version key, or null when absent. */
export function shareOf(buckets: readonly CountBucket[], key: string | null | undefined): number | null {
  if (!key) return null;
  return buckets.find((b) => b.key === key)?.share ?? null;
}
