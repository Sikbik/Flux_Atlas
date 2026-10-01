// Typed route tree for the design IA (section 2.2). The globe is persistent and never re-mounts;
// routes are windows rendered over it. Params and search params are validated here, so views
// receive typed values and a malformed URL resolves to a 404 instead of a crash.

import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  notFound,
  redirect,
  useRouter,
  useRouterState,
} from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';
import { queries } from '../api/queries';
import { GlobeCanvas, GlobeProvider } from '../globe';
import { Shell } from '../shell';
import {
  AboutView,
  AddressView,
  AmbientView,
  AnalyticsView,
  AppHistoryView,
  AppView,
  BlockView,
  GlobeHome,
  HostView,
  MempoolView,
  NodeView,
  OperatorView,
  QueueView,
  RichListView,
  SearchResultsView,
  SettingsView,
  SupplyView,
  TerminalView,
  TimeMachineView,
  TxView,
  WeatherView,
} from '../views';
import { useNetwork, useRuntime } from './context';
import { NotFound, RouteError } from './errors';
import type { AtlasRuntime } from './runtime';
import {
  ANALYTICS_TABS,
  type AnalyticsTab,
  QUEUE_TIERS,
  type QueueTier,
  validateGlobalSearch,
  validateOperatorSearch,
  validateTerminalSearch,
  validateTimeSearch,
} from './search';
import { routeForHit } from './searchRoutes';
import { canonicalNodeLocation, isUnresolvableLegacyKey, selectionKeys } from './selection';

export interface RouterContext {
  queryClient: QueryClient;
  runtime: AtlasRuntime;
}

/**
 * Feeds URL selection (`/node/:key`, `?sel=`) into the live runtime as node keys; the runtime maps
 * them to ids of the loaded snapshot, again after every resync (the watchlist syncs itself).
 */
function useSelectionSync() {
  const runtime = useRuntime();
  const location = useRouterState({ select: (s) => s.location });
  useEffect(() => {
    runtime.setSelected(selectionKeys(location.pathname, (location.search as { sel?: unknown }).sel));
  }, [runtime, location]);
}

/**
 * Older node links (`/node/<id>`, `/node/<ip:port>`, the same in `?sel=` and `?w=`) are resolved
 * against the loaded snapshot once and replaced with the outpoint form (ARCHITECTURE 8.1).
 */
function useCanonicalNodeUrl() {
  const runtime = useRuntime();
  const router = useRouter();
  const gen = useNetwork((s) => (s.loaded ? s.snapshotGen : 0));
  const location = useRouterState({ select: (s) => s.location });
  useEffect(() => {
    if (gen === 0) return;
    const next = canonicalNodeLocation(
      runtime.store.nodes,
      location.pathname,
      location.search as Record<string, unknown>,
    );
    if (!next) return;
    void router.navigate({
      href: next.pathname + router.options.stringifySearch(next.search),
      hash: location.hash || undefined,
      replace: true,
    });
  }, [runtime, router, gen, location]);
}

/**
 * The root layout never unmounts: the globe (GlobeCanvas, the living wallpaper) is mounted once here,
 * and the shell turns the matched route into a window over it (the route's component renders inside
 * the window through the shell's <Outlet />).
 */
function RootLayout() {
  useSelectionSync();
  useCanonicalNodeUrl();
  const ambient = useRouterState({ select: (s) => s.location.pathname === '/ambient' });
  return (
    <GlobeProvider>
      <div className="atlas" data-ambient={ambient || undefined}>
        <GlobeCanvas />
        <Shell />
      </div>
    </GlobeProvider>
  );
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  validateSearch: validateGlobalSearch,
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: RouteError,
});

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: GlobeHome });

const nodeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/node/$key',
  component: function NodeRoute() {
    const { key } = nodeRoute.useParams();
    // An older key (id, ip:port) the snapshot cannot place: not found (an outpoint goes to the server).
    const runtime = useRuntime();
    const gen = useNetwork((s) => (s.loaded ? s.snapshotGen : 0));
    const missing = useMemo(
      () => gen > 0 && isUnresolvableLegacyKey(runtime.store.nodes, key),
      [runtime, gen, key],
    );
    if (missing) return <NotFound />;
    return <NodeView nodeKey={key} />;
  },
});

const hostRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/host/$ip',
  component: function HostRoute() {
    const { ip } = hostRoute.useParams();
    return <HostView ip={ip} />;
  },
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/$name',
  component: function AppRoute() {
    const { name } = appRoute.useParams();
    return <AppView name={name} />;
  },
});

const appHistoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/$name/history/$n',
  params: {
    parse: (p) => {
      const n = Number(p.n);
      if (!Number.isInteger(n) || n < 0) throw notFound();
      return { name: p.name, n };
    },
    stringify: (p) => ({ name: p.name, n: String(p.n) }),
  },
  component: function AppHistoryRoute() {
    const { name, n } = appHistoryRoute.useParams();
    return <AppHistoryView name={name} n={n} />;
  },
});

const blockRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/block/$key',
  component: function BlockRoute() {
    const { key } = blockRoute.useParams();
    return <BlockView blockKey={key} />;
  },
});

const txRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tx/$txid',
  component: function TxRoute() {
    const { txid } = txRoute.useParams();
    return <TxView txid={txid} />;
  },
});

const addressRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/address/$addr',
  component: function AddressRoute() {
    const { addr } = addressRoute.useParams();
    return <AddressView addr={addr} />;
  },
});

const mempoolRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/mempool',
  component: MempoolView,
});
const supplyRoute = createRoute({ getParentRoute: () => rootRoute, path: '/supply', component: SupplyView });
const richlistRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/richlist',
  component: RichListView,
});

const queueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/queue',
  component: () => <QueueView />,
});

const queueTierRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/queue/$tier',
  params: {
    parse: (p) => {
      if (!(QUEUE_TIERS as readonly string[]).includes(p.tier)) throw notFound();
      return { tier: p.tier as QueueTier };
    },
    stringify: (p) => ({ tier: p.tier }),
  },
  component: function QueueTierRoute() {
    const { tier } = queueTierRoute.useParams();
    return <QueueView tier={tier} />;
  },
});

const analyticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/analytics',
  component: () => <AnalyticsView tab="overview" />,
});

const analyticsTabRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/analytics/$tab',
  params: {
    parse: (p) => {
      if (!(ANALYTICS_TABS as readonly string[]).includes(p.tab)) throw notFound();
      return { tab: p.tab as AnalyticsTab };
    },
    stringify: (p) => ({ tab: p.tab }),
  },
  component: function AnalyticsTabRoute() {
    const { tab } = analyticsTabRoute.useParams();
    return <AnalyticsView tab={tab} />;
  },
});

const operatorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/operator/$addr',
  validateSearch: validateOperatorSearch,
  component: function OperatorRoute() {
    const { addr } = operatorRoute.useParams();
    return <OperatorView addr={addr} />;
  },
});

const timeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/time',
  validateSearch: validateTimeSearch,
  component: function TimeRoute() {
    const { t, speed } = timeRoute.useSearch();
    return <TimeMachineView t={t} speed={speed} />;
  },
});

const weatherRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/weather',
  component: WeatherView,
});

const terminalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/terminal',
  validateSearch: validateTerminalSearch,
  component: function TerminalRoute() {
    const { cmd } = terminalRoute.useSearch();
    return <TerminalView cmd={cmd} />;
  },
});

const ambientRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ambient',
  component: AmbientView,
});
const aboutRoute = createRoute({ getParentRoute: () => rootRoute, path: '/about', component: AboutView });
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsView,
});

/**
 * `/q/:text`: resolves an ambiguous string with the search API and redirects to the best hit. The
 * `#all` form (the palette's "See all results") skips the redirect and lists every hit.
 */
const qRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/q/$text',
  loader: async ({ params, context, location }) => {
    const res = await context.queryClient.ensureQueryData(queries.search(params.text));
    if (location.hash.replace(/^#/, '') === 'all') return res;
    const best = res.hits[0];
    const target = best ? routeForHit(best) : null;
    if (target) throw redirect({ ...target, replace: true } as Parameters<typeof redirect>[0]);
    return res;
  },
  component: function QRoute() {
    const { text } = qRoute.useParams();
    return <SearchResultsView text={text} />;
  },
});

const devLiveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev/live',
  component: lazyRouteComponent(() => import('../features/dev/LiveInspector'), 'LiveInspector'),
});

const devMotionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev/motion',
  component: lazyRouteComponent(() => import('../motion/gallery/MotionGallery'), 'MotionGallery'),
});

const devKitRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev/kit',
  component: lazyRouteComponent(() => import('../ui/gallery/Gallery'), 'Gallery'),
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  nodeRoute,
  hostRoute,
  appRoute,
  appHistoryRoute,
  blockRoute,
  txRoute,
  addressRoute,
  mempoolRoute,
  supplyRoute,
  richlistRoute,
  queueRoute,
  queueTierRoute,
  analyticsRoute,
  analyticsTabRoute,
  operatorRoute,
  timeRoute,
  weatherRoute,
  terminalRoute,
  ambientRoute,
  aboutRoute,
  settingsRoute,
  qRoute,
  devLiveRoute,
  devMotionRoute,
  devKitRoute,
]);

export function createAtlasRouter(context: RouterContext) {
  return createRouter({
    routeTree,
    context,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: NotFound,
    scrollRestoration: false,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAtlasRouter>;
  }
}
