import { beforeAll, describe, expect, it } from 'vitest';
import { syntheticOutpoint } from '../../../api/bin/writer';
import type { LiveMsg } from '../../../api/generated/LiveMsg';
import type { SearchHit } from '../../../api/generated/SearchHit';
import { beatState } from '../../../lib/clock';
import { NetworkStore } from '../../../store/network';
import { blockMsg, bootstrap, hex64, live, syntheticNodesBin } from '../../../testing/fixtures';
import type { NavTarget } from '../navigation';
import type { ActionEnv } from '../palette/actions';
import type { FlyView } from '../palette/types';
import { COMMANDS, findCommand, findNodes, PUBLIC_NAMES } from './commands';
import { complete, ghostFor, nearest, wordStart } from './complete';
import { devFundOf } from './format';
import { suggest } from './history';
import { type LineKind, lineText, type Span } from './output';
import { commonPrefix, splitCommand, tokenize } from './parse';
import { execute, inferLine, isStreaming, type Sink } from './session';
import type { CmdEnv } from './types';

let store: NetworkStore;

beforeAll(() => {
  store = new NetworkStore();
  store.loadSnapshot({ bootstrap: bootstrap(100, 2_996_914), nodes: syntheticNodesBin(600) });
  const current = store.nodes.versions.intern('8.20.0');
  for (let i = 0; i < 600; i++) store.nodes.version[i] = current;
  store.apply(
    live('next_payees', 101, {
      height: 2_996_915,
      payees: [
        { tier: 'cumulus', node: 3, address: 't1c' },
        { tier: 'nimbus', node: 12, address: 't1n' },
        { tier: 'stratus', node: 27, address: 't1s' },
      ],
    }),
  );
});

interface Screen {
  sink: Sink;
  rows: { kind: LineKind; text: string }[];
  text(): string;
  cleared: number;
}

function screen(): Screen {
  const rows: { kind: LineKind; text: string }[] = [];
  const s: Screen = {
    rows,
    cleared: 0,
    text: () => rows.map((r) => r.text).join('\n'),
    sink: {
      push: (kind: LineKind, spans: Span[]) => rows.push({ kind, text: lineText(spans) }),
      pushMany: (kind: LineKind, many: Span[][]) => {
        for (const spans of many) rows.push({ kind, text: lineText(spans) });
      },
      clear: () => {
        s.cleared++;
        rows.length = 0;
      },
    },
  };
  return s;
}

const actionEnv: ActionEnv = {
  search: {},
  pathname: '/terminal',
  motion: 'system',
  perf: 'auto',
  art: 'marble',
  ambientIdleMin: 5,
  sound: false,
};

interface Spy {
  opened: NavTarget[];
  actions: [string, string | undefined][];
  flights: FlyView[];
  watched: number[];
  env: CmdEnv;
  abort(): void;
}

function makeEnv(
  over: Partial<CmdEnv> = {},
  search: Record<string, unknown> = {},
  hits: readonly SearchHit[] = [],
): Spy {
  const ac = new AbortController();
  const spy: Spy = {
    opened: [],
    actions: [],
    flights: [],
    watched: [],
    abort: () => ac.abort(),
    env: {} as CmdEnv,
  };
  spy.env = {
    store,
    now: () => 1_000_000 + 12_000,
    beat: () => beatState({ height: 2_996_914, anchorMs: 1_000_000 }, 1_012_000, 30_000),
    signal: ac.signal,
    location: () => ({ pathname: '/terminal', search }),
    actionEnv: () => ({ ...actionEnv, search }),
    open: (t) => spy.opened.push(t),
    fly: (v) => {
      spy.flights.push(v);
      return true;
    },
    action: (id, arg) => spy.actions.push([id, arg]),
    searchHits: async () => hits,
    fetchBlock: async () => null,
    replayRelay: () => false,
    watch: (id, on) => {
      if (on) spy.watched.push(id);
    },
    watched: () => spy.watched,
    achievementLines: () => [[{ t: '0 of 24 found' }]],
    version: '2.0',
    ...over,
  };
  return spy;
}

