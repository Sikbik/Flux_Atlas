// The palette model: what to show for the text typed. Pure (no React, no network): local matches from
// the NetworkStore come first and the server's hits are merged in when they arrive, so the same
// function feeds the palette, the `/q/$text` page and the terminal's `search`.
//
// Order of work for a query: parse the prefix, classify the text (height, hash, address, IP, word),
// gather rows per group, merge server hits, hoist an exact hit to the top, apply the kind chip.

import type { SearchHit } from '../../../api/generated/SearchHit';
import { formatInt } from '../../../lib/format';
import type { NetworkStore } from '../../../store/network';
import { activeFilters, describeFilters, type FilterLookup, parseFilterExpr } from '../filters';
import { countryPlace, matchPlaces } from '../places';
import { ACTIONS, type ActionEnv, actionById, actionRow, actionRows } from './actions';
import { gmRow, isGm } from './egg';
import {
  classifyIpQuery,
  getLocalIndex,
  type IpQuery,
  type LocalIndex,
  matchApps,
  matchEndpoints,
  matchProviders,
  matchVersions,
  TIER_LABEL,
} from './local';
import {
  addressRow,
  appRow,
  blockRow,
  hitRow,
  hostRow,
  nodeRow,
  operatorRow,
  placeToRow,
  providerRow,
  txRow,
  versionRow,
} from './rowFactory';
import {
  GROUP_LABEL,
  GROUP_ORDER,
  type GroupId,
  KIND_CHIPS,
  type KindChip,
  type PaletteModel,
  type PaletteRow,
  type ParsedInput,
  PREFIXES,
  type Prefix,
  type RecentEntry,
  type RowGroup,
} from './types';

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------

const PREFIX_WORDS: Readonly<Record<string, Prefix>> = {
  node: 'node',
  nodes: 'node',
  ip: 'node',
  app: 'app',
  apps: 'app',
  block: 'block',
  blocks: 'block',
  height: 'block',
  tx: 'tx',
  txid: 'tx',
  transaction: 'tx',
  addr: 'addr',
  address: 'addr',
  operator: 'operator',
  op: 'operator',
  zelid: 'operator',
  goto: 'goto',
  go: 'goto',
  fly: 'goto',
  layer: 'layer',
  layers: 'layer',
  filter: 'filter',
  filters: 'filter',
};

/** Splits a leading prefix word off the text (`node 65.109` is the `node` prefix with `65.109`). */
export function parseInput(raw: string): ParsedInput {
  const m = /^\s*([a-z]+)\s+([\s\S]*)$/i.exec(raw);
  if (m) {
    const prefix = PREFIX_WORDS[m[1]!.toLowerCase()];
    if (prefix) {
      const rest = m[2]!.trim();
      return { raw, text: prefix === 'goto' ? rest.replace(/^to\s+/i, '') : rest, prefix };
    }
  }
  return { raw, text: raw.trim(), prefix: null };
}

export type TextShape =
  | { kind: 'height'; height: number }
  | { kind: 'hash'; hash: string }
  | { kind: 'outpoint'; txid: string; vout: number }
  | { kind: 'address'; addr: string }
  | { kind: 'shielded'; addr: string }
  | { kind: 'ip'; ip: IpQuery }
  | { kind: 'text' };

const HASH = /^[0-9a-f]{64}$/i;
const OUTPOINT = /^([0-9a-f]{64}):(\d{1,5})$/i;
/** Transparent addresses and ZelIDs: base58, 26 to 36 characters, starting `t1`, `t3`, `1` or `3`. */
const ADDRESS = /^[t13][1-9A-HJ-NP-Za-km-z]{24,35}$/;
const SHIELDED = /^(zs1[0-9a-z]{60,}|zc[1-9A-HJ-NP-Za-km-z]{80,})$/;
const HEIGHT = /^(\d{1,9}|\d{1,3}(,\d{3}){1,2})$/;

