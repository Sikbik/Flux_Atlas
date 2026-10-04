// The launchers of the dock, the menus, the phone tabs and the keyboard (design 2.7, 8.5, 10.4): one
// list says what each one is called, which key runs it and what it does, so the four surfaces cannot
// drift apart. A launcher either opens a window (retargeting or raising one that is already open),
// or goes to a route. The Explorer, Nodes and Apps launchers open their hub (a landing with search and the
// leaderboards) unless a window of their kind is already open, which they raise instead. The Operator launcher opens
// the watchlist, the operator view of the nodes you follow.

import {
  Blocks,
  Boxes,
  ChartNoAxesCombined,
  CloudRain,
  Coins,
  Globe,
  History,
  type LucideIcon,
  Orbit,
  Server,
  SlidersHorizontal,
  SquareTerminal,
  UserRoundCheck,
} from 'lucide-react';
import { useCallback } from 'react';
import { windowOfType } from '../wm/machine';
import { useWindowManager } from '../wm/react';
import type { WindowRef, WindowType } from '../wm/types';
import { type ShellNav, useShellNav } from './nav';

export type LauncherId =
  | 'globe'
  | 'nodes'
  | 'apps'
  | 'explorer'
  | 'queue'
  | 'analytics'
  | 'time'
  | 'operator'
  | 'terminal'
  | 'weather'
  | 'ambient'
  | 'settings'
  | 'about';

export interface Launcher {
  id: LauncherId;
  label: string;
  /** The key that runs it (a letter, or the backtick); shown as a key cap. */
  key: string | null;
  /** Displayed in place of `key` when the combination has a modifier. */
  keyLabel?: readonly string[];
  /** Line icon; the About launcher draws the symbol mark instead. */
  icon: LucideIcon | null;
  /** The window types this launcher stands for (the dock shows them open, focused or minimized). */
  types: readonly WindowType[];
  /** The window accent (`data-accent`) that tints its open tick and its focused glow. */
  accent: 'chain' | 'app' | 'analytics' | 'time' | 'operator' | 'terminal' | 'pulse';
}

const EXPLORER_TYPES = ['explorer', 'block', 'tx', 'address', 'mempool', 'supply', 'richlist'] as const;

export const LAUNCHERS: Record<LauncherId, Launcher> = {
  globe: { id: 'globe', label: 'Globe', key: 'G', icon: Globe, types: [], accent: 'chain' },
  nodes: {
    id: 'nodes',
    label: 'Nodes',
    key: 'N',
    icon: Server,
    types: ['nodes', 'node', 'host'],
    accent: 'operator',
  },
  apps: { id: 'apps', label: 'Apps', key: 'A', icon: Boxes, types: ['apps', 'app'], accent: 'app' },
  explorer: {
    id: 'explorer',
    label: 'Explorer',
    key: 'E',
    icon: Blocks,
    types: EXPLORER_TYPES,
    accent: 'chain',
  },
  queue: { id: 'queue', label: 'Payment queue', key: 'Q', icon: Coins, types: ['queue'], accent: 'chain' },
  analytics: {
    id: 'analytics',
    label: 'Analytics',
    key: 'S',
    icon: ChartNoAxesCombined,
    types: ['analytics'],
    accent: 'analytics',
  },
  time: { id: 'time', label: 'Time machine', key: 'T', icon: History, types: ['time'], accent: 'time' },
  operator: {
    id: 'operator',
    label: 'Operator',
    key: 'O',
    icon: UserRoundCheck,
    types: ['operator', 'wallet'],
    accent: 'operator',
  },
  terminal: {
    id: 'terminal',
    label: 'Terminal',
    key: '`',
    icon: SquareTerminal,
    types: ['terminal'],
    accent: 'terminal',
  },
  weather: {
    id: 'weather',
    label: 'Weather layer',
    key: 'W',
    icon: CloudRain,
    types: ['weather'],
    accent: 'time',
  },
  ambient: {
    id: 'ambient',
    label: 'Ambient mode',
    key: null,
    keyLabel: ['shift', 'A'],
    icon: Orbit,
    types: [],
    accent: 'pulse',
  },
  settings: {
    id: 'settings',
    label: 'Settings',
    key: null,
    icon: SlidersHorizontal,
    types: ['settings'],
    accent: 'pulse',
  },
  about: { id: 'about', label: 'About Flux', key: 'M', icon: null, types: ['about'], accent: 'chain' },
};

