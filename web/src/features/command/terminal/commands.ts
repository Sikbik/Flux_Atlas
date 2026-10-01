// The terminal's commands: the same verbs as the interface. Each one is a plain function over a `CmdEnv`
// (see types.ts), prints through `Io`, and opens real windows through `env.open`, so everything it does
// is reachable from the palette and the UI as well. Voice: dry, a little playful, never cute at the cost
// of clarity. Errors say what happened and what to try.
//
// `help` lists a short core; the rest appears with `help all`, so the first screen stays quiet.

import { QUEUE_TIERS } from '../../../app/search';
import { formatAgo, formatEta, formatInt, formatPercent, formatUtcTime } from '../../../lib/format';
import { type NetworkStore, Slice } from '../../../store/network';
import { feedSentence } from '../feedText';
import { activeFilters, describeFilters, parseFilterExpr } from '../filters';
import { layerHidden, meshLabel, parseLayers } from '../layers';
import { classifyIpQuery, getLocalIndex, matchApps, matchEndpoints, nodeFacts } from '../palette/local';
import { buildModel, classifyText, PAGE_LIMITS } from '../palette/model';
import type { GroupId } from '../palette/types';
import { matchPlaces } from '../places';
import {
  type BlockBrief,
  blockSentence,
  briefOf,
  coinbaseSplit,
  flux2,
  nodeSpans,
  placeOf,
  type TierName,
} from './format';
import { bar, dim, key, link, pad, type Span, sp, tierSpan, val } from './output';
import type { CmdEnv, Command, Io } from './types';

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** Largest payout first, the order every list in Atlas reads in. */
const TIER_ORDER: readonly TierName[] = ['stratus', 'nimbus', 'cumulus'];
const tierRank = (t: string): number => {
  const i = TIER_ORDER.indexOf(t as TierName);
  return i < 0 ? TIER_ORDER.length : i;
};

function needLoaded(env: CmdEnv, io: Io): boolean {
  if (env.store.loaded) return true;
  io.err('The network is still loading.', 'Give it a second and run the command again.');
  return false;
}

const tierFromWord = (w: string | undefined): TierName | null => {
  const t = (w ?? '').toLowerCase();
  return t === 'cumulus' || t === 'nimbus' || t === 'stratus' ? t : null;
};

const startsWithAny = (words: readonly string[], partial: string): string[] =>
  words.filter((w) => w.startsWith(partial.toLowerCase()));

export type NodeLookup =
  | { kind: 'none' }
  /** Exactly one node: an `ip:port`, or a host that runs a single node. */
  | { kind: 'node'; row: number }
  | { kind: 'host'; ip: string; rows: number[] }
  | { kind: 'prefix'; rows: number[]; total: number };

/** Nodes for an `ip:port`, a host IP or the start of an IP, from the local node table. */
export function findNodes(store: NetworkStore, text: string): NodeLookup {
  const q = classifyIpQuery(text.trim());
  if (!q) return { kind: 'none' };
  const found = matchEndpoints(store, getLocalIndex(store), q, 60, 1);
  if (found.nodes.length === 0) return { kind: 'none' };
  if (q.complete) {
    const exact = found.nodes.filter((n) => n.score >= 100);
    if (exact.length > 0 && q.port) return { kind: 'node', row: exact[0]!.row };
    const onHost = found.nodes.filter((n) => n.score >= 85).map((n) => n.row);
    if (onHost.length === 1) return { kind: 'node', row: onHost[0]! };
    if (onHost.length > 1) return { kind: 'host', ip: q.host, rows: onHost };
    return { kind: 'none' };
  }
  return { kind: 'prefix', rows: found.nodes.map((n) => n.row), total: found.total };
}

const nodeKeyOf = (store: NetworkStore, row: number): string =>
  store.nodes.endpoint(row) || String(store.nodes.ids[row] ?? row);

const nodeTarget = (store: NetworkStore, row: number) => ({
  to: '/node/$key',
  params: { key: nodeKeyOf(store, row) },
});

/** `Hetzner, FluxOS 7.1.0, 3 apps` for a node row: the facts a line adds under its headline. */
function nodeDetail(store: NetworkStore, row: number): Span[] {
  const t = store.nodes;
  const parts: string[] = [];
  const org = t.orgName(row);
  if (org) parts.push(org);
  const os = t.fluxOs(row);
  if (os) parts.push(`FluxOS ${os}`);
  const apps = t.appCount[row] ?? 0;
  if (apps > 0) parts.push(`${formatInt(apps)} ${apps === 1 ? 'app' : 'apps'}`);
  const paid = t.lastPaid[row] ?? 0;
  if (paid > 0) parts.push(`last paid in block ${formatInt(paid)}`);
  return parts.length ? [dim(`  ${parts.join(', ')}`)] : [];
}

