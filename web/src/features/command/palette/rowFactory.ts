// Turns the things the palette can find into rows: one factory per kind, shared by the local index and
// the server's hits so a node looks the same whichever side answered first.

import type { SearchHit } from '../../../api/generated/SearchHit';
import { type HitRoute, routeForHit } from '../../../app/searchRoutes';
import { formatInt, middleTruncate } from '../../../lib/format';
import type { NetworkStore } from '../../../store/network';
import type { NavTarget } from '../navigation';
import type { Place } from '../places';
import {
  type AppMatch,
  type CityEntry,
  type CountryEntry,
  type HostMatch,
  nodeFacts,
  nodeSubline,
  type ProviderEntry,
  shareText,
  TIER_LABEL,
  type VersionEntry,
} from './local';
import type { FlyView, PaletteRow, TierName } from './types';

export const nodeKey = (endpoint: string): string => endpoint;

const NODE_FLY_ALT = 0.34;

const finite = (n: number) => Number.isFinite(n);

/** A node row from the node table (row index `i`). */
export function nodeRow(store: NetworkStore, i: number, score: number): PaletteRow {
  const f = nodeFacts(store, i);
  const key = f.endpoint || String(store.nodes.ids[i] ?? i);
  const fly: FlyView | undefined =
    finite(f.lat) && finite(f.lon) ? { lat: f.lat, lon: f.lon, alt: NODE_FLY_ALT } : undefined;
  return {
    id: `node:${key}`,
    group: 'nodes',
    kind: 'node',
    icon: 'node',
    title: f.endpoint || `Node #${formatInt(store.nodes.ids[i] ?? i)}`,
    mono: true,
    sub: nodeSubline(f),
    chip: 'Node',
    ...(f.tier ? { tier: f.tier } : {}),
    meta: { type: 'status', tone: f.status.tone, label: f.status.label },
    score,
    action: { type: 'go', target: { to: '/node/$key', params: { key } } },
    ...(fly ? { fly } : {}),
    alongside: true,
    remember: true,
  };
}

export function hostRow(store: NetworkStore, m: HostMatch, score: number): PaletteRow {
  const t = store.nodes;
  const lat = t.lat[m.row] ?? Number.NaN;
  const lon = t.lon[m.row] ?? Number.NaN;
  const f = nodeFacts(store, m.row);
  const where = f.city || (f.countryCode ? f.countryName : '');
  const sub = [`${formatInt(m.count)} ${m.count === 1 ? 'node' : 'nodes'}`, where, f.org]
    .filter(Boolean)
    .join(', ');
  return {
    id: `host:${m.ip}`,
    group: 'hosts',
    kind: 'host',
    icon: 'host',
    title: m.ip,
    mono: true,
    sub,
    chip: 'Host',
    score,
    action: { type: 'go', target: { to: '/host/$ip', params: { ip: m.ip } } },
    ...(finite(lat) && finite(lon) ? { fly: { lat, lon, alt: NODE_FLY_ALT } } : {}),
    alongside: true,
    remember: true,
  };
}

export function providerRow(p: ProviderEntry, total: number, score: number): PaletteRow {
  return {
    id: `provider:${p.lower}`,
    group: 'hosts',
    kind: 'provider',
    icon: 'provider',
    title: p.name,
    sub: `${formatInt(p.count)} nodes, ${shareText(p.count, total)}`,
    chip: 'Provider',
    score,
    // Providers filter by name (the globe's filter matches a substring of the organisation).
    action: { type: 'go', target: { to: '/', search: { org: p.lower }, stay: true } },
    remember: true,
  };
}

export function versionRow(v: VersionEntry, total: number, score: number): PaletteRow {
  return {
    id: `version:${v.version}`,
    group: 'hosts',
    kind: 'version',
    icon: 'version',
    title: `FluxOS ${v.version}`,
    sub: `${formatInt(v.count)} nodes, ${shareText(v.count, total)}`,
    chip: 'Version',
    score,
    action: { type: 'go', target: { to: '/', search: { ver: v.version }, stay: true } },
    remember: true,
  };
}

