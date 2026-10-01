import type { CSSProperties, Ref } from 'react';
import { formatHeight } from '../../lib/format';
import { cx } from '../internal/cx';
import { EntityLink } from './EntityLink';
import { Unknown } from './Unknown';
import './identity.css';

export interface HeightProps {
  /** A block height. Null or undefined renders Unknown. */
  value: number | null | undefined;
  /** Link to the block (default true); turn off inside rows that are links themselves. */
  link?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Ref to the rendered element (the link, or the `<span>` when `link` is off). */
  ref?: Ref<HTMLElement>;
}

/** A block height with grouped digits in tabular Plex Mono (`2,996,929`), linked to its block. */
export function Height({ value, link = true, className, style, ref }: HeightProps) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <Unknown />;
  if (link) {
    return (
      <EntityLink
        kind="block"
        value={String(value)}
        className={className}
        style={style}
        ref={ref as Ref<HTMLAnchorElement>}
      />
    );
  }
  return (
    <span ref={ref as Ref<HTMLSpanElement>} className={cx('ui-height ui-mono', className)} style={style}>
      {formatHeight(value)}
    </span>
  );
}
