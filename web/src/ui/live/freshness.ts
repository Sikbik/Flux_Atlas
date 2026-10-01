// Pure freshness helpers (design 6.5, 8.8): the state of a source from its age and cadence, the
// words and age labels a chip shows, and the compact key a component subscribes to so it re-renders
// only when its visible text changes (an age past one minute changes once a minute, not every second).

import { type Freshness, freshness } from '../../lib/clock';
import { formatAge, formatUtcDateTime, formatUtcTime, UNKNOWN } from '../../lib/format';

/** The four freshness states of lib/clock, plus `unknown` when no update time is known. */
export type FreshnessState = Freshness | 'unknown';

/** The word that accompanies a bad state, so colour is never the only signal. */
export type FreshnessWord = 'stale' | 'lost';

export interface FreshnessView {
  state: FreshnessState;
  /** Age label: `now`, `4 s`, `41 s`, `12 min`, `3 h`, `5 d`. Null when unknown. */
  age: string | null;
  /** `stale` past 3x the cadence, `lost` past 10x, otherwise null. */
  word: FreshnessWord | null;
}

const WORD: Record<FreshnessState, FreshnessWord | null> = {
  fresh: null,
  aging: null,
  stale: 'stale',
  dead: 'lost',
  unknown: null,
};

/** The view for an update time (unix ms) judged at `nowMs` against the source's cadence. */
export function freshnessView(
  ts: number | null | undefined,
  nowMs: number,
  cadenceMs: number,
): FreshnessView {
  if (ts === null || ts === undefined || !Number.isFinite(ts)) {
    return { state: 'unknown', age: null, word: null };
  }
  const ageMs = Math.max(0, nowMs - ts);
  const state = freshness(ageMs, Math.max(1, cadenceMs));
  return { state, age: formatAge(ageMs), word: WORD[state] };
}

const SEP = '|';

/** The snapshot string a subscribed component compares: it changes exactly when the visible text can. */
export function viewKey(ts: number | null | undefined, nowMs: number, cadenceMs: number): string {
  const v = freshnessView(ts, nowMs, cadenceMs);
  return `${v.state}${SEP}${v.age ?? ''}`;
}

/** Inverse of {@link viewKey}. */
export function parseViewKey(key: string): FreshnessView {
  const i = key.indexOf(SEP);
  const state = (i < 0 ? key : key.slice(0, i)) as FreshnessState;
  const age = i < 0 ? '' : key.slice(i + 1);
  return { state, age: age === '' ? null : age, word: WORD[state] ?? null };
}

/** The unit of an age label: `now`, `s`, `min`, `h` or `d`; null for an unknown age. */
export function ageUnit(age: string | null): 'now' | 's' | 'min' | 'h' | 'd' | null {
  if (age === null) return null;
  if (age === 'now') return 'now';
  const unit = age.slice(age.indexOf(' ') + 1);
  return unit === 's' || unit === 'min' || unit === 'h' || unit === 'd' ? unit : null;
}

/** `now` stays `now`; `4 s` becomes `4 s ago`. */
export function freshnessAgo(age: string): string {
  return age === 'now' ? age : `${age} ago`;
}

/** The chip text: `nodes 4 s`, `nodes 11 min stale`, `mesh 6 h lost`, `nodes Unknown`. */
export function freshnessChipText(label: string | undefined, v: FreshnessView): string {
  return [label, v.age ?? UNKNOWN, v.word].filter(Boolean).join(' ');
}

/** The inline text: `updated 3 s ago`, `nodes updated 11 min ago, stale`, `update time Unknown`. */
export function freshnessInlineText(label: string | undefined, v: FreshnessView): string {
  const prefix = label ? `${label} ` : '';
  if (v.age === null) return `${prefix}update time ${UNKNOWN}`;
  return `${prefix}updated ${freshnessAgo(v.age)}${v.word ? `, ${v.word}` : ''}`;
}

/** The title attribute: the absolute UTC time of the last update (with the date once it is days old). */
export function freshnessTitle(ts: number | null | undefined, v: FreshnessView): string {
  if (ts === null || ts === undefined || !Number.isFinite(ts)) return 'No update seen yet';
  const days = v.age?.endsWith(' d') === true;
  return `Last update ${days ? formatUtcDateTime(ts) : formatUtcTime(ts)}`;
}
