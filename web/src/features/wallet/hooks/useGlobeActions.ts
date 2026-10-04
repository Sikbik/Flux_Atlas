// The wallet and the globe behind it: show the fleet on the globe (the selection in the URL, the camera on the
// fleet, the window out of the way) and ping one node while the pointer rests on its row. Everything here is a
// request to the globe; with no WebGL the engine is null and each action quietly does nothing.

import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useGlobeEngine } from '../../../globe';
import { toEngineId } from '../../../globe/bindings';
import { windowRect } from '../../../shell/wm/machine';
import { useWindowManager } from '../../../shell/wm/react';
import { WINDOW_SPECS } from '../../../shell/wm/specs';
import type { Rect } from '../../../shell/wm/types';
import { type FleetNode, fleetCentroid, flyRangeFor } from '../../inspect/derive/operator';
import type { FleetRow } from '../lib/fleet';

/** `?sel=` holds at most this many nodes (the globe resolves no more). */
export const SELECT_LIMIT = 50;
/** The pointer rests this long on a row before the node is pinged, so a sweep down the table pings nothing. */
export const HOVER_DWELL_MS = 140;
/** The window narrows to this width to leave the globe in view. */
const NARROW_W = 560;

/** The `sel` value for a fleet: the outpoints of the nodes paid soonest, at most `SELECT_LIMIT`. */
export function selectionOf(rows: readonly FleetRow[]): string {
  return rows
    .filter((r) => r.present && r.key.includes(':'))
    .sort((a, b) => (a.etaMs ?? Number.POSITIVE_INFINITY) - (b.etaMs ?? Number.POSITIVE_INFINITY))
    .slice(0, SELECT_LIMIT)
    .map((r) => r.key)
    .join(',');
}

export interface GlobeActions {
  /** The globe is available (WebGL and its chunk have loaded). */
  ready: boolean;
  /** The fleet is the globe's selection. */
  onGlobe: boolean;
  /** How many of the fleet the selection holds. */
  selected: number;
  toggle: () => void;
  /** Flies to the fleet without selecting it. */
  fly: () => void;
  /** Pings a node (after a short dwell) or, with null, lets go. */
  hover: (row: FleetRow | null) => void;
  /** Flies to one node. */
  locate: (row: FleetRow) => void;
}

export function useGlobeActions(nodes: readonly FleetNode[], rows: readonly FleetRow[]): GlobeActions {
  const engine = useGlobeEngine();
  const wm = useWindowManager();
  const navigate = useNavigate();
  const search = useRouterState({ select: (s) => s.location.search as { sel?: string } });
  const endpoints = useMemo(() => selectionOf(rows), [rows]);
  const onGlobe = endpoints !== '' && search.sel === endpoints;
  const before = useRef<Rect | null>(null);
  const dwell = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Takes the window off the globe: narrower on a desktop, a peek on a phone. Returns what to undo. */
  const makeRoom = useCallback(() => {
    const s = wm.getState();
    const win = Object.values(s.windows).find((w) => w.type === 'wallet');
    if (!win) return;
    if (s.layout === 'phone') {
      wm.dispatch({ t: 'setSheet', snap: 'peek' });
      return;
    }
    if (win.mode === 'maximized') wm.dispatch({ t: 'restore', id: win.id });
    const now = wm.getState();
    const rect = windowRect(now, win.id);
    if (rect.w <= now.viewport.w * 0.5) return;
    before.current = rect;
    const w = Math.max(WINDOW_SPECS.wallet.min.w, Math.min(NARROW_W, Math.round(now.viewport.w * 0.4)));
    wm.dispatch({ t: 'resize', id: win.id, rect: { ...rect, w } });
  }, [wm]);

  const giveBack = useCallback(() => {
    const rect = before.current;
    before.current = null;
    if (!rect) return;
    const s = wm.getState();
    const win = Object.values(s.windows).find((w) => w.type === 'wallet');
    if (win && s.layout !== 'phone') wm.dispatch({ t: 'resize', id: win.id, rect });
  }, [wm]);

  const fly = useCallback(() => {
    const c = fleetCentroid(nodes);
    if (c) void engine?.flyTo(c.lat, c.lon, flyRangeFor(c.spread), { tilt: 0.3 });
  }, [engine, nodes]);

  const toggle = useCallback(() => {
    void navigate({
      to: '.',
      replace: true,
      search: ((prev: Record<string, unknown>) => ({
        ...prev,
        sel: onGlobe ? undefined : endpoints,
      })) as never,
    });
    if (onGlobe) {
      giveBack();
      return;
    }
    makeRoom();
    fly();
  }, [navigate, onGlobe, endpoints, makeRoom, giveBack, fly]);

  const hover = useCallback(
    (row: FleetRow | null) => {
      clearTimeout(dwell.current);
      if (!engine) return;
      if (!row?.present) {
        engine.setHover(null);
        return;
      }
      dwell.current = setTimeout(() => {
        const id = toEngineId(row.id);
        engine.setHover(id);
        engine.sink.pulse({
          node: id,
          kind: 'confirmed',
          priority: 1,
          tier: row.tier === 'unknown' ? null : row.tier,
        });
      }, HOVER_DWELL_MS);
    },
    [engine],
  );

  const locate = useCallback(
    (row: FleetRow) => {
      if (!engine || !row.present) return;
      makeRoom();
      void engine.flyToNode(toEngineId(row.id));
    },
    [engine, makeRoom],
  );

  useEffect(
    () => () => {
      clearTimeout(dwell.current);
      engine?.setHover(null);
    },
    [engine],
  );

  return {
    ready: engine !== null,
    onGlobe,
    selected: endpoints === '' ? 0 : endpoints.split(',').length,
    toggle,
    fly,
    hover,
    locate,
  };
}
