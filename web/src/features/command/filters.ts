// Filters as URL params (design 2.6): `tier`, `cc`, `org`, `ver`, `arcane`, `watched` dim the rest of the
// globe (`globe/bindings.ts` maps them). The palette's `filter` prefix and the terminal's `filter`
// command share this parser: an expression becomes a patch of search params.
//
//   filter stratus nimbus        tier=stratus,nimbus
//   filter fi                    cc=FI (a country code or a name)
//   filter hetzner               org=hetzner (a provider, matched by name)
//   filter 8.20.0                ver=8.20.0
//   filter arcane / !arcane      arcane=true / arcane=false
//   filter tier=stratus cc=de    explicit keys
//   filter clear                 removes every filter

export type FilterKey = 'tier' | 'cc' | 'org' | 'ver' | 'arcane' | 'watched';

export const FILTER_KEYS: readonly FilterKey[] = ['tier', 'cc', 'org', 'ver', 'arcane', 'watched'];

const KEY_ALIAS: Record<string, FilterKey> = {
  tier: 'tier',
  tiers: 'tier',
  cc: 'cc',
  country: 'cc',
  countries: 'cc',
  org: 'org',
  provider: 'org',
  providers: 'org',
  host: 'org',
  ver: 'ver',
  version: 'ver',
  os: 'ver',
  fluxos: 'ver',
  arcane: 'arcane',
  arcaneos: 'arcane',
  watched: 'watched',
  watch: 'watched',
};

export const TIER_NAMES = ['cumulus', 'nimbus', 'stratus'] as const;

export type FilterValue = string | boolean;
export type FilterSet = Partial<Record<FilterKey, FilterValue>>;

export interface FilterPatch {
  set: FilterSet;
  clear: FilterKey[];
}

export interface FilterLookup {
  countries: readonly { code: string; name: string; lower: string }[];
  providers: readonly { name: string; lower: string }[];
  versions: readonly { version: string }[];
}

export interface ParsedFilter {
  patch: FilterPatch;
  /** Remove every filter first. */
  clearAll: boolean;
  /** Words that matched nothing. */
  unknown: string[];
}

const TRUE = new Set(['true', 'on', 'yes', '1']);
const FALSE = new Set(['false', 'off', 'no', '0']);
const CLEAR_WORDS = new Set(['clear', 'none', 'reset', 'off', 'all', 'everything']);

function mergeList(cur: FilterValue | undefined, add: string): string {
  const have = typeof cur === 'string' && cur ? cur.split(',') : [];
  return have.includes(add) ? have.join(',') : [...have, add].join(',');
}

function tierOf(word: string): string | null {
  const w = word.toLowerCase();
  return (TIER_NAMES as readonly string[]).includes(w) ? w : null;
}

/** Resolves a bare word: a country (code or name), a provider (by name), a version. */
function resolveWord(word: string, lookup: FilterLookup): { key: FilterKey; value: string } | null {
  const w = word.toLowerCase();
  if (/^v?\d+\.\d+(\.\d+)*$/.test(w)) {
    const v = w.replace(/^v/, '');
    const hit =
      lookup.versions.find((x) => x.version === v) ?? lookup.versions.find((x) => x.version.startsWith(v));
    return hit ? { key: 'ver', value: hit.version } : { key: 'ver', value: v };
  }
  if (w.length === 2) {
    const c = lookup.countries.find((x) => x.code.toLowerCase() === w);
    if (c) return { key: 'cc', value: c.code };
  }
  const exact = lookup.countries.find((x) => x.lower === w);
  if (exact) return { key: 'cc', value: exact.code };
  if (w.length >= 3) {
    const pre = lookup.countries.find((x) => x.lower.startsWith(w));
    if (pre) return { key: 'cc', value: pre.code };
    const prov = lookup.providers.find((p) => p.lower.includes(w));
    if (prov) return { key: 'org', value: prov.lower };
  }
  return null;
}

