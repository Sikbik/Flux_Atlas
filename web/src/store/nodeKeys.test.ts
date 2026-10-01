// Stable node keys (ARCHITECTURE 8.1): outpoints per row, resolution of every key form, the client's
// migration of stored numeric ids, and the URL redirect of older node links.

import { afterEach, describe, expect, it } from 'vitest';
import { encodeSyntheticNodesBin, syntheticOutpoint } from '../api/bin/writer';
import type { NodeLite } from '../api/generated/NodeLite';
import { decodeNodesBin } from '../api/nodesBin';
import {
  canonicalNodeLocation,
  isUnresolvableLegacyKey,
  nodeKeyFromPath,
  selectionKeys,
} from '../app/selection';
import { migrateRecentEntries } from '../features/command/palette/recents';
import type { RecentEntry } from '../features/command/palette/types';
import { decodeSegment, pathForWindow } from '../shell/wm/route';
import { entityRoute } from '../ui/identity/entityRoute';
import {
  canonicalNodeKey,
  isOutpoint,
  localNodeId,
  resolveNodeKey,
  setNodeKeySource,
  stableNodeKey,
} from './nodeKeys';
import { NodeTable } from './nodeTable';
import { parseUi, resolveWatchlist, useUi } from './ui';

const op = (n: number) => syntheticOutpoint(n);

/** Ids 1..n; node k has outpoint op(100 + k) and endpoint 10.0.0.k:16127. */
function table(n = 5, withOutpoints = true): NodeTable {
  const nodes = Array.from({ length: n }, (_, k) => ({
    id: k + 1,
    ip: `10.0.0.${k + 1}:16127`,
    ...(withOutpoints ? { outpoint: op(101 + k) } : {}),
  }));
  return NodeTable.fromSnapshot(decodeNodesBin(encodeSyntheticNodesBin(nodes)));
}

const lite = (id: number, outpoint: string): NodeLite => ({
  id,
  outpoint,
  endpoint: '9.9.9.9:16137',
  tier: 'nimbus',
  status: 'started',
  lat: null,
  lon: null,
  country_code: null,
  org: null,
  rank: null,
  last_paid_height: null,
  app_count: 0,
  flags: 0,
});

afterEach(() => setNodeKeySource(null));

describe('node table outpoints', () => {
  it('reads outpoints per row and follows inserts and swap-removes', () => {
    const t = table(3);
    expect(t.outpointOf(2)).toBe(op(102));
    expect(t.idOfOutpoint(op(103))).toBe(3);
    expect(t.idOfOutpoint(op(103).toUpperCase())).toBe(3);
    t.upsert(lite(9, op(900)));
    expect(t.idOfOutpoint(op(900))).toBe(9);
    // Removing row 0 swaps the last row (9) into its place: keys follow their rows.
    t.remove(1);
    expect(t.outpointOf(9)).toBe(op(900));
    expect(t.idOfOutpoint(op(101))).toBe(-1);
    expect(t.outpointOf(3)).toBe(op(103));
    expect(t.hasOutpoints).toBe(true);
  });

  it('reads as unknown without the OUTPOINTS column (older servers)', () => {
    const t = table(2, false);
    expect(t.hasOutpoints).toBe(false);
    expect(t.outpointOf(1)).toBe('');
    expect(t.idOfOutpoint(op(101))).toBe(-1);
  });
});

describe('key resolution', () => {
  const t = table();

  it('resolves outpoints, legacy ids and endpoints', () => {
    expect(isOutpoint(op(1))).toBe(true);
    expect(isOutpoint('10.0.0.1:16127')).toBe(false);
    expect(resolveNodeKey(t, op(102))).toBe(2);
    expect(resolveNodeKey(t, '4')).toBe(4);
    expect(resolveNodeKey(t, '10.0.0.5:16127')).toBe(5);
    expect(resolveNodeKey(t, '77')).toBeNull();
    expect(resolveNodeKey(t, op(999))).toBeNull();
    expect(stableNodeKey(t, '10.0.0.3:16127')).toBe(op(103));
    expect(stableNodeKey(t, '3')).toBe(op(103));
    expect(stableNodeKey(t, 'nope')).toBe('nope');
  });

  it('maps a server record to the session id by outpoint, never by its foreign id', () => {
    // The other instance calls this node 1; here it is node 4.
    expect(localNodeId(t, { id: 1, outpoint: op(104) })).toBe(4);
    expect(localNodeId(t, { id: 1, outpoint: op(999) })).toBeNull();
    expect(localNodeId(table(3, false), { id: 2, outpoint: op(999) })).toBe(2);
  });

  it('turns every node link into its outpoint once the snapshot knows the node', () => {
    expect(entityRoute('node', '10.0.0.2:16127')).toEqual({
      to: '/node/$key',
      params: { key: '10.0.0.2:16127' },
    });
    setNodeKeySource(() => t);
    expect(canonicalNodeKey(2)).toBe(op(102));
    expect(entityRoute('node', '10.0.0.2:16127')).toEqual({ to: '/node/$key', params: { key: op(102) } });
    expect(pathForWindow('node', '2')).toBe(`/node/${encodeURIComponent(op(102))}`);
    expect(pathForWindow('host', '10.0.0.2')).toBe('/host/10.0.0.2');
  });
});

