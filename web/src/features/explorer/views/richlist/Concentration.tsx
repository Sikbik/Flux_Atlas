// The headline of the rich list: one bar for the whole supply, cut by rank. The widest segment is the
// largest address; the last is everyone not on the list. A segment filters the list below to its ranks.

import { type CSSProperties, useState } from 'react';
import { formatInt } from '../../../../lib/format';
import type { Bucket } from '../../lib/richlist';
import { cx } from '../../parts';
import './richlist.css';

export const formatShare = (pct: number): string =>
  `${pct >= 10 ? pct.toFixed(1) : pct >= 0.1 ? pct.toFixed(2) : pct.toFixed(3)}%`;

const FILL = ['var(--seq-6)', 'var(--seq-5)', 'var(--seq-4)', 'var(--seq-3)'] as const;
const REST_FILL = 'var(--ink-4)';

const segStyle = (b: Bucket, i: number): CSSProperties =>
  ({ flexGrow: Math.max(b.share, 0.4), '--seg': FILL[i] ?? REST_FILL, '--i': i }) as CSSProperties;

export function Concentration({
  buckets,
  active,
  onPick,
  entityOfFirst,
}: {
  buckets: readonly Bucket[];
  active: string | null;
  onPick: (key: string | null) => void;
  /** Name of the largest holder when it is a known entity ("Swap pool"). */
  entityOfFirst?: string | null;
}) {
  const [hot, setHot] = useState<string | null>(null);
  return (
    <div className="ex-conc" data-picked={active !== null || undefined}>
      <fieldset className="ex-conc__bar">
        <legend className="ex-sr">Share of the supply by rank</legend>
        {buckets.map((b, i) => {
          if (b.from === null) {
            return (
              <div
                key={b.key}
                className="ex-conc__seg"
                style={segStyle(b, i)}
                data-rest=""
                role="img"
                aria-label={`Everyone else: ${formatShare(b.share)} of the supply`}
              />
            );
          }
          const on = active === b.key;
          return (
            <button
              key={b.key}
              type="button"
              className={cx('ex-conc__seg', hot === b.key && 'is-hot', on && 'is-on')}
              style={segStyle(b, i)}
              aria-pressed={on}
              aria-label={`${b.label}: ${formatShare(b.share)} of the supply. ${on ? 'Showing these addresses; press to show all.' : 'Show these addresses.'}`}
              onClick={() => onPick(on ? null : b.key)}
              onPointerEnter={() => setHot(b.key)}
              onPointerLeave={() => setHot(null)}
              onFocus={() => setHot(b.key)}
              onBlur={() => setHot(null)}
            />
          );
        })}
      </fieldset>
      <ul className="ex-conc__legend">
        {buckets.map((b, i) => (
          <li
            key={b.key}
            className={cx(hot === b.key && 'is-hot')}
            style={{ '--seg': FILL[i] ?? REST_FILL } as CSSProperties}
          >
            <i className="ex-conc__dot" data-rest={b.from === null || undefined} aria-hidden="true" />
            <span className="ex-conc__name">
              {b.label}
              {i === 0 && entityOfFirst ? <em>{entityOfFirst}</em> : null}
            </span>
            <b>{formatShare(b.share)}</b>
            <span className="ex-conc__count">
              {b.from === null
                ? 'not on the list'
                : b.holders === 1
                  ? '1 address'
                  : `${formatInt(b.holders)} addresses`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
