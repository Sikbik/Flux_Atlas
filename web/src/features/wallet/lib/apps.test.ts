import { describe, expect, it } from 'vitest';
import type { WalletApp } from '../types';
import {
  appColorSlot,
  appCountBuckets,
  appCountHeadline,
  appLabel,
  appRows,
  filterAppRows,
  perNodeCounts,
  summarizeApps,
} from './apps';

const app = (name: string, keys: string[], over: Partial<WalletApp> = {}): WalletApp => ({
  name,
  display_name: name.toUpperCase(),
  instances: keys.length,
  node_keys: keys,
  ...over,
});

const APPS = [app('alpha', ['n1', 'n2', 'n3']), app('beta', ['n1', 'n1', 'n2']), app('gamma', ['n3'])];
const NODES = ['n1', 'n2', 'n3', 'n4', 'n5'];

describe('perNodeCounts', () => {
  it('counts the different apps on each node, an app once however many instances it has there', () => {
    const c = perNodeCounts(APPS);
    expect(c.get('n1')).toBe(2);
    expect(c.get('n2')).toBe(2);
    expect(c.get('n3')).toBe(2);
    expect(c.get('n4')).toBeUndefined();
  });

  it('is empty for no apps', () => {
    expect(perNodeCounts([]).size).toBe(0);
  });
});

describe('summarizeApps', () => {
  it('totals the apps, the instances, who hosts and who is idle', () => {
    const s = summarizeApps(APPS, NODES);
    expect(s.apps).toBe(3);
    expect(s.instances).toBe(7);
    expect(s.nodes).toBe(5);
    expect(s.hosting).toBe(3);
    expect(s.idle).toBe(2);
    expect(s.busiest?.count).toBe(2);
    expect(s.average).toBeCloseTo(6 / 5, 9);
  });

  it('names the first of the busiest nodes', () => {
    expect(summarizeApps([app('a', ['n2', 'n9']), app('b', ['n9'])], ['n2', 'n9']).busiest).toEqual({
      key: 'n9',
      count: 2,
    });
  });

  it('has no busiest node and no average when there is nothing to count', () => {
    const s = summarizeApps([], []);
    expect(s.busiest).toBeNull();
    expect(s.average).toBeNull();
    expect(summarizeApps([], NODES).idle).toBe(5);
    expect(summarizeApps([], NODES).busiest).toBeNull();
  });

  it('counts only the nodes the fleet has, whatever else an app mentions', () => {
    const s = summarizeApps([app('x', ['elsewhere'])], ['n1']);
    expect(s.hosting).toBe(0);
    expect(s.idle).toBe(1);
  });
});

describe('appCountBuckets', () => {
  it('puts every node in one bucket, empty buckets included', () => {
    const b = appCountBuckets(perNodeCounts(APPS), NODES);
    expect(b.map((x) => x.label)).toEqual(['No apps', '1 app', '2 apps', '3 apps', '4 apps', '5 or more']);
    expect(b.map((x) => x.nodes)).toEqual([2, 0, 3, 0, 0, 0]);
    expect(b[0]?.keys).toEqual(['n4', 'n5']);
    expect(b.reduce((s, x) => s + x.nodes, 0)).toBe(NODES.length);
  });

  it('folds the busiest nodes into the last bucket', () => {
    const many = Array.from({ length: 7 }, (_, i) => app(`a${i}`, ['n1']));
    const b = appCountBuckets(perNodeCounts(many), ['n1', 'n2'], 3);
    expect(b.map((x) => x.id)).toEqual(['0', '1', '2', '3+']);
    expect(b[3]?.keys).toEqual(['n1']);
    expect(b[3]?.label).toBe('3 or more');
  });
});

