import { describe, expect, it } from 'vitest';
import { ARCHIVE_ATTR, publishArchive, readArchive, tMinus, tMinusSpoken } from './archive';

/** The three calls the contract needs, over a plain map, and a log of what was written. */
function fakeRoot() {
  const attrs = new Map<string, string>();
  const writes: string[] = [];
  return {
    attrs,
    writes,
    getAttribute: (n: string) => attrs.get(n) ?? null,
    setAttribute: (n: string, v: string) => {
      writes.push(`set ${n}=${v}`);
      attrs.set(n, v);
    },
    removeAttribute: (n: string) => {
      writes.push(`remove ${n}`);
      attrs.delete(n);
    },
  };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('the archive moment on the document', () => {
  it('reads nothing while no archive shows', () => {
    expect(readArchive(fakeRoot())).toBeNull();
  });

  it('round-trips an instant, a tip and a node count', () => {
    const root = fakeRoot();
    publishArchive(root, { at: 1_790_000_000_123, tip: 2_978_201, nodes: 6512 });
    expect(root.attrs.get(ARCHIVE_ATTR.at)).toBe('1790000000123');
    expect(readArchive(root)).toEqual({ at: 1_790_000_000_123, tip: 2_978_201, nodes: 6512 });
  });

  it('leaves out what the recording does not hold, so unknown is never read as zero', () => {
    const root = fakeRoot();
    publishArchive(root, { at: 5000, tip: null, nodes: null });
    expect(root.attrs.has(ARCHIVE_ATTR.tip)).toBe(false);
    expect(root.attrs.has(ARCHIVE_ATTR.nodes)).toBe(false);
    expect(readArchive(root)).toEqual({ at: 5000, tip: null, nodes: null });
  });

  it('takes a reading away when it stops being known, and everything away on leaving', () => {
    const root = fakeRoot();
    publishArchive(root, { at: 5000, tip: 10, nodes: 20 });
    publishArchive(root, { at: 6000, tip: null, nodes: 20 });
    expect(readArchive(root)).toEqual({ at: 6000, tip: null, nodes: 20 });
    publishArchive(root, null);
    expect(root.attrs.size).toBe(0);
    expect(readArchive(root)).toBeNull();
  });

  it('writes only what changed', () => {
    const root = fakeRoot();
    publishArchive(root, { at: 5000, tip: 10, nodes: 20 });
    root.writes.length = 0;
    publishArchive(root, { at: 5000, tip: 10, nodes: 20 });
    expect(root.writes).toEqual([]);
    publishArchive(root, { at: 5033, tip: 10, nodes: 20 });
    expect(root.writes).toEqual([`set ${ARCHIVE_ATTR.at}=5033`]);
  });

  it('rounds to whole milliseconds and reads a bad instant as no archive', () => {
    const root = fakeRoot();
    publishArchive(root, { at: 5000.6, tip: 10.2, nodes: 20 });
    expect(readArchive(root)).toEqual({ at: 5001, tip: 10, nodes: 20 });
    root.attrs.set(ARCHIVE_ATTR.at, 'soon');
    expect(readArchive(root)).toBeNull();
    root.attrs.set(ARCHIVE_ATTR.at, '');
    expect(readArchive(root)).toBeNull();
  });
});

describe('t minus', () => {
  it('reads two units at most, the lower one padded so the width holds', () => {
    expect(tMinus(0)).toBe('T−0 s');
    expect(tMinus(40_000)).toBe('T−40 s');
    expect(tMinus(12 * MIN + 5_000)).toBe('T−12 m 05 s');
    expect(tMinus(3 * HOUR + 5 * MIN)).toBe('T−3 h 05 m');
    expect(tMinus(3 * HOUR + 12 * MIN)).toBe('T−3 h 12 m');
    expect(tMinus(4 * DAY + 11 * HOUR + 30 * MIN)).toBe('T−4 d 11 h');
    expect(tMinus(4 * DAY + 3 * HOUR)).toBe('T−4 d 03 h');
    expect(tMinus(4 * DAY)).toBe('T−4 d 00 h');
  });

  it('is never negative: a moment at or after now reads as zero', () => {
    expect(tMinus(-5_000)).toBe('T−0 s');
  });

  it('is spelled out for a screen reader', () => {
    expect(tMinusSpoken(4 * DAY + 11 * HOUR)).toBe('T minus 4 days 11 hours');
    expect(tMinusSpoken(DAY)).toBe('T minus 1 day');
    expect(tMinusSpoken(3 * HOUR + 12 * MIN)).toBe('T minus 3 hours 12 minutes');
    expect(tMinusSpoken(12 * MIN + 5_000)).toBe('T minus 12 minutes 5 seconds');
    expect(tMinusSpoken(40_000)).toBe('T minus 40 seconds');
    expect(tMinusSpoken(1_000)).toBe('T minus 1 second');
  });
});
