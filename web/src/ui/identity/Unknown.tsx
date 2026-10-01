import type { ReactNode } from 'react';
import { UNKNOWN } from '../../lib/format';
import { cx } from '../internal/cx';
import '../base.css';

export interface UnknownProps {
  /** Replaces the word "Unknown" (for example "Not reported"). Keep it a word, never a zero or a dash. */
  children?: ReactNode;
  className?: string;
}

/** The one rendering of "no value": the word Unknown in muted text. Honest data: never 0, never blank. */
export function Unknown({ children = UNKNOWN, className }: UnknownProps) {
  return <span className={cx('ui-unknown', className)}>{children}</span>;
}

/** True when a value should render as Unknown: null, undefined, an empty string or NaN. */
export function isUnknownValue(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));
}
