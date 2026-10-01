// Ten hexagons for ten confirmations of finality. Each new block lights the next hexagon with a flash;
// the next one to fill breathes. A pending transaction shows all ten dim with a slow sweep, never a
// filled cell: pending is not confirmed. After finality the cells settle to the confirmed colour and
// the count keeps counting in the label.

import { useEffect, useRef, useState } from 'react';
import { formatInt } from '../../../lib/format';
import { cx } from '../../../ui';
import { FINAL_DEPTH } from '../hooks/useChain';
import './gauge.css';

const SQ3 = Math.sqrt(3) / 2;

function hex(cx0: number, cy0: number, r: number): string {
  const p = [
    [cx0, cy0 - r],
    [cx0 + r * SQ3, cy0 - r / 2],
    [cx0 + r * SQ3, cy0 + r / 2],
    [cx0, cy0 + r],
    [cx0 - r * SQ3, cy0 + r / 2],
    [cx0 - r * SQ3, cy0 - r / 2],
  ];
  return `M${p.map(([x, y]) => `${x!.toFixed(2)} ${y!.toFixed(2)}`).join('L')}Z`;
}

export interface ConfirmationGaugeProps {
  /** Confirmations so far (0 = pending). */
  confirmations: number;
  /** The transaction or block is not in a block yet. */
  pending?: boolean;
  size?: 'sm' | 'md';
  /** Show the word next to the cells. */
  label?: boolean;
  className?: string;
}

export function ConfirmationGauge({
  confirmations,
  pending = false,
  size = 'md',
  label = true,
  className,
}: ConfirmationGaugeProps) {
  const r = size === 'sm' ? 5.6 : 7.6;
  const stride = r * 2 * SQ3 + (size === 'sm' ? 2 : 2.8);
  const w = stride * FINAL_DEPTH;
  const h = r * 2 + 2;
  const n = pending ? 0 : confirmations;
  const final = n >= FINAL_DEPTH;
  // Flash the cell that just lit up (not on first paint).
  const prev = useRef(n);
  const [fresh, setFresh] = useState<number | null>(null);
  useEffect(() => {
    const grew = n > prev.current && n <= FINAL_DEPTH;
    prev.current = n;
    if (!grew) return undefined;
    setFresh(n - 1);
    const t = setTimeout(() => setFresh(null), 900);
    return () => clearTimeout(t);
  }, [n]);
  const words = pending
    ? 'Pending'
    : final
      ? `${formatInt(n)} confirmation${n === 1 ? '' : 's'}`
      : `${formatInt(n)} of ${FINAL_DEPTH} confirmations`;
  return (
    <span
      className={cx('ex-gauge', className)}
      data-size={size}
      data-pending={pending || undefined}
      data-final={final || undefined}
      data-status={pending ? 'pending' : final ? 'ok' : 'pending'}
    >
      <svg
        className="ex-gauge__svg"
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={words}
        focusable="false"
      >
        {Array.from({ length: FINAL_DEPTH }, (_, i) => {
          const x = r * SQ3 + 1 + i * stride;
          const on = i < n;
          const d = hex(x, h / 2, r);
          return (
            <g
              // biome-ignore lint/suspicious/noArrayIndexKey: ten fixed cells
              key={i}
              className="ex-gauge__cell"
              data-on={on || undefined}
              data-next={(!pending && !final && i === n) || undefined}
              style={{ ['--i' as string]: i }}
            >
              <path className="ex-gauge__fill" d={d} />
              <path className="ex-gauge__line" d={d} />
              {fresh === i ? <path className="ex-gauge__flash" d={d} /> : null}
            </g>
          );
        })}
      </svg>
      {label ? <span className="ex-gauge__label">{words}</span> : null}
    </span>
  );
}