describe('URL redirect of older node links', () => {
  const t = table();

  it('replaces /node/<id> and /node/<ip:port> with the outpoint form, keeping the search', () => {
    expect(canonicalNodeLocation(t, '/node/3', { l: 'mesh' })).toEqual({
      pathname: `/node/${encodeURIComponent(op(103))}`,
      search: { l: 'mesh' },
    });
    expect(canonicalNodeLocation(t, '/node/10.0.0.2%3A16127', {})?.pathname).toBe(
      `/node/${encodeURIComponent(op(102))}`,
    );
  });

  it('rewrites ?sel= and ?w= node keys as well', () => {
    const next = canonicalNodeLocation(t, '/', { sel: '1,10.0.0.2:16127,unknown', w: 'node:3,queue' });
    expect(next?.search.sel).toBe(`${op(101)},${op(102)},unknown`);
    expect(next?.search.w).toBe(`node:${encodeURIComponent(op(103))},queue`);
  });

  it('leaves canonical and unresolvable links alone; an unresolvable legacy key is not found', () => {
    expect(canonicalNodeLocation(t, `/node/${encodeURIComponent(op(101))}`, { sel: op(102) })).toBeNull();
    expect(canonicalNodeLocation(t, '/node/77', {})).toBeNull();
    expect(isUnresolvableLegacyKey(t, '77')).toBe(true);
    expect(isUnresolvableLegacyKey(t, '10.9.9.9:1')).toBe(true);
    expect(isUnresolvableLegacyKey(t, '3')).toBe(false);
    // An outpoint the snapshot does not hold still goes to the server (a departed node).
    expect(isUnresolvableLegacyKey(t, op(999))).toBe(false);
  });
});

describe('malformed escapes (L9)', () => {
  it('decodes a path segment without throwing', () => {
    expect(decodeSegment('%ZZ')).toBe('%ZZ');
    expect(decodeSegment('1.2.3.4%3A16127')).toBe('1.2.3.4:16127');
    expect(nodeKeyFromPath('/node/%ZZ')).toBe('%ZZ');
    expect(nodeKeyFromPath('/node/%E0%A4%A')).toBe('%E0%A4%A');
    expect(() => selectionKeys('/node/%ZZ', 'a,%ZZ')).not.toThrow();
    expect(selectionKeys('/node/%ZZ', 'a,b')).toEqual(['%ZZ', 'a', 'b']);
    expect(canonicalNodeLocation(table(), '/node/%ZZ', {})).toBeNull();
  });
});

describe('stored watchlist migration', () => {
  it('reads outpoints and legacy numeric ids from the stored list', () => {
    const raw = JSON.stringify({ motion: 'off', watched: [3, op(105).toUpperCase(), 'junk', -1, 3] });
    expect(parseUi(raw)).toEqual({ motion: 'off', watchedKeys: [op(105)], legacyWatched: [3] });
  });

  it('resolves stored ids once against the first snapshot with outpoints; unresolvable ones are dropped', () => {
    const t = table();
    const r = resolveWatchlist(t, [op(105)], [2, 77]);
    expect(r).toEqual({ watchedKeys: [op(105), op(102)], legacyWatched: [], watched: [5, 2] });
    // Without outpoints (an older server) the ids are kept for later and used as they are.
    const old = resolveWatchlist(table(5, false), [], [2, 77]);
    expect(old).toEqual({ watchedKeys: [], legacyWatched: [2, 77], watched: [2] });
  });

  it('maps watched outpoints to the ids of whichever instance loaded', () => {
    // The other instance numbers collateral 105 as id 1.
    const other = NodeTable.fromSnapshot(
      decodeNodesBin(
        encodeSyntheticNodesBin([
          { id: 1, outpoint: op(105) },
          { id: 2, outpoint: op(101) },
        ]),
      ),
    );
    expect(resolveWatchlist(other, [op(105)], []).watched).toEqual([1]);
  });

  it('rewrites the store and storage, and watches by outpoint from then on', () => {
    const t = table();
    setNodeKeySource(() => t);
    useUi.setState({ watchedKeys: [], legacyWatched: [4], watched: [] });
    useUi.getState().resolveWatched(t);
    expect(useUi.getState()).toMatchObject({ watchedKeys: [op(104)], legacyWatched: [], watched: [4] });
    useUi.getState().watch(1);
    expect(useUi.getState().watchedKeys).toEqual([op(104), op(101)]);
    useUi.getState().unwatch(4);
    expect(useUi.getState()).toMatchObject({ watchedKeys: [op(101)], watched: [1] });
    useUi.setState({ watchedKeys: [], legacyWatched: [], watched: [] });
  });
});

describe('palette recents migration', () => {
  const entry = (id: string, key: string): RecentEntry => ({
    id,
    kind: 'node',
    icon: 'node',
    title: key,
    chip: 'Node',
    ts: 1,
    action: { type: 'go', target: { to: '/node/$key', params: { key } } },
  });

  it('rewrites node ids and endpoints to outpoints and drops ids nothing resolves', () => {
    const t = table();
    const app: RecentEntry = {
      ...entry('app:x', 'x'),
      kind: 'app',
      action: { type: 'go', target: { to: '/app/$name', params: { name: 'x' } } },
    };
    const next = migrateRecentEntries(
      [entry('node:2', '2'), entry('node:10.0.0.3:16127', '10.0.0.3:16127'), entry('node:77', '77'), app],
      t,
    );
    expect(next?.map((e) => (e.action.type === 'go' ? e.action.target.params : null))).toEqual([
      { key: op(102) },
      { key: op(103) },
      { name: 'x' },
    ]);
    expect(next?.[0]?.id).toBe(`node:${op(102)}`);
    expect(next?.[1]?.id).toBe('node:10.0.0.3:16127');
    expect(migrateRecentEntries([entry('node:x', op(101))], t)).toBeNull();
  });
});
