// "Everything is a link": where each kind of entity lives in the app. The routes are the ones in
// app/router.tsx (the same targets as `routeForHit` in app/searchRoutes.ts); countries, providers
// and versions have no window of their own, so they open the globe with that filter applied.

import type { HitRoute } from '../../app/searchRoutes';
import { pathForWindow } from '../../shell/wm/route';
import { canonicalNodeKey } from '../../store/nodeKeys';

export type EntityKind =
  | 'node'
  | 'host'
  | 'app'
  | 'block'
  | 'tx'
  | 'address'
  | 'operator'
  | 'country'
  | 'provider'
  | 'version';

/** A reference to an entity: its kind and the key its route takes. */
export interface EntityRef {
  kind: EntityKind;
  /** A node's outpoint `txid:vout` (an id or `ip:port` becomes one when the snapshot knows the node), an IP for a host, an app name, a height or hash for a block, a txid, an address, an ISO country code, an organisation name, a version string. */
  value: string;
}

export const ENTITY_KINDS: readonly EntityKind[] = [
  'node',
  'host',
  'app',
  'block',
  'tx',
  'address',
  'operator',
  'country',
  'provider',
  'version',
];

/** The typed router location for an entity (spread into `<Link>` or `navigate`). */
export function entityRoute(kind: EntityKind, value: string): HitRoute {
  switch (kind) {
    case 'node':
      // Links name nodes by outpoint, the key that means the same node on every instance.
      return { to: '/node/$key', params: { key: canonicalNodeKey(value) } };
    case 'host':
      return { to: '/host/$ip', params: { ip: value } };
    case 'app':
      return { to: '/app/$name', params: { name: value } };
    case 'block':
      return { to: '/block/$key', params: { key: value } };
    case 'tx':
      return { to: '/tx/$txid', params: { txid: value } };
    case 'address':
      return { to: '/address/$addr', params: { addr: value } };
    case 'operator':
      return { to: '/operator/$addr', params: { addr: value } };
    case 'country':
      return { to: '/', search: { cc: value } };
    case 'provider':
      return { to: '/', search: { org: value } };
    case 'version':
      return { to: '/', search: { ver: value } };
  }
}

/** The URL path (with query) of an entity, for `href` attributes and copy-link actions. */
export function entityHref(kind: EntityKind, value: string): string {
  switch (kind) {
    case 'country':
      return `/?cc=${encodeURIComponent(value)}`;
    case 'provider':
      return `/?org=${encodeURIComponent(value)}`;
    case 'version':
      return `/?ver=${encodeURIComponent(value)}`;
    default:
      return pathForWindow(kind, value) ?? '/';
  }
}
