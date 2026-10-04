// What the app index says about the network, in the shapes the Apps hub draws. Pure functions over the generated
// types; the components format and lay them out.
//
// Two facts shape everything here. An app locks what its spec asks of each node, times the instances running
// (`per_instance` x `instances_running`, which is how the server's own overview counts it). And an enterprise app
// keeps its components private: its spec reads as zero cores, memory and storage, which means "not public" and not
// "nothing". So an enterprise app has instances but no known size, and no function here turns that into a zero.

import type { AppIndexEntry } from '../../../../api/generated/AppIndexEntry';
import type { ResourceSum } from '../../../../api/generated/ResourceSum';

const MB_PER_GB = 1024;

/** What the top apps are ranked by: the instances they run, or the share of the network's capacity they hold. */
export type RankBy = 'instances' | 'footprint';

/** The name to show for an app: its display name, else its registered name. */
export const appLabel = (a: Pick<AppIndexEntry, 'name' | 'display_name'>): string => a.display_name || a.name;

/** What the running instances of an app lock: the per-instance spec times the instances running (RAM in GiB). */
export function lockedBy(a: Pick<AppIndexEntry, 'per_instance' | 'instances_running'>): ResourceSum {
  const n = a.instances_running;
  return {
    cores: a.per_instance.cpu * n,
    ram_gb: (a.per_instance.ram_mb * n) / MB_PER_GB,
    ssd_gb: a.per_instance.hdd_gb * n,
  };
}

// ---- the totals ---------------------------------------------------------------------------------------------

export interface IndexTotals {
  /** Apps in the index. */
  apps: number;
  /** Apps with at least one instance running. */
  active: number;
  /** Running instances of every app. */
  instances: number;
  /** The instances the specs ask for, which the running ones are measured against. */
  wanted: number;
  enterpriseApps: number;
  enterpriseInstances: number;
}

export function indexTotals(apps: readonly AppIndexEntry[]): IndexTotals {
  const t: IndexTotals = {
    apps: apps.length,
    active: 0,
    instances: 0,
    wanted: 0,
    enterpriseApps: 0,
    enterpriseInstances: 0,
  };
  for (const a of apps) {
    const n = a.instances_running;
    t.instances += n;
    t.wanted += a.instances_target;
    if (n > 0) t.active++;
    if (a.enterprise) {
      t.enterpriseApps++;
      t.enterpriseInstances += n;
    }
  }
  return t;
}

/** The enterprise part of one owner: how many such apps it has, and how many instances of them are running. */
export interface OwnerEnterprise {
  apps: number;
  instances: number;
}

/**
 * The enterprise apps of each owner. Their size is private, so this is the part of an owner's size that is not
 * public; an owner with no enterprise app has no entry.
 */
export function enterpriseByOwner(apps: readonly AppIndexEntry[]): Map<string, OwnerEnterprise> {
  const out = new Map<string, OwnerEnterprise>();
  for (const a of apps) {
    if (!a.enterprise) continue;
    const cur = out.get(a.owner) ?? { apps: 0, instances: 0 };
    cur.apps++;
    cur.instances += a.instances_running;
    out.set(a.owner, cur);
  }
  return out;
}

// ---- the footprint ------------------------------------------------------------------------------------------

export interface Footprint {
  /** Each is a fraction of the network's cores, memory and storage. */
  cpu: number;
  ram: number;
  ssd: number;
  /** The mean of the three: the one number an app is ranked by. */
  share: number;
}

/**
 * The share of the network's capacity that `locked` holds, per resource, and their mean. Null when the network's
 * capacity is not known (a total of zero is "not measured", never a capacity of nothing).
 */
export function footprintOf(locked: ResourceSum, network: ResourceSum | null): Footprint | null {
  if (!network || !(network.cores > 0) || !(network.ram_gb > 0) || !(network.ssd_gb > 0)) return null;
  const cpu = locked.cores / network.cores;
  const ram = locked.ram_gb / network.ram_gb;
  const ssd = locked.ssd_gb / network.ssd_gb;
  return { cpu, ram, ssd, share: (cpu + ram + ssd) / 3 };
}

