// The apps running on a fleet, as the Apps tab uses them: how many there are and where, how they spread over the nodes,
// and the small helpers a treemap and a table need (a stable colour per app, a search). Pure functions.

import { formatInt } from '../../../lib/format';
import type { WalletApp } from '../types';

/** How many different apps each node runs (an app on a node counts once, however many instances it has there). */
export function perNodeCounts(apps: readonly WalletApp[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of apps) {
    for (const key of new Set(a.node_keys)) out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

export interface AppsSummary {
  /** Different apps. */
  apps: number;
  /** App instances (an app on two nodes counts twice). */
  instances: number;
  /** Nodes in the fleet. */
  nodes: number;
  /** Nodes running at least one app. */
  hosting: number;
  /** Nodes running none. */
  idle: number;
  /** The node running the most apps. */
  busiest: { key: string; count: number } | null;
  /** Apps per node over the whole fleet, idle nodes included. */
  average: number | null;
}

/** The totals of a fleet's apps, over the fleet's nodes (a node the apps never mention runs none). */
export function summarizeApps(apps: readonly WalletApp[], nodeKeys: readonly string[]): AppsSummary {
  const counts = perNodeCounts(apps);
  let hosting = 0;
  let sum = 0;
  let busiest: AppsSummary['busiest'] = null;
  for (const key of nodeKeys) {
    const n = counts.get(key) ?? 0;
    if (n > 0) hosting++;
    sum += n;
    if (n > 0 && (busiest === null || n > busiest.count)) busiest = { key, count: n };
  }
  return {
    apps: apps.length,
    instances: apps.reduce((s, a) => s + a.instances, 0),
    nodes: nodeKeys.length,
    hosting,
    idle: nodeKeys.length - hosting,
    busiest,
    average: nodeKeys.length === 0 ? null : sum / nodeKeys.length,
  };
}

export interface AppCountBucket {
  id: string;
  label: string;
  /** Nodes running this many apps. */
  nodes: number;
  keys: string[];
}

/**
 * The nodes grouped by how many apps they run: none, one, two ... and `cap` or more. Every node of the fleet is in
 * exactly one bucket, and the buckets are all there even when empty, so the distribution always reads from none.
 */
export function appCountBuckets(
  counts: ReadonlyMap<string, number>,
  nodeKeys: readonly string[],
  cap = 5,
): AppCountBucket[] {
  const buckets: AppCountBucket[] = Array.from({ length: cap + 1 }, (_, i) => ({
    id: i === cap ? `${cap}+` : String(i),
    label: i === 0 ? 'No apps' : i === cap ? `${cap} or more` : i === 1 ? '1 app' : `${i} apps`,
    nodes: 0,
    keys: [],
  }));
  for (const key of nodeKeys) {
    const b = buckets[Math.min(cap, counts.get(key) ?? 0)] as AppCountBucket;
    b.nodes++;
    b.keys.push(key);
  }
  return buckets;
}

/** How a bucket reads in a sentence: "no app", "one app", "3 apps", "5 or more apps". */
function bucketWords(b: AppCountBucket): string {
  if (b.id === '0') return 'no app';
  if (b.id === '1') return 'one app';
  return b.id.endsWith('+') ? `${b.label} apps` : b.label;
}

/** A sentence about the distribution: the commonest number of apps a node runs, and how many nodes run none. */
export function appCountHeadline(buckets: readonly AppCountBucket[], nodes: number): string {
  const first = buckets[0];
  if (nodes === 0 || !first) return 'There are no nodes to count.';
  const top = buckets.reduce((m, b) => (b.nodes > m.nodes ? b : m), first);
  if (top.nodes === nodes) {
    if (top.id === '0') return nodes === 1 ? 'The node runs no app.' : 'No node runs an app.';
    return nodes === 1 ? `The node runs ${bucketWords(top)}.` : `Every node runs ${bucketWords(top)}.`;
  }
  const main = `${formatInt(top.nodes)} of ${formatInt(nodes)} nodes run ${bucketWords(top)}, the most common.`;
  if (top.id === '0' || first.nodes === 0) return main;
  return `${main} ${formatInt(first.nodes)} ${first.nodes === 1 ? 'runs' : 'run'} none.`;
}

/** One app as the treemap and the table list it. */
export interface AppRow {
  /** The registered name: the key, and what the app's page is addressed by. */
  name: string;
  /** What to show: the display name, else the registered one. */
  label: string;
  instances: number;
  /** The different nodes it runs on, in the order the server listed them. */
  keys: string[];
  /** The number of those nodes. */
  nodes: number;
  /** Its share of every instance on the fleet, 0 to 1. */
  share: number;
}

/** The apps as rows, each with its distinct nodes and its share of all the instances (the server's order is kept). */
export function appRows(apps: readonly WalletApp[]): AppRow[] {
  const total = apps.reduce((s, a) => s + a.instances, 0);
  return apps.map((a) => {
    const keys = [...new Set(a.node_keys)];
    return {
      name: a.name,
      label: appLabel(a),
      instances: a.instances,
      keys,
      nodes: keys.length,
      share: total > 0 ? a.instances / total : 0,
    };
  });
}

/** The categorical colour slot (1 to 6) of an app: the same name always gets the same one, whatever the data around it. */
export function appColorSlot(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 6) + 1;
}

/** The apps whose name or display name contains the text, ignoring case and spaces at the ends; no text keeps them all. */
export function filterAppRows(rows: readonly AppRow[], text: string): AppRow[] {
  const needle = text.trim().toLowerCase();
  if (needle === '') return [...rows];
  return rows.filter((r) => `${r.name}\n${r.label}`.toLowerCase().includes(needle));
}

/** The name to show for an app: its display name, else its registered name. */
export const appLabel = (a: Pick<WalletApp, 'name' | 'display_name'>): string => a.display_name || a.name;
