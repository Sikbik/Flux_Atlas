import { describe, expect, it } from 'vitest';
import type { AppComponent } from '../../../api/generated/AppComponent';
import type { AppHistoryEntry } from '../../../api/generated/AppHistoryEntry';
import type { AppSpec } from '../../../api/generated/AppSpec';
import {
  buildHistory,
  currentValue,
  findRevision,
  groupChanges,
  parseChange,
  revisionCount,
  summarizeChanges,
  totalPaid,
  withCurrentValues,
} from './appHistory';

const entry = (
  kind: AppHistoryEntry['kind'],
  height: number,
  changed: string[] = [],
  paid: string | null = null,
  spec_version = 5,
): AppHistoryEntry => ({
  height,
  time_ms: height * 30_000,
  kind,
  spec_hash: null,
  spec_version,
  changed,
  paid,
});

const component = (over: Partial<AppComponent> = {}): AppComponent => ({
  name: 'web',
  description: '',
  repotag: 'nginx:1',
  ports: [8080],
  container_ports: [80],
  domains: [],
  environment: ['TOKEN=abc', 'MODE=prod'],
  commands: [],
  container_data: '/data',
  cpu: 0.5,
  ram_mb: 1_000,
  hdd_gb: 10,
  tiered: false,
  has_repoauth: false,
  has_secrets: false,
  ...over,
});

const spec = (over: Partial<AppSpec> = {}): AppSpec => ({
  spec_version: 8,
  name: 'Demo',
  description: 'A demo app',
  owner: '1Owner',
  instances: 4,
  contacts: ['a@b.c', 'd@e.f'],
  geolocation: [],
  expire_blocks: null,
  nodes: [],
  static_ip: false,
  enterprise: false,
  datacenter: null,
  components: [component()],
  ...over,
});

describe('parseChange', () => {
  it('reads component fields, components added or removed, and app fields', () => {
    expect(parseChange('components.web.ram_mb')).toMatchObject({
      scope: 'web',
      field: 'ram_mb',
      label: 'Memory',
      kind: 'changed',
    });
    expect(parseChange('components.api+')).toMatchObject({
      scope: 'api',
      kind: 'added',
      label: 'Component api',
    });
    expect(parseChange('components.api-')).toMatchObject({ scope: 'api', kind: 'removed' });
    expect(parseChange('instances')).toMatchObject({ scope: null, label: 'Instance count' });
    expect(parseChange('some_new_field')).toMatchObject({ label: 'some new field' });
  });

  it('copes with dotted component names', () => {
    expect(parseChange('components.web.v2.cpu')).toMatchObject({ scope: 'web.v2', field: 'cpu' });
  });
});

describe('buildHistory', () => {
  it('numbers messages from one and keeps registered and updated rows', () => {
    const items = buildHistory([
      entry('registered', 10, [], '10.0', 2),
      entry('updated', 20, ['instances'], '0.5', 3),
    ]);
    expect(items[0]).toMatchObject({ type: 'registered', n: 1, again: false });
    expect(items[1]).toMatchObject({ type: 'updated', n: 2, versionFrom: 2, versionTo: 3 });
  });

  it('groups consecutive renewals and totals what they paid', () => {
    const items = buildHistory([
      entry('registered', 10, [], '10.0'),
      entry('renewed', 20, [], '1.5'),
      entry('renewed', 30, [], '2.5'),
      entry('updated', 40, ['owner'], '0.5'),
    ]);
    expect(items).toHaveLength(3);
    const run = items[1]!;
    expect(run).toMatchObject({ type: 'renewals', from: 2, to: 3 });
    if (run.type === 'renewals') expect(run.paid).toBe(400_000_000n);
    const last = items[2]!;
    if (last.type === 'updated') expect(last.ownerChanged).toBe(true);
  });

  it('flags a registration after an expiry as a return', () => {
    const items = buildHistory([entry('registered', 1), entry('expired', 2), entry('registered', 3)]);
    expect(items.at(-1)).toMatchObject({ type: 'registered', again: true });
  });

  it('totals payments across every message', () => {
    expect(
      totalPaid([
        entry('registered', 1, [], '1.25'),
        entry('updated', 2, [], null),
        entry('renewed', 3, [], '0.75'),
      ]),
    ).toBe(200_000_000n);
    expect(totalPaid([])).toBe(0n);
  });

  it('numbers revisions: renewals never define one, updates and re-registrations do', () => {
    const items = buildHistory([
      entry('registered', 1),
      entry('renewed', 2),
      entry('updated', 3, ['instances']),
      entry('renewed', 4),
      entry('expired', 5),
      entry('registered', 6),
    ]);
    expect(revisionCount(items)).toBe(3);
    expect(findRevision(items, 1)).toMatchObject({ type: 'registered', rev: 1, n: 1 });
    expect(findRevision(items, 2)).toMatchObject({ type: 'updated', rev: 2, n: 3 });
    expect(findRevision(items, 3)).toMatchObject({ type: 'registered', rev: 3, again: true });
    expect(findRevision(items, 4)).toBeNull();
    expect(findRevision(items, 0)).toBeNull();
    expect(revisionCount([])).toBe(0);
  });
});

describe('current values', () => {
  it('formats the new value of a change for the current version', () => {
    const s = spec();
    expect(currentValue(s, parseChange('instances'))).toBe('4');
    expect(currentValue(s, parseChange('spec_version'))).toBe('v8');
    expect(currentValue(s, parseChange('components.web.ram_mb'))).toBe('1,000 MB');
    expect(currentValue(s, parseChange('components.web.repotag'))).toBe('nginx:1');
    expect(currentValue(s, parseChange('components.gone.cpu'))).toBeUndefined();
  });

  it('never prints environment values, contacts or secrets', () => {
    const s = spec();
    const env = currentValue(s, parseChange('components.web.environment'));
    expect(env).toBe('2 variables, values hidden');
    expect(env).not.toContain('abc');
    expect(currentValue(s, parseChange('contacts'))).toBe('2 contacts');
    expect(
      currentValue(
        spec({ components: [component({ has_secrets: true })] }),
        parseChange('components.web.has_secrets'),
      ),
    ).toBe('present, hidden');
  });

  it('applies values to the latest updated item only', () => {
    const [item] = buildHistory([entry('updated', 2, ['instances', 'components.web.cpu'])]);
    const withValues = withCurrentValues(item!, spec());
    if (withValues.type === 'updated') {
      expect(withValues.changes.map((c) => c.value)).toEqual(['4', '0.5 CPU']);
    }
    const [reg] = buildHistory([entry('registered', 1)]);
    expect(withCurrentValues(reg!, spec())).toBe(reg);
  });
});

describe('summaries', () => {
  it('summarizes in one line', () => {
    expect(summarizeChanges([])).toBe('No fields changed');
    expect(summarizeChanges(['components.api+', 'instances', 'components.web.ram_mb'].map(parseChange))).toBe(
      'Added api; instance count, memory',
    );
    expect(summarizeChanges(['components.old-'].map(parseChange))).toBe('Removed old');
  });

  it('groups app fields before components', () => {
    const groups = groupChanges(
      ['components.web.cpu', 'instances', 'components.api+', 'components.web.ram_mb'].map(parseChange),
    );
    expect(groups.map((g) => g.scope)).toEqual([null, 'web', 'api']);
    expect(groups[1]!.lines).toHaveLength(2);
  });
});
