// What the weather view knows about the whole network. The live table carries what the stream has said
// since load; the server's node list says the rest (which nodes cannot be reached, when each last checked
// in). The list is read once, page by page, into compact columns, and `buildWeather` lays the live table
// over it, so the picture follows the stream without ever polling.

import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { api } from '../../../api/endpoints';
import type { NodeRow } from '../../../api/generated/NodeRow';
import type { NodesPage } from '../../../api/generated/NodesPage';
import { STATUS_CODES } from '../../../api/nodesBin';
import { useNetwork, useRuntime, useTip } from '../../../app/context';
import { Reach } from '../../../store/nodeTable';
import { countryName } from '../derive/appSpec';
import {
  type Breakdown,
  breakdown,
  buildWeather,
  cellTotals,
  emptyScan,
  groupTotals,
  type Hotspot,
  hotspots,
  type NodeScan,
  type Verdict,
  verdictOf,
  type WeatherCounts,
  type WeatherModel,
} from '../derive/weather';

/** One node as the scan keeps it: just the three facts the weather needs. */
export interface ScanRow {
  id: number;
  /** A `Reach` value. */
  reach: number;
  /** A `STATUS_CODES` index. */
  status: number;
  /** Height of the last check-in, 0 when the server does not know one. */
  lastConfirmed: number;
}

export const scanRow = (r: NodeRow): ScanRow => ({
  id: r.id,
  reach: r.reachable === true ? Reach.Yes : r.reachable === false ? Reach.No : Reach.Unknown,
  status: Math.max(0, STATUS_CODES.indexOf(r.status)),
  lastConfirmed: r.last_confirmed_height ?? 0,
});

/** The columns the weather reads, in scan order. */
export function buildScan(rows: readonly ScanRow[]): NodeScan {
  const scan = emptyScan(rows.length);
  rows.forEach((r, i) => {
    scan.ids[i] = r.id;
    scan.reach[i] = r.reach;
    scan.status[i] = r.status;
    scan.lastConfirmed[i] = r.lastConfirmed;
    scan.index.set(r.id, i);
  });
  return scan;
}

const PAGE_LIMIT = 1000;
/** A safety stop (the network is under ten pages); never loops on a server that keeps handing out cursors. */
const MAX_PAGES = 40;

/** Reads the whole node list. Pages are asked for in turn (a cursor leads to the next one). */
export async function readScan(signal: AbortSignal): Promise<NodeScan> {
  const rows: ScanRow[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page: NodesPage = await api.nodes({ limit: PAGE_LIMIT, cursor }, { signal });
    for (const r of page.items) rows.push(scanRow(r));
    if (!page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return buildScan(rows);
}

/** The scan stays fresh for ten minutes; the live table keeps it current in between. */
export const SCAN_CADENCE_MS = 10 * 60_000;

export interface WeatherData {
  counts: WeatherCounts;
  verdict: Verdict;
  hotspots: Hotspot[];
  providers: Breakdown[];
  countries: Breakdown[];
  /** Server time the node list was read (null until it has been). */
  scannedAt: number | null;
  /** The node list is being read for the first time. */
  scanning: boolean;
  /** Reading the node list failed (and there is none from before). */
  failed: boolean;
  /** True while only the live table is known: reachability and check-ins are then not complete. */
  partial: boolean;
  retry: () => void;
}

const NO_SPOTS: Hotspot[] = [];
const NO_ROWS: Breakdown[] = [];

/** The network's weather: counts, verdict, where trouble concentrates, and which providers and countries carry it. */
export function useWeather(): WeatherData {
  const { store, clock } = useRuntime();
  const loaded = useNetwork((s) => s.loaded);
  // The node table's contents are read from `store.nodes`; its version says when they changed.
  const nodesVersion = useNetwork((s) => s.versions.Nodes);
  const tip = useTip()?.height ?? null;
  const q = useQuery({
    queryKey: ['atlas', 'inspect', 'weather-scan'] as const,
    queryFn: async ({ signal }) => ({ scan: await readScan(signal), at: clock.now() }),
    staleTime: SCAN_CADENCE_MS,
    refetchOnWindowFocus: false,
  });
  const scan = q.data?.scan ?? null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: nodesVersion is the change signal for store.nodes
  const built = useMemo(() => {
    const t = store.nodes;
    const model: WeatherModel = buildWeather(t, loaded ? scan : null, tip);
    const totals = groupTotals(t);
    const baseline = model.counts.total > 0 ? model.counts.affected / model.counts.total : 0;
    return {
      model,
      hotspots: hotspots(model.problems, cellTotals(t), baseline),
      providers: breakdown(model.problems, totals.byOrg, (p) => p.org),
      countries: breakdown(model.problems, totals.byCountry, (p) => p.country, countryName),
    };
  }, [store, loaded, scan, tip, nodesVersion]);

  const retry = useCallback(() => {
    void q.refetch();
  }, [q.refetch]);

  const known = scan !== null && loaded;
  return {
    counts: built.model.counts,
    verdict: verdictOf(built.model.counts, { known }),
    hotspots: loaded ? built.hotspots : NO_SPOTS,
    providers: loaded ? built.providers : NO_ROWS,
    countries: loaded ? built.countries : NO_ROWS,
    scannedAt: q.data?.at ?? null,
    scanning: q.isPending,
    failed: q.isError && scan === null,
    partial: built.model.partial,
    retry,
  };
}
