import { beforeAll, describe, expect, it } from 'vitest';
import { syntheticOutpoint } from '../../../api/bin/writer';
import type { SearchHit } from '../../../api/generated/SearchHit';
import { NetworkStore } from '../../../store/network';
import { bootstrap, hex64, syntheticNodesBin } from '../../../testing/fixtures';
import type { ActionEnv } from './actions';
import { buildModel, classifyText, PAGE_LIMITS, parseInput, serverQueryFor } from './model';
import type { PaletteModel, RecentEntry } from './types';

const env: ActionEnv = {
  search: {},
  pathname: '/',
  motion: 'system',
  perf: 'auto',
  art: 'marble',
  ambientIdleMin: 5,
  sound: false,
};

let store: NetworkStore;

beforeAll(() => {
  store = new NetworkStore();
  store.loadSnapshot({ bootstrap: bootstrap(100, 2_996_914), nodes: syntheticNodesBin(600) });
  const current = store.nodes.versions.intern('8.20.0');
  for (let i = 0; i < 600; i++) store.nodes.version[i] = current;
});

const rowsOf = (m: PaletteModel) => m.groups.flatMap((g) => g.rows);
const ids = (m: PaletteModel) => rowsOf(m).map((r) => r.id);
const group = (m: PaletteModel, id: string) => m.groups.find((g) => g.id === id);
const run = (raw: string, extra: Partial<Parameters<typeof buildModel>[0]> = {}) =>
  buildModel({ raw, store, env, ...extra });

describe('parseInput', () => {
  it('reads a prefix word followed by a space', () => {
    expect(parseInput('node 65.109')).toMatchObject({ prefix: 'node', text: '65.109' });
    expect(parseInput('  APP BitcoinWhitepaper ')).toMatchObject({
      prefix: 'app',
      text: 'BitcoinWhitepaper',
    });
    expect(parseInput('operator ')).toMatchObject({ prefix: 'operator', text: '' });
    expect(parseInput('go to helsinki')).toMatchObject({ prefix: 'goto', text: 'helsinki' });
    expect(parseInput('address t1abc')).toMatchObject({ prefix: 'addr' });
  });

  it('treats everything else as plain text', () => {
    expect(parseInput('node')).toMatchObject({ prefix: null, text: 'node' });
    expect(parseInput('hetzner online')).toMatchObject({ prefix: null, text: 'hetzner online' });
    expect(parseInput('')).toMatchObject({ prefix: null, text: '' });
  });
});

describe('classifyText and serverQueryFor', () => {
  it('knows heights, hashes, outpoints, addresses and IPs', () => {
    expect(classifyText('2996914')).toEqual({ kind: 'height', height: 2996914 });
    expect(classifyText('2,996,914')).toEqual({ kind: 'height', height: 2996914 });
    expect(classifyText(hex64(7))).toMatchObject({ kind: 'hash' });
    expect(classifyText(`${hex64(7)}:1`)).toMatchObject({ kind: 'outpoint', vout: 1 });
    expect(classifyText('t1cz5PE2QbwzPvqMVohgGqnoaupwzS3k4bx')).toMatchObject({ kind: 'address' });
    expect(classifyText('65.109.1.2:16127')).toMatchObject({ kind: 'ip' });
    expect(classifyText('finland')).toEqual({ kind: 'text' });
    expect(classifyText('BitcoinWhitepaper')).toEqual({ kind: 'text' });
  });

  it('asks the server only for what the local index cannot resolve', () => {
    const q = (raw: string) => serverQueryFor(parseInput(raw));
    expect(q('2996914')).toBeNull();
    expect(q('1234')).toBe('1234');
    expect(q(hex64(9))).toBe(hex64(9));
    expect(q('t1cz5PE2QbwzPvqMVohgGqnoaupwzS3k4bx')).toBe('t1cz5PE2QbwzPvqMVohgGqnoaupwzS3k4bx');
    expect(q('AS24940')).toBe('AS24940');
    expect(q('hetzner')).toBeNull();
    expect(q('65.109.1.2')).toBeNull();
    expect(q('goto 60,24')).toBeNull();
    expect(q('filter stratus')).toBeNull();
    expect(q('app kadena')).toBeNull();
    expect(q('tx 8aa97365')).toBeNull();
    expect(q(`tx ${hex64(3)}`)).toBe(hex64(3));
  });
});

