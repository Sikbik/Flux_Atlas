import { describe, expect, it } from 'vitest';
import {
  angleFor,
  arcPath,
  BIN_COUNT,
  barLength,
  buildDial,
  clockUtc,
  DIAL_HORIZONS,
  type DialPayout,
  DOT_LIMIT,
  describeItem,
  dialSummary,
  dialTicks,
  GEOMETRY,
  HORIZON,
  offsetLabel,
  polar,
  sectorPath,
  spokenSpan,
  TAU,
  toDialPayouts,
  trackRadii,
} from './payoutDial';

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;

const payout = (i: number, tier: DialPayout['tier'], etaMs: number): DialPayout => ({
  key: `${String(i).padStart(64, '0')}:0`,
  tier,
  etaMs,
  amount: tier === 'stratus' ? 9 : tier === 'nimbus' ? 3.5 : 1,
  height: 3_006_000 + i,
});

describe('angles and points', () => {
  it('puts now at the top and the horizon back at the top', () => {
    expect(angleFor(0, HOUR)).toBe(0);
    expect(angleFor(HOUR, HOUR)).toBeCloseTo(TAU, 12);
    expect(angleFor(HOUR / 4, HOUR)).toBeCloseTo(Math.PI / 2, 12);
  });

  it("runs clockwise: a quarter of the way is three o'clock, half is six", () => {
    const q = polar(100, 100, 50, Math.PI / 2);
    expect(q.x).toBeCloseTo(150, 9);
    expect(q.y).toBeCloseTo(100, 9);
    const h = polar(100, 100, 50, Math.PI);
    expect(h.x).toBeCloseTo(100, 9);
    expect(h.y).toBeCloseTo(150, 9);
    const top = polar(100, 100, 50, 0);
    expect(top.x).toBe(100);
    expect(top.y).toBe(50);
  });
});

describe('paths', () => {
  it('draws a sector between two radii and two angles, outer arc coming back', () => {
    const d = sectorPath(0, 0, 10, 20, 0, Math.PI / 2);
    expect(d.startsWith('M0 -10')).toBe(true);
    expect(d).toContain('A10 10 0 0 1 10 0');
    expect(d).toContain('L20 0');
    expect(d).toContain('A20 20 0 0 0 0 -20');
    expect(d.endsWith('Z')).toBe(true);
  });

  it('flags a sector over a half turn as the large arc', () => {
    expect(sectorPath(0, 0, 10, 20, 0, Math.PI * 1.5)).toContain('A10 10 0 1 1');
  });

  it('draws an arc, and a full circle as nearly full so the path does not collapse', () => {
    expect(arcPath(0, 0, 10, 0, Math.PI / 2)).toBe('M0 -10A10 10 0 0 1 10 0');
    const full = arcPath(0, 0, 10, 0, TAU);
    expect(full.startsWith('M0 -10A10 10 0 1 1')).toBe(true);
  });
});

describe('ticks', () => {
  it('has a tick per hour over a day, a label every six hours, none at the seam', () => {
    const t = dialTicks('24h');
    expect(t).toHaveLength(24);
    expect(t[0]?.label).toBeNull();
    expect(t.filter((x) => x.label).map((x) => x.label)).toEqual(['+6h', '+12h', '+18h']);
    expect(t.filter((x) => x.major)).toHaveLength(4);
  });

  it('labels every hour over six hours, and every day over three', () => {
    expect(
      dialTicks('6h')
        .filter((x) => x.label)
        .map((x) => x.label),
    ).toEqual(['+1h', '+2h', '+3h', '+4h', '+5h']);
    expect(
      dialTicks('72h')
        .filter((x) => x.label)
        .map((x) => x.label),
    ).toEqual(['+1d', '+2d']);
  });

  it('says an offset the short way', () => {
    expect(offsetLabel(30 * MIN)).toBe('+30m');
    expect(offsetLabel(6 * HOUR)).toBe('+6h');
    expect(offsetLabel(48 * HOUR)).toBe('+2d');
  });

  it('puts every tick inside one turn', () => {
    for (const h of DIAL_HORIZONS) for (const t of dialTicks(h)) expect(t.angle).toBeLessThan(TAU);
  });
});