/** The dock's order (2.7): nine launchers, a divider, then the utilities and About Flux last. */
export const DOCK_MAIN: readonly LauncherId[] = [
  'globe',
  'nodes',
  'apps',
  'explorer',
  'queue',
  'analytics',
  'time',
  'operator',
  'terminal',
];
export const DOCK_UTILITY: readonly LauncherId[] = ['weather', 'ambient', 'settings'];

/** The key caps a launcher shows. */
export function keyCaps(l: Launcher): readonly string[] {
  return l.keyLabel ?? (l.key ? [l.key] : []);
}

/** The Operator launcher's window: the nodes you follow (`/operator/watchlist`), which also finds an operator to follow. */
export const WATCHLIST: WindowRef = { type: 'operator', key: 'watchlist' };

/** The Explorer launcher's window: the landing (`/explorer`), the hub from which every explorer view opens. */
export const EXPLORER_HOME: WindowRef = { type: 'explorer', key: null };
/** The Nodes launcher's window: the hub of the network's nodes and operators (`/nodes`). */
export const NODES_HOME: WindowRef = { type: 'nodes', key: null };
/** The Apps launcher's window: the hub of the app network (`/apps`). */
export const APPS_HOME: WindowRef = { type: 'apps', key: null };

/** The hub each hub launcher opens when none of its windows is open. */
const HUB_HOME: Partial<Record<LauncherId, WindowRef>> = {
  explorer: EXPLORER_HOME,
  nodes: NODES_HOME,
  apps: APPS_HOME,
};

/** Runs a launcher. `source` is the launcher's element (the aperture opens out of it). */
export type RunLauncher = (id: LauncherId) => void;

/** The launcher runner: needs the router, the window manager and the live store. */
export function useLauncher(): RunLauncher {
  const nav = useShellNav();
  const wm = useWindowManager();
  return useCallback(
    (id) => {
      runLauncher(id, {
        nav,
        openWindowOfType: (types) => {
          const s = wm.getState();
          for (const t of types) {
            const w = windowOfType(s, t);
            if (w) return w;
          }
          return null;
        },
        focus: (windowId) => wm.dispatch({ t: 'focus', id: windowId }),
        isFront: (windowId) => wm.getState().focused === windowId,
      });
    },
    [nav, wm],
  );
}

interface LauncherEnv {
  nav: ShellNav;
  openWindowOfType(
    types: readonly WindowType[],
  ): { id: string; type: WindowType; key: string | null; binding: string } | null;
  focus(windowId: string): void;
  /** Whether the window is the one in front (the focused one). */
  isFront(windowId: string): boolean;
}

/** What each launcher does (exported for tests; the hook binds the environment). */
export function runLauncher(id: LauncherId, env: LauncherEnv): void {
  const { nav } = env;
  const l = LAUNCHERS[id];
  switch (id) {
    case 'globe':
      nav.globe();
      return;
    case 'operator': {
      // Raise an operator window if one is open (an address, or the watchlist), otherwise open the watchlist.
      const w = env.openWindowOfType(l.types);
      if (w) {
        if (w.binding === 'extra') nav.open({ type: w.type, key: w.key });
        else env.focus(w.id);
        return;
      }
      nav.open(WATCHLIST);
      return;
    }
    case 'explorer':
    case 'nodes':
    case 'apps': {
      // Raise the window of this kind that is open, whatever it shows (a block, a node, an app, the hub itself).
      // When that window is already in front, raising it would change nothing, so the launcher goes home instead:
      // the hub, from which the latest block, a node or an app is one action away. With none open it opens the hub.
      const home = HUB_HOME[id] ?? { type: l.types[0] ?? 'settings', key: null };
      const w = env.openWindowOfType(l.types);
      if (w && !(env.isFront(w.id) && w.type !== home.type)) {
        if (w.binding === 'extra') nav.open({ type: w.type, key: w.key });
        else env.focus(w.id);
        return;
      }
      nav.open(home);
      return;
    }
    case 'ambient':
      nav.go('/ambient', {});
      return;
    default:
      nav.open({ type: l.types[0] ?? 'settings', key: null });
  }
}