/** What a piece of text looks like, so the right lookups run and the server is asked only when it can help. */
export function classifyText(text: string): TextShape {
  const t = text.trim();
  if (HEIGHT.test(t)) return { kind: 'height', height: Number(t.replaceAll(',', '')) };
  if (HASH.test(t)) return { kind: 'hash', hash: t.toLowerCase() };
  const o = OUTPOINT.exec(t);
  if (o) return { kind: 'outpoint', txid: o[1]!.toLowerCase(), vout: Number(o[2]) };
  if (ADDRESS.test(t)) return { kind: 'address', addr: t };
  if (SHIELDED.test(t)) return { kind: 'shielded', addr: t };
  const ip = classifyIpQuery(t);
  if (ip) return { kind: 'ip', ip };
  return { kind: 'text' };
}

/**
 * The query to send to `/search`, or null when the local index already says everything the server
 * could: words and IPs resolve here; heights, hashes, outpoints, addresses and ASNs need the server.
 */
export function serverQueryFor(input: ParsedInput): string | null {
  const { prefix, text } = input;
  if (!text || prefix === 'goto' || prefix === 'layer' || prefix === 'filter' || prefix === 'app')
    return null;
  const shape = classifyText(text);
  switch (shape.kind) {
    case 'hash':
    case 'outpoint':
    case 'address':
    case 'shielded':
      return text.trim();
    case 'height':
      // Heights past a million are blocks: the tip says so without asking. Smaller ones may be old blocks.
      return shape.height < 1_000_000 ? String(shape.height) : null;
    default:
      return /^AS\d{1,7}$/i.test(text.trim()) ? text.trim() : null;
  }
}

// ---------------------------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------------------------

export type GroupLimits = Readonly<Record<GroupId, number>>;

export const PALETTE_LIMITS: GroupLimits = {
  recent: 5,
  next: 3,
  try: 4,
  nodes: 5,
  hosts: 4,
  apps: 4,
  blocks: 3,
  txs: 3,
  addresses: 3,
  goto: 4,
  commands: 5,
};

/** The results page lists far more. */
export const PAGE_LIMITS: GroupLimits = {
  recent: 5,
  next: 3,
  try: 4,
  nodes: 60,
  hosts: 30,
  apps: 60,
  blocks: 20,
  txs: 20,
  addresses: 20,
  goto: 30,
  commands: 30,
};

export interface ModelInput {
  raw: string;
  store: NetworkStore;
  /** The server's hits for `serverQuery`, once they arrive. */
  hits?: readonly SearchHit[] | null;
  recents?: readonly RecentEntry[];
  env: ActionEnv;
  chip?: KindChip;
  limits?: GroupLimits;
}

class Collector {
  private readonly rows = new Map<GroupId, Map<string, PaletteRow>>();
  /** Matches past what a group can show (set by the producer that knows the total). */
  readonly extra = new Map<GroupId, number>();

  add(row: PaletteRow): void {
    let g = this.rows.get(row.group);
    if (!g) {
      g = new Map();
      this.rows.set(row.group, g);
    }
    const cur = g.get(row.id);
    if (!cur || cur.score < row.score) g.set(row.id, row);
  }

  has(id: string): boolean {
    for (const g of this.rows.values()) if (g.has(id)) return true;
    return false;
  }

  /** Puts `row` in place of a row with the same id, whatever either scored. */
  replace(row: PaletteRow): void {
    let g = this.rows.get(row.group);
    if (!g) {
      g = new Map();
      this.rows.set(row.group, g);
    }
    g.set(row.id, row);
  }

  list(group: GroupId): PaletteRow[] {
    const g = this.rows.get(group);
    if (!g) return [];
    return [...g.values()].sort((a, b) => b.score - a.score);
  }
}

function lookupOf(index: LocalIndex): FilterLookup {
  return { countries: index.countries, providers: index.providers, versions: index.versions };
}