describe('the empty state', () => {
  it('offers Try rows, the latest block first', () => {
    const m = run('');
    expect(m.groups.map((g) => g.id)).toEqual(['try']);
    const rows = rowsOf(m);
    expect(rows[0]).toMatchObject({ id: 'block:2996914', title: 'Block 2,996,914' });
    expect(rows.some((r) => r.id === 'action:ambient.enter')).toBe(true);
    expect(m.best?.id).toBe('block:2996914');
    expect(m.empty).toBe(false);
  });

  it('puts recents first and shortens Try to make room', () => {
    const recents: RecentEntry[] = [0, 1, 2].map((k) => ({
      id: `node:5.0.0.${k}:16127`,
      kind: 'node',
      icon: 'node',
      title: `5.0.0.${k}:16127`,
      mono: true,
      chip: 'Node',
      action: { type: 'go', target: { to: '/node/$key', params: { key: `5.0.0.${k}:16127` } } },
      ts: 10 - k,
    }));
    const m = run('', { recents });
    expect(m.groups[0]?.id).toBe('recent');
    expect(group(m, 'recent')?.rows).toHaveLength(3);
    expect(group(m, 'try')?.rows).toHaveLength(3);
    expect(m.best?.id).toBe('node:5.0.0.0:16127');
  });

  it('lists the next payees from the queue', () => {
    const s = new NetworkStore();
    s.loadSnapshot({ bootstrap: bootstrap(), nodes: syntheticNodesBin(50) });
    s.nextPayees = {
      height: 2_996_915,
      receivedMs: 1,
      payees: [
        { tier: 'stratus', node: 3, address: 't1x' },
        { tier: 'nimbus', node: null, address: 't1y' },
      ],
    };
    const m = buildModel({ raw: '', store: s, env });
    const next = m.groups.find((g) => g.id === 'next');
    expect(next?.rows).toHaveLength(1);
    expect(next?.rows[0]).toMatchObject({ kind: 'payee', chip: 'Payee' });
    expect(next?.rows[0]?.sub).toBe('Next Stratus payee, block 2,996,915');
  });
});