async function run(line: string, spy: Spy = makeEnv()): Promise<{ s: Screen; spy: Spy; ok: boolean }> {
  const s = screen();
  const res = await execute(line, spy.env, s.sink);
  return { s, spy, ok: res.ok };
}

describe('reading a line', () => {
  it('splits words, keeps quoted phrases together and notes a trailing space', () => {
    expect(tokenize('app "Bitcoin Whitepaper" x')).toEqual({
      words: ['app', 'Bitcoin Whitepaper', 'x'],
      trailingSpace: false,
    });
    expect(tokenize("goto 'new york' ")).toEqual({ words: ['goto', 'new york'], trailingSpace: true });
    expect(splitCommand('  Node   65.109  ')).toEqual({ name: 'node', args: ['65.109'], rest: '65.109' });
    expect(splitCommand('search two words')).toMatchObject({ name: 'search', rest: 'two words' });
    expect(commonPrefix(['layer', 'labels'])).toBe('la');
  });

  it('recognises a bare IP, height, hash and address as a question', () => {
    expect(inferLine('5.0.0.7:16127')).toMatchObject({ line: 'node 5.0.0.7:16127' });
    expect(inferLine('2996914')).toMatchObject({ line: 'block 2996914' });
    expect(inferLine(hex64(5))).toMatchObject({ note: 'search' });
    expect(inferLine('t1cz5PE2QbwzPvqMVohgGqnoaupwzS3k4bx')).toMatchObject({ note: 'addr' });
    expect(inferLine('hello')).toBeNull();
  });

  it('knows which commands stream', () => {
    expect(isStreaming('tail blocks')).toBe(true);
    expect(isStreaming('node 5.0.0.1')).toBe(false);
    expect(isStreaming('nothing')).toBe(false);
  });
});

describe('the registry', () => {
  it('lists a short core and keeps the winks hidden', () => {
    const core = COMMANDS.filter((c) => c.level === 'core').map((c) => c.name);
    expect(core).toEqual(
      expect.arrayContaining(['help', 'next', 'node', 'app', 'block', 'goto', 'moon', 'ambient', 'clear']),
    );
    expect(core.length).toBeLessThanOrEqual(12);
    expect(PUBLIC_NAMES).not.toContain('sudo');
    expect(PUBLIC_NAMES).toContain('tail');
    expect(findCommand('NODE')).toBeDefined();
  });

  it('gives every public command a usage and a summary', () => {
    for (const c of COMMANDS.filter((x) => x.level !== 'hidden')) {
      expect(c.usage.startsWith(c.name)).toBe(true);
      expect(c.summary.length).toBeGreaterThan(5);
    }
  });
});

