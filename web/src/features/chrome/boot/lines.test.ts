import { describe, expect, it } from 'vitest';
import { announce, type BootFacts, lineValue, NO_FACTS } from './lines';

const facts: BootFacts = {
  ttfbMs: 41,
  tipHeight: 2_996_929,
  nodes: 6724,
  hosts: 2655,
  countries: 87,
  apps: 1882,
  instances: 8274,
  utcHM: '19:46',
  nextS: 18,
};

describe('lineValue', () => {
  it('says nothing for a stage that has not begun and "fail" for one that failed', () => {
    expect(lineValue('nodes', 'wait', 0, facts)).toBe('');
    expect(lineValue('stream', 'fail', 0.3, facts)).toBe('fail');
  });

  it('counts the real number up while a stage runs and ends on it', () => {
    expect(lineValue('nodes', 'run', 0.5, facts)).toBe('3,362 of 6,724');
    expect(lineValue('nodes', 'done', 1, facts)).toBe('6,724 of 6,724');
    expect(lineValue('hosts', 'run', 0.5, facts)).toBe('1,328 hosts');
    expect(lineValue('hosts', 'done', 1, facts)).toBe('2,655 hosts, 87 countries');
    expect(lineValue('apps', 'done', 1, facts)).toBe('1,882 apps, 8,274 instances');
  });

  it('describes a running stage in words when there is nothing to count yet', () => {
    expect(lineValue('nodes', 'run', 0.4, NO_FACTS)).toBe('receiving');
    expect(lineValue('hosts', 'run', 0.4, NO_FACTS)).toBe('placing');
    expect(lineValue('apps', 'run', 0.4, NO_FACTS)).toBe('reading');
    expect(lineValue('tip', 'run', 0.4, NO_FACTS)).toBe('asking');
  });

  it('reports what the stages found', () => {
    expect(lineValue('connect', 'done', 1, facts)).toBe('Atlas answered, 41 ms');
    expect(lineValue('connect', 'done', 1, NO_FACTS)).toBe('connected');
    expect(lineValue('tip', 'done', 1, facts)).toBe('block 2,996,929');
    expect(lineValue('sun', 'done', 1, facts)).toBe('19:46 UTC, terminator set');
    expect(lineValue('stream', 'done', 1, facts)).toBe('next block in 18 s');
    expect(lineValue('stream', 'done', 1, NO_FACTS)).toBe('live');
  });

  it('never counts past the real number', () => {
    expect(lineValue('nodes', 'run', 3, facts)).toBe('6,724 of 6,724');
    expect(lineValue('nodes', 'run', -1, facts)).toBe('0 of 6,724');
  });
});

describe('announce', () => {
  it('names the running stage', () => {
    expect(announce({ id: 'nodes', label: 'Load nodes', state: 'run', u: 0.5 }, 24)).toBe(
      'Loading Flux Atlas, 24 percent: Load nodes',
    );
    expect(announce(null, 100)).toBe('Loading Flux Atlas, 100 percent');
  });
});
