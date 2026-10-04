// The action catalogue: everything the palette can do besides finding a thing. Pure data, so the model
// can rank it and the terminal can reuse the same wording. Pages and windows carry a navigation target
// (the globe follows the URL, so opening is navigating); the rest carry an id that `run.ts` executes.

import { ANALYTICS_TABS } from '../../../app/search';
import type { GlobeArtPref, MotionPref, PerfPref } from '../../../store/ui';
import { layerHidden, parseLayers } from '../layers';
import type { NavTarget } from '../navigation';
import { matchScore } from './rank';
import type { IconId, PaletteRow, RowAction, RowMeta } from './types';

/** What the catalogue needs to know about the app to describe current state. */
export interface ActionEnv {
  /** Search params of the current route. */
  search: Record<string, unknown>;
  pathname: string;
  motion: MotionPref;
  perf: PerfPref;
  art: GlobeArtPref;
  ambientIdleMin: number;
  sound: boolean;
}

export interface ActionDef {
  id: string;
  title: string;
  sub?: string;
  /** Extra words that find the action. */
  keywords: string;
  icon: IconId;
  /** What the type chip says. */
  chip: string;
  keys?: readonly string[];
  /** Opens a page or window: Enter navigates, Shift+Enter opens alongside. */
  go?: NavTarget;
  /** The argument `run.ts` receives. */
  arg?: string;
  alongside?: boolean;
  /** True when the action describes what is already in force (a tick instead of an Enter hint). */
  current?: (env: ActionEnv) => boolean;
  /** Shown only while this holds (clearing filters only makes sense with filters on). */
  when?: (env: ActionEnv) => boolean;
}

const search = (env: ActionEnv, k: string): unknown => env.search[k];

const FILTER_KEYS = ['tier', 'cc', 'org', 'ver', 'arcane', 'watched'] as const;
const anyFilter = (env: ActionEnv) => FILTER_KEYS.some((k) => search(env, k) !== undefined);
const tierIs = (env: ActionEnv, tier: string) => String(search(env, 'tier') ?? '').toLowerCase() === tier;
const meshIs = (env: ActionEnv, mode: 'sel' | 'flow' | 'off') =>
  parseLayers(typeof env.search.l === 'string' ? env.search.l : undefined).mesh === mode;
const labelsOn = (env: ActionEnv) =>
  !layerHidden(typeof env.search.l === 'string' ? env.search.l : undefined, 'labels');

const page = (
  id: string,
  title: string,
  sub: string,
  keywords: string,
  icon: IconId,
  to: string,
  extra: Partial<ActionDef> = {},
): ActionDef => ({ id, title, sub, keywords, icon, chip: 'Page', go: { to }, alongside: true, ...extra });

const tabTitle = (t: string) => t[0]!.toUpperCase() + t.slice(1);

