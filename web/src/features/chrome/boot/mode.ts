// Which boot to play (design 9.1). A first visit gets the full sequence paced to at least 2.4 s; a visitor
// who has booted in this browser before gets the full sequence at its own pace; a visit within the same
// session (a reload, a new route in the same tab) gets a 300 ms fade with the moon already in orbit; reduced
// motion cross-fades. Automation (a driven browser) gets the quick path unless the URL asks for the whole
// show with `?boot=full`, so tests and screenshots never wait for a performance; `?boot=off` always skips.
// Every storage access is in try/catch: a private window plays the first-visit boot every time.

import type { BootMode } from './model';

export type BootChoice = BootMode | 'instant';

const SEEN_KEY = 'atlas.boot.seen.v1';
const SESSION_KEY = 'atlas.boot.session.v1';

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export interface ChooseInput {
  reduced: boolean;
  /** `location.search`. */
  search: string;
  /** `navigator.webdriver`: true in a driven browser. */
  automated: boolean;
  local: Store | null;
  session: Store | null;
}

const read = (s: Store | null, k: string): boolean => {
  try {
    return s?.getItem(k) === '1';
  } catch {
    return false;
  }
};

export function chooseBoot(i: ChooseInput): BootChoice {
  const force = new URLSearchParams(i.search).get('boot');
  if (force === 'off') return 'instant';
  const inSession = read(i.session, SESSION_KEY);
  if (force === 'full') return i.reduced ? 'reduced' : read(i.local, SEEN_KEY) ? 'return' : 'first';
  if (i.automated || inSession) return 'instant';
  if (i.reduced) return 'reduced';
  return read(i.local, SEEN_KEY) ? 'return' : 'first';
}

/** Remembers that this browser and this tab have booted. */
export function markBooted(local: Store | null, session: Store | null): void {
  try {
    local?.setItem(SEEN_KEY, '1');
  } catch {
    // A full quota or a private window only means the next visit plays the first-visit boot again.
  }
  try {
    session?.setItem(SESSION_KEY, '1');
  } catch {
    // Same.
  }
}

/** The choice for this page load, from the real environment. */
export function chooseBootNow(reduced: boolean): BootChoice {
  const safe = <T>(f: () => T): T | null => {
    try {
      return f();
    } catch {
      return null;
    }
  };
  return chooseBoot({
    reduced,
    search: typeof location === 'undefined' ? '' : location.search,
    automated: typeof navigator !== 'undefined' && navigator.webdriver === true,
    local: safe(() => localStorage),
    session: safe(() => sessionStorage),
  });
}

export const markBootedNow = (): void =>
  markBooted(
    (() => {
      try {
        return localStorage;
      } catch {
        return null;
      }
    })(),
    (() => {
      try {
        return sessionStorage;
      } catch {
        return null;
      }
    })(),
  );
