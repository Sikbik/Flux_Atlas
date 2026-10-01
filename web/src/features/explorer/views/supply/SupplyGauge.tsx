// How much exists against the announced cap, as one bar: transparent supply, the shielded pools, and a
// tick for the explorer's "circulating" figure. The cap is announced, not enforced by consensus code,
// and the bar says so. Fills grow from the left with a transform, nothing reflows.

import { useEffect, useState } from 'react';
import { formatCompact, formatPercent } from '../../../../lib/format';
import './supply.css';

export interface SupplyGaugeProps {
  transparent: number;
  shielded: number;
  circulating: number | null;
  cap: number;
}

export function SupplyGauge({ transparent, shielded, circulating, cap }: SupplyGaugeProps) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const total = transparent + shielded;
  const f = (v: number) => (on ? Math.max(0, Math.min(1, v / cap)) : 0);
  return (
    <figure
      className="ex-sg"
      aria-label={`Supply ${formatCompact(total)} FLUX of the announced ${formatCompact(cap)}`}
    >
      <div className="ex-sg__track">
        <i className="ex-sg__fill" data-kind="transparent" style={{ ['--w' as string]: f(transparent) }} />
        <i
          className="ex-sg__fill"
          data-kind="shielded"
          style={{ ['--w' as string]: f(shielded), ['--x' as string]: f(transparent) }}
        />
        {circulating !== null ? (
          <b
            className="ex-sg__mark"
            style={{ ['--p' as string]: f(circulating) }}
            title={`Circulating per the explorer: ${formatCompact(circulating)} FLUX`}
          >
            <span>circulating, per explorer</span>
          </b>
        ) : null}
      </div>
      <figcaption className="ex-sg__scale ex-mono">
        <span>0</span>
        <span className="ex-sg__now">{formatPercent(total / cap, 1)} of the cap exists</span>
        <span>{formatCompact(cap)} announced, not enforced</span>
      </figcaption>
      <ul className="ex-sg__legend">
        <li>
          <i data-kind="transparent" aria-hidden="true" /> Transparent
        </li>
        <li>
          <i data-kind="shielded" aria-hidden="true" /> Shielded pools
        </li>
        {circulating !== null ? (
          <li>
            <i data-kind="mark" aria-hidden="true" /> Circulating, per explorer
          </li>
        ) : null}
      </ul>
    </figure>
  );
}