describe('completion', () => {
  // The store is loaded in beforeAll, so the environment is built per test.
  let env: CmdEnv;
  beforeAll(() => {
    env = makeEnv().env;
  });

  it('completes a command name, listing candidates when several fit', () => {
    expect(complete('he', env)).toEqual({ line: 'help ', candidates: [] });
    const n = complete('n', env);
    expect(n.candidates).toEqual(expect.arrayContaining(['next', 'node']));
    expect(n.line).toBe('n');
    expect(complete('xyzzy', env)).toEqual({ line: 'xyzzy', candidates: [] });
  });

  it('completes arguments through the command', () => {
    expect(complete('layer m', env).line).toBe('layer mesh ');
    expect(complete('layer mesh ', env).candidates).toEqual(['sel', 'flow', 'off']);
    expect(complete('top c', env).line).toBe('top countries ');
    expect(complete('app Kad', env).line).toBe('app KadenaNode ');
    expect(complete('tail ', env).candidates).toEqual(['blocks', 'feed']);
  });

  it('finds where the word being typed starts, quotes included', () => {
    expect(wordStart('node 65.1')).toBe(5);
    expect(wordStart('node ')).toBe(5);
    expect(wordStart('app "Bitcoin Wh')).toBe(4);
    expect(wordStart('')).toBe(0);
  });

  it('offers a ghost from history first, then the one command a prefix names', () => {
    expect(ghostFor('nod', ['node 65.109', 'next'])).toBe('e 65.109');
    expect(ghostFor('node 6', ['node 65.109'])).toBe('5.109');
    expect(ghostFor('hel', [])).toBe('p');
    expect(ghostFor('n', [])).toBe('');
    expect(ghostFor('', ['help'])).toBe('');
    expect(suggest(['help'], 'help')).toBeNull();
  });

  it('suggests the nearest command for a typo and nothing for nonsense', () => {
    expect(nearest('nod')).toBe('node');
    expect(nearest('hlep')).toBe('help');
    expect(nearest('mon')).toBe('moon');
    expect(nearest('xyzzy')).toBeNull();
    expect(nearest('s')).toBeNull();
  });
});

describe('finding nodes', () => {
  it('tells an exact endpoint, a lone host and a prefix apart', () => {
    expect(findNodes(store, '5.0.0.7:16127')).toMatchObject({ kind: 'node' });
    expect(findNodes(store, '5.0.0.7')).toMatchObject({ kind: 'node' });
    const prefix = findNodes(store, '5.0.0');
    expect(prefix.kind).toBe('prefix');
    expect(findNodes(store, '9.9.9.9')).toEqual({ kind: 'none' });
    expect(findNodes(store, 'hetzner')).toEqual({ kind: 'none' });
  });
});

describe('help', () => {
  it('shows the core by default and the rest with help all', async () => {
    const a = await run('help');
    expect(a.s.text()).toContain('Atlas shell 2.0.');
    expect(a.s.text()).toContain('node <ip[:port]>');
    expect(a.s.text()).not.toContain('tail <blocks|feed>');
    expect(a.s.text()).toContain('help all');
    const all = await run('help all');
    expect(all.s.text()).toContain('tail <blocks|feed>');
    expect(all.s.text()).not.toContain('sudo');
  });

  it('describes one command with its examples', async () => {
    const r = await run('help node');
    expect(r.s.text()).toContain('node <ip[:port]>');
    expect(r.s.text()).toContain('Try: node 65.109');
    const bad = await run('help nonsense');
    expect(bad.ok).toBe(false);
    expect(bad.s.text()).toContain("No command called 'nonsense'");
  });
});

describe('unknown input', () => {
  it('says what happened and what to try, with a guess when one is close', async () => {
    const r = await run('nod 5.0.0.1');
    expect(r.ok).toBe(false);
    expect(r.s.rows[0]?.kind).toBe('err');
    expect(r.s.text()).toContain("Unknown command 'nod'. Did you mean node?");
    expect(r.s.text()).toContain('Type help');
  });

  it('reads a bare IP as a node question and runs it', async () => {
    const r = await run('5.0.0.7:16127');
    expect(r.s.text()).toContain('Reading that as node.');
    expect(r.spy.opened[0]).toMatchObject({ to: '/node/$key', params: { key: syntheticOutpoint(7) } });
  });

  it('clears the screen', async () => {
    const r = await run('clear');
    expect(r.s.cleared).toBe(1);
    expect(r.s.rows).toHaveLength(0);
  });
});

