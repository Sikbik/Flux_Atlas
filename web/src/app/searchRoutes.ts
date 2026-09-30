// Maps a typed search hit to its route (the omnibox and `/q/:text` use this).

import type { SearchHit } from '../api/generated/SearchHit';

export type HitRoute =
  | { to: '/node/$key'; params: { key: string } }
  | { to: '/host/$ip'; params: { ip: string } }
  | { to: '/app/$name'; params: { name: string } }
  | { to: '/block/$key'; params: { key: string } }
  | { to: '/tx/$txid'; params: { txid: string } }
  | { to: '/address/$addr'; params: { addr: string } }
  | { to: '/operator/$addr'; params: { addr: string } }
  | { to: '/'; search: { cc?: string; org?: string; ver?: string } };

/** The route for a hit, or null when the hit only explains something (shielded addresses). */
export function routeForHit(hit: SearchHit): HitRoute | null {
  switch (hit.kind) {
    case 'node':
      return { to: '/node/$key', params: { key: hit.key } };
    case 'host':
      return { to: '/host/$ip', params: { ip: hit.key } };
    case 'app':
      return { to: '/app/$name', params: { name: hit.key } };
    case 'block':
      return { to: '/block/$key', params: { key: hit.key } };
    case 'tx':
      return { to: '/tx/$txid', params: { txid: hit.key } };
    case 'address':
      return { to: '/address/$addr', params: { addr: hit.key } };
    case 'operator':
      return { to: '/operator/$addr', params: { addr: hit.key } };
    case 'country':
      return { to: '/', search: { cc: hit.key } };
    case 'provider':
      return { to: '/', search: { org: hit.key } };
    case 'version':
      return { to: '/', search: { ver: hit.key } };
    case 'shielded':
      return null;
  }
}
