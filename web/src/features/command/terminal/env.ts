// The terminal's environment: the live runtime, the router and the globe behind the `CmdEnv` contract
// the commands are written against. This is the one file in the terminal that touches the app.

import type { QueryClient } from '@tanstack/react-query';
import type { AnyRouter } from '@tanstack/react-router';
import { queries } from '../../../api/queries';
import type { AtlasRuntime } from '../../../app/runtime';
import type { GlobeTarget } from '../../../globe';
import { useUi } from '../../../store/ui';
import { track } from '../../achievements/events';
import { achievementLines } from '../../achievements/summary';
import { ATLAS_VERSION } from '../../settings/version';
import { navigateTo } from '../navigation';
import { type RunCtx, readActionEnv, runAction } from '../palette/run';
import { replayLastBlock } from './relay';
import type { CmdEnv } from './types';

export interface EnvDeps {
  router: AnyRouter;
  runtime: AtlasRuntime;
  queryClient: QueryClient;
  engine: () => GlobeTarget | null;
  signal: AbortSignal;
  /** Called after a command navigated somewhere (the view keeps the terminal in front). */
  onOpened?: () => void;
}

type SearchRecord = Record<string, unknown>;

export function createEnv(d: EnvDeps): CmdEnv {
  const ctx: RunCtx = {
    router: d.router,
    store: d.runtime.store,
    engine: d.engine,
    dismiss: () => {},
    page: true,
  };
  return {
    store: d.runtime.store,
    now: () => d.runtime.clock.now(),
    beat: () => d.runtime.clock.beat(),
    signal: d.signal,
    location: () => {
      const loc = d.router.state.location;
      return { pathname: loc.pathname, search: loc.search as SearchRecord };
    },
    actionEnv: () => readActionEnv(d.router),
    // The terminal rides in `?w=` when a command moves the primary window, so it stays beside what it opened.
    open: (target) => {
      navigateTo(d.router, target, 'keepTerminal');
      d.onOpened?.();
    },
    fly: (view) => {
      const e = d.engine();
      if (!e) return false;
      void e.flyTo(view.lat, view.lon, view.alt);
      track({ type: 'ui', what: 'fly' });
      return true;
    },
    action: (id, arg) => runAction(id, arg, ctx),
    searchHits: async (q) => (await d.queryClient.fetchQuery(queries.search(q))).hits,
    fetchBlock: async (key) => {
      try {
        return (await d.queryClient.fetchQuery(queries.block(key))).block;
      } catch {
        return null;
      }
    },
    replayRelay: () => replayLastBlock(d.runtime),
    watch: (id, on) => {
      const ui = useUi.getState();
      if (on) ui.watch(id);
      else ui.unwatch(id);
    },
    watched: () => useUi.getState().watched,
    achievementLines,
    version: ATLAS_VERSION,
  };
}
