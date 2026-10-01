// The rules: given an event and what is already known, which achievements unlock and what the counters
// become. Pure (no storage, no clock, no React), so every rule has a test and the tracker only plumbs.

import { parseExtraWindows, windowForPath } from '../../shell/wm/route';
import type { WindowType } from '../../shell/wm/types';
import { ACHIEVEMENTS } from './catalog';
import type { AchievementEvent } from './events';
import type { Progress } from './state';

export interface Facts {
  unlocked: ReadonlySet<string>;
  progress: Progress;
}

export interface Outcome {
  /** Ids unlocked by this event, in catalogue order. */
  unlock: string[];
  /** The counters after this event (the same object when nothing changed). */
  progress: Progress;
}

const GOAL = Object.fromEntries(ACHIEVEMENTS.filter((a) => a.goal).map((a) => [a.id, a.goal as number]));

/** Every window type a URL shows: the path's own window plus the `?w=` extras. */
export function windowsOf(pathname: string, search: Readonly<Record<string, unknown>>): Set<WindowType> {
  const out = new Set<WindowType>();
  const primary = windowForPath(pathname);
  if (primary) out.add(primary.type);
  for (const w of parseExtraWindows(typeof search.w === 'string' ? search.w : undefined)) out.add(w.type);
  return out;
}

const APP_HISTORY = /^\/app\/[^/]+\/history\/\d+\/?$/;

export function evaluate(e: AchievementEvent, facts: Facts): Outcome {
  const unlock = new Set<string>();
  let progress = facts.progress;
  const give = (id: string) => {
    if (!facts.unlocked.has(id)) unlock.add(id);
  };
  const count = (key: 'paletteKeys' | 'commands' | 'blocks', id: string) => {
    progress = { ...progress, [key]: progress[key] + 1 };
    if (progress[key] >= (GOAL[id] ?? Number.POSITIVE_INFINITY)) give(id);
  };

  switch (e.type) {
    case 'route': {
      const w = windowsOf(e.pathname, e.search);
      if (w.has('about')) give('first-contact');
      if (w.has('node')) give('hello-node');
      if (w.has('host')) give('fan-out');
      if (w.has('app')) give('constellation');
      if (APP_HISTORY.test(e.pathname)) give('archaeologist');
      if (w.has('time')) give('time-traveller');
      if (w.has('queue')) give('the-queue');
      if (w.has('operator')) give('landlord');
      break;
    }
    case 'node.focus': {
      if (e.continent && !progress.continents.includes(e.continent)) {
        progress = { ...progress, continents: [...progress.continents, e.continent] };
        if (progress.continents.length >= (GOAL['six-continents'] ?? 6)) give('six-continents');
      }
      break;
    }
    case 'block': {
      if (e.watching) count('blocks', 'witness');
      if (e.paidWatched) give('payday');
      if (e.paidFocused && e.announcedFirst) give('on-target');
      break;
    }
    case 'zoom':
      if (e.band >= 3) give('close-up');
      break;
    case 'watched':
      if (e.count > 0) give('watcher');
      break;
    case 'palette':
      if (e.action === 'open' && e.via === 'key') count('paletteKeys', 'palette-native');
      break;
    case 'ui':
      if (e.what === 'copy') give('link-sharer');
      if (
        (e.what === 'motion' && (e.value === 'reduced' || e.value === 'off')) ||
        (e.what === 'perf' && e.value === 'lite')
      )
        give('keeping-it-calm');
      break;
    case 'terminal':
      count('commands', 'shell-script');
      if (e.streams) give('tail-f');
      break;
    case 'ambient.seconds':
      if (e.seconds >= 600) give('night-shift');
      break;
    case 'late':
      give('running-late');
      break;
    case 'reconnected':
      give('reconnected');
      break;
    case 'cut':
      give('before-and-after');
      break;
    case 'egg':
      give('easter-egg');
      break;
    default:
      break;
  }

  return { unlock: ACHIEVEMENTS.filter((a) => unlock.has(a.id)).map((a) => a.id), progress };
}
