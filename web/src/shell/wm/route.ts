// Route binding, pure: which window a URL path opens (design 2.2), and the `?w=` extra windows.
// No router import, so the reducer and its tests stay framework-free.

import { canonicalNodeKey } from '../../store/nodeKeys';
import { isWindowType, WINDOW_SPECS } from './specs';
import type { WindowRef, WindowType } from './types';

/** At most two extra windows ride in `?w=` (design 2.2). */
export const MAX_EXTRA = 2;

/**
 * Decodes one URL path segment. A malformed escape (`%ZZ`) is kept as written instead of throwing:
 * a bad link opens a not-found view, never the root error view.
 */
export function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function seg(s: string | undefined): string | null {
  if (s === undefined || s === '') return null;
  return decodeSegment(s);
}

/** Node windows are keyed by outpoint (ARCHITECTURE 8.1): older keys become one when the snapshot knows them. */
function windowKey(type: WindowType, key: string): string {
  return type === 'node' ? canonicalNodeKey(key) : key;
}

/** The primary window a path opens, or null for the bare globe, ambient, `/q/...` and `/dev/...`. */
export function windowForPath(pathname: string): WindowRef | null {
  const parts = pathname.split('?')[0]!.split('/').filter(Boolean);
  const [head, a, b, c] = parts;
  switch (head) {
    case 'node':
    case 'host':
    case 'block':
    case 'tx':
    case 'address':
    case 'operator':
    case 'wallet': {
      const key = seg(a);
      return key && parts.length === 2 ? { type: head, key } : null;
    }
    case 'app': {
      const key = seg(a);
      if (!key) return null;
      if (parts.length === 2 || (parts.length === 4 && b === 'history' && c !== undefined))
        return { type: 'app', key };
      return null;
    }
    case 'queue':
    case 'analytics':
      if (parts.length > 2) return null;
      return { type: head, key: seg(a) };
    case 'mempool':
    case 'supply':
    case 'richlist':
    case 'terminal':
    case 'time':
    case 'weather':
    case 'about':
    case 'settings':
      return parts.length === 1 ? { type: head, key: null } : null;
    default:
      return null;
  }
}

/** The canonical path of a window (inverse of `windowForPath`), or null when the type needs a key. */
export function pathForWindow(type: WindowType, key: string | null): string | null {
  const k = key === null ? null : encodeURIComponent(windowKey(type, key));
  switch (type) {
    case 'node':
    case 'host':
    case 'app':
    case 'block':
    case 'tx':
    case 'address':
    case 'operator':
    case 'wallet':
      return k ? `/${type}/${k}` : null;
    case 'queue':
    case 'analytics':
      return k ? `/${type}/${k}` : `/${type}`;
    default:
      return `/${type}`;
  }
}

/** Parses `?w=queue,app:BitcoinWhitepaper` (stack order, at most two, unknown types dropped). */
export function parseExtraWindows(w: string | undefined): WindowRef[] {
  if (!w) return [];
  const out: WindowRef[] = [];
  for (const raw of w.split(',')) {
    const item = raw.trim();
    if (!item) continue;
    const i = item.indexOf(':');
    const type = i < 0 ? item : item.slice(0, i);
    if (!isWindowType(type) || WINDOW_SPECS[type].chrome !== 'window') continue;
    const key = i < 0 ? null : seg(item.slice(i + 1));
    if (out.some((r) => r.type === type)) continue;
    out.push({ type, key });
    if (out.length >= MAX_EXTRA) break;
  }
  return out;
}

/** Serializes extra windows for `?w=` (undefined when empty, so the param disappears). */
export function serializeExtraWindows(list: readonly WindowRef[]): string | undefined {
  const items = list
    .slice(0, MAX_EXTRA)
    .map((r) => (r.key === null ? r.type : `${r.type}:${encodeURIComponent(windowKey(r.type, r.key))}`));
  return items.length ? items.join(',') : undefined;
}
