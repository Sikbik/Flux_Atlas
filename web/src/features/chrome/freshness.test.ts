import { describe, expect, it } from 'vitest';
import type { JobFreshness } from '../../api/generated/JobFreshness';
import { PATHS, readPath, readPaths, worstState } from './freshness';

const job = (name: string, lastOk: number | null): JobFreshness => ({
  job: name,
  last_ok_ms: lastOk,
  last_error: null,
  last_error_ms: null,
  stale: false,
  next_run_ms: null,
});

const jobs = (...list: JobFreshness[]) => new Map(list.map((j) => [j.job, j]));
const tipDef = PATHS.find((p) => p.id === 'tip')!;
const nodesDef = PATHS.find((p) => p.id === 'nodes')!;

describe('readPath', () => {
  it('uses the newest of the stream receipt and the server job time', () => {
    const r = readPath(nodesDef, {
      nowMs: 100_000,
      jobs: jobs(job('node_count', 40_000)),
      lastMessage: new Map([['nodes', 90_000]]),
      tipAnchorMs: null,
    });
    expect(r.ageMs).toBe(10_000);
    expect(r.source).toBe('stream');
    expect(r.state).toBe('fresh');
  });

  it('falls back to the snapshot job time and says so', () => {
    const r = readPath(nodesDef, {
      nowMs: 100_000,
      jobs: jobs(job('node_registry', 40_000)),
      lastMessage: new Map(),
      tipAnchorMs: null,
    });
    expect(r.ageMs).toBe(60_000);
    expect(r.source).toBe('snapshot');
  });

  it('reads the tip from the last block anchor', () => {
    const r = readPath(tipDef, { nowMs: 100_000, jobs: jobs(), lastMessage: new Map(), tipAnchorMs: 88_000 });
    expect(r.ageMs).toBe(12_000);
    expect(r.state).toBe('fresh');
  });

  it('reads the tip as the age of the last block, ignoring a newer server job time', () => {
    const r = readPath(tipDef, {
      nowMs: 100_000,
      jobs: jobs(job('chain_stream', 99_000)),
      lastMessage: new Map(),
      tipAnchorMs: 70_000,
    });
    expect(r.ageMs).toBe(30_000);
    expect(r.source).toBe('stream');
  });

  it('is unknown, never zero, without evidence', () => {
    const r = readPath(nodesDef, { nowMs: 5, jobs: jobs(), lastMessage: new Map(), tipAnchorMs: null });
    expect(r.ageMs).toBeNull();
    expect(r.state).toBe('unknown');
    expect(r.source).toBe('none');
  });

  it('classifies by the path cadence: aging, stale, dead', () => {
    const at = (age: number) =>
      readPath(nodesDef, {
        nowMs: 1_000_000,
        jobs: jobs(),
        lastMessage: new Map([['nodes', 1_000_000 - age]]),
        tipAnchorMs: null,
      }).state;
    expect(at(2 * 90_000)).toBe('aging');
    expect(at(5 * 90_000)).toBe('stale');
    expect(at(20 * 90_000)).toBe('dead');
  });

  it('never reports a negative age when a receipt is slightly ahead of the clock', () => {
    const r = readPath(nodesDef, {
      nowMs: 100,
      jobs: jobs(),
      lastMessage: new Map([['nodes', 250]]),
      tipAnchorMs: null,
    });
    expect(r.ageMs).toBe(0);
  });
});

describe('worstState', () => {
  it('picks the worst of several readings', () => {
    const readings = readPaths({
      nowMs: 1_000_000,
      jobs: jobs(),
      lastMessage: new Map([
        ['block', 999_000],
        ['nodes', 1_000_000 - 20 * 90_000],
      ]),
      tipAnchorMs: 999_000,
    });
    expect(worstState(readings)).toBe('unknown');
    expect(worstState(readings.filter((r) => r.state !== 'unknown'))).toBe('dead');
  });
});