/** Parses a filter expression into a patch of search params. */
export function parseFilterExpr(expr: string, lookup: FilterLookup): ParsedFilter {
  const patch: FilterPatch = { set: {}, clear: [] };
  const unknown: string[] = [];
  let clearAll = false;
  const tokens = expr.trim().split(/\s+/).filter(Boolean);
  const put = (key: FilterKey, value: string) => {
    if (key === 'tier' || key === 'cc' || key === 'org' || key === 'ver') {
      patch.set[key] =
        key === 'cc' ? mergeList(patch.set[key], value.toUpperCase()) : mergeList(patch.set[key], value);
    }
  };
  for (const tok of tokens) {
    const lower = tok.toLowerCase();
    if (tokens.length === 1 && CLEAR_WORDS.has(lower)) {
      clearAll = true;
      continue;
    }
    const kv = /^([a-z]+)[=:](.+)$/i.exec(tok);
    if (kv) {
      const key = KEY_ALIAS[kv[1]!.toLowerCase()];
      const value = kv[2]!;
      if (!key) {
        unknown.push(tok);
        continue;
      }
      if (key === 'arcane' || key === 'watched') {
        const v = value.toLowerCase();
        if (TRUE.has(v)) patch.set[key] = true;
        else if (FALSE.has(v)) {
          if (key === 'arcane') patch.set[key] = false;
          else patch.clear.push(key);
        } else unknown.push(tok);
        continue;
      }
      for (const part of value.split(',').filter(Boolean)) {
        if (key === 'tier') {
          const t = tierOf(part);
          if (t) put('tier', t);
          else unknown.push(part);
        } else if (key === 'cc') {
          const r = resolveWord(part, lookup);
          put('cc', r?.key === 'cc' ? r.value : part);
        } else put(key, part);
      }
      continue;
    }
    if (lower === 'arcane' || lower === 'arcaneos') patch.set.arcane = true;
    else if (/^(!|-|no)(arcane|arcaneos)$/.test(lower)) patch.set.arcane = false;
    else if (lower === 'watched' || lower === 'watchlist') patch.set.watched = true;
    else {
      const t = tierOf(lower);
      if (t) {
        put('tier', t);
        continue;
      }
      const r = resolveWord(tok, lookup);
      if (r) put(r.key, r.value);
      else unknown.push(tok);
    }
  }
  return { patch, clearAll, unknown };
}

type SearchRecord = Record<string, unknown>;

/** The filters currently in a search object. */
export function activeFilters(search: SearchRecord): FilterSet {
  const out: FilterSet = {};
  for (const k of FILTER_KEYS) {
    const v = search[k];
    if (typeof v === 'string' && v) out[k] = v;
    else if (typeof v === 'number') out[k] = String(v);
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/** Applies a patch to a search object (clears first when asked). */
export function applyFilterPatch(search: SearchRecord, patch: FilterPatch, clearAll = false): SearchRecord {
  const next: SearchRecord = { ...search };
  if (clearAll) for (const k of FILTER_KEYS) delete next[k];
  for (const k of patch.clear) delete next[k];
  for (const [k, v] of Object.entries(patch.set)) next[k] = v;
  return next;
}

/** The search params that remove every filter. */
export const CLEAR_ALL_FILTERS: readonly string[] = FILTER_KEYS;

/** Human text for the filters in force: `tier Stratus, country FI`. */
export function describeFilters(f: FilterSet): string[] {
  const out: string[] = [];
  if (typeof f.tier === 'string') out.push(`tier ${f.tier.split(',').map(cap).join(', ')}`);
  if (typeof f.cc === 'string') out.push(`country ${f.cc.toUpperCase().split(',').join(', ')}`);
  if (typeof f.org === 'string') out.push(`provider ${f.org}`);
  if (typeof f.ver === 'string') out.push(`FluxOS ${f.ver}`);
  if (f.arcane === true) out.push('ArcaneOS only');
  if (f.arcane === false) out.push('without ArcaneOS');
  if (f.watched === true) out.push('watched nodes');
  return out;
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