export function appRow(a: AppMatch): PaletteRow {
  const state =
    a.target > 0 && a.running < a.target
      ? `${formatInt(a.running)} of ${formatInt(a.target)} running`
      : `${formatInt(a.running)} ${a.running === 1 ? 'instance' : 'instances'}`;
  return {
    id: `app:${a.name}`,
    group: 'apps',
    kind: 'app',
    icon: 'app',
    title: a.displayName,
    sub: a.enterprise ? `${state}, enterprise` : state,
    chip: 'App',
    score: a.score,
    action: { type: 'go', target: { to: '/app/$name', params: { name: a.name } } },
    alongside: true,
    remember: true,
  };
}

/** A country: filters the globe to it and frames it; Alt+Enter only flies. */
export function countryRow(c: CountryEntry, score: number): PaletteRow {
  return {
    id: `country:${c.code}`,
    group: 'goto',
    kind: 'country',
    icon: 'country',
    title: c.name,
    sub: `${formatInt(c.count)} ${c.count === 1 ? 'node' : 'nodes'}, filters the globe to this country`,
    chip: 'Country',
    score,
    action: { type: 'go', target: { to: '/', search: { cc: c.code }, stay: true } },
    fly: { lat: c.lat, lon: c.lon, alt: c.alt },
    alsoFly: true,
    remember: true,
  };
}

export function cityRow(c: CityEntry, score: number): PaletteRow {
  const fly: FlyView = { lat: c.lat, lon: c.lon, alt: c.count > 200 ? 0.42 : c.count > 30 ? 0.36 : 0.45 };
  return {
    id: `city:${c.lower}|${c.country}`,
    group: 'goto',
    kind: 'city',
    icon: 'city',
    title: c.name,
    sub: `${formatInt(c.count)} ${c.count === 1 ? 'node' : 'nodes'} at this site, ${c.country}`,
    chip: 'City',
    score,
    action: { type: 'run', id: 'fly', arg: `${fly.lat},${fly.lon},${fly.alt}` },
    fly,
    remember: true,
  };
}

const PLACE_CHIP: Record<Place['kind'], string> = {
  city: 'City',
  country: 'Country',
  continent: 'Region',
  coords: 'Coordinates',
};

/** A place the camera can fly to; a country also filters the globe to it. */
export function placeToRow(p: Place): PaletteRow {
  if (p.kind === 'country' && p.cc) {
    return {
      id: p.id,
      group: 'goto',
      kind: 'country',
      icon: 'country',
      title: p.name,
      sub: p.sub,
      chip: PLACE_CHIP.country,
      score: p.score,
      action: { type: 'go', target: { to: '/', search: { cc: p.cc }, stay: true } },
      fly: p.view,
      alsoFly: true,
      remember: true,
    };
  }
  return {
    ...placeRow(p.id, p.name, p.sub, PLACE_CHIP[p.kind], p.view, p.score),
    kind: p.kind === 'city' ? 'city' : 'place',
    icon: p.kind === 'city' ? 'city' : 'place',
  };
}

export function placeRow(
  id: string,
  title: string,
  sub: string,
  chip: string,
  fly: FlyView,
  score: number,
): PaletteRow {
  return {
    id,
    group: 'goto',
    kind: 'place',
    icon: 'place',
    title,
    sub,
    chip,
    score,
    action: { type: 'run', id: 'fly', arg: `${fly.lat},${fly.lon},${fly.alt}` },
    fly,
    remember: true,
  };
}