describe('trackRadii', () => {
  it('gives each tier its own radius, inner to outer, inside the rim and outside the hub', () => {
    for (const n of [1, 2, 3]) {
      const r = trackRadii(n);
      expect(r).toHaveLength(n);
      for (const [i, t] of r.entries()) {
        expect(t.r).toBeGreaterThan(GEOMETRY.hub);
        expect(t.r + t.reach).toBeLessThanOrEqual(GEOMETRY.rim);
        if (i > 0) expect(t.r).toBeGreaterThan((r[i - 1] as { r: number }).r);
      }
    }
    expect(trackRadii(0)).toEqual([]);
  });

  it('lets a bar on an inner track grow no further than the next track', () => {
    const r = trackRadii(3);
    for (let i = 0; i < 2; i++) {
      const a = r[i] as { r: number; reach: number };
      const b = r[i + 1] as { r: number };
      expect(a.r + a.reach).toBeLessThan(b.r);
    }
  });
});

describe('toDialPayouts', () => {
  it('drops a payment of an unknown tier and sorts soonest first', () => {
    const out = toDialPayouts([
      { node_key: 'b:0', tier: 'stratus', height: 2, eta_ms: 2000, amount: '9.00000000' },
      { node_key: 'x:0', tier: 'unknown', height: 3, eta_ms: 1, amount: '1.00000000' },
      { node_key: 'a:0', tier: 'nimbus', height: 1, eta_ms: 1000, amount: '3.50000000' },
    ]);
    expect(out.map((p) => p.key)).toEqual(['a:0', 'b:0']);
    expect(out[0]?.amount).toBe(3.5);
  });
});

describe('buildDial', () => {
  it('draws a small fleet as dots at the angle of their time', () => {
    const ps = [payout(1, 'stratus', NOW + 6 * HOUR), payout(2, 'stratus', NOW + 12 * HOUR)];
    const m = buildDial(ps, NOW, '24h');
    expect(m.tracks).toHaveLength(1);
    expect(m.tracks[0]?.mode).toBe('dots');
    expect(m.items.map((i) => i.kind)).toEqual(['dot', 'dot']);
    expect(m.items[0]?.angle).toBeCloseTo(Math.PI / 2, 12);
    expect(m.items[1]?.angle).toBeCloseTo(Math.PI, 12);
    expect(m.next?.key).toBe(ps[0]?.key);
    expect(m.within).toBe(2);
    expect(m.later).toBe(0);
  });

  it('draws a big tier as bars, one per slice of time, counting the nodes in each', () => {
    // 208 nodes spread over the next 14 hours, one every four minutes.
    const ps = Array.from({ length: 208 }, (_, i) => payout(i, 'stratus', NOW + (i + 1) * 4 * MIN));
    const m = buildDial(ps, NOW, '24h');
    const track = m.tracks[0];
    expect(track?.mode).toBe('bars');
    expect(track?.within).toBe(208);
    expect(m.items.every((i) => i.kind === 'bin')).toBe(true);
    expect(m.items.reduce((s, i) => s + i.count, 0)).toBe(208);
    expect(m.items.reduce((s, i) => s + i.amount, 0)).toBeCloseTo(208 * 9, 9);
    // A slice of 15 minutes holds three or four payments four minutes apart.
    expect(track?.peak).toBeGreaterThanOrEqual(3);
    expect(track?.peak).toBeLessThanOrEqual(4);
    expect(m.items.every((i) => i.nodes.length <= 6)).toBe(true);
    expect(m.items.every((i) => i.a1 > i.a0)).toBe(true);
  });

  it('switches to dots when a shorter horizon holds few enough', () => {
    const ps = Array.from({ length: 208 }, (_, i) => payout(i, 'stratus', NOW + (i + 1) * 4 * MIN));
    const m = buildDial(ps, NOW, '6h');
    expect(m.within).toBe(89);
    expect(m.tracks[0]?.mode).toBe('bars');
    const short = buildDial(ps.slice(0, DOT_LIMIT), NOW, '6h');
    expect(short.tracks[0]?.mode).toBe('dots');
  });

  it('gives each tier of a mixed fleet its own track, inner to outer', () => {
    const ps = [
      payout(1, 'stratus', NOW + HOUR),
      payout(2, 'cumulus', NOW + 2 * HOUR),
      payout(3, 'nimbus', NOW + 3 * HOUR),
    ];
    const m = buildDial(ps, NOW, '24h');
    expect(m.tracks.map((t) => t.tier)).toEqual(['cumulus', 'nimbus', 'stratus']);
    const radii = m.tracks.map((t) => t.r);
    expect([...radii].sort((a, b) => a - b)).toEqual(radii);
  });

  it('counts what lies beyond the horizon and names the soonest of it', () => {
    const ps = [
      payout(1, 'cumulus', NOW + 2 * HOUR),
      payout(2, 'cumulus', NOW + 30 * HOUR),
      payout(3, 'cumulus', NOW + 40 * HOUR),
    ];
    const m = buildDial(ps, NOW, '24h');
    expect(m.within).toBe(1);
    expect(m.later).toBe(2);
    expect(m.laterNext?.key).toBe(ps[1]?.key);
    expect(m.total).toBe(3);
    expect(buildDial(ps, NOW, '72h').later).toBe(0);
  });

  it('ignores a payment that is already past', () => {
    const ps = [payout(1, 'stratus', NOW - 5 * MIN), payout(2, 'stratus', NOW + 5 * MIN)];
    const m = buildDial(ps, NOW, '24h');
    expect(m.within).toBe(1);
    expect(m.next?.key).toBe(ps[1]?.key);
  });

  it('is empty, not broken, for no payments', () => {
    const m = buildDial([], NOW, '24h');
    expect(m.tracks).toEqual([]);
    expect(m.items).toEqual([]);
    expect(m.next).toBeNull();
    expect(m.total).toBe(0);
  });

  it('keeps every angle inside one turn, however full the last slice', () => {
    const ps = [payout(1, 'stratus', NOW + 24 * HOUR - 1)];
    const m = buildDial(ps, NOW, '24h');
    for (const i of m.items) {
      expect(i.angle).toBeLessThan(TAU);
      expect(i.a1).toBeLessThanOrEqual(TAU);
    }
    // 96 slices, and a payment just inside the horizon lands in the last of them.
    const many = Array.from({ length: 80 }, (_, i) => payout(i, 'stratus', NOW + 24 * HOUR - 1 - i));
    const big = buildDial(many, NOW, '24h');
    expect(big.items.every((i) => i.kind === 'bin')).toBe(true);
    expect(Math.max(...big.items.map((i) => Number(i.id.split(':')[1])))).toBe(BIN_COUNT - 1);
  });
});