const countWord = (n: number, one: string, many: string): string => `${formatInt(n)} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------------------------
// Core commands
// ---------------------------------------------------------------------------------------------

const help: Command = {
  name: 'help',
  usage: 'help [command|all]',
  summary: 'Lists commands, or one command in detail',
  level: 'core',
  run(args, _rest, _env, io) {
    const want = (args[0] ?? '').toLowerCase();
    if (want && want !== 'all') {
      const c = findCommand(want);
      if (!c) {
        io.err(`No command called '${want}'.`, 'Type help to see them.');
        return;
      }
      io.line(key(c.usage));
      io.line(sp(`  ${c.summary || 'No summary.'}`));
      for (const d of c.detail ?? []) io.line(dim(`  ${d}`));
      if (c.examples?.length)
        io.line(dim('  Try: '), ...c.examples.flatMap((e, i) => [i ? dim('   ') : sp(''), val(e)]));
      return;
    }
    const list = COMMANDS.filter((c) => (want === 'all' ? c.level !== 'hidden' : c.level === 'core'));
    const w = Math.max(...list.map((c) => c.usage.length)) + 2;
    io.line(val('Atlas shell 2.0.'), sp(' Type a command, or press Tab to complete.'));
    io.blank();
    io.lines(list.map((c) => [key(c.usage.padEnd(w)), sp(c.summary)]));
    io.blank();
    io.hint(
      want === 'all'
        ? 'help <command> shows one command in detail.'
        : 'More commands (tail, filter, top and others): help all.',
    );
  },
  complete: (words, partial) => {
    if (words.length > 0) return [];
    return startsWithAny(['all', ...PUBLIC_NAMES], partial);
  },
};

const next: Command = {
  name: 'next',
  usage: 'next',
  summary: 'The next block and its three payees',
  level: 'core',
  run(_a, _r, env, io) {
    if (!needLoaded(env, io)) return;
    const s = env.store;
    const tip = s.tip;
    const np = s.nextPayees;
    const height = np?.height ?? (tip ? tip.height + 1 : null);
    if (height === null) {
      io.err('There is no chain tip yet.', 'Try again in a moment.');
      return;
    }
    const beat = env.beat();
    const late = beat.phase === 'late' || beat.phase === 'quiet';
    io.line(
      link(`Block ${formatInt(height)}`, { to: '/block/$key', params: { key: String(height) } }),
      sp(
        late
          ? ' is late'
          : beat.remainingMs < 1000
            ? ' is due'
            : ` in ${Math.round(beat.remainingMs / 1000)} s`,
      ),
      dim(tip ? `   tip ${formatInt(tip.height)} (${formatAgo(env.now() - tip.time_ms)})` : ''),
    );
    if (!np || np.payees.length === 0) {
      io.hint('The payees for this block have not been announced yet.');
      return;
    }
    const split = coinbaseSplit(s);
    for (const p of [...np.payees].sort((a, b) => tierRank(a.tier) - tierRank(b.tier))) {
      const amount = flux2(split.tiers[p.tier as TierName] ?? null);
      const row = p.node === null ? -1 : s.nodes.indexOf(p.node);
      if (row < 0) {
        io.line(pad(tierSpan(p.tier), 9), pad(val(amount), 12), dim(p.address));
        continue;
      }
      io.line(
        pad(tierSpan(p.tier), 9),
        pad(val(amount), 12),
        link(s.nodes.endpoint(row) || `node #${p.node}`, nodeTarget(s, row)),
        dim(placeOf(s, row) ? `  ${placeOf(s, row)}` : ''),
      );
    }
  },
};

const node: Command = {
  name: 'node',
  usage: 'node <ip[:port]>',
  summary: 'Describes a node or host and opens it',
  level: 'core',
  examples: ['node 65.109', 'node 65.109.26.93:16147'],
  detail: [
    'An IP prefix lists matches, a full IP lists every node on that host, and ip:port opens one node.',
    'A collateral outpoint (txid:index) works too.',
  ],
  async run(args, rest, env, io) {
    if (!needLoaded(env, io)) return;
    const text = (args[0] ?? rest).trim();
    if (!text) {
      io.err('Which node?', 'Try node 65.109 or node <ip:port>.');
      return;
    }
    const s = env.store;
    let found = findNodes(s, text);
    if (found.kind === 'none' && classifyText(text).kind === 'outpoint') {
      // Collateral outpoints are not in the node table: the server resolves them.
      const hits = await env.searchHits(text).catch(() => []);
      const hit = hits.find((h) => h.kind === 'node');
      const id = hit ? Number(hit.key) : Number.NaN;
      const row = Number.isInteger(id) ? s.nodes.indexOf(id) : -1;
      if (row >= 0) found = { kind: 'node', row };
    }
    switch (found.kind) {
      case 'none':
        io.err(`No node matches '${text}'.`, 'Try an IP, an IP:port, or the start of one such as 65.109.');
        return;
      case 'node': {
        io.line(...nodeSpans(s, found.row), ...nodeDetail(s, found.row));
        env.open({ to: '/node/$key', params: { key: nodeKeyOf(s, found.row) } });
        return;
      }
      case 'host': {
        const n = found.rows.length;
        const where = [placeOf(s, found.rows[0]!), s.nodes.orgName(found.rows[0]!)]
          .filter(Boolean)
          .join(', ');
        io.line(
          val(countWord(n, 'node', 'nodes')),
          sp(' on host '),
          link(found.ip, { to: '/host/$ip', params: { ip: found.ip } }),
          dim(where ? ` (${where})` : ''),
          sp(n >= 5 ? '. Not a great place for all your eggs.' : '.'),
        );
        io.lines(found.rows.slice(0, 12).map((r) => nodeSpans(s, r, { padEndpoint: 22, columns: true })));
        if (n > 12) io.hint(`${formatInt(n - 12)} more on this host.`);
        env.open({ to: '/host/$ip', params: { ip: found.ip } });
        return;
      }
      case 'prefix': {
        io.line(
          val(formatInt(found.total)),
          sp(found.total === 1 ? ' node starts with ' : ' nodes start with '),
          val(text),
          sp(found.total > 8 ? '. The first few:' : ':'),
        );
        io.lines(found.rows.slice(0, 8).map((r) => nodeSpans(s, r, { padEndpoint: 22, columns: true })));
        if (found.total > 8) io.hint('Type more of the address to narrow it.');
      }
    }
  },
};

