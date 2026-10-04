// The owners leaderboard's rows. An owner's cores, memory and storage are the server's sum of what its running
// instances lock, and that sum can only count the apps whose spec is public. An enterprise app keeps its components
// private, so an owner with enterprise apps locks at least what is shown, and an owner whose running instances are
// all enterprise has no figure at all: that is Unknown, never a zero. Pure.

import type { AppOwnerRow } from '../../../../api/generated/AppOwnerRow';
import { formatInt } from '../../../../lib/format';
import { formatCapacity, type Resource } from '../../../analytics/lib/capacity';
import { nameList } from '../../../analytics/lib/concentration';
import type { OwnerEnterprise } from './apps';

/** A locked resource: exactly this, at least this (the owner also runs enterprise apps), or not known. */
export type Locked =
  | { kind: 'exact'; value: number }
  | { kind: 'atLeast'; value: number }
  | { kind: 'unknown' };

export interface OwnerRow {
  owner: string;
  apps: number;
  instances: number;
  /** A fraction of every running instance; null while the total is not known. */
  share: number | null;
  cores: Locked;
  ramGb: Locked;
  ssdGb: Locked;
  /** How many of the owner's apps are enterprise; null while the index is not known. */
  enterpriseApps: number | null;
}

/**
 * How one resource of one owner reads. `enterpriseInstances` is how many of the owner's running instances belong to
 * enterprise apps (null when the index is not loaded, in which case the global fact `anyEnterprise` stands in).
 */
export function lockedFor(
  value: number,
  instances: number,
  enterpriseInstances: number | null,
  anyEnterprise: boolean,
): Locked {
  // Nothing running locks nothing, exactly.
  if (instances <= 0) return { kind: 'exact', value: 0 };
  const hidden = enterpriseInstances === null ? anyEnterprise : enterpriseInstances > 0;
  if (!hidden) return { kind: 'exact', value };
  return value > 0 ? { kind: 'atLeast', value } : { kind: 'unknown' };
}

export function ownerRows(
  owners: readonly AppOwnerRow[],
  enterprise: ReadonlyMap<string, OwnerEnterprise> | null,
  anyEnterprise: boolean,
  totalInstances: number | null,
): OwnerRow[] {
  return owners.map((o) => {
    const mine = enterprise ? (enterprise.get(o.owner) ?? { apps: 0, instances: 0 }) : null;
    const e = mine ? mine.instances : null;
    return {
      owner: o.owner,
      apps: o.apps,
      instances: o.instances,
      share: totalInstances !== null && totalInstances > 0 ? o.instances / totalInstances : null,
      cores: lockedFor(o.cores, o.instances, e, anyEnterprise),
      ramGb: lockedFor(o.ram_gb, o.instances, e, anyEnterprise),
      ssdGb: lockedFor(o.ssd_gb, o.instances, e, anyEnterprise),
      enterpriseApps: mine ? mine.apps : null,
    };
  });
}

/** The sentence for a screen reader, ahead of the list. */
export function ownersSummary(rows: readonly OwnerRow[], shown: number, total: number): string {
  const lead = rows[0];
  if (!lead) return 'No app owners.';
  return `The ${formatInt(shown)} owners with the most running instances, of ${formatInt(total)} in the index. The largest runs ${formatInt(lead.instances)} ${lead.instances === 1 ? 'instance' : 'instances'} in ${formatInt(lead.apps)} ${lead.apps === 1 ? 'app' : 'apps'}.`;
}

/** A cell of the table: the figure (cores as a number, memory and storage with their unit), a plus when it is a floor, or Unknown. */
export function lockedCell(l: Locked, key: Resource): string {
  if (l.kind === 'unknown') return 'Unknown';
  const text = key === 'cpu' ? formatInt(Math.round(l.value)) : formatCapacity(key, l.value);
  return l.kind === 'atLeast' ? `${text}+` : text;
}

/** The words a cell is read with by a screen reader and in a tooltip: `at least 42`, `unknown`. */
export function lockedWords(l: Locked, key: Resource): string {
  if (l.kind === 'unknown') return 'Unknown';
  const text = key === 'cpu' ? formatInt(Math.round(l.value)) : formatCapacity(key, l.value);
  return l.kind === 'atLeast' ? `at least ${text}` : text;
}

const RESOURCE_TEXT: Record<Resource, (v: number) => string> = {
  cpu: (v) => formatCapacity('cpu', v),
  ram: (v) => `${formatCapacity('ram', v)} memory`,
  ssd: (v) => `${formatCapacity('ssd', v)} storage`,
};

/** What an owner's running instances lock, as the sentence in its open row says it. */
export function lockedSentence(r: OwnerRow): string {
  const items: [Resource, Locked][] = [
    ['cpu', r.cores],
    ['ram', r.ramGb],
    ['ssd', r.ssdGb],
  ];
  const known = items.filter(([, l]) => l.kind !== 'unknown');
  if (known.length === 0) {
    return 'Not known: its running instances are all enterprise apps, which keep their size private.';
  }
  const text = nameList(known.map(([key, l]) => RESOURCE_TEXT[key]((l as { value: number }).value)));
  const floor = items.some(([, l]) => l.kind !== 'exact');
  return floor ? `Locks at least ${text}; its enterprise apps keep their size private.` : `Locks ${text}.`;
}
