import { describe, expect, it } from 'vitest';
import type { FeedItem } from '../../../api/generated/FeedItem';
import type { StatusSegment } from '../../../api/generated/StatusSegment';
import { nodeStateChips } from './nodeState';
import { heartbeatTicks, ipHistory, uptimeCells } from './uptime';

describe('nodeStateChips', () => {
  it('reads a healthy confirmed node as ok', () => {
    const [c, ...rest] = nodeStateChips({ status: 'confirmed', reachable: true, sinceConfirm: 40 });
    expect(c).toMatchObject({ tone: 'ok', label: 'Confirmed', icon: 'check' });
    expect(rest).toEqual([]);
  });

  it('flags at risk from 560 blocks and expiry from 640', () => {
    expect(nodeStateChips({ status: 'confirmed', reachable: true, sinceConfirm: 559 })[0]!.tone).toBe('ok');
    expect(nodeStateChips({ status: 'confirmed', reachable: true, sinceConfirm: 560 })[0]).toMatchObject({
      tone: 'warn',
      label: 'At risk',
    });
    expect(nodeStateChips({ status: 'confirmed', reachable: true, sinceConfirm: 640 })[0]).toMatchObject({
      tone: 'crit',
    });
  });

  it('never calls an unknown check-in healthy by accident: unknown since stays on the plain status', () => {
    expect(nodeStateChips({ status: 'confirmed', reachable: null, sinceConfirm: null })[0]!.label).toBe(
      'Confirmed',
    );
  });

  it('maps the other statuses and adds reachability', () => {
    expect(nodeStateChips({ status: 'started', reachable: null, sinceConfirm: null })[0]).toMatchObject({
      tone: 'pending',
      label: 'Started',
    });
    expect(nodeStateChips({ status: 'dos', reachable: true, sinceConfirm: 10 })[0]).toMatchObject({
      tone: 'crit',
      label: 'DoS listed',
    });
    expect(nodeStateChips({ status: 'departed', reachable: null, sinceConfirm: null })[0]!.tone).toBe('off');
    const both = nodeStateChips({ status: 'confirmed', reachable: false, sinceConfirm: 10 });
    expect(both.map((c) => c.key)).toEqual(['confirmed', 'unreachable']);
    expect(both[1]!.tone).toBe('off');
  });
});

const seg = (from: number, to: number, status: StatusSegment['status'] = 'confirmed'): StatusSegment => ({
  from_ms: from,
  to_ms: to,
  status,
});

describe('uptimeCells', () => {
  const DAY = 86_400_000;
  const now = 10 * DAY + 12 * 3_600_000; // noon on day 10

  it('leaves unobserved days empty and measures observed ones', () => {
    const cells = uptimeCells([seg(8 * DAY, now)], { nowMs: now, days: 5, coverageFromMs: 8 * DAY });
    expect(cells).toHaveLength(5);
    expect(cells.slice(0, 2).every((c) => c.fraction === null)).toBe(true);
    expect(cells[2]!.fraction).toBe(1);
    expect(cells[4]!.dayMs).toBe(10 * DAY);
    expect(cells[4]!.fraction).toBe(1);
    expect(cells[4]!.observedH).toBeCloseTo(12, 5);
  });

  it('counts a gap against the day it fell in', () => {
    const cells = uptimeCells([seg(8 * DAY, 9 * DAY + 6 * 3_600_000), seg(9 * DAY + 12 * 3_600_000, now)], {
      nowMs: now,
      days: 3,
      coverageFromMs: 8 * DAY,
    });
    expect(cells[1]!.fraction).toBeCloseTo(0.75, 5);
    expect(cells[2]!.fraction).toBe(1);
  });

  it('treats non-confirmed spans as down and no coverage as none', () => {
    const cells = uptimeCells([seg(10 * DAY, now, 'offline')], {
      nowMs: now,
      days: 1,
      coverageFromMs: 10 * DAY,
    });
    expect(cells[0]!.fraction).toBe(0);
    expect(
      uptimeCells([], { nowMs: now, days: 2, coverageFromMs: null }).every((c) => c.fraction === null),
    ).toBe(true);
  });
});

const ev = (kind: FeedItem['kind'], ts: number, params: Record<string, string> = {}): FeedItem => ({
  kind,
  ts_ms: ts,
  text_key: `feed.${kind}`,
  refs: [],
  params,
});

describe('heartbeatTicks and ipHistory', () => {
  it('keeps check-ins inside the window, oldest first, with their heights', () => {
    const t = heartbeatTicks(
      [
        ev('node_heartbeat', 9_000, { height: '2997554' }),
        ev('node_heartbeat', 1_000, { height: '2997054' }),
        ev('node_heartbeat', 100, { height: '1' }),
        ev('node_paid', 8_000, { height: '2' }),
      ],
      10_000,
      9_500,
    );
    expect(t.map((x) => x.tsMs)).toEqual([1_000, 9_000]);
    expect(t[1]!.height).toBe(2_997_554);
  });

  it('lists IP changes newest first and treats an empty old address as a first sighting', () => {
    const h = ipHistory([
      ev('node_ip_changed', 1_000, { old: '', new: '1.1.1.1:16127' }),
      ev('node_ip_changed', 5_000, { old: '1.1.1.1:16127', new: '2.2.2.2:16127' }),
      ev('node_ip_changed', 5_000, { old: '1.1.1.1:16127', new: '2.2.2.2:16127' }),
      ev('node_heartbeat', 6_000),
    ]);
    expect(h).toEqual([
      { tsMs: 5_000, from: '1.1.1.1:16127', to: '2.2.2.2:16127' },
      { tsMs: 1_000, from: null, to: '1.1.1.1:16127' },
    ]);
  });
});
