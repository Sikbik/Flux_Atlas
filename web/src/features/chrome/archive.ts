// The time machine's moment, for the rest of the page. While the time machine shows a recorded moment it writes
// that moment to <html> (`publishArchive`, called by its view) and takes it away when it leaves. The Beat (the
// top bar, the phone's header, the Live sheet) and the status bar read it here and switch to the archived moment
// without knowing the feature exists; "Return to live" removes the attributes and everything reads the present
// again. Attributes rather than a store, so the two features share no module and anything (CSS included) can key
// off them, as it does off `data-archive`.
//
//   data-archive-at     the instant on screen, unix ms (the playhead); present exactly while the archive shows
//   data-archive-tip    the chain tip's height at that instant; absent while the recording does not hold it
//   data-archive-nodes  the confirmed node count at that instant; absent while it is not known
//
// An absent number is unknown, never zero: the readers say "unknown" for it.

import { useSyncExternalStore } from 'react';

export const ARCHIVE_ATTR = {
  at: 'data-archive-at',
  tip: 'data-archive-tip',
  nodes: 'data-archive-nodes',
} as const;

const NAMES: readonly string[] = Object.values(ARCHIVE_ATTR);

export interface ArchiveMoment {
  /** The archive instant, unix ms. */
  at: number;
  /** The chain tip's height then, or null when the recording does not hold it. */
  tip: number | null;
  /** The confirmed node count then, or null when it is not known. */
  nodes: number | null;
}

interface Reader {
  getAttribute(name: string): string | null;
}
interface Writer extends Reader {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

function num(v: string | null): number | null {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The moment `root` carries, or null while no archive shows (no instant, or one that is not a number). */
export function readArchive(root: Reader): ArchiveMoment | null {
  const at = num(root.getAttribute(ARCHIVE_ATTR.at));
  if (at === null) return null;
  return {
    at,
    tip: num(root.getAttribute(ARCHIVE_ATTR.tip)),
    nodes: num(root.getAttribute(ARCHIVE_ATTR.nodes)),
  };
}

/**
 * Puts `moment` on `root`, or takes every attribute off for null. Only what changed is written, so a playhead that
 * moves but whose readings do not leaves the others alone.
 */
export function publishArchive(root: Writer, moment: ArchiveMoment | null): void {
  const put = (name: string, v: number | null) => {
    if (v === null || !Number.isFinite(v)) {
      if (root.getAttribute(name) !== null) root.removeAttribute(name);
      return;
    }
    const s = String(Math.round(v));
    if (root.getAttribute(name) !== s) root.setAttribute(name, s);
  };
  put(ARCHIVE_ATTR.at, moment ? moment.at : null);
  put(ARCHIVE_ATTR.tip, moment ? moment.tip : null);
  put(ARCHIVE_ATTR.nodes, moment ? moment.nodes : null);
}

// ---- the readers --------------------------------------------------------------------------------------------

const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;
let cache: { key: string; value: ArchiveMoment | null } = { key: '', value: null };

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (!observer && typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    observer = new MutationObserver(() => {
      for (const l of [...listeners]) l();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [...NAMES] });
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
}

/** The moment on the document, the same object until an attribute changes (a stable snapshot for React). */
function snapshot(): ArchiveMoment | null {
  if (typeof document === 'undefined') return null;
  const root = document.documentElement;
  const key = NAMES.map((n) => root.getAttribute(n) ?? '').join('|');
  if (key !== cache.key) cache = { key, value: readArchive(root) };
  return cache.value;
}

/**
 * A reading of the archive's moment: `select` gets the moment, or null while the present shows, and returns a
 * primitive. The component re-renders only when that value changes, so one that needs the tip height does not
 * follow the playhead's every move.
 */
export function useArchive<T extends string | number | boolean | null | undefined>(
  select: (moment: ArchiveMoment | null) => T,
): T {
  return useSyncExternalStore(
    subscribe,
    () => select(snapshot()),
    () => select(null),
  );
}

/** Whether a recorded moment is on screen (re-renders on the change only). */
export const useArchived = (): boolean => useArchive((m) => m !== null);

// ---- "t minus" ---------------------------------------------------------------------------------------------

/** U+2212, which the latin subset of the chrome's fonts carries. */
const MINUS = '−';
const pad2 = (n: number): string => String(n).padStart(2, '0');

interface Parts {
  d: number;
  h: number;
  m: number;
  s: number;
}

function split(ms: number): Parts {
  const t = Math.max(0, Math.round(ms / 1000));
  return {
    d: Math.floor(t / 86400),
    h: Math.floor((t % 86400) / 3600),
    m: Math.floor((t % 3600) / 60),
    s: t % 60,
  };
}

/**
 * How long before now a moment was, as the Beat's instrument reads it, two units at most and the lower one padded
 * so the width holds: `T-40 s`, `T-12 m 05 s`, `T-3 h 12 m`, `T-4 d 11 h` (with a true minus sign).
 */
export function tMinus(ms: number): string {
  const { d, h, m, s } = split(ms);
  if (d > 0) return `T${MINUS}${d} d ${pad2(h)} h`;
  if (h > 0) return `T${MINUS}${h} h ${pad2(m)} m`;
  if (m > 0) return `T${MINUS}${m} m ${pad2(s)} s`;
  return `T${MINUS}${s} s`;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The same, spelled for a screen reader: `T minus 4 days 11 hours`, `T minus 12 minutes 5 seconds`. */
export function tMinusSpoken(ms: number): string {
  const { d, h, m, s } = split(ms);
  if (d > 0) return `T minus ${plural(d, 'day')}${h > 0 ? ` ${plural(h, 'hour')}` : ''}`;
  if (h > 0) return `T minus ${plural(h, 'hour')}${m > 0 ? ` ${plural(m, 'minute')}` : ''}`;
  if (m > 0) return `T minus ${plural(m, 'minute')}${s > 0 ? ` ${plural(s, 'second')}` : ''}`;
  return `T minus ${plural(s, 'second')}`;
}