export function blockRow(
  height: number,
  opts: { hash?: string | null; sub?: string; score: number; group?: 'blocks' | 'try' },
): PaletteRow {
  const { hash, sub, score } = opts;
  return {
    id: `block:${height}`,
    group: opts.group ?? 'blocks',
    kind: 'block',
    icon: 'block',
    title: `Block ${formatInt(height)}`,
    ...(sub ? { sub } : hash ? { sub: middleTruncate(hash, 10, 8), subMono: true } : {}),
    chip: 'Block',
    score,
    action: { type: 'go', target: { to: '/block/$key', params: { key: String(height) } } },
    alongside: true,
    remember: true,
  };
}

export function txRow(txid: string, sub: string | undefined, score: number): PaletteRow {
  return {
    id: `tx:${txid}`,
    group: 'txs',
    kind: 'tx',
    icon: 'tx',
    title: middleTruncate(txid, 12, 10),
    mono: true,
    ...(sub ? { sub: capFirst(sub) } : {}),
    chip: 'Transaction',
    score,
    action: { type: 'go', target: { to: '/tx/$txid', params: { txid } } },
    alongside: true,
    remember: true,
  };
}

export function addressRow(
  addr: string,
  sub: string | undefined,
  score: number,
  label = 'Address',
): PaletteRow {
  return {
    id: `address:${addr}`,
    group: 'addresses',
    kind: 'address',
    icon: 'address',
    title: addr,
    mono: true,
    sub: sub ? `${label}, ${sub}` : label,
    chip: 'Address',
    score,
    action: { type: 'go', target: { to: '/address/$addr', params: { addr } } },
    alongside: true,
    remember: true,
  };
}

export function operatorRow(addr: string, sub: string | undefined, score: number): PaletteRow {
  return {
    id: `operator:${addr}`,
    group: 'addresses',
    kind: 'operator',
    icon: 'operator',
    title: addr,
    mono: true,
    sub: sub ? `Operator, ${sub}` : 'Operator',
    chip: 'Operator',
    score,
    action: { type: 'go', target: { to: '/operator/$addr', params: { addr } } },
    alongside: true,
    remember: true,
  };
}

export function shieldedRow(addr: string, label: string, sub: string | null, score: number): PaletteRow {
  return {
    id: `shielded:${addr}`,
    group: 'addresses',
    kind: 'shielded',
    icon: 'info',
    title: label,
    sub: sub ? capFirst(sub) : 'Shielded balances and history are private',
    chip: 'Shielded',
    score,
    action: { type: 'none' },
  };
}