describe('local matches', () => {
  it('finds a node by IP and IP:port, exact first', () => {
    const m = run('5.0.0.7:16127');
    expect(m.groups[0]?.id).toBe('nodes');
    expect(m.best).toMatchObject({ id: 'node:5.0.0.7:16127', mono: true, chip: 'Node' });
    // Links name the node by outpoint, the key every instance agrees on.
    expect(m.best?.action).toEqual({
      type: 'go',
      target: { to: '/node/$key', params: { key: syntheticOutpoint(7) } },
    });
    expect(m.best?.alongside).toBe(true);
    expect(group(m, 'hosts')?.rows[0]?.id).toBe('host:5.0.0.7');
    expect(m.serverQuery).toBeNull();
  });

  it('counts matches beyond what the palette shows', () => {
    const m = run('5.0.0.');
    const nodes = group(m, 'nodes');
    expect(nodes?.rows).toHaveLength(5);
    expect(nodes?.more).toBeGreaterThan(0);
    expect(m.seeAll?.action).toEqual({
      type: 'go',
      target: { to: '/q/$text', params: { text: '5.0.0.' }, fragment: 'all' },
    });
    const page = run('5.0.0.', { limits: PAGE_LIMITS });
    expect(group(page, 'nodes')?.rows.length).toBeGreaterThan(5);
  });

  it('finds apps by name, with a typo allowance', () => {
    expect(group(run('kadena'), 'apps')?.rows[0]).toMatchObject({
      id: 'app:kadenanode',
      title: 'KadenaNode',
    });
    expect(group(run('kadenanod'), 'apps')?.rows[0]?.id).toBe('app:kadenanode');
    expect(run('zzzzzz').empty).toBe(true);
  });

  it('turns providers and versions into filters of the globe', () => {
    const p = rowsOf(run('hetzner')).find((r) => r.kind === 'provider');
    expect(p?.action).toEqual({
      type: 'go',
      target: { to: '/', search: { org: 'hetzner online gmbh' }, stay: true },
    });
    const v = rowsOf(run('8.20')).find((r) => r.kind === 'version');
    expect(v?.action).toEqual({ type: 'go', target: { to: '/', search: { ver: '8.20.0' }, stay: true } });
  });

  it('flies to places, and filters to a country', () => {
    const m = run('finland');
    const fi = rowsOf(m).find((r) => r.id === 'country:FI');
    expect(fi).toMatchObject({ group: 'goto', alsoFly: true, chip: 'Country' });
    expect(fi?.fly?.alt).toBeGreaterThanOrEqual(0.45);
    expect(fi?.action).toEqual({ type: 'go', target: { to: '/', search: { cc: 'FI' }, stay: true } });
    const city = rowsOf(run('city 3')).find((r) => r.kind === 'city');
    expect(city?.action.type).toBe('run');
    const coords = rowsOf(run('goto 60.17, 24.94')).find((r) => r.id.startsWith('coords:'));
    expect(coords?.fly).toEqual({ lat: 60.17, lon: 24.94, alt: 0.6 });
  });

  it('resolves a block height locally, but not one past the tip', () => {
    const m = run('2996900');
    expect(m.best).toMatchObject({ id: 'block:2996900', title: 'Block 2,996,900' });
    expect(m.best?.subMono).toBe(true);
    expect(run('2996999').empty).toBe(true);
    expect(run('block tip').best?.id).toBe('block:2996914');
    expect(run('block 2,996,914').best?.id).toBe('block:2996914');
  });

  it('shows an address at once and offers its wallet workspace and its operator', () => {
    const a = 't1cz5PE2QbwzPvqMVohgGqnoaupwzS3k4bx';
    const m = run(a);
    expect(group(m, 'addresses')?.rows.map((r) => r.id)).toEqual([
      `address:${a}`,
      `wallet:${a}`,
      `operator:${a}`,
    ]);
    expect(run(`operator ${a}`).groups[0]?.rows.map((r) => r.id)).toEqual([`operator:${a}`]);
    expect(run(`addr ${a}`).groups[0]?.rows.map((r) => r.id)).toEqual([
      `address:${a}`,
      `wallet:${a}`,
      `operator:${a}`,
    ]);
  });

  it('opens the wallet workspace from a row, and from the wallet prefix alone', () => {
    const a = 't1cz5PE2QbwzPvqMVohgGqnoaupwzS3k4bx';
    const row = group(run(a), 'addresses')?.rows.find((r) => r.kind === 'wallet');
    expect(row).toMatchObject({
      icon: 'wallet',
      chip: 'Wallet',
      mono: true,
      sub: 'Wallet workspace',
      alongside: true,
      remember: true,
      action: { type: 'go', target: { to: '/wallet/$addr', params: { addr: a } } },
    });
    const only = run(`wallet ${a}`);
    expect(only.groups).toHaveLength(1);
    expect(only.groups[0]?.rows.map((r) => r.id)).toEqual([`wallet:${a}`]);
    expect(only.best?.id).toBe(`wallet:${a}`);
  });

  it('offers no wallet for a ZelID, which the server refuses: only its address and its operator', () => {
    const zel = '1cz5PE2QbwzPvqMVohgGqnoaupwzS3k4bx';
    expect(group(run(zel), 'addresses')?.rows.map((r) => r.kind)).toEqual(['address', 'operator']);
    expect(group(run(`addr ${zel}`), 'addresses')?.rows.map((r) => r.kind)).toEqual(['address', 'operator']);
    expect(rowsOf(run(`operator ${zel}`)).map((r) => r.kind)).toEqual(['operator']);
    expect(rowsOf(run(`wallet ${zel}`))).toEqual([]);
  });

  it('offers a wallet for a t3 address as it does for a t1 address', () => {
    const a = 't3c4EfxLoXXSRZCRnPRF3RpjPi9mBzF5yoJ';
    expect(group(run(a), 'addresses')?.rows.map((r) => r.kind)).toEqual(['address', 'wallet', 'operator']);
    expect(rowsOf(run(`wallet ${a}`)).map((r) => r.id)).toEqual([`wallet:${a}`]);
  });

  it('leaves a word that is not an address without a wallet row', () => {
    expect(rowsOf(run('kadena')).some((r) => r.kind === 'wallet')).toBe(false);
    expect(rowsOf(run('wallet kadena')).some((r) => r.kind === 'wallet')).toBe(false);
  });
});