const app: Command = {
  name: 'app',
  usage: 'app <name>',
  summary: 'Describes an app and opens it',
  level: 'core',
  examples: ['app BitcoinWhitepaper'],
  run(args, rest, env, io) {
    if (!needLoaded(env, io)) return;
    const text = (args.length ? args.join(' ') : rest).trim();
    if (!text) {
      io.err('Which app?', 'Type part of its name, such as app bitcoin.');
      return;
    }
    const m = matchApps(env.store, text, 4);
    const best = m.items[0];
    if (!best) {
      io.err(`No app called '${text}'.`, 'Names match loosely: a typo or two is fine.');
      return;
    }
    const tip = env.store.tip?.height ?? null;
    const detail = env.store.apps.get(best.name);
    const left = detail && tip !== null ? (detail.expire_height - tip) * 30_000 : null;
    io.line(
      link(best.displayName, { to: '/app/$name', params: { name: best.name } }),
      sp(`, ${countWord(best.running, 'instance', 'instances')}`),
      best.target > best.running ? dim(` of ${formatInt(best.target)} wanted`) : sp(''),
      left === null ? sp('') : sp(left > 0 ? `, expires ${formatEta(left)}` : ', has expired'),
    );
    const others = m.items.slice(1);
    if (others.length > 0)
      io.line(
        dim('  Also close: '),
        ...others.flatMap((x, i) => [
          i ? dim(', ') : sp(''),
          link(x.displayName, { to: '/app/$name', params: { name: x.name } }, 'dim'),
        ]),
      );
    env.open({ to: '/app/$name', params: { name: best.name } });
  },
  complete: (_w, partial, env) => {
    const p = partial.toLowerCase();
    return env.store
      .appList()
      .filter((a) => a.display_name.toLowerCase().startsWith(p))
      .sort((a, b) => b.instances_running - a.instances_running)
      .slice(0, 8)
      .map((a) => a.display_name);
  },
};

async function resolveBlock(env: CmdEnv, what: string): Promise<BlockBrief | null> {
  const s = env.store;
  const word = what.toLowerCase();
  if (word === 'tip' || word === 'latest' || word === '') {
    const b = s.blocks.newest();
    return b ? briefOf(b) : null;
  }
  const shape = classifyText(what);
  if (shape.kind === 'height') {
    const live = s.blocks.toArray().find((x) => x.height === shape.height);
    if (live) return briefOf(live);
    const tip = s.tip?.height;
    if (tip !== undefined && shape.height > tip) return null;
    const fetched = await env.fetchBlock(shape.height);
    return fetched ? briefOf(fetched) : null;
  }
  if (shape.kind === 'hash') {
    const live = s.blocks.toArray().find((x) => x.hash.toLowerCase() === shape.hash);
    if (live) return briefOf(live);
    const fetched = await env.fetchBlock(shape.hash);
    return fetched ? briefOf(fetched) : null;
  }
  return null;
}

const block: Command = {
  name: 'block',
  usage: 'block <height|hash|tip>',
  summary: 'A block: producer, payouts and size',
  level: 'core',
  examples: ['block tip'],
  async run(args, rest, env, io) {
    const what = (args[0] ?? rest).trim() || 'tip';
    const b = await resolveBlock(env, what);
    if (!b) {
      io.err(`No block '${what}'.`, 'Try a height up to the tip, a block hash, or tip for the latest.');
      return;
    }
    const s = env.store;
    io.line(...blockSentence(s, b));
    for (const p of [...b.payouts].sort((x, y) => tierRank(x.tier) - tierRank(y.tier))) {
      const row = p.node === null ? -1 : s.nodes.indexOf(p.node);
      io.line(
        sp('  '),
        pad(tierSpan(p.tier), 9),
        pad(val(flux2(p.amount)), 12),
        row >= 0 ? link(s.nodes.endpoint(row) || `node #${p.node}`, nodeTarget(s, row)) : dim(p.address),
        dim(row >= 0 && placeOf(s, row) ? `  ${placeOf(s, row)}` : ''),
      );
    }
    env.open({ to: '/block/$key', params: { key: String(b.height) } });
  },
  complete: (words, partial) => (words.length === 0 ? startsWithAny(['tip'], partial) : []),
};

/** The data groups a text search prints; actions, recents and the rest are the palette's business. */
const SEARCH_GROUPS: readonly GroupId[] = ['nodes', 'hosts', 'apps', 'blocks', 'txs', 'addresses', 'goto'];