export const ACTIONS: readonly ActionDef[] = [
  // Pages and windows
  page(
    'view.globe',
    'Globe',
    'The live network with nothing in front of it',
    'home map world planet',
    'globe',
    '/',
    {
      alongside: false,
    },
  ),
  page(
    'view.nodes',
    'Nodes',
    'The network node by node: top operators, countries, hosts, and search',
    'network fleet hosts decentralization leaderboard find a node operators',
    'node',
    '/nodes',
    { keys: ['N'] },
  ),
  page(
    'view.operators',
    'Top node operators',
    'Who runs the most nodes, and where',
    'operators zelid runners fleets leaderboard biggest largest',
    'operator',
    '/nodes',
    { go: { to: '/nodes', fragment: 'operators' } },
  ),
  page(
    'view.apps',
    'Apps',
    'The app network: top apps and owners, where they run, and the economy',
    'applications docker deployments owners leaderboard marketplace find an app',
    'app',
    '/apps',
    { keys: ['A'] },
  ),
  page(
    'view.queue',
    'Payment queue',
    'Who is paid next, by tier',
    'next payees fifo order cumulus nimbus stratus',
    'queue',
    '/queue',
  ),
  page(
    'view.analytics',
    'Analytics',
    'Geography, hosting, capacity, versions and churn',
    'stats charts numbers overview',
    'analytics',
    '/analytics',
  ),
  ...ANALYTICS_TABS.filter((t) => t !== 'overview').map((t) => ({
    id: `view.analytics.${t}`,
    title: `Analytics: ${tabTitle(t)}`,
    keywords: `${t} analytics stats`,
    icon: 'analytics' as const,
    chip: 'Page',
    go: { to: `/analytics/${t}` } as NavTarget,
    alongside: true,
  })),
  page(
    'view.explorer',
    'Explorer',
    'The chain at a glance: blocks, supply, charts, the rich list and search',
    'chain overview hub blockchain blocks transactions explorer latest block',
    'explorer',
    '/explorer',
    { keys: ['E'] },
  ),
  page(
    'view.mempool',
    'Mempool',
    'Transactions waiting for a block',
    'pending unconfirmed transactions',
    'tx',
    '/mempool',
  ),
  page(
    'view.supply',
    'Supply',
    'Circulating supply and the emission schedule',
    'coins emission halving reduction',
    'explorer',
    '/supply',
  ),
  page(
    'view.richlist',
    'Rich list',
    'Who holds the supply, and who moved',
    'whales balances top addresses richest holders concentration movers gainers losers',
    'address',
    '/richlist',
  ),
  page(
    'view.time',
    'Time machine',
    'Replay the network at any moment',
    'history replay archive past rewind archaeology',
    'time',
    '/time',
  ),
  page(
    'view.weather',
    'Network weather',
    'The health of the network as a field',
    'health storm unreachable',
    'weather',
    '/weather',
  ),
  page(
    'view.terminal',
    'Terminal',
    'Every command, with live output',
    'console shell cli commands prompt',
    'terminal',
    '/terminal',
  ),
  page(
    'view.settings',
    'Settings',
    'Art style, motion, performance, ambient and notifications',
    'preferences options config',
    'settings',
    '/settings',
  ),
  {
    id: 'view.achievements',
    title: 'Achievements',
    sub: 'What you have found so far',
    keywords: 'badges trophies progress secrets',
    icon: 'award',
    chip: 'Page',
    go: { to: '/settings', fragment: 'achievements' },
  },
  page(
    'view.about',
    'About Flux',
    'The moon, live network totals',
    'moon flux atlas credits version',
    'moon',
    '/about',
    {
      keys: ['M'],
    },
  ),

  // Ambient
  {
    id: 'ambient.enter',
    title: 'Ambient mode',
    sub: 'Let the network drift. Any key brings you back',
    keywords: 'screensaver screen saver kiosk idle tv wallpaper',
    icon: 'ambient',
    chip: 'Action',
    keys: ['shift', 'A'],
  },

  // The globe's look
  ...(
    [
      ['marble', 'Marble', 'NASA imagery through a slate grade'],
      ['holo', 'Holo', 'The dot-matrix planet'],
      ['neon', 'Neon', 'Glowing coastlines'],
    ] as const
  ).map(
    ([art, name, sub]): ActionDef => ({
      id: `art.${art}`,
      title: `Art style: ${name}`,
      sub,
      keywords: `globe look theme style appearance ${art}`,
      icon: 'art',
      chip: 'Setting',
      current: (env) => env.art === art,
    }),
  ),
  ...(
    [
      ['full', 'Full', 'Every transition and effect'],
      ['reduced', 'Reduced', 'Quieter transitions, the data stays live'],
      ['off', 'Off', 'No motion at all'],
      ['system', 'Follow the system', 'Use the operating system setting'],
    ] as const
  ).map(
    ([m, name, sub]): ActionDef => ({
      id: `motion.${m}`,
      title: `Motion: ${name}`,
      sub,
      keywords: `animation accessibility reduce ${m}`,
      icon: 'motion',
      chip: 'Setting',
      current: (env) => env.motion === m,
    }),
  ),
  ...(
    [
      ['auto', 'Automatic', 'Pick a level from the frame rate'],
      ['high', 'High', 'Everything on'],
      ['balanced', 'Balanced', 'Lighter effects'],
      ['lite', 'Lite', 'The dot-matrix planet, fewer effects'],
    ] as const
  ).map(
    ([p, name, sub]): ActionDef => ({
      id: `perf.${p}`,
      title: `Performance: ${name}`,
      sub,
      keywords: `fps battery gpu quality graphics ${p}`,
      icon: 'perf',
      chip: 'Setting',
      current: (env) => env.perf === p,
    }),
  ),
  {
    id: 'sound.toggle',
    title: 'Ambient sound',
    sub: 'A quiet generative pad in ambient mode',
    keywords: 'audio music mute volume noise',
    icon: 'sound',
    chip: 'Setting',
  },

  // Layers (they live in the URL, so they follow the route)
  ...(
    [
      ['sel', 'Peers of the selection', 'The links of the node you picked'],
      ['flow', 'Network flow', 'Every link at once, with packets'],
      ['off', 'Off', 'Hide the mesh'],
    ] as const
  ).map(
    ([m, name, sub]): ActionDef => ({
      id: `layer.mesh.${m}`,
      title: `Mesh: ${name}`,
      sub,
      keywords: `layer gossip p2p network links connections peers ${m}`,
      icon: 'mesh',
      chip: 'Layer',
      current: (env) => meshIs(env, m),
    }),
  ),
  {
    id: 'layer.labels.on',
    title: 'Place labels: show',
    sub: 'Country and city names on the globe',
    keywords: 'layer names text cities countries',
    icon: 'place',
    chip: 'Layer',
    current: (env) => labelsOn(env),
  },
  {
    id: 'layer.labels.off',
    title: 'Place labels: hide',
    sub: 'A cleaner globe for screenshots',
    keywords: 'layer names text cities countries clean',
    icon: 'place',
    chip: 'Layer',
    current: (env) => !labelsOn(env),
  },

  // Filters
  ...(['cumulus', 'nimbus', 'stratus'] as const).map(
    (t): ActionDef => ({
      id: `filter.tier.${t}`,
      title: `Filter: ${tabTitle(t)} only`,
      sub: 'Dim every other tier',
      keywords: `tier dim only show ${t}`,
      icon: 'filter',
      chip: 'Filter',
      arg: `tier=${t}`,
      current: (env) => tierIs(env, t),
    }),
  ),
  {
    id: 'filter.arcane',
    title: 'Filter: ArcaneOS nodes',
    sub: 'Only nodes running ArcaneOS',
    keywords: 'dim only os arcane',
    icon: 'filter',
    chip: 'Filter',
    arg: 'arcane',
    current: (env) => search(env, 'arcane') === true,
  },
  {
    id: 'filter.watched',
    title: 'Filter: watched nodes',
    sub: 'Only the nodes on your watchlist',
    keywords: 'dim only watchlist favourites',
    icon: 'watch',
    chip: 'Filter',
    arg: 'watched',
    current: (env) => search(env, 'watched') === true,
  },
  {
    id: 'filter.clear',
    title: 'Clear all filters',
    sub: 'Light the whole globe again',
    keywords: 'reset remove undim filters',
    icon: 'filter',
    chip: 'Filter',
    when: anyFilter,
  },

  // Utility
  {
    id: 'copy.link',
    title: 'Copy link to this view',
    sub: 'The URL holds the whole state: camera, filters, windows',
    keywords: 'share url permalink bookmark',
    icon: 'link',
    chip: 'Action',
  },
];