/** Builds the model for the text typed. */
export function buildModel(inp: ModelInput): PaletteModel {
  const { store, env } = inp;
  const input = parseInput(inp.raw);
  const limits = inp.limits ?? PALETTE_LIMITS;
  const index = getLocalIndex(store);
  const c = new Collector();
  const text = input.text;

  if (!text) {
    if (input.prefix) collectPrefixHint(c, input.prefix, store, index, env);
    else collectEmptyState(c, inp);
  } else {
    switch (input.prefix) {
      case 'node':
        collectNodes(c, store, index, text, limits);
        break;
      case 'app':
        collectApps(c, store, text);
        break;
      case 'block':
        collectBlocks(c, store, text);
        break;
      case 'tx':
        collectTx(c, text);
        break;
      case 'addr':
        collectAddress(c, text, false);
        break;
      case 'operator':
        collectAddress(c, text, true);
        break;
      case 'goto':
        collectPlaces(c, store, index, text, 12);
        break;
      case 'layer':
        collectCommands(c, text, env, 'layer.');
        break;
      case 'filter':
        collectFilter(c, index, text, env);
        break;
      default:
        collectGeneral(c, store, index, text, env, limits);
    }
    if (inp.hits) mergeHits(c, inp.hits, store, index, input);
  }

  // Groups in display order, trimmed to their limit.
  const total = (id: GroupId) => c.list(id).length + (c.extra.get(id) ?? 0);
  let groups: RowGroup[] = [];
  for (const id of GROUP_ORDER) {
    const all = c.list(id);
    if (all.length === 0) continue;
    const limit = inp.chip && inp.chip !== 'all' ? Math.max(limits[id], 12) : limits[id];
    const rows = all.slice(0, limit);
    groups.push({ id, label: GROUP_LABEL[id], rows, more: Math.max(0, total(id) - rows.length) });
  }
  groups = hoistExact(groups);

  const counts = Object.fromEntries(
    KIND_CHIPS.map((k) => [
      k.id,
      groups.filter((g) => k.groups.includes(g.id)).reduce((n, g) => n + g.rows.length + g.more, 0),
    ]),
  ) as Record<KindChip, number>;

  const chip = KIND_CHIPS.find((k) => k.id === (inp.chip ?? 'all')) ?? KIND_CHIPS[0]!;
  const shown = chip.id === 'all' ? groups : groups.filter((g) => chip.groups.includes(g.id));
  const best = shown[0]?.rows[0] ?? null;
  const shownRows = shown.reduce((n, g) => n + g.rows.length, 0);
  const anyMore = shown.some((g) => g.more > 0);

  const seeAll: PaletteRow | null =
    text.length >= 2 && !input.prefix && (anyMore || shownRows >= 6)
      ? {
          id: 'see-all',
          group: 'commands',
          kind: 'action',
          icon: 'search',
          title: `See all results for ${text}`,
          sub: anyMore ? 'Every match, grouped by kind' : 'The full results page',
          chip: 'Page',
          score: 0,
          action: { type: 'go', target: { to: '/q/$text', params: { text }, fragment: 'all' } },
          meta: { type: 'keys', keys: ['mod', 'enter'] },
        }
      : null;

  const usage = input.prefix ? (PREFIXES.find((p) => p.id === input.prefix)?.hint ?? null) : null;

  return {
    input,
    groups: shown,
    best,
    serverQuery: serverQueryFor(input),
    empty: text.length > 0 && shownRows === 0,
    counts,
    seeAll,
    usage,
  };
}

/** An exact hit (90 or better) in a later group moves its group to the front when it clearly beats the first. */
function hoistExact(groups: RowGroup[]): RowGroup[] {
  if (groups.length < 2) return groups;
  const top = (g: RowGroup) => g.rows[0]?.score ?? 0;
  const first = groups[0]!;
  if (first.id === 'recent' || first.id === 'next' || first.id === 'try') return groups;
  let best = first;
  for (const g of groups) if (top(g) > top(best)) best = g;
  if (best === first || top(best) < 90 || top(best) - top(first) < 8) return groups;
  return [best, ...groups.filter((g) => g !== best)];
}

// ---------------------------------------------------------------------------------------------
// Empty state and prefix hints
// ---------------------------------------------------------------------------------------------