const search: Command = {
  name: 'search',
  usage: 'search <text>',
  summary: 'What the palette finds, as lines',
  level: 'core',
  examples: ['search hetzner', 'search 2996914'],
  async run(args, rest, env, io) {
    if (!needLoaded(env, io)) return;
    const text = (rest || args.join(' ')).trim();
    if (!text) {
      io.err('Search for what?', 'Try search hetzner, or a block height, a hash or an address.');
      return;
    }
    const hits = await env.searchHits(text).catch(() => []);
    const model = buildModel({
      raw: text,
      store: env.store,
      hits,
      env: env.actionEnv(),
      limits: PAGE_LIMITS,
    });
    const groups = model.groups.filter((g) => SEARCH_GROUPS.includes(g.id));
    if (groups.length === 0) {
      io.err(
        `No match for '${text}'.`,
        'Try a block height, a hash, an address, an IP with a port, or an app name.',
      );
      return;
    }
    for (const g of groups) {
      io.line(dim(`${g.label} (${formatInt(g.rows.length + g.more)})`));
      for (const r of g.rows.slice(0, 6)) {
        const go = r.action.type === 'go' && !r.action.target.stay ? r.action.target : null;
        io.line(sp('  '), go ? link(r.title, go) : val(r.title), dim(r.sub ? `  ${r.sub}` : ''));
      }
      const hidden = g.rows.length - 6 + g.more;
      if (hidden > 0) io.line(dim(`  and ${formatInt(hidden)} more`));
    }
    io.line(link('All results on one page', { to: '/q/$text', params: { text }, fragment: 'all' }, 'dim'));
  },
};

const goto: Command = {
  name: 'goto',
  usage: 'goto <place|lat,lon>',
  summary: 'Flies the camera to a place',
  level: 'core',
  examples: ['goto helsinki', 'goto finland', 'goto 60.17,24.94'],
  detail: ['A country also filters the globe to it (filter clear brings the rest back).'],
  run(args, rest, env, io) {
    const text = (rest || args.join(' ')).replace(/^to\s+/i, '').trim();
    if (!text) {
      io.err('Where to?', 'Try goto helsinki, goto finland or goto 60.17,24.94.');
      return;
    }
    const best = matchPlaces(getLocalIndex(env.store), text, 1, env.store)[0];
    if (!best) {
      io.err(`No place called '${text}'.`, 'Try a city, a country, a region such as Europe, or coordinates.');
      return;
    }
    if (!env.fly(best.view)) {
      io.err('The globe is not running here, so there is nowhere to fly.');
      return;
    }
    io.line(
      sp('Flying to '),
      val(best.name),
      dim(`  ${best.view.lat.toFixed(2)}, ${best.view.lon.toFixed(2)}`),
    );
    if (best.kind === 'country' && best.cc) {
      env.action('filter.apply', best.cc);
      io.hint(`Showing only ${best.name}. filter clear brings the rest back.`);
    }
  },
  complete: (_w, partial, env) => {
    const index = getLocalIndex(env.store);
    if (!partial) return index.countries.slice(0, 8).map((c) => c.name);
    return matchPlaces(index, partial, 8, env.store).map((p) => p.name);
  },
};

const stats: Command = {
  name: 'stats',
  usage: 'stats',
  summary: 'The network totals',
  level: 'core',
  run(_a, _r, env, io) {
    const sum = env.store.summary;
    if (!sum) {
      io.err('The network summary has not arrived yet.', 'Try again in a moment.');
      return;
    }
    io.line(
      val(formatInt(sum.node_count)),
      sp(' nodes, '),
      val(formatInt(sum.host_count)),
      sp(' hosts, '),
      val(formatInt(sum.app_count)),
      sp(' apps, tip '),
      sum.tip
        ? link(formatInt(sum.tip.height), { to: '/block/$key', params: { key: String(sum.tip.height) } })
        : dim('unknown'),
    );
    io.line(
      tierSpan('stratus'),
      sp(` ${formatInt(sum.tiers.stratus)}   `),
      tierSpan('nimbus'),
      sp(` ${formatInt(sum.tiers.nimbus)}   `),
      tierSpan('cumulus'),
      sp(` ${formatInt(sum.tiers.cumulus)}`),
    );
    io.line(
      dim(
        `${countWord(sum.country_count, 'country', 'countries')}, ${countWord(sum.provider_count, 'provider', 'providers')}, ${formatInt(sum.arcane_count)} on ArcaneOS, ${formatInt(sum.unreachable_count)} unreachable, ${formatInt(sum.mempool_size)} in the mempool`,
      ),
    );
  },
};

