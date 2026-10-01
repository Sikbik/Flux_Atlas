// When an address was paid by the network: three lanes (Stratus, Nimbus, Cumulus), one dot per payout
// along time. Tier colours appear here because a payout ARRIVES here. Hover or focus a dot for its
// amount and block; click opens the block.

import { useNavigate } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { formatInt, formatSats, formatUtcDateTime } from '../../../../lib/format';
import { linear, timeTicks } from '../../../analytics/viz/scale';
import { useSize } from '../../../analytics/viz/useSize';
import '../../../analytics/viz/viz.css';
import { TierGlyph, type TierName, tierLabel } from '../../../../ui';
import type { PayoutEvent } from '../../lib/addressTxs';
import './address.css';

const LANES: readonly TierName[] = ['stratus', 'nimbus', 'cumulus'];
const M = { left: 92, right: 14, top: 6, bottom: 24 };
const LANE_H = 30;

export function PayoutStrip({ events, now }: { events: readonly PayoutEvent[]; now: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { width } = useSize(ref);
  const navigate = useNavigate();
  const [hot, setHot] = useState<number | null>(null);
  const tiers = useMemo(
    () => events.filter((e) => e.role === 'stratus' || e.role === 'nimbus' || e.role === 'cumulus'),
    [events],
  );
  const height = M.top + LANES.length * LANE_H + M.bottom;
  const geo = useMemo(() => {
    if (tiers.length === 0 || width <= 0) return null;
    const t0 = tiers[0]!.t;
    const t1 = Math.max(now, tiers.at(-1)!.t);
    const x = linear([t0, t1 === t0 ? t0 + 1 : t1], [M.left, width - M.right]);
    return { x, t0, t1 };
  }, [tiers, width, now]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { stratus: 0, nimbus: 0, cumulus: 0 };
    for (const e of tiers) c[e.role] = (c[e.role] ?? 0) + 1;
    return c;
  }, [tiers]);
  const ticks = geo
    ? timeTicks(geo.t0, geo.t1, Math.max(2, Math.floor((width - M.left - M.right) / 110)))
    : [];
  const hotEv = hot !== null ? tiers[hot] : undefined;
  const open = (e: PayoutEvent) =>
    void navigate({ to: '/block/$key', params: { key: String(e.height) } } as never);
  return (
    <div className="ex-strip-wrap" ref={ref} style={{ height }}>
      {geo ? (
        <svg
          className="vz-svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Payouts to this address: ${LANES.map((l) => `${tierLabel(l)} ${counts[l]}`).join(', ')}`}
        >
          <g className="vz-grid">
            {LANES.map((l, i) => (
              <line
                key={l}
                x1={M.left}
                x2={width - M.right}
                y1={M.top + i * LANE_H + LANE_H / 2}
                y2={M.top + i * LANE_H + LANE_H / 2}
                strokeDasharray="1 5"
                strokeLinecap="round"
              />
            ))}
          </g>
          <g className="vz-xaxis">
            {ticks.map((tk) => (
              <g key={tk.t} data-major={tk.major || undefined}>
                <line
                  x1={geo.x(tk.t)}
                  x2={geo.x(tk.t)}
                  y1={M.top + LANES.length * LANE_H}
                  y2={M.top + LANES.length * LANE_H + 4}
                />
                <text x={geo.x(tk.t)} y={M.top + LANES.length * LANE_H + 17} textAnchor="middle">
                  {tk.label}
                </text>
              </g>
            ))}
          </g>
          {tiers.map((e, k) => {
            const lane = LANES.indexOf(e.role as TierName);
            if (lane < 0) return null;
            const cx = geo.x(e.t);
            const cy = M.top + lane * LANE_H + LANE_H / 2;
            return (
              // biome-ignore lint/a11y/useSemanticElements: an SVG dot cannot be a <button>
              <g
                key={`${e.txid}:${e.n}`}
                role="button"
                tabIndex={0}
                aria-label={`${tierLabel(e.role as TierName)} payout of ${formatSats(e.sats, { decimals: 2 })}, block ${formatInt(e.height)}`}
                className="ex-dot"
                data-hot={hot === k || undefined}
                onPointerEnter={() => setHot(k)}
                onPointerLeave={() => setHot((h) => (h === k ? null : h))}
                onFocus={() => setHot(k)}
                onBlur={() => setHot((h) => (h === k ? null : h))}
                onClick={() => open(e)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    open(e);
                  }
                }}
              >
                <circle className="ex-dot__hit" cx={cx} cy={cy} r={10} />
                <circle
                  className="ex-dot__halo"
                  cx={cx}
                  cy={cy}
                  r={8}
                  style={{ ['--c' as string]: `var(--tier-${e.role})` }}
                />
                <circle
                  className="ex-dot__dot"
                  cx={cx}
                  cy={cy}
                  r={4}
                  style={{ ['--c' as string]: `var(--tier-${e.role}-ink)` }}
                />
              </g>
            );
          })}
        </svg>
      ) : null}
      {geo
        ? LANES.map((l, i) => (
            <div
              key={l}
              className="ex-lane__label"
              data-tier={l}
              style={{ top: M.top + i * LANE_H, height: LANE_H, width: M.left - 12 }}
            >
              <TierGlyph tier={l} size={13} />
              <span>{tierLabel(l)}</span>
              <b>{formatInt(counts[l] ?? 0)}</b>
            </div>
          ))
        : null}
      {hotEv && geo ? (
        <div
          className="vz-tip"
          data-side={geo.x(hotEv.t) > width * 0.6 ? 'left' : 'right'}
          style={{ left: geo.x(hotEv.t), top: M.top + LANES.indexOf(hotEv.role as TierName) * LANE_H - 8 }}
          role="presentation"
        >
          <div className="vz-tip-head">{formatUtcDateTime(hotEv.t)}</div>
          <ul>
            <li>
              <span
                className="vz-key"
                style={{ ['--c' as string]: `var(--tier-${hotEv.role}-ink)` }}
                aria-hidden="true"
              />
              <strong className="vz-tip-val tabular">
                +{formatSats(hotEv.sats, { decimals: 2, unit: false })}
              </strong>
              <span className="vz-tip-name">FLUX, block {formatInt(hotEv.height)}</span>
            </li>
          </ul>
        </div>
      ) : null}
      {tiers.length === 0 ? (
        <p className="ex-muted">No node payouts in the transactions loaded so far.</p>
      ) : null}
    </div>
  );
}