describe('actions and prefixes', () => {
  it('hoists an exact command above weaker groups', () => {
    const m = run('ambient');
    expect(m.groups[0]?.id).toBe('commands');
    expect(m.best?.id).toBe('action:ambient.enter');
    expect(m.best?.meta).toEqual({ type: 'keys', keys: ['shift', 'A'] });
  });

  it('marks the setting already in force', () => {
    const m = run('art style', { env: { ...env, art: 'neon' } });
    const neon = rowsOf(m).find((r) => r.id === 'action:art.neon');
    expect(neon?.meta).toEqual({ type: 'current' });
    const marble = rowsOf(m).find((r) => r.id === 'action:art.marble');
    expect(marble?.meta).toBeUndefined();
  });

  it('only offers clearing filters when some are on', () => {
    expect(ids(run('clear filters'))).not.toContain('action:filter.clear');
    expect(ids(run('clear filters', { env: { ...env, search: { tier: 'stratus' } } }))).toContain(
      'action:filter.clear',
    );
  });

  it('applies a filter expression from the filter prefix', () => {
    const m = run('filter stratus fi');
    expect(m.best).toMatchObject({
      title: 'Filter: tier Stratus, country FI',
      action: { type: 'run', id: 'filter.apply', arg: 'stratus fi' },
    });
    const bad = run('filter zzzzz');
    expect(bad.best?.title).toBe('No filter matches zzzzz');
    expect(run('filter clear', { env: { ...env, search: { cc: 'FI' } } }).best?.id).toBe(
      'action:filter.clear',
    );
  });

  it('lists the layers under the layer prefix', () => {
    const m = run('layer mesh');
    expect(ids(m).every((id) => id.startsWith('action:layer.'))).toBe(true);
    expect(ids(m)).toContain('action:layer.mesh.flow');
    expect(ids(run('layer ')).length).toBeGreaterThanOrEqual(5);
  });

  it('teaches a prefix when only its word is typed, and lists usage for a bare prefix', () => {
    const word = run('goto');
    expect(rowsOf(word)[0]).toMatchObject({ id: 'hint:goto', action: { type: 'type', text: 'goto ' } });
    const bare = run('goto ');
    expect(bare.usage).toBe('goto <place or lat,lon>');
    expect(group(bare, 'goto')?.rows.length).toBeGreaterThan(0);
    expect(run('operator ').usage).toBe('operator <address or ZelID>');
    expect(run('wallet ').usage).toBe('wallet <address>');
  });

  it('reads the wallet prefix and its plural', () => {
    expect(parseInput('wallet t1abc')).toMatchObject({ prefix: 'wallet', text: 't1abc' });
    expect(parseInput('Wallets t1abc')).toMatchObject({ prefix: 'wallet' });
    expect(parseInput('wallet')).toMatchObject({ prefix: null, text: 'wallet' });
  });
});