const moon: Command = {
  name: 'moon',
  usage: 'moon [open|replay]',
  summary: 'The coinbase split, with the next payees',
  level: 'core',
  detail: ['moon open opens About Flux. moon replay plays the last block on the globe again.'],
  run(args, _r, env, io) {
    const sub = (args[0] ?? '').toLowerCase();
    if (sub === 'open') {
      io.line(sp('Opening About Flux.'));
      env.open({ to: '/about' });
      return;
    }
    if (sub === 'replay') {
      if (env.replayRelay()) io.line(sp('Replaying the last block on the globe.'));
      else io.err('There is no block to replay yet, or motion is off.', 'Try again after the next block.');
      return;
    }
    if (sub) {
      io.err(`'moon ${sub}' is not a thing.`, 'Try moon, moon open or moon replay.');
      return;
    }
    if (!needLoaded(env, io)) return;
    const s = env.store;
    const tip = s.tip;
    const beat = env.beat();
    const late = beat.phase === 'late' || beat.phase === 'quiet';
    io.line(
      sp('The moon is the chain. '),
      tip ? val(`Block ${formatInt(tip.height)}`) : dim('No block yet'),
      sp(
        late
          ? ', and the next one is late.'
          : `, next in ${Math.max(0, Math.round(beat.remainingMs / 1000))} s.`,
      ),
    );
    const split = coinbaseSplit(s);
    const np = s.nextPayees;
    const payee = (tier: TierName): Span[] => {
      const p = np?.payees.find((x) => x.tier === tier);
      const row = p && p.node !== null ? s.nodes.indexOf(p.node) : -1;
      if (row < 0) return [];
      return [
        sp('  '),
        pad(dim(placeOf(s, row)), 12),
        sp('  '),
        link(s.nodes.endpoint(row) || `node #${p?.node}`, nodeTarget(s, row)),
      ];
    };
    const piece = (name: string, tier: TierName, note: string): Span[] => [
      sp('  '),
      pad(dim(name), 15),
      pad(tierSpan(tier), 9),
      pad(val(flux2(split.tiers[tier] ?? null)), 12),
      ...payee(tier),
      ...(note ? [dim(`   ${note}`)] : []),
    ];
    io.line(...piece('cap', 'stratus', np ? 'next block' : ''));
    io.line(...piece('big hexagon', 'nimbus', ''));
    io.line(...piece('small hexagon', 'cumulus', ''));
    io.line(
      sp('  '),
      pad(dim('bar'), 15),
      pad(dim('dev fund'), 9),
      pad(val(flux2(split.dev)), 12),
      dim("  plus the block's fees"),
    );
    io.hint('moon open for About Flux, moon replay to watch the last block again.');
  },
  complete: (words, partial) => (words.length === 0 ? startsWithAny(['open', 'replay'], partial) : []),
};

const ambient: Command = {
  name: 'ambient',
  usage: 'ambient',
  summary: 'Enters ambient mode (any key brings you back)',
  level: 'core',
  run(_a, _r, env, io) {
    io.line(sp('Entering ambient mode. Move the mouse or press any key to come back.'));
    env.action('ambient.enter');
  },
};

const clear: Command = {
  name: 'clear',
  usage: 'clear',
  summary: 'Clears the screen',
  level: 'core',
  detail: ['Ctrl+L does the same.'],
  run() {
    // The session clears the screen itself (it owns the scrollback); this entry makes help and Tab know the name.
  },
};

// ---------------------------------------------------------------------------------------------
// More commands (help all)
// ---------------------------------------------------------------------------------------------

const tx: Command = {
  name: 'tx',
  usage: 'tx <id>',
  summary: 'Opens the explorer on a transaction',
  level: 'more',
  run(args, rest, env, io) {
    const id = (args[0] ?? rest).trim();
    const shape = classifyText(id);
    const txid = shape.kind === 'hash' ? shape.hash : shape.kind === 'outpoint' ? shape.txid : null;
    if (!txid) {
      io.err(`'${id}' is not a transaction id.`, 'A transaction id is 64 hexadecimal characters.');
      return;
    }
    io.line(
      sp('Opening transaction '),
      link(`${txid.slice(0, 12)}...${txid.slice(-10)}`, { to: '/tx/$txid', params: { txid } }),
      sp('.'),
    );
    env.open({ to: '/tx/$txid', params: { txid } });
  },
};

const addr: Command = {
  name: 'addr',
  usage: 'addr <address>',
  summary: 'Opens the explorer on an address',
  level: 'more',
  run(args, rest, env, io) {
    const a = (args[0] ?? rest).trim();
    if (classifyText(a).kind !== 'address') {
      io.err(
        `'${a}' is not a Flux address.`,
        'Transparent addresses start with t1 or t3 and run 26 to 36 characters.',
      );
      return;
    }
    io.line(sp('Opening address '), link(a, { to: '/address/$addr', params: { addr: a } }), sp('.'));
    env.open({ to: '/address/$addr', params: { addr: a } });
  },
};

const operator: Command = {
  name: 'operator',
  usage: 'operator <address>',
  summary: 'Opens the operator view for an address',
  level: 'more',
  run(args, rest, env, io) {
    const a = (args[0] ?? rest).trim();
    if (classifyText(a).kind !== 'address') {
      io.err(`'${a}' is not an operator address.`, 'Type a full payment address or a ZelID.');
      return;
    }
    io.line(sp('Opening operator '), link(a, { to: '/operator/$addr', params: { addr: a } }), sp('.'));
    env.open({ to: '/operator/$addr', params: { addr: a } });
  },
};