describe('appCountHeadline', () => {
  const buckets = (nodes: string[], apps: WalletApp[] = APPS) => appCountBuckets(perNodeCounts(apps), nodes);

  it('names the commonest number of apps and says who runs none', () => {
    expect(appCountHeadline(buckets(NODES), NODES.length)).toBe(
      '3 of 5 nodes run 2 apps, the most common. 2 run none.',
    );
  });

  it('does not repeat itself when the idle nodes are the commonest', () => {
    const nodes = ['n1', 'n4', 'n5', 'n6'];
    expect(appCountHeadline(buckets(nodes), nodes.length)).toBe('3 of 4 nodes run no app, the most common.');
  });

  it('says so when every node is alike', () => {
    expect(appCountHeadline(buckets(['n1', 'n2', 'n3']), 3)).toBe('Every node runs 2 apps.');
    expect(appCountHeadline(buckets(['n1']), 1)).toBe('The node runs 2 apps.');
    expect(appCountHeadline(buckets(['n8', 'n9']), 2)).toBe('No node runs an app.');
    expect(appCountHeadline(buckets(['n8']), 1)).toBe('The node runs no app.');
  });

  it('reads a single app and the folded top bucket in words', () => {
    expect(appCountHeadline(buckets(['n3'], [app('only', ['n3'])]), 1)).toBe('The node runs one app.');
    const many = Array.from({ length: 7 }, (_, i) => app(`a${i}`, ['n1']));
    expect(appCountHeadline(buckets(['n1'], many), 1)).toBe('The node runs 5 or more apps.');
  });

  it('has nothing to say for a fleet of no nodes', () => {
    expect(appCountHeadline(buckets([]), 0)).toBe('There are no nodes to count.');
  });
});

describe('appRows', () => {
  it('lists each app with its distinct nodes and its share of every instance', () => {
    const rows = appRows(APPS);
    expect(rows.map((r) => r.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(rows[1]?.keys).toEqual(['n1', 'n2']);
    expect(rows[1]?.instances).toBe(3);
    expect(rows[1]?.nodes).toBe(2);
    expect(rows[0]?.share).toBeCloseTo(3 / 7, 9);
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 9);
  });

  it('has a zero share when no app has an instance, and never divides by nothing', () => {
    expect(appRows([app('idle', [], { instances: 0 })])[0]?.share).toBe(0);
    expect(appRows([])).toEqual([]);
  });

  it('labels an app by its display name, else its name', () => {
    expect(appRows([app('plain', ['n1'], { display_name: '' })])[0]?.label).toBe('plain');
    expect(appRows([app('plain', ['n1'], { display_name: 'Plain App' })])[0]?.label).toBe('Plain App');
  });
});

describe('appColorSlot', () => {
  it('is stable and always one of the six slots', () => {
    expect(appColorSlot('wordpress')).toBe(appColorSlot('wordpress'));
    for (const n of ['a', 'bb', 'ccc', 'FluxDrive', 'x'.repeat(200), '']) {
      const s = appColorSlot(n);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(6);
    }
  });

  it('spreads names over the slots', () => {
    const used = new Set(Array.from({ length: 60 }, (_, i) => appColorSlot(`app${i}`)));
    expect(used.size).toBeGreaterThanOrEqual(5);
  });
});

describe('filterAppRows and appLabel', () => {
  const rows = appRows(APPS);

  it('finds an app by its name or its display name, ignoring case', () => {
    expect(filterAppRows(rows, 'ALP').map((r) => r.name)).toEqual(['alpha']);
    expect(filterAppRows(rows, '  gam ').map((r) => r.name)).toEqual(['gamma']);
    expect(filterAppRows(rows, 'zzz')).toEqual([]);
  });

  it('finds an app by a word of its display name that its registered name does not have', () => {
    const named = appRows([app('wp', ['n1'], { display_name: 'Word Press Blog' })]);
    expect(filterAppRows(named, 'press').map((r) => r.name)).toEqual(['wp']);
  });

  it('keeps every app, in a new list, for no text', () => {
    const all = filterAppRows(rows, '   ');
    expect(all).toEqual(rows);
    expect(all).not.toBe(rows);
  });

  it('shows the display name, else the registered one', () => {
    expect(appLabel({ name: 'alpha', display_name: 'Alpha' })).toBe('Alpha');
    expect(appLabel({ name: 'alpha', display_name: '' })).toBe('alpha');
  });
});
