// The palette model as a hook: local matches at once, the server's hits merged in when they arrive.
// The server is asked only for what the local index cannot resolve (see `serverQueryFor`), after a short
// pause in typing, and hits left over from an earlier query are never shown for a newer one.

import { useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { queries } from '../../../api/queries';
import { useNetwork, useRuntime } from '../../../app/context';
import { useUi } from '../../../store/ui';
import { usePrefs } from '../../settings/prefs';
import type { ActionEnv } from './actions';
import { buildModel, type GroupLimits, parseInput, serverQueryFor } from './model';
import type { KindChip, PaletteModel, RecentEntry } from './types';

export type ServerState = 'idle' | 'loading' | 'error' | 'done';

export interface SearchModel {
  model: PaletteModel;
  server: ServerState;
}

const SERVER_PAUSE_MS = 160;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (value === null || value === undefined) {
      setV(value);
      return;
    }
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The catalogue's view of the app, reactive to the route and the preferences. */
export function useActionEnv(): ActionEnv {
  const search = useRouterState({ select: (s) => s.location.search }) as Record<string, unknown>;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const motion = useUi((s) => s.motion);
  const perf = useUi((s) => s.perf);
  const art = useUi((s) => s.globeArt);
  const ambientIdleMin = usePrefs((s) => s.ambientIdleMin);
  const sound = usePrefs((s) => s.ambientSound);
  return useMemo(
    () => ({ search, pathname, motion, perf, art, ambientIdleMin, sound }),
    [search, pathname, motion, perf, art, ambientIdleMin, sound],
  );
}

export function useSearchModel(opts: {
  raw: string;
  chip?: KindChip;
  recents?: readonly RecentEntry[];
  limits?: GroupLimits;
  /**
   * `shape` (the palette) asks the server only for what the local index cannot resolve; `all` (the
   * results page) asks for every text and does not wait for a pause in typing.
   */
  ask?: 'shape' | 'all';
}): SearchModel {
  const { store } = useRuntime();
  // Coarse store tick: new blocks, payees, apps and every 50th node change rebuild the rows.
  const tick = useNetwork(
    (s) =>
      s.versions.Blocks +
      s.versions.NextPayees +
      s.versions.Apps +
      Math.floor(s.versions.Nodes / 50) +
      (s.loaded ? 1 : 0),
  );
  const env = useActionEnv();

  const askAll = opts.ask === 'all';
  const wanted = useMemo(() => {
    const input = parseInput(opts.raw);
    if (!askAll) return serverQueryFor(input);
    if (!input.text || input.prefix === 'goto' || input.prefix === 'layer' || input.prefix === 'filter')
      return null;
    return input.text.trim();
  }, [opts.raw, askAll]);
  const paused = useDebounced(wanted, SERVER_PAUSE_MS);
  const asked = askAll ? wanted : paused;
  const q = useQuery(queries.search(asked ?? ''));
  // `q.data.q` is the query the server answered (trimmed): a newer text never shows an older answer.
  const fresh =
    asked !== null &&
    asked === wanted &&
    !q.isPlaceholderData &&
    q.data !== undefined &&
    q.data.q === asked.trim();
  const hits = fresh ? q.data.hits : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` stands for the store's contents
  const model = useMemo(
    () =>
      buildModel({
        raw: opts.raw,
        store,
        hits,
        env,
        ...(opts.chip ? { chip: opts.chip } : {}),
        ...(opts.recents ? { recents: opts.recents } : {}),
        ...(opts.limits ? { limits: opts.limits } : {}),
      }),
    [opts.raw, opts.chip, opts.recents, opts.limits, store, hits, env, tick],
  );

  let server: ServerState = 'idle';
  if (wanted !== null) {
    if (asked === wanted && q.isError) server = 'error';
    else if (fresh) server = 'done';
    else server = 'loading';
  }
  return { model, server };
}