describe('merging server hits', () => {
  const hits: SearchHit[] = [
    { kind: 'block', key: '2996914', label: 'Block 2,996,914', sublabel: hex64(2996914) },
    {
      kind: 'tx',
      key: hex64(5),
      label: 'Transaction 00000000...00005',
      sublabel: 'transfer in block 2,996,914',
    },
    {
      kind: 'node',
      key: '7',
      label: 'Stratus node 5.0.0.7:16127',
      sublabel: 'confirmed / queue #8 / FI / OVH',
    },
    { kind: 'version', key: 'daemon:8.20.0', label: 'fluxd 8.20.0', sublabel: '12 nodes' },
    { kind: 'version', key: 'flux_os:8.20.0', label: 'FluxOS 8.20.0', sublabel: '400 nodes' },
    { kind: 'provider', key: 'AS24940', label: 'Hetzner Online GmbH', sublabel: 'AS24940 / 200 nodes' },
    { kind: 'country', key: 'FI', label: 'Finland', sublabel: '300 nodes' },
    {
      kind: 'shielded',
      key: 'zs1abc',
      label: 'Sapling shielded address',
      sublabel: 'shielded balances and history are private',
    },
  ];

  it('adds typed rows to the right groups, a node hit matched by its endpoint and linked by outpoint', () => {
    const m = run(hex64(5), { hits });
    expect(group(m, 'blocks')?.rows[0]?.id).toBe('block:2996914');
    const tx = group(m, 'txs')?.rows[0];
    expect(tx).toMatchObject({ id: `tx:${hex64(5)}`, mono: true, chip: 'Transaction' });
    expect(tx?.sub).toBe('Transfer in block 2,996,914');
    const node = rowsOf(m).find((r) => r.kind === 'node');
    expect(node?.action).toEqual({
      type: 'go',
      target: { to: '/node/$key', params: { key: syntheticOutpoint(7) } },
    });
  });

  it('matches a node hit by endpoint, not by the id of the instance that answered', () => {
    // The other instance numbers this node 9: its hit key must not select local node 9.
    const other: SearchHit = { kind: 'node', key: '9', label: 'Stratus node 5.0.0.7:16127', sublabel: null };
    const m = run('5.0.0.7', { hits: [other] });
    const node = rowsOf(m).find((r) => r.kind === 'node' && r.id === 'node:5.0.0.7:16127');
    expect(node?.action).toEqual({
      type: 'go',
      target: { to: '/node/$key', params: { key: syntheticOutpoint(7) } },
    });
  });

  it('keeps only FluxOS versions, maps providers to their name and routes shielded to an explanation', () => {
    const m = run('hetzner', { hits });
    const versions = rowsOf(m).filter((r) => r.kind === 'version');
    expect(versions.map((r) => r.id)).toEqual(['version:8.20.0']);
    const provider = rowsOf(m).filter((r) => r.kind === 'provider');
    expect(provider).toHaveLength(1);
    expect(provider[0]?.action).toEqual({
      type: 'go',
      target: { to: '/', search: { org: 'hetzner online gmbh' }, stay: true },
    });
    const sh = rowsOf(m).find((r) => r.kind === 'shielded');
    expect(sh?.action).toEqual({ type: 'none' });
  });

  it('does not show node ids for a typed number', () => {
    const m = run('1234', { hits });
    expect(rowsOf(m).some((r) => r.kind === 'node')).toBe(false);
  });

  it('narrows to the kinds a prefix names', () => {
    const m = run(`tx ${hex64(5)}`, { hits });
    expect(rowsOf(m).every((r) => r.kind === 'tx')).toBe(true);
  });

  it('lets the server row replace a local guess for chain objects', () => {
    const a = 't1cz5PE2QbwzPvqMVohgGqnoaupwzS3k4bx';
    const server: SearchHit[] = [
      { kind: 'address', key: a, label: `Address ${a}`, sublabel: 'pays 3 active nodes' },
    ];
    const m = run(a, { hits: server });
    expect(group(m, 'addresses')?.rows[0]?.sub).toBe('Address, pays 3 active nodes');
  });

  it('tells the wallet row how many nodes an operator hit pays', () => {
    const a = 't1cz5PE2QbwzPvqMVohgGqnoaupwzS3k4bx';
    const server: SearchHit[] = [
      { kind: 'operator', key: a, label: `Operator ${a}`, sublabel: 'pays 3 active nodes' },
    ];
    const m = run(a, { hits: server });
    const rows = group(m, 'addresses')?.rows ?? [];
    expect(rows.find((r) => r.kind === 'wallet')?.sub).toBe('Wallet workspace, pays 3 active nodes');
    expect(rows.find((r) => r.kind === 'operator')?.sub).toBe('Operator, pays 3 active nodes');
    expect(rows.filter((r) => r.kind === 'wallet')).toHaveLength(1);
  });

  it('adds no wallet row for an operator hit that is a ZelID', () => {
    const zel = '1cz5PE2QbwzPvqMVohgGqnoaupwzS3k4bx';
    const server: SearchHit[] = [
      { kind: 'operator', key: zel, label: `Operator ${zel}`, sublabel: 'pays 3 active nodes' },
    ];
    const rows = rowsOf(run(zel, { hits: server }));
    expect(rows.some((r) => r.kind === 'wallet')).toBe(false);
    expect(rows.find((r) => r.kind === 'operator')?.sub).toBe('Operator, pays 3 active nodes');
  });

  it('keeps the wallet row of an operator hit under the wallet prefix, and drops the others', () => {
    const a = 't1cz5PE2QbwzPvqMVohgGqnoaupwzS3k4bx';
    const server: SearchHit[] = [
      { kind: 'operator', key: a, label: `Operator ${a}`, sublabel: 'pays 3 active nodes' },
      { kind: 'address', key: a, label: `Address ${a}`, sublabel: null },
    ];
    const m = run(`wallet ${a}`, { hits: server });
    expect(rowsOf(m).map((r) => r.id)).toEqual([`wallet:${a}`]);
    expect(rowsOf(m)[0]?.sub).toBe('Wallet workspace, pays 3 active nodes');
  });
});

describe('kind chips', () => {
  it('filters the groups and counts every chip', () => {
    const all = run('kadena');
    const apps = run('kadena', { chip: 'apps' });
    expect(apps.groups.map((g) => g.id)).toEqual(['apps']);
    expect(apps.counts.apps).toBe(all.counts.apps);
    expect(run('kadena', { chip: 'blocks' }).empty).toBe(true);
    expect(all.counts.all).toBeGreaterThanOrEqual(all.counts.apps);
  });
});

describe('the hidden greeting', () => {
  it('is found by typing gm, first in its group, and by nothing else', () => {
    const m = run('gm');
    expect(ids(m)).toContain('egg:gm');
    expect(group(m, 'commands')?.rows[0]?.id).toBe('egg:gm');
    expect(ids(run('GM '))).toContain('egg:gm');
    expect(ids(run('gmx'))).not.toContain('egg:gm');
    expect(ids(run(''))).not.toContain('egg:gm');
  });
});