const filter: Command = {
  name: 'filter',
  usage: 'filter <expression>',
  summary: 'Dims the rest of the globe',
  level: 'more',
  examples: ['filter stratus', 'filter fi hetzner', 'filter clear'],
  detail: [
    'Words: a tier (cumulus, nimbus, stratus), a country code or name, a provider, a FluxOS version, arcane, watched.',
    'filter clear removes every filter. Explicit forms work too: tier=stratus cc=fi.',
  ],
  run(args, rest, env, io) {
    const expr = (rest || args.join(' ')).trim();
    if (!expr) {
      const now = describeFilters(activeFilters(env.location().search));
      io.line(
        sp(now.length ? `Filters: ${now.join(', ')}.` : 'No filters are on.'),
        dim('  filter <expression> sets some.'),
      );
      return;
    }
    const index = getLocalIndex(env.store);
    const parsed = parseFilterExpr(expr, {
      countries: index.countries,
      providers: index.providers,
      versions: index.versions,
    });
    if (parsed.clearAll) {
      env.action('filter.clear');
      io.line(sp('Filters cleared.'));
      return;
    }
    const described = describeFilters(activeFilters(parsed.patch.set));
    if (described.length === 0) {
      io.err(
        `No filter matches '${expr}'.`,
        'Try a tier, a country (fi), a provider (hetzner), a FluxOS version, arcane or watched.',
      );
      return;
    }
    env.action('filter.apply', expr);
    io.line(sp('Filter: '), val(described.join(', ')), sp('.'), dim('  filter clear removes it.'));
    if (parsed.unknown.length > 0) io.hint(`Ignored: ${parsed.unknown.join(', ')}.`);
  },
  complete: (_w, partial, env) => {
    const p = partial.toLowerCase();
    const out = startsWithAny(['cumulus', 'nimbus', 'stratus', 'arcane', 'watched', 'clear'], p);
    if (p.length >= 2)
      for (const c of getLocalIndex(env.store).countries)
        if (c.lower.startsWith(p)) out.push(c.name.toLowerCase());
    return out.slice(0, 8);
  },
};

const layer: Command = {
  name: 'layer',
  usage: 'layer <name> [on|off|mode]',
  summary: 'Shows or hides a layer of the globe',
  level: 'more',
  examples: ['layer mesh flow', 'layer labels off'],
  detail: ['Layers: mesh (modes sel, flow, off) and labels.'],
  run(args, _rest, env, io) {
    const name = (args[0] ?? '').toLowerCase();
    const arg = (args[1] ?? '').toLowerCase();
    const l = env.location().search.l;
    const cur = typeof l === 'string' ? l : undefined;
    if (!name) {
      io.line(
        sp('Mesh: '),
        val(meshLabel(parseLayers(cur).mesh)),
        sp('. Place labels: '),
        val(layerHidden(cur, 'labels') ? 'off' : 'on'),
        sp('.'),
      );
      return;
    }
    if (name === 'mesh') {
      const mode =
        arg === 'flow' ? 'flow' : arg === 'sel' || arg === 'on' ? 'sel' : arg === 'off' ? 'off' : null;
      if (!mode) {
        io.err(`'${arg}' is not a mesh mode.`, 'Try layer mesh sel, layer mesh flow or layer mesh off.');
        return;
      }
      env.action(`layer.mesh.${mode}`);
      io.line(sp('Mesh: '), val(meshLabel(mode)), sp('.'));
      return;
    }
    if (name === 'labels') {
      const on = arg !== 'off';
      env.action(on ? 'layer.labels.on' : 'layer.labels.off');
      io.line(sp('Place labels: '), val(on ? 'on' : 'off'), sp('.'));
      return;
    }
    io.err(`No layer called '${name}'.`, 'Try mesh or labels.');
  },
  complete: (words, partial) => {
    if (words.length === 0) return startsWithAny(['mesh', 'labels'], partial);
    if (words[0]?.toLowerCase() === 'mesh') return startsWithAny(['sel', 'flow', 'off'], partial);
    if (words[0]?.toLowerCase() === 'labels') return startsWithAny(['on', 'off'], partial);
    return [];
  },
};

/** Ranked rows with a share bar (scaled to the leader) and the share of the total. */
function ranked(items: readonly { name: string; count: number }[], total: number): Span[][] {
  const top = items.slice(0, 10);
  const lead = top[0]?.count ?? 0;
  const nameW = Math.min(26, Math.max(4, ...top.map((i) => [...i.name].length)));
  const countW = Math.max(1, ...top.map((i) => formatInt(i.count).length));
  return top.map((i, n) => [
    dim(`${String(n + 1).padStart(2)}  `),
    pad(val([...i.name].length > nameW ? `${[...i.name].slice(0, nameW - 1).join('')}.` : i.name), nameW),
    sp('  '),
    pad(sp(formatInt(i.count)), countW, true),
    sp('  '),
    bar(lead > 0 ? i.count / lead : 0, total > 0 ? formatPercent(i.count / total, 1) : ''),
    sp('  '),
    dim(total > 0 ? formatPercent(i.count / total, 1) : ''),
  ]);
}