describe('node, app, block', () => {
  it('describes one node and opens it beside the terminal', async () => {
    const r = await run('node 5.0.0.7:16127');
    expect(r.ok).toBe(true);
    expect(r.s.text()).toContain('5.0.0.7:16127');
    expect(r.spy.opened).toEqual([{ to: '/node/$key', params: { key: syntheticOutpoint(7) } }]);
  });

  it('lists the first matches of an IP prefix and opens nothing', async () => {
    const r = await run('node 5.0.0');
    expect(r.s.text()).toMatch(/\d+ nodes start with 5\.0\.0/);
    expect(r.s.text()).toContain('Type more of the address');
    expect(r.spy.opened).toHaveLength(0);
  });

  it('answers an unknown node with a way forward', async () => {
    const r = await run('node 9.9.9.9');
    expect(r.ok).toBe(false);
    expect(r.s.text()).toContain("No node matches '9.9.9.9'");
  });

  it('describes an app with its instances and expiry, and opens it', async () => {
    const r = await run('app kadena');
    expect(r.s.text()).toContain('KadenaNode, 3 instances, expires in');
    expect(r.spy.opened[0]).toMatchObject({ to: '/app/$name', params: { name: 'kadenanode' } });
    const none = await run('app zzzzzz');
    expect(none.ok).toBe(false);
  });

  it('prints the tip block with its producer and opens it', async () => {
    const r = await run('block tip');
    expect(r.s.text()).toContain('Block 2,996,914, 14 tx');
    expect(r.spy.opened[0]).toMatchObject({ to: '/block/$key', params: { key: '2996914' } });
    const far = await run('block 99999999');
    expect(far.ok).toBe(false);
    expect(far.s.text()).toContain("No block '99999999'");
  });
});

describe('next and moon', () => {
  it('lists the three payees largest first, with the time to the block', async () => {
    const r = await run('next');
    const lines = r.s.rows.map((x) => x.text);
    expect(lines[0]).toMatch(/^Block 2,996,915 in \d+ s\s+tip 2,996,914/);
    expect(lines[1]).toMatch(/^Stratus/);
    expect(lines[2]).toMatch(/^Nimbus/);
    expect(lines[3]).toMatch(/^Cumulus/);
  });

  it('prints the coinbase split and the ways to go further', async () => {
    const r = await run('moon');
    const t = r.s.text();
    expect(t).toContain('The moon is the chain. Block 2,996,914, next in');
    expect(t).toMatch(/cap\s+Stratus/);
    expect(t).toMatch(/big hexagon\s+Nimbus/);
    expect(t).toMatch(/small hexagon\s+Cumulus/);
    expect(t).toMatch(/bar\s+dev fund/);
    expect(t).toContain('moon open for About Flux, moon replay');
  });

  it('opens About for moon open and says so when there is nothing to replay', async () => {
    const open = await run('moon open');
    expect(open.spy.opened).toEqual([{ to: '/about' }]);
    const replay = await run('moon replay');
    expect(replay.ok).toBe(false);
    expect(replay.s.text()).toContain('no block to replay');
    const played = await run('moon replay', makeEnv({ replayRelay: () => true }));
    expect(played.s.text()).toContain('Replaying the last block');
  });
});

