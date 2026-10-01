import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Unknown } from '../identity/Unknown';
import { cx } from '../internal/cx';
import { formatDelta } from './delta';
import './Delta.css';

export interface DeltaProps {
  /** The change since the period began (already a delta, not a level). Null or undefined renders Unknown. */
  value: number | null | undefined;
  /** `count` formats an integer change (default); `percent` takes a value already in percent units (`1.95` is `+1.95%`). */
  kind?: 'count' | 'percent';
  /** Fraction digits (default 0 for counts, 2 for percentages). */
  decimals?: number;
  /** The period the change is measured over, in words: "today", "24 h", "vs last week". Always name it. */
  period?: ReactNode;
  className?: string;
}

/** A signed change: an arrow, a plus or minus, and blue (up) or coral (down) in Plex Mono; flat is gray. */
export function Delta({ value, kind, decimals, period, className }: DeltaProps) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <Unknown />;
  const { text, direction } = formatDelta(value, { kind, decimals });
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;
  return (
    <span className={cx('ui-delta ui-mono', className)} data-dir={direction}>
      <Icon className="ui-delta__icon" size={12} strokeWidth={1.75} aria-hidden="true" />
      <span className="ui-sr-only">
        {direction === 'up' ? 'Up' : direction === 'down' ? 'Down' : 'No change'}
      </span>
      <span className="ui-delta__value">{text}</span>
      {period ? <span className="ui-delta__period">{period}</span> : null}
    </span>
  );
}