const top: Command = {
  name: 'top',
  usage: 'top <countries|providers|apps>',
  summary: 'A ranked list with share bars',
  level: 'more',
  examples: ['top countries', 'top providers'],
  run(args, _rest, env, io) {
    if (!needLoaded(env, io)) return;
    const what = (args[0] ?? '').toLowerCase();
    const index = getLocalIndex(env.store);
    if (what.startsWith('countr')) {
      io.line(dim('Countries by nodes'));
      io.lines(ranked(index.countries, index.total));
    } else if (what.startsWith('provid')) {
      io.line(dim('Providers by nodes'));
      io.lines(ranked(index.providers, index.total));
    } else if (what.startsWith('app')) {
      const apps = env.store
        .appList()
        .map((a) => ({ name: a.display_name, count: a.instances_running }))
        .sort((a, b) => b.count - a.count);
      io.line(dim('Apps by running instances'));
      io.lines(
        ranked(
          apps,
          apps.reduce((n, a) => n + a.count, 0),
        ),
      );
    } else {
      io.err(what ? `Cannot rank '${what}'.` : 'Rank what?', 'Try top countries, top providers or top apps.');
    }
  },
  complete: (words, partial) =>
    words.length === 0 ? startsWithAny(['countries', 'providers', 'apps'], partial) : [],
};

const queue: Command = {
  name: 'queue',
  usage: 'queue [tier]',
  summary: 'The payment queue: who is paid next',
  level: 'more',
  examples: ['queue stratus'],
  run(args, _rest, env, io) {
    if (!needLoaded(env, io)) return;
    const want = tierFromWord(args[0]);
    if (args[0] && !want) {
      io.err(`'${args[0]}' is not a tier.`, 'Try queue cumulus, queue nimbus or queue stratus.');
      return;
    }
    const s = env.store;
    const t = s.nodes;
    for (const tier of want ? [want] : TIER_ORDER) {
      const heads: { row: number; rank: number }[] = [];
      for (let i = 0; i < t.count; i++) {
        const rank = t.rank[i] ?? 0;
        if (rank > 0 && rank <= 5 && nodeFacts(s, i).tier === tier) heads.push({ row: i, rank });
      }
      heads.sort((a, b) => a.rank - b.rank);
      io.line(tierSpan(tier), dim(heads.length > 0 ? '  next in line' : '  no queue positions known'));
      for (const h of heads) {
        io.line(
          dim(`  #${h.rank}  `),
          link(t.endpoint(h.row) || `node #${t.ids[h.row]}`, nodeTarget(s, h.row)),
          dim(placeOf(s, h.row) ? `  ${placeOf(s, h.row)}` : ''),
        );
      }
    }
    env.open(want ? { to: '/queue/$tier', params: { tier: want } } : { to: '/queue' });
  },
  complete: (words, partial) => (words.length === 0 ? startsWithAny([...QUEUE_TIERS], partial) : []),
};

const watch: Command = {
  name: 'watch',
  usage: 'watch [ip:port]',
  summary: 'Watches a node, or lists the watched ones',
  level: 'more',
  detail: ['unwatch <ip:port> stops watching a node.'],
  run(args, rest, env, io) {
    const text = (args[0] ?? rest).trim();
    const s = env.store;
    if (!text) {
      const ids = env.watched();
      if (ids.length === 0) {
        io.line(sp('Nothing is watched yet.'), dim('  watch <ip:port> adds a node.'));
        return;
      }
      io.line(
        val(countWord(ids.length, 'node', 'nodes')),
        sp(ids.length === 1 ? ' is watched:' : ' are watched:'),
      );
      for (const id of ids.slice(0, 12)) {
        const row = s.nodes.indexOf(id);
        io.line(
          sp('  '),
          row >= 0
            ? link(s.nodes.endpoint(row) || `node #${id}`, nodeTarget(s, row))
            : dim(`node #${id} (no longer on the network)`),
        );
      }
      return;
    }
    const found = findNodes(s, text);
    if (found.kind !== 'node') {
      io.err(
        found.kind === 'none' ? `No node matches '${text}'.` : `'${text}' is more than one node.`,
        'Use the full ip:port of the node.',
      );
      return;
    }
    env.watch(s.nodes.ids[found.row]!, true);
    io.line(sp('Watching '), link(s.nodes.endpoint(found.row), nodeTarget(s, found.row)), sp('.'));
    io.hint('Alerts use browser notifications. Allow them in Settings.');
  },
};

const unwatch: Command = {
  name: 'unwatch',
  usage: 'unwatch <ip:port>',
  summary: 'Stops watching a node',
  level: 'hidden',
  run(args, rest, env, io) {
    const text = (args[0] ?? rest).trim();
    const found = findNodes(env.store, text);
    if (found.kind !== 'node') {
      io.err(`No single node matches '${text}'.`, 'Use the full ip:port.');
      return;
    }
    env.watch(env.store.nodes.ids[found.row]!, false);
    io.line(sp('No longer watching '), val(env.store.nodes.endpoint(found.row)), sp('.'));
  },
};

