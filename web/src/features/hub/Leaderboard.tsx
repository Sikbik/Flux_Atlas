// A leaderboard: ranked rows of a named thing (an operator, an app, an owner), each a real link that opens it, with
// figures in columns that line up from row to row and a share bar to read the sizes by. It is a list, not a table:
// in a wide panel the figures sit in columns under a hairline of headers; in a narrow one the same row folds into
// two lines, the name on top and the figures under it, so nothing scrolls sideways. Each figure carries its column
// name for a screen reader, which hears "Nodes: 424", not a bare number.

import type { CSSProperties, ReactNode } from 'react';
import { ShellLink } from '../../shell/frame/ShellLink';
import type { WindowRef } from '../../shell/wm/types';
import { cx } from '../../ui';
import './hub.css';

export interface LbColumn<T> {
  id: string;
  /** The column name: the header over a wide list, and what a screen reader hears before the figure. */
  header: string;
  /** The column's grid track: `72px`, `minmax(96px, 1fr)`. */
  width: string;
  align?: 'end';
  /** Left out of the folded row (`narrow`) or of a medium one too (`compact`). */
  hide?: 'compact' | 'narrow';
  cell: (row: T) => ReactNode;
}

export interface LeaderboardProps<T> {
  /** Names the list for assistive technology. */
  label: string;
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** The rank shown (1 for the first). */
  rank: (row: T, index: number) => number;
  /** The name: the content of the row's link. */
  identity: (row: T) => ReactNode;
  /** A quiet line under the name. */
  identitySub?: (row: T) => ReactNode;
  /** Where the row's link goes. */
  to: (row: T) => WindowRef | string;
  /** The link's accessible name ("Open operator 1DFiyJ..."). */
  linkLabel: (row: T) => string;
  columns: readonly LbColumn<T>[];
  /** Extra links at the end of the row (a wallet): they sit above the row's own link. */
  actions?: (row: T) => ReactNode;
  className?: string;
}

/** The ranked list. */
export function Leaderboard<T>({
  label,
  rows,
  rowKey,
  rank,
  identity,
  identitySub,
  to,
  linkLabel,
  columns,
  actions,
  className,
}: LeaderboardProps<T>) {
  const tail = actions ? 'auto' : '0px';
  const tracks = ['2.25rem', 'minmax(0, 1.5fr)', ...columns.map((c) => c.width), tail];
  // A medium panel drops the columns marked `compact`, and their tracks with them, so the rest still line up. (A
  // column marked `narrow` stays until the panel is a phone's, as the CSS has it.)
  const kept = [
    '2.25rem',
    'minmax(0, 1.5fr)',
    ...columns.filter((c) => c.hide !== 'compact').map((c) => c.width),
    tail,
  ];
  const style = { '--lb-cols': tracks.join(' '), '--lb-cols-compact': kept.join(' ') } as CSSProperties;
  return (
    <div className={cx('hub-lb', className)} style={style}>
      <div className="hub-lb__head" aria-hidden="true">
        <span />
        <span />
        {columns.map((c) => (
          <span key={c.id} data-hide={c.hide} data-align={c.align}>
            {c.header}
          </span>
        ))}
        <span />
      </div>
      <ol className="hub-lb__list" aria-label={label}>
        {rows.map((row, i) => {
          const n = rank(row, i);
          return (
            <li key={rowKey(row)} className="hub-lb__row" data-top={n <= 3 ? n : undefined}>
              <span className="hub-lb__rank" aria-hidden="true">
                {n}
              </span>
              <span className="hub-lb__who">
                <ShellLink to={to(row)} className="hub-lb__link" aria-label={`${n}. ${linkLabel(row)}`}>
                  {identity(row)}
                </ShellLink>
                {identitySub ? <span className="hub-lb__sub">{identitySub(row)}</span> : null}
              </span>
              <span className="hub-lb__cells">
                {columns.map((c) => (
                  <span
                    key={c.id}
                    className="hub-lb__cell"
                    data-col={c.id}
                    data-hide={c.hide}
                    data-align={c.align}
                  >
                    <span className="ui-sr-only">{c.header}: </span>
                    {c.cell(row)}
                  </span>
                ))}
              </span>
              {actions ? <span className="hub-lb__acts">{actions(row)}</span> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export interface LbBarProps {
  /** 0 to 1 against `max`. */
  value: number;
  max?: number;
  /** The figure beside the bar. */
  text: ReactNode;
}

/** A share bar with its figure, for a leaderboard cell. The figure is the reading; the bar is the comparison. */
export function LbBar({ value, max = 1, text }: LbBarProps) {
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <span className="hub-lbbar">
      <span className="hub-lbbar__text">{text}</span>
      <span className="hub-lbbar__track" aria-hidden="true">
        <i style={{ '--frac': frac } as CSSProperties} />
      </span>
    </span>
  );
}