// ---- the ranking --------------------------------------------------------------------------------------------

export interface AppRank {
  name: string;
  label: string;
  owner: string;
  enterprise: boolean;
  instances: number;
  target: number;
  /** What its running instances lock; null for an enterprise app, whose size is private. */
  locked: ResourceSum | null;
  /** Its share of the network's capacity; null for an enterprise app or while the network's capacity is unknown. */
  footprint: Footprint | null;
}

export function rankOf(a: AppIndexEntry, network: ResourceSum | null): AppRank {
  const locked = a.enterprise ? null : lockedBy(a);
  return {
    name: a.name,
    label: appLabel(a),
    owner: a.owner,
    enterprise: a.enterprise,
    instances: a.instances_running,
    target: a.instances_target,
    locked,
    footprint: locked ? footprintOf(locked, network) : null,
  };
}

const byName = (a: AppRank, b: AppRank): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * The apps that have something to show for `by`, biggest first. By instances every app that runs one; by footprint
 * every app whose size is public and whose footprint is known (an enterprise app has no footprint, so it is not in
 * that ranking, and `privateRunning` says how many were left out).
 */
export function rankApps(apps: readonly AppIndexEntry[], by: RankBy, network: ResourceSum | null): AppRank[] {
  const ranked = apps.map((a) => rankOf(a, network));
  if (by === 'instances') {
    return ranked
      .filter((r) => r.instances > 0)
      .sort(
        (a, b) =>
          b.instances - a.instances || (b.footprint?.share ?? 0) - (a.footprint?.share ?? 0) || byName(a, b),
      );
  }
  return ranked
    .filter((r) => r.footprint !== null && r.footprint.share > 0)
    .sort(
      (a, b) =>
        (b.footprint?.share ?? 0) - (a.footprint?.share ?? 0) || b.instances - a.instances || byName(a, b),
    );
}

/** Enterprise apps with an instance running: the ones a footprint ranking has to leave out. */
export function privateRunning(apps: readonly AppIndexEntry[]): number {
  let n = 0;
  for (const a of apps) if (a.enterprise && a.instances_running > 0) n++;
  return n;
}

/** The value a ranking is sized by. */
export const rankValue = (r: AppRank, by: RankBy): number =>
  by === 'instances' ? r.instances : (r.footprint?.share ?? 0);

// ---- an owner's apps ----------------------------------------------------------------------------------------

export interface OwnerApps {
  /** The owner's apps with the most instances running. */
  top: AppRank[];
  /** How many more apps the owner has than `top` lists. */
  more: number;
}

export function appsOfOwner(
  apps: readonly AppIndexEntry[],
  owner: string,
  limit: number,
  network: ResourceSum | null,
): OwnerApps {
  const mine = apps
    .filter((a) => a.owner === owner)
    .map((a) => rankOf(a, network))
    .sort((a, b) => b.instances - a.instances || byName(a, b));
  return { top: mine.slice(0, limit), more: Math.max(0, mine.length - limit) };
}

// ---- the search examples ------------------------------------------------------------------------------------

/** Names that share this many leading letters are one family (`foldingatrunonflux12`, `foldingatrunonflux13`). */
const FAMILY_PREFIX = 8;
/** An example chip is a name, not a sentence. */
const EXAMPLE_MAX_LENGTH = 22;

/**
 * Real apps to offer as search examples: the ones with the most instances running, one from each family of similarly
 * named apps (two chips that differ by a digit teach nothing), and short enough to fit a chip.
 */
export function exampleApps(apps: readonly AppIndexEntry[], n: number): AppIndexEntry[] {
  const out: AppIndexEntry[] = [];
  const families = new Set<string>();
  const ranked = [...apps]
    .filter((a) => a.instances_running > 0 && appLabel(a).length <= EXAMPLE_MAX_LENGTH)
    .sort((a, b) => b.instances_running - a.instances_running || (a.name < b.name ? -1 : 1));
  for (const a of ranked) {
    const family = a.name.slice(0, FAMILY_PREFIX);
    if (families.has(family)) continue;
    families.add(family);
    out.push(a);
    if (out.length === n) break;
  }
  return out;
}