const tail: Command = {
  name: 'tail',
  usage: 'tail <blocks|feed>',
  summary: 'Streams new blocks or feed rows (Ctrl+C stops)',
  level: 'more',
  streams: true,
  examples: ['tail blocks', 'tail feed'],
  async run(args, _r, env, io) {
    const what = (args[0] ?? '').toLowerCase();
    if (what !== 'blocks' && what !== 'feed') {
      io.err(what ? `Cannot tail '${what}'.` : 'Tail what?', 'Try tail blocks or tail feed.');
      return;
    }
    if (!needLoaded(env, io)) return;
    const s = env.store;
    if (what === 'blocks') {
      const newest = s.blocks.newest();
      let last = newest?.height ?? 0;
      const clock = (ms: number) => dim(`${formatUtcTime(ms).replace(' UTC', '')}  `);
      if (newest) io.line(clock(newest.timeMs), ...blockSentence(s, briefOf(newest)));
      const show = () => {
        for (const b of s.blocks
          .toArray()
          .filter((x) => x.height > last)
          .reverse()) {
          last = Math.max(last, b.height);
          const brief = briefOf(b);
          io.line(clock(b.timeMs), ...blockSentence(s, brief));
          const pay = [...brief.payouts].sort((x, y) => tierRank(x.tier) - tierRank(y.tier));
          if (pay.length > 0)
            io.line(
              sp(' '.repeat(10)),
              ...pay.flatMap((p, i) => [
                i ? dim('   ') : sp(''),
                tierSpan(p.tier),
                dim(` ${flux2(p.amount)}`),
              ]),
            );
        }
      };
      await follow(env, Slice.Blocks, show);
      return;
    }
    let lastSeq = 0;
    const row = (f: ReturnType<typeof s.feed.toArray>[number]) => {
      lastSeq = Math.max(lastSeq, f.seq);
      const sen = feedSentence(s, f.item);
      io.line(dim(`${formatUtcTime(f.observedMs).replace(' UTC', '')}  `), sp(sen.text, sen.tone));
    };
    for (const f of s.feed.toArray().slice(0, 5).reverse()) row(f);
    const show = () => {
      for (const f of s.feed
        .toArray()
        .filter((x) => x.seq > lastSeq)
        .reverse())
        row(f);
    };
    await follow(env, Slice.Feed, show);
  },
  complete: (words, partial) => (words.length === 0 ? startsWithAny(['blocks', 'feed'], partial) : []),
};

/** Calls `show` whenever the slice changes, until the signal aborts. */
function follow(env: CmdEnv, slice: number, show: () => void): Promise<void> {
  return new Promise<void>((resolve) => {
    const unsubscribe = env.store.subscribe((change) => {
      if (change.slices & slice) show();
    });
    const done = () => {
      unsubscribe();
      resolve();
    };
    if (env.signal.aborted) done();
    else env.signal.addEventListener('abort', done, { once: true });
  });
}

const about: Command = {
  name: 'about',
  usage: 'about',
  summary: 'Opens About Flux',
  level: 'more',
  run(_a, _r, env, io) {
    io.line(
      sp('Flux Atlas '),
      val(env.version),
      sp(', a live map of the Flux network. '),
      dim('Opening About Flux.'),
    );
    env.open({ to: '/about' });
  },
};

const achievements: Command = {
  name: 'achievements',
  usage: 'achievements',
  summary: 'What you have found so far',
  level: 'more',
  run(_a, _r, env, io) {
    io.lines(env.achievementLines());
  },
};

const settings: Command = {
  name: 'settings',
  usage: 'settings',
  summary: 'Opens Settings',
  level: 'more',
  run(_a, _r, env, io) {
    io.line(sp('Opening Settings.'));
    env.open({ to: '/settings' });
  },
};

// ---------------------------------------------------------------------------------------------
// Hidden: a few winks, listed nowhere
// ---------------------------------------------------------------------------------------------

const wink = (name: string, say: (env: CmdEnv, io: Io) => void): Command => ({
  name,
  usage: name,
  summary: '',
  level: 'hidden',
  run: (_a, _r, env, io) => say(env, io),
});

const sudo = wink('sudo', (_e, io) =>
  io.err('atlas is not in the sudoers file.', 'This incident will be reported to nobody.'),
);
const gm = wink('gm', (env, io) => {
  const tip = env.store.tip;
  io.line(sp('gm.'), tip ? dim(` The chain says gm back, at block ${formatInt(tip.height)}.`) : sp(''));
  // The same hidden greeting as the palette's: the moon answers.
  env.action('egg.gm');
});
const exit = wink('exit', (_e, io) => io.line(sp('There is no exit. There is Esc, and the close button.')));
const whoami = wink('whoami', (_e, io) =>
  io.line(sp('Someone with a browser tab open on a blockchain. Respect.')),
);
const pwd = wink('pwd', (env, io) => io.line(sp(env.location().pathname)));
const ls = wink('ls', (_e, io) => {
  io.line(sp('Nothing to list: the network is the filesystem.'));
  io.hint('top countries is the closest thing.');
});

/** Every command, in the order `help` lists them. */
export const COMMANDS: readonly Command[] = [
  help,
  next,
  node,
  app,
  block,
  search,
  goto,
  stats,
  moon,
  ambient,
  clear,
  tx,
  addr,
  operator,
  filter,
  layer,
  top,
  queue,
  watch,
  tail,
  about,
  achievements,
  settings,
  unwatch,
  sudo,
  gm,
  exit,
  whoami,
  pwd,
  ls,
];

const BY_NAME: ReadonlyMap<string, Command> = new Map(COMMANDS.map((c) => [c.name, c]));

export function findCommand(name: string): Command | undefined {
  return BY_NAME.get(name.toLowerCase());
}

/** The names `help` and Tab offer (hidden commands are left out). */
export const PUBLIC_NAMES: readonly string[] = COMMANDS.filter((c) => c.level !== 'hidden').map(
  (c) => c.name,
);