describe('goto, filter, layer', () => {
  it('flies to a city and does not filter', async () => {
    const r = await run('goto "city 3"');
    expect(r.spy.flights).toHaveLength(1);
    expect(r.spy.actions).toEqual([]);
    expect(r.s.text()).toContain('Flying to');
  });

  it('flies to a country and filters the globe to it, saying how to undo it', async () => {
    const r = await run('goto finland');
    expect(r.spy.flights).toHaveLength(1);
    expect(r.spy.actions).toEqual([['filter.apply', 'FI']]);
    expect(r.s.text()).toContain('filter clear');
  });

  it('says there is no globe when the camera cannot move', async () => {
    const r = await run('goto finland', makeEnv({ fly: () => false }));
    expect(r.ok).toBe(false);
    expect(r.s.text()).toContain('globe is not running');
    expect((await run('goto qqqqzzzz')).ok).toBe(false);
  });

  it('applies and clears filters through the shared action', async () => {
    const on = await run('filter stratus');
    expect(on.spy.actions).toEqual([['filter.apply', 'stratus']]);
    expect(on.s.text()).toContain('Filter: tier Stratus.');
    const off = await run('filter clear');
    expect(off.spy.actions).toEqual([['filter.clear', undefined]]);
    const none = await run('filter flibbertigibbet');
    expect(none.ok).toBe(false);
    const state = await run('filter', makeEnv({}, { tier: 'stratus' }));
    expect(state.s.text()).toContain('Filters: tier Stratus.');
  });

  it('sets the mesh and the labels and reports the current state', async () => {
    const flow = await run('layer mesh flow');
    expect(flow.spy.actions).toEqual([['layer.mesh.flow', undefined]]);
    const labels = await run('layer labels off');
    expect(labels.spy.actions).toEqual([['layer.labels.off', undefined]]);
    expect((await run('layer mesh sideways')).ok).toBe(false);
    expect((await run('layer nope')).ok).toBe(false);
    const state = await run('layer', makeEnv({}, { l: 'mesh.flow,-labels' }));
    expect(state.s.text()).toContain('Mesh: Network flow. Place labels: off.');
    const fresh = await run('layer', makeEnv({}, { l: 'mesh.flow' }));
    expect(fresh.s.text()).toContain('Place labels: on.');
  });
});

describe('top, stats, search', () => {
  it('ranks countries with a bar and a share', async () => {
    const r = await run('top countries');
    const bars = r.s.rows.length;
    expect(bars).toBeGreaterThan(1);
    expect(r.s.text()).toMatch(/\d+\.\d%/);
    expect((await run('top nothing')).ok).toBe(false);
  });

  it('prints the network totals', async () => {
    const r = await run('stats');
    expect(r.s.text()).toContain('6,724 nodes, 2,655 hosts, 1,900 apps, tip 2,996,914');
  });

  it('prints grouped results for a text and links to the page', async () => {
    const hits: SearchHit[] = [{ kind: 'block', key: '2996914', label: 'Block 2,996,914', sublabel: null }];
    const r = await run('search 2996914', makeEnv({}, {}, hits));
    expect(r.s.text()).toContain('2,996,914');
    expect(r.s.text()).toContain('All results on one page');
    const none = await run('search qqqqqqqq');
    expect(none.ok).toBe(false);
  });
});

describe('streams', () => {
  it('follows new blocks until the signal aborts, then resolves', async () => {
    const spy = makeEnv();
    const s = screen();
    const done = execute('tail blocks', spy.env, s.sink);
    expect(s.text()).toMatch(/^\d\d:\d\d:\d\d {2}Block 2,996,914/);
    const msg: LiveMsg = live('block', 102, blockMsg(2_996_915, { producer: 5 }), 1_030_000);
    store.apply(msg);
    expect(s.text()).toContain('Block 2,996,915');
    expect(s.text()).toMatch(/Stratus.*Nimbus.*Cumulus/);
    spy.abort();
    const res = await done;
    expect(res).toMatchObject({ name: 'tail', ok: true, streams: true });
    // Nothing prints after the abort.
    const n = s.rows.length;
    store.apply(live('block', 103, blockMsg(2_996_916, { producer: 6 }), 1_060_000));
    expect(s.rows.length).toBe(n);
  });

  it('refuses a stream it does not know', async () => {
    const r = await run('tail sideways');
    expect(r.ok).toBe(false);
    expect(r.s.text()).toContain('Try tail blocks or tail feed');
  });
});