function recentRow(e: RecentEntry, i: number): PaletteRow {
  return {
    id: e.id,
    group: 'recent',
    kind: e.kind,
    icon: e.icon,
    title: e.title,
    ...(e.mono ? { mono: true } : {}),
    ...(e.sub ? { sub: e.sub } : {}),
    ...(e.subMono ? { subMono: true } : {}),
    chip: e.chip,
    ...(e.tier ? { tier: e.tier } : {}),
    score: 100 - i,
    action: e.action,
    ...(e.fly ? { fly: e.fly } : {}),
    ...(e.alsoFly ? { alsoFly: true } : {}),
    ...(e.alongside ? { alongside: true } : {}),
    remember: true,
  };
}

function nextPayeeRows(store: NetworkStore, group: GroupId): PaletteRow[] {
  const out: PaletteRow[] = [];
  const next = store.nextPayees;
  if (!next) return out;
  next.payees.forEach((p, k) => {
    if (p.node === null) return;
    const i = store.nodes.indexOf(p.node);
    if (i < 0) return;
    const row = nodeRow(store, i, 90 - k);
    const tier = TIER_LABEL[p.tier as 'cumulus' | 'nimbus' | 'stratus'];
    out.push({
      ...row,
      id: `payee:${row.id}`,
      group,
      kind: 'payee',
      sub: tier ? `Next ${tier} payee, block ${formatInt(next.height)}` : (row.sub ?? ''),
      chip: 'Payee',
    });
  });
  return out;
}

function collectEmptyState(c: Collector, inp: ModelInput): void {
  const { store, env } = inp;
  const recents = (inp.recents ?? []).slice(0, 5);
  for (const [i, e] of recents.entries()) c.add(recentRow(e, i));
  for (const r of nextPayeeRows(store, 'next')) c.add(r);

  const tryRows: PaletteRow[] = [];
  const tip = store.tip?.height ?? null;
  if (tip !== null) tryRows.push(blockRow(tip, { sub: 'The latest block', score: 80, group: 'try' }));
  tryRows.push({
    id: 'try:goto',
    group: 'try',
    kind: 'action',
    icon: 'place',
    title: 'Go to a place',
    sub: 'Type goto helsinki, or any city, country or lat,lon',
    chip: 'Tip',
    score: 78,
    action: { type: 'type', text: 'goto ' },
  });
  const ambient = actionById('ambient.enter');
  if (ambient) tryRows.push({ ...actionRow(ambient, env, 76), group: 'try' });
  const about = actionById('view.about');
  if (about) tryRows.push({ ...actionRow(about, env, 74), group: 'try' });
  const room = recents.length >= 3 ? 3 : 4;
  for (const r of tryRows.slice(0, room)) c.add(r);
}

