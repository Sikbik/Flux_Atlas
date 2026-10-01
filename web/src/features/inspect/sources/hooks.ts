// Small shared hooks: the age of the ledger, watch state, one-shot flashes and the layer parameter.

import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NodeRow } from '../../../api/generated/NodeRow';
import { queries, useTimeline } from '../../../api/queries';
import { parseEndpoint } from '../../../lib/format';
import { useUi } from '../../../store/ui';

/** When our own ingest began; history older than this does not exist. Null until known. */
export function useFirstIngestMs(): number | null {
  return useTimeline().data?.first_ms ?? null;
}

/** Whether node `id` is on the watchlist, and the toggle. Server registration is the runtime's job. */
export function useWatch(id: number | null): { watched: boolean; toggle: () => void } {
  const watched = useUi((s) => id !== null && s.watched.includes(id));
  const watch = useUi((s) => s.watch);
  const unwatch = useUi((s) => s.unwatch);
  const toggle = useCallback(() => {
    if (id === null) return;
    if (watched) unwatch(id);
    else watch(id);
  }, [id, watched, watch, unwatch]);
  return { watched, toggle };
}

/**
 * True for `ms` after `value` rises (never at mount): a one-shot cue that something just landed, for
 * a highlight that decays on its own.
 */
export function useRiseFlash(value: number, ms = 1800): boolean {
  const prev = useRef(value);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (value > prev.current) {
      setOn(true);
      const t = window.setTimeout(() => setOn(false), ms);
      prev.current = value;
      return () => window.clearTimeout(t);
    }
    prev.current = value;
    return undefined;
  }, [value, ms]);
  return on;
}

type MeshMode = 'off' | 'sel' | 'flow';

function parseLayers(l: string | undefined): { mesh: MeshMode | null; rest: string[] } {
  const rest: string[] = [];
  let mesh: MeshMode | null = null;
  for (const raw of (l ?? '').split(',')) {
    const t = raw.trim();
    if (!t) continue;
    if (t === '-mesh' || t === 'mesh.off') mesh = 'off';
    else if (t === 'mesh.flow') mesh = 'flow';
    else if (t === 'mesh.sel' || t === 'mesh') mesh = 'sel';
    else rest.push(t);
  }
  return { mesh, rest };
}

/**
 * The globe's mesh mode from the URL (`?l=mesh.sel`), and a setter that rewrites only that token and
 * keeps every other layer and parameter.
 */
export function useMeshLayer(): { mode: MeshMode | null; set: (mode: MeshMode | null) => void } {
  const search = useRouterState({ select: (s) => (s.location.search as { l?: string }).l });
  const navigate = useNavigate();
  const { mesh } = parseLayers(search);
  const set = useCallback(
    (mode: MeshMode | null) => {
      void navigate({
        to: '.',
        replace: true,
        search: ((prev: { l?: string }) => {
          const { rest } = parseLayers(prev.l);
          const next = [...rest, ...(mode ? [`mesh.${mode}`] : [])].join(',');
          return { ...prev, l: next || undefined };
        }) as never,
      });
    },
    [navigate],
  );
  return { mode: mesh, set };
}

/**
 * The node list rows (with payment addresses) of every node on `ip`. The list search is a substring
 * match, so rows are filtered to the exact host.
 */
export function useHostRows(ip: string | null): { rows: NodeRow[]; pending: boolean } {
  const q = useQuery({ ...queries.nodes({ q: ip ?? '', limit: 24 }), enabled: !!ip });
  const rows = useMemo(
    () => (q.data?.items ?? []).filter((r) => parseEndpoint(r.endpoint)?.host === ip),
    [q.data, ip],
  );
  return { rows, pending: !!ip && q.isPending };
}
