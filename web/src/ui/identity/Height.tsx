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
}

/** A block height with grouped digits in tabular Plex Mono (`2,996,929`), linked to its block. */
export function Height({ value, link = true, className }: HeightProps) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <Unknown />;
  if (link) return <EntityLink kind="block" value={String(value)} className={className} />;
  return <span className={cx('ui-height ui-mono', className)}>{formatHeight(value)}</span>;
}