describe('watch and the winks', () => {
  it('watches one node and lists the watched ones', async () => {
    const spy = makeEnv();
    const r = await run('watch 5.0.0.7:16127', spy);
    expect(spy.watched).toHaveLength(1);
    expect(r.s.text()).toContain('Watching 5.0.0.7:16127');
    const list = await run('watch', spy);
    expect(list.s.text()).toContain('1 node is watched');
    expect((await run('watch 5.0.0')).ok).toBe(false);
  });

  it('keeps a few winks, and none of them break', async () => {
    expect((await run('sudo rm -rf /')).s.text()).toContain('sudoers');
    expect((await run('gm')).s.text()).toContain('gm.');
    expect((await run('whoami')).ok).toBe(true);
    expect((await run('exit')).s.text()).toContain('no exit');
    expect((await run('pwd')).s.text()).toBe('/terminal');
    expect((await run('ls')).ok).toBe(true);
  });
});

describe('the rest', () => {
  it('opens the explorer and operator views for the right shapes only', async () => {
    const tx = await run(`tx ${hex64(9)}`);
    expect(tx.spy.opened[0]).toMatchObject({ to: '/tx/$txid' });
    expect((await run('tx nope')).ok).toBe(false);
    const addr = await run('addr t1cz5PE2QbwzPvqMVohgGqnoaupwzS3k4bx');
    expect(addr.spy.opened[0]).toMatchObject({ to: '/address/$addr' });
    expect((await run('addr nope')).ok).toBe(false);
    const op = await run('operator t1cz5PE2QbwzPvqMVohgGqnoaupwzS3k4bx');
    expect(op.spy.opened[0]).toMatchObject({ to: '/operator/$addr' });
  });

  it('opens About, Settings and the queue, and enters ambient mode', async () => {
    expect((await run('about')).spy.opened).toEqual([{ to: '/about' }]);
    expect((await run('settings')).spy.opened).toEqual([{ to: '/settings' }]);
    const q = await run('queue stratus');
    expect(q.spy.opened).toEqual([{ to: '/queue/$tier', params: { tier: 'stratus' } }]);
    expect((await run('queue gold')).ok).toBe(false);
    const amb = await run('ambient');
    expect(amb.spy.actions).toEqual([['ambient.enter', undefined]]);
  });

  it('prints whatever the achievements surface gives it', async () => {
    expect((await run('achievements')).s.text()).toContain('0 of 24 found');
  });

  it('never throws: a failing command prints an error', async () => {
    const spy = makeEnv({
      searchHits: async () => {
        throw new Error('network down');
      },
    });
    const r = await run('search hetzner', spy);
    // The search degrades to local results instead of failing.
    expect(r.s.rows.length).toBeGreaterThan(0);
    const boom = makeEnv({
      actionEnv: () => {
        throw new Error('boom');
      },
    });
    const b = await run('search hetzner', boom);
    expect(b.ok).toBe(false);
    expect(b.s.text()).toContain('search did not work: boom');
  });
});

describe('the dev fund', () => {
  const payouts = [
    { tier: 'cumulus', node: 1, address: 'a', amount: '1.00000000' },
    { tier: 'nimbus', node: 2, address: 'b', amount: '3.50000000' },
    { tier: 'stratus', node: 3, address: 'c', amount: '9.00000000' },
  ] as const;

  it('uses the node figure when the live block carried it', () => {
    expect(devFundOf({ devFund: '0.50010000', reward: '14.00000000', payouts })).toBe('0.50010000');
  });

  it('derives it from what the reward leaves after the three payouts', () => {
    expect(devFundOf({ devFund: null, reward: '14.00000000', payouts })).toBe('0.50000000');
  });

  it('stays unknown without the payouts, never zero', () => {
    expect(devFundOf({ devFund: null, reward: '14.00000000', payouts: [] })).toBeNull();
    expect(devFundOf({ devFund: null, reward: 'x', payouts })).toBeNull();
  });
});

describe('node lists', () => {
  it('lines the columns up and keeps the link to the endpoint alone', async () => {
    const r = await run('node 5.0.0');
    const widths = new Set(
      r.s.rows.filter((x) => /^\w+\s+5\./.test(x.text)).map((x) => x.text.indexOf('5.0.0.')),
    );
    expect(widths.size).toBe(1);
  });
});