describe('barLength', () => {
  const track = { reach: 30, peak: 9 };
  it('grows with the count, never past the reach, never below a stub', () => {
    expect(barLength(0, track)).toBe(0);
    expect(barLength(1, track)).toBeGreaterThanOrEqual(4);
    expect(barLength(9, track)).toBeCloseTo(30, 9);
    expect(barLength(4, track)).toBeGreaterThan(barLength(1, track));
    expect(barLength(4, track)).toBeLessThan(barLength(9, track));
  });
});

describe('reading the dial', () => {
  it('says a span in words a screen reader can speak', () => {
    expect(spokenSpan(45_000)).toBe('45 seconds');
    expect(spokenSpan(60_000)).toBe('1 minute');
    expect(spokenSpan(2 * MIN + 14_000)).toBe('2 minutes 14 seconds');
    expect(spokenSpan(14 * MIN + 30_000)).toBe('14 minutes');
    expect(spokenSpan(2 * HOUR + 14 * MIN)).toBe('2 hours 14 minutes');
    expect(spokenSpan(3 * HOUR)).toBe('3 hours');
    expect(spokenSpan(26 * HOUR)).toBe('1 day 2 hours');
  });

  it('writes a clock time in UTC', () => {
    expect(clockUtc(Date.UTC(2026, 9, 3, 7, 5))).toBe('07:05');
  });

  it('summarises the dial, and an empty one', () => {
    const ps = Array.from({ length: 10 }, (_, i) => payout(i, 'stratus', NOW + (i + 1) * 30 * MIN));
    const text = dialSummary(buildDial(ps, NOW, '24h'), NOW);
    expect(text).toContain('Next payment in 30 minutes.');
    expect(text).toContain('10 of 10 nodes are paid within the next 24 hours.');
    expect(dialSummary(buildDial([], NOW, '24h'), NOW)).toBe('No payments are queued for this wallet.');
  });

  it('says what a dot and a bar stand for', () => {
    const dot = buildDial([payout(1, 'stratus', NOW + 2 * HOUR)], NOW, '24h').items[0];
    expect(describeItem(dot as NonNullable<typeof dot>)).toBe('stratus node, 9.00 FLUX in 2 hours');
    const ps = Array.from({ length: 60 }, (_, i) => payout(i, 'stratus', NOW + (i + 1) * 10 * MIN));
    const bar = buildDial(ps, NOW, '24h').items.find((i) => i.count > 1);
    expect(describeItem(bar as NonNullable<typeof bar>)).toMatch(/^\d+ stratus payments in /);
  });

  it('knows every horizon', () => {
    expect(Object.keys(HORIZON)).toEqual([...DIAL_HORIZONS]);
    expect(HORIZON['24h'].ms).toBe(24 * HOUR);
  });
});