export function capFirst(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

const TIER_WORDS: Record<string, TierName> = { cumulus: 'cumulus', nimbus: 'nimbus', stratus: 'stratus' };

/** `confirmed / queue #3 / FI / Hetzner` becomes `Confirmed, queue #3, FI, Hetzner`. */
function hitSub(sublabel: string | null): string | undefined {
  if (!sublabel) return undefined;
  return capFirst(sublabel.split(' / ').join(', '));
}

function navFromRoute(r: HitRoute): NavTarget {
  return r.to === '/' ? { to: '/', search: r.search, stay: true } : { to: r.to, params: r.params };
}

/** What a hit points at once the local table has had its say (node ids become endpoints). */
export function hitRow(hit: SearchHit, store: NetworkStore, total: number, score: number): PaletteRow | null {
  switch (hit.kind) {
    case 'node': {
      const id = Number(hit.key);
      const i = Number.isInteger(id) ? store.nodes.indexOf(id) : -1;
      if (i >= 0) return nodeRow(store, i, score);
      const word = hit.label.split(' ')[0]?.toLowerCase() ?? '';
      const tier = TIER_WORDS[word];
      const endpoint = hit.label.replace(/^\w+ node /, '');
      const sub = hitSub(hit.sublabel);
      return {
        id: `node:${endpoint}`,
        group: 'nodes',
        kind: 'node',
        icon: 'node',
        title: endpoint,
        mono: true,
        ...(sub ? { sub } : {}),
        chip: 'Node',
        ...(tier ? { tier } : {}),
        score,
        action: { type: 'go', target: { to: '/node/$key', params: { key: hit.key } } },
        alongside: true,
        remember: true,
      };
    }
    case 'host': {
      const count = Number.parseInt(hit.sublabel ?? '', 10);
      return {
        id: `host:${hit.key}`,
        group: 'hosts',
        kind: 'host',
        icon: 'host',
        title: hit.key,
        mono: true,
        sub: Number.isFinite(count) ? `${formatInt(count)} ${count === 1 ? 'node' : 'nodes'}` : 'Host',
        chip: 'Host',
        score,
        action: { type: 'go', target: { to: '/host/$ip', params: { ip: hit.key } } },
        alongside: true,
        remember: true,
      };
    }
    case 'app': {
      const m = /^(.*) \/ (\d+) instances$/.exec(hit.sublabel ?? '');
      const running = m ? Number(m[2]) : 0;
      return {
        id: `app:${hit.key}`,
        group: 'apps',
        kind: 'app',
        icon: 'app',
        title: hit.label,
        sub: m
          ? `${formatInt(running)} ${running === 1 ? 'instance' : 'instances'}`
          : (hitSub(hit.sublabel) ?? 'App'),
        chip: 'App',
        score,
        action: { type: 'go', target: { to: '/app/$name', params: { name: hit.key } } },
        alongside: true,
        remember: true,
      };
    }
    case 'block': {
      const height = Number(hit.key);
      return blockRow(height, { hash: hit.sublabel, score });
    }
    case 'tx':
      return txRow(hit.key, hit.sublabel ?? undefined, score);
    case 'address': {
      const label = hit.label.startsWith('P2SH') ? 'Script address' : 'Address';
      return addressRow(hit.key, hit.sublabel ?? undefined, score, label);
    }
    case 'operator':
      return operatorRow(hit.key, hit.sublabel ?? undefined, score);
    case 'shielded':
      return shieldedRow(hit.key, hit.label, hit.sublabel, score);
    case 'country': {
      const count = Number.parseInt(hit.sublabel ?? '', 10);
      return {
        id: `country:${hit.key}`,
        group: 'goto',
        kind: 'country',
        icon: 'country',
        title: hit.label,
        sub: Number.isFinite(count)
          ? `${formatInt(count)} nodes, filters the globe to this country`
          : 'Country',
        chip: 'Country',
        score,
        action: { type: 'go', target: navFromRoute(routeForHit(hit)!) },
        remember: true,
      };
    }
    case 'provider': {
      const count = Number.parseInt((hit.sublabel ?? '').split(' / ').pop() ?? '', 10);
      // The globe filters providers by name; the server keys them by AS number.
      const lower = hit.label.toLowerCase();
      return {
        id: `provider:${lower}`,
        group: 'hosts',
        kind: 'provider',
        icon: 'provider',
        title: hit.label,
        sub: Number.isFinite(count)
          ? `${hit.sublabel?.startsWith('AS') ? `${hit.sublabel.split(' / ')[0]}, ` : ''}${formatInt(count)} nodes, ${shareText(count, total)}`
          : (hitSub(hit.sublabel) ?? 'Provider'),
        chip: 'Provider',
        score,
        action: { type: 'go', target: { to: '/', search: { org: lower }, stay: true } },
        remember: true,
      };
    }
    case 'version': {
      // Only FluxOS versions filter the globe (`flux_os:8.20.0`); other components just explain.
      const [component, ...rest] = hit.key.split(':');
      const version = rest.join(':');
      if (component !== 'flux_os' || !version) return null;
      const count = Number.parseInt(hit.sublabel ?? '', 10);
      return {
        id: `version:${version}`,
        group: 'hosts',
        kind: 'version',
        icon: 'version',
        title: `FluxOS ${version}`,
        sub: Number.isFinite(count) ? `${formatInt(count)} nodes, ${shareText(count, total)}` : 'Version',
        chip: 'Version',
        score,
        action: { type: 'go', target: { to: '/', search: { ver: version }, stay: true } },
        remember: true,
      };
    }
  }
}

export { TIER_LABEL };