const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

export function actionById(id: string): ActionDef | undefined {
  return BY_ID.get(id);
}

/** The row action an entry runs: a navigation, or the id with its argument. */
export function rowActionFor(a: ActionDef): RowAction {
  return a.go ? { type: 'go', target: a.go } : { type: 'run', id: a.id, ...(a.arg ? { arg: a.arg } : {}) };
}

export function metaFor(a: ActionDef, env: ActionEnv): RowMeta | undefined {
  if (a.current?.(env)) return { type: 'current' };
  if (a.id === 'sound.toggle') return { type: 'text', text: env.sound ? 'On' : 'Off' };
  if (a.keys) return { type: 'keys', keys: a.keys };
  return undefined;
}

/**
 * A page whose first word is exactly what was typed ("rich" for the Rich list, "time" for the Time machine) is a hit on
 * its name. Without this a place that merely starts with the same letters ("Richmond") ties with it and, because places
 * are listed before pages, outranks the page the word was typed for.
 */
function leadWordHit(a: ActionDef, q: string): number {
  const typed = q.trim().toLowerCase();
  if (a.chip !== 'Page' || typed.length < 3) return 0;
  return a.title.toLowerCase().split(' ')[0] === typed ? 100 : 0;
}

/** How well the query finds an action: the title weighs most, keywords and the sub-line less. */
export function actionScore(a: ActionDef, q: string): number {
  const t = matchScore(q, a.title, { fuzzy: true });
  let kw = 0;
  for (const w of a.keywords.split(' ')) kw = Math.max(kw, matchScore(q, w) - 20);
  const sub = a.sub ? matchScore(q, a.sub) - 30 : 0;
  return Math.max(t, kw, sub, leadWordHit(a, q), 0);
}

/** The catalogue as palette rows for a query (empty query lists the first few worth showing). */
export function actionRows(q: string, env: ActionEnv, limit = 8): { rows: PaletteRow[]; total: number } {
  const scored: { a: ActionDef; score: number }[] = [];
  for (const a of ACTIONS) {
    if (a.when && !a.when(env)) continue;
    const score = actionScore(a, q);
    if (score > 0) scored.push({ a, score });
  }
  scored.sort((x, y) => y.score - x.score);
  const rows = scored.slice(0, limit).map(({ a, score }) => actionRow(a, env, score));
  return { rows, total: scored.length };
}

export function actionRow(a: ActionDef, env: ActionEnv, score: number): PaletteRow {
  const meta = metaFor(a, env);
  return {
    id: `action:${a.id}`,
    group: 'commands',
    kind: 'action',
    icon: a.icon,
    title: a.title,
    ...(a.sub ? { sub: a.sub } : {}),
    chip: a.chip,
    ...(meta ? { meta } : {}),
    score,
    action: rowActionFor(a),
    ...(a.alongside ? { alongside: true } : {}),
    remember: a.go !== undefined || a.id === 'ambient.enter',
  };
}