function collectPrefixHint(
  c: Collector,
  prefix: Prefix,
  store: NetworkStore,
  index: LocalIndex,
  env: ActionEnv,
): void {
  const info = PREFIXES.find((p) => p.id === prefix);
  if (info)
    c.add({
      id: `hint:${prefix}`,
      group: 'try',
      kind: 'action',
      icon: 'search',
      title: info.hint,
      sub: `${info.summary}, for example ${info.example}`,
      chip: 'Usage',
      score: 95,
      action: { type: 'type', text: info.example },
    });
  switch (prefix) {
    case 'node':
      for (const r of nextPayeeRows(store, 'nodes')) c.add(r);
      break;
    case 'app': {
      const apps = [...store.appList()].sort((a, b) => b.instances_running - a.instances_running).slice(0, 6);
      for (const [k, a] of apps.entries()) {
        c.add(
          appRow({
            name: a.name,
            displayName: a.display_name,
            owner: a.owner,
            running: a.instances_running,
            target: a.instances_target,
            enterprise: a.enterprise,
            score: 70 - k,
          }),
        );
      }
      break;
    }
    case 'block': {
      const tip = store.tip?.height;
      if (tip !== undefined) c.add(blockRow(tip, { sub: 'The latest block', score: 90 }));
      break;
    }
    case 'goto':
      for (const [k, x] of index.countries.slice(0, 8).entries()) c.add(placeToRow(countryPlace(x, 80 - k)));
      break;
    case 'layer':
      collectCommands(c, '', env, 'layer.');
      break;
    case 'filter':
      collectCommands(c, '', env, 'filter.');
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// Collectors
// ---------------------------------------------------------------------------------------------

function collectNodes(
  c: Collector,
  store: NetworkStore,
  index: LocalIndex,
  text: string,
  limits: GroupLimits,
): void {
  const ip = classifyIpQuery(text);
  if (!ip) return;
  const m = matchEndpoints(store, index, ip, Math.max(8, limits.nodes), Math.max(3, limits.hosts));
  for (const n of m.nodes) c.add(nodeRow(store, n.row, n.score));
  for (const h of m.hosts) c.add(hostRow(store, h, h.score));
  c.extra.set('nodes', Math.max(0, m.total - m.nodes.length));
}

function collectApps(c: Collector, store: NetworkStore, text: string): void {
  const m = matchApps(store, text, 40);
  for (const a of m.items) c.add(appRow(a));
  c.extra.set('apps', Math.max(0, m.total - m.items.length));
}

const LATEST_WORDS = new Set(['tip', 'latest', 'head', 'newest', 'last', 'current']);

function blockSubFor(store: NetworkStore, height: number): { hash: string | null; sub?: string } {
  const inRing = store.blocks.toArray().find((b) => b.height === height);
  if (inRing) return { hash: inRing.hash };
  const tip = store.tip?.height;
  if (tip !== undefined && tip >= height) {
    const ago = tip - height;
    return { hash: null, sub: ago === 0 ? 'The latest block' : `${formatInt(ago)} blocks ago` };
  }
  return { hash: null };
}

function collectBlocks(c: Collector, store: NetworkStore, text: string): void {
  const lower = text.trim().toLowerCase();
  const tip = store.tip?.height;
  if (LATEST_WORDS.has(lower) && tip !== undefined) {
    c.add(blockRow(tip, { sub: 'The latest block', score: 100 }));
    return;
  }
  const shape = classifyText(text);
  if (shape.kind === 'height' && (tip === undefined || shape.height <= tip)) {
    const s = blockSubFor(store, shape.height);
    c.add(blockRow(shape.height, { ...s, score: 100 }));
  } else if (shape.kind === 'hash') {
    const ring = store.blocks.toArray().find((b) => b.hash.toLowerCase() === shape.hash);
    if (ring) c.add(blockRow(ring.height, { hash: ring.hash, score: 100 }));
  }
}

function collectTx(c: Collector, text: string): void {
  // A hash is a block or a transaction until the server says which; under `tx` it is the transaction.
  const shape = classifyText(text);
  if (shape.kind === 'hash') c.add(txRow(shape.hash, 'Open this transaction', 100));
  else if (shape.kind === 'outpoint') c.add(txRow(shape.txid, `Collateral output ${shape.vout}`, 100));
}

function collectAddress(c: Collector, text: string, operator: boolean): void {
  const shape = classifyText(text);
  if (shape.kind === 'address') {
    if (operator) c.add(operatorRow(shape.addr, undefined, 100));
    else {
      c.add(addressRow(shape.addr, undefined, 100));
      c.add(operatorRow(shape.addr, undefined, 80));
    }
  }
}

function collectPlaces(
  c: Collector,
  store: NetworkStore,
  index: LocalIndex,
  text: string,
  limit: number,
): void {
  for (const p of matchPlaces(index, text, limit, store)) c.add(placeToRow(p));
}

function collectCommands(c: Collector, text: string, env: ActionEnv, idPrefix?: string): void {
  if (!text) {
    // With nothing typed, the prefix lists everything under it.
    for (const a of ACTIONS) {
      if (idPrefix && !a.id.startsWith(idPrefix)) continue;
      if (a.when && !a.when(env)) continue;
      c.add(actionRow(a, env, 60));
    }
    return;
  }
  const { rows } = actionRows(text, env, 30);
  for (const r of rows) {
    const id = r.id.replace(/^action:/, '');
    if (idPrefix && !id.startsWith(idPrefix)) continue;
    c.add(r);
  }
}

function collectFilter(c: Collector, index: LocalIndex, text: string, env: ActionEnv): void {
  const parsed = parseFilterExpr(text, lookupOf(index));
  const set = parsed.patch.set;
  const described = describeFilters(activeFilters(set));
  if (parsed.clearAll) {
    const a = actionById('filter.clear');
    if (a) c.add({ ...actionRow(a, env, 100), group: 'commands' });
  } else if (described.length > 0) {
    c.add({
      id: `filter:${text}`,
      group: 'commands',
      kind: 'action',
      icon: 'filter',
      title: `Filter: ${described.join(', ')}`,
      sub:
        parsed.unknown.length > 0
          ? `Not understood and ignored: ${parsed.unknown.join(', ')}`
          : 'Dim the rest of the globe',
      chip: 'Filter',
      score: 100,
      action: { type: 'run', id: 'filter.apply', arg: text },
    });
  } else if (parsed.unknown.length > 0) {
    c.add({
      id: 'filter:unknown',
      group: 'commands',
      kind: 'action',
      icon: 'info',
      title: `No filter matches ${parsed.unknown.join(', ')}`,
      sub: 'Try a tier, a country, a provider, a FluxOS version, arcane or watched',
      chip: 'Filter',
      score: 50,
      action: { type: 'none' },
    });
  }
  // Single-word suggestions for the word being typed.
  const words = text.split(/\s+/);
  const last = words[words.length - 1] ?? '';
  const before = words.slice(0, -1).join(' ');
  if (last.length >= 2) {
    const compose = (tok: string) => (before ? `${before} ${tok}` : tok);
    for (const t of ['cumulus', 'nimbus', 'stratus'] as const) {
      if (t.startsWith(last.toLowerCase()) && t !== last.toLowerCase()) {
        const arg = compose(t);
        c.add({
          id: `filter:${arg}`,
          group: 'commands',
          kind: 'action',
          icon: 'filter',
          title: `Filter: ${t[0]!.toUpperCase()}${t.slice(1)} only`,
          sub: 'Dim every other tier',
          chip: 'Filter',
          score: 70,
          action: { type: 'run', id: 'filter.apply', arg },
        });
      }
    }
    for (const co of index.countries) {
      if (co.lower.startsWith(last.toLowerCase()) && co.lower !== last.toLowerCase()) {
        const arg = compose(co.code);
        c.add({
          id: `filter:${arg}`,
          group: 'commands',
          kind: 'action',
          icon: 'country',
          title: `Filter: ${co.name}`,
          sub: `${formatInt(co.count)} nodes`,
          chip: 'Filter',
          score: 60 + Math.min(9, Math.floor(co.count / 100)),
          action: { type: 'run', id: 'filter.apply', arg },
        });
      }
    }
    for (const p of matchProviders(index, last, 3)) {
      const arg = compose(p.item.lower.split(' ')[0] ?? p.item.lower);
      c.add({
        id: `filter:provider:${p.item.lower}`,
        group: 'commands',
        kind: 'action',
        icon: 'provider',
        title: `Filter: ${p.item.name}`,
        sub: `${formatInt(p.item.count)} nodes`,
        chip: 'Filter',
        score: 50 + p.score / 10,
        action: { type: 'run', id: 'filter.apply', arg },
      });
    }
  }
}

function collectGeneral(
  c: Collector,
  store: NetworkStore,
  index: LocalIndex,
  text: string,
  env: ActionEnv,
  limits: GroupLimits,
): void {
  const shape = classifyText(text);
  const lower = text.toLowerCase();
  const total = index.total;

  // The hidden greeting: nothing advertises it, and it is not saved under Recent.
  if (isGm(text)) c.add(gmRow());

  // A word that is itself a prefix teaches the prefix.
  const asPrefix = PREFIX_WORDS[lower];
  if (asPrefix) {
    const info = PREFIXES.find((p) => p.id === asPrefix);
    if (info)
      c.add({
        id: `hint:${asPrefix}`,
        group: 'try',
        kind: 'action',
        icon: 'search',
        title: info.hint,
        sub: `${info.summary}, for example ${info.example}`,
        chip: 'Usage',
        score: 88,
        action: { type: 'type', text: `${asPrefix} ` },
      });
  }

  switch (shape.kind) {
    case 'ip':
      collectNodes(c, store, index, text, limits);
      break;
    case 'height': {
      const tip = store.tip?.height;
      if (tip === undefined || shape.height <= tip) {
        const s = blockSubFor(store, shape.height);
        c.add(blockRow(shape.height, { ...s, score: 100 }));
      }
      break;
    }
    case 'hash': {
      const ring = store.blocks.toArray().find((b) => b.hash.toLowerCase() === shape.hash);
      if (ring) c.add(blockRow(ring.height, { hash: ring.hash, score: 100 }));
      break;
    }
    case 'address':
      c.add(addressRow(shape.addr, undefined, 100));
      c.add(operatorRow(shape.addr, undefined, 80));
      break;
    default:
      break;
  }

  if (shape.kind === 'text') {
    if (LATEST_WORDS.has(lower) || lower === 'latest block') {
      const tip = store.tip?.height;
      if (tip !== undefined) c.add(blockRow(tip, { sub: 'The latest block', score: 95 }));
    }
    for (const a of matchApps(store, text, 12).items) c.add(appRow(a));
    for (const p of matchProviders(index, text, 3)) c.add(providerRow(p.item, total, p.score));
    for (const v of matchVersions(index, text, 2)) c.add(versionRow(v.item, total, v.score));
  } else if (shape.kind === 'ip') {
    for (const v of matchVersions(index, text, 2)) c.add(versionRow(v.item, total, v.score - 10));
  }
  if (shape.kind === 'text' || shape.kind === 'ip') collectPlaces(c, store, index, text, 5);

  const { rows } = actionRows(text, env, 12);
  for (const r of rows) c.add(r);
}

// ---------------------------------------------------------------------------------------------
// Server hits
// ---------------------------------------------------------------------------------------------

const norm = (v: string) => v.trim().toLowerCase();

/** True when the hit is what was typed, not merely something like it (only these may jump the queue). */
function isExactHit(hit: SearchHit, typed: string): boolean {
  const t = norm(typed);
  if (!t) return false;
  if (norm(hit.key) === t || norm(hit.label) === t) return true;
  if (hit.kind === 'block') {
    const shape = classifyText(typed);
    if (shape.kind === 'height') return hit.key === String(shape.height);
    if (shape.kind === 'hash') return norm(hit.sublabel ?? '') === t;
  }
  if (hit.kind === 'node') return norm(hit.label).endsWith(` ${t}`);
  return false;
}

function mergeHits(
  c: Collector,
  hits: readonly SearchHit[],
  store: NetworkStore,
  index: LocalIndex,
  input: ParsedInput,
): void {
  const digits = classifyText(input.text).kind === 'height';
  hits.forEach((hit, rank) => {
    // Node ids are not something people type; a number is a block height.
    if (digits && hit.kind === 'node') return;
    // The server lists hits best first but does not say how good they are: only an exact hit may score
    // high enough to move its group to the top.
    const score = isExactHit(hit, input.text) ? 100 : Math.max(40, 82 - Math.min(rank, 42));
    const row = hitRow(hit, store, index.total, score);
    if (!row) return;
    // The prefix narrows what is shown to the kinds it names.
    if (input.prefix && !prefixAccepts(input.prefix, row)) return;
    // The server knows more about a chain object than a guess made from its shape; for nodes, hosts and
    // apps the local table is richer, so it keeps its row.
    if (row.kind === 'tx' || row.kind === 'address' || row.kind === 'operator' || row.kind === 'block')
      c.replace(row);
    else if (!c.has(row.id)) c.add(row);
  });
}

function prefixAccepts(prefix: Prefix, row: PaletteRow): boolean {
  switch (prefix) {
    case 'node':
      return row.kind === 'node' || row.kind === 'host';
    case 'app':
      return row.kind === 'app';
    case 'block':
      return row.kind === 'block';
    case 'tx':
      return row.kind === 'tx';
    case 'addr':
      return row.kind === 'address' || row.kind === 'operator' || row.kind === 'shielded';
    case 'operator':
      return row.kind === 'operator';
    default:
      return false;
  }
}
