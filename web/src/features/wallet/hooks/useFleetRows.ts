// The wallet's nodes as the page uses them: the server's roster joined with the live node table (status, check-in,
// queue place follow the stream), then with the wallet's own next payments and health findings. The join runs again
// when the table changes, not on every render, and keeps the previous list while nothing in it moved so the table
// and the dial below do not redraw for a change somewhere else on the network.

import { useMemo, useRef } from 'react';
import { useNetwork, useRuntime, useTip } from '../../../app/context';
import { buildFleet, type FleetNode } from '../../inspect/derive/operator';
import { tierPayouts, useQueues, useTierInfo } from '../../inspect/sources/live';
import { buildFleetRows, type FleetRow } from '../lib/fleet';
import type { WalletDto } from '../types';

function sameNode(a: FleetNode, b: FleetNode): boolean {
  for (const k of Object.keys(a) as (keyof FleetNode)[]) if (!Object.is(a[k], b[k])) return false;
  return true;
}

function sameRow(a: FleetRow, b: FleetRow): boolean {
  for (const k of Object.keys(a) as (keyof FleetRow)[]) {
    const x = a[k];
    const y = b[k];
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length || x.some((v, i) => v !== y[i])) return false;
    } else if (!Object.is(x, y)) return false;
  }
  return true;
}

/** Keeps the previous array while every element is unchanged. */
function useStable<T>(next: T[], same: (a: T, b: T) => boolean): T[] {
  const prev = useRef<T[]>(next);
  const p = prev.current;
  if (p !== next && p.length === next.length && next.every((n, i) => same(n, p[i] as T))) return p;
  prev.current = next;
  return next;
}

export interface WalletFleet {
  /** The roster joined with the live table (what the operator view's helpers take). */
  nodes: FleetNode[];
  /** One row per node with its next payment and findings. */
  rows: FleetRow[];
  /** The live table is loaded, so status is live rather than the server's last word. */
  live: boolean;
}

const NONE: FleetNode[] = [];

export function useFleetRows(dto: WalletDto | undefined): WalletFleet {
  const { store } = useRuntime();
  const loaded = useNetwork((s) => s.loaded);
  // Re-run when any node changes: status, reachability, check-ins and paid heights live in the table.
  const nodesVersion = useNetwork((s) => s.versions.Nodes);
  const queues = useQueues();
  const tip = useTip()?.height ?? null;
  const info = useTierInfo();

  // `nodesVersion` stands for the table's contents, which are read from `store.nodes`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: nodesVersion is the change signal for store.nodes
  const built = useMemo(
    () => (dto ? buildFleet(dto.nodes, store.nodes, queues, tip, tierPayouts(info)) : NONE),
    [dto, store, queues, tip, info, nodesVersion],
  );
  const nodes = useStable(built, sameNode);

  const rows = useMemo(
    () => (dto ? buildFleetRows(nodes, dto.nodes, dto.payouts, dto.health.attention) : []),
    [dto, nodes],
  );
  const stable = useStable(rows, sameRow);
  return { nodes, rows: stable, live: loaded };
}
