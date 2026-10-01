// The launchers of the dock, the menus, the phone tabs and the keyboard (design 2.7, 8.5, 10.4): one
// list says what each one is called, which key runs it and what it does, so the four surfaces cannot
// drift apart. A launcher either opens a window (retargeting or raising one that is already open),
// goes to a route, or opens the command palette for the things that need a subject (a node, an app, an
// operator address).

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
import { useRuntime } from '../../app/context';
import { windowOfType } from '../wm/machine';
import { useWindowManager } from '../wm/react';
import type { WindowType } from '../wm/types';
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

const EXPLORER_TYPES = ['block', 'tx', 'address', 'mempool', 'supply', 'richlist'] as const;

export const LAUNCHERS: Record<LauncherId, Launcher> = {
  globe: { id: 'globe', label: 'Globe', key: 'G', icon: Globe, types: [], accent: 'chain' },
  nodes: { id: 'nodes', label: 'Nodes', key: 'N', icon: Server, types: ['node', 'host'], accent: 'operator' },
  apps: { id: 'apps', label: 'Apps', key: 'A', icon: Boxes, types: ['app'], accent: 'app' },
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
    types: ['operator'],
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

/**
 * What the palette opens with for a launcher that needs a subject: the kind's prefix, which scopes the palette to
 * that kind (`app ` lists the biggest apps, `node ` the next payees) until something else is typed. A launcher
 * that is not here opens it empty.
 */
export const PALETTE_SEED: Partial<Record<LauncherId, string>> = {
  nodes: 'node ',
  apps: 'app ',
  operator: 'operator ',
};

/** Runs a launcher. `source` is the launcher's element (the aperture opens out of it). */
export type RunLauncher = (id: LauncherId) => void;

/** The launcher runner: needs the router, the window manager and the live store. */
export function useLauncher(): RunLauncher {
  const nav = useShellNav();
  const wm = useWindowManager();
  const { store } = useRuntime();
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
        tipHeight: () => store.tip?.height ?? null,
      });
    },
    [nav, wm, store],
  );
}

interface LauncherEnv {
  nav: ShellNav;
  openWindowOfType(
    types: readonly WindowType[],
  ): { id: string; type: WindowType; key: string | null; binding: string } | null;
  focus(windowId: string): void;
  tipHeight(): number | null;
}

/** What each launcher does (exported for tests; the hook binds the environment). */
export function runLauncher(id: LauncherId, env: LauncherEnv): void {
  const { nav } = env;
  const l = LAUNCHERS[id];
  switch (id) {
    case 'globe':
      nav.globe();
      return;
    case 'nodes':
    case 'apps':
    case 'operator': {
      // These need a subject: raise the window if one is open, otherwise ask the palette for it.
      const w = env.openWindowOfType(l.types);
      if (w) {
        if (w.binding === 'extra') nav.open({ type: w.type, key: w.key });
        else env.focus(w.id);
        return;
      }
      if (id === 'nodes') {
        const sel = nav.here().search.sel;
        const first = typeof sel === 'string' ? sel.split(',')[0] : undefined;
        if (first) {
          nav.open({ type: 'node', key: first });
          return;
        }
      }
      nav.palette(PALETTE_SEED[id] ?? '');
      return;
    }
    case 'explorer': {
      const w = env.openWindowOfType(l.types);
      if (w) {
        if (w.binding === 'extra') nav.open({ type: w.type, key: w.key });
        else env.focus(w.id);
        return;
      }
      const tip = env.tipHeight();
      if (tip !== null) nav.open({ type: 'block', key: String(tip) });
      else nav.open({ type: 'mempool', key: null });
      return;
    }
    case 'ambient':
      nav.go('/ambient', {});
      return;
    default:
      nav.open({ type: l.types[0] ?? 'settings', key: null });
  }
}
