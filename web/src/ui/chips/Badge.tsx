import type { ComponentPropsWithoutRef } from 'react';
import { cx } from '../internal/cx';
import type { StatusTone } from '../internal/status';
import './Chip.css';

export interface BadgeProps extends ComponentPropsWithoutRef<'span'> {
  /** A status role (soft fill, 40% border) or `accent` / `neutral`. */
  tone?: StatusTone | 'accent' | 'neutral';
}

/** The caps badge: Montserrat 10.5 px, tracked. The only ALL CAPS in the product; for status words only. */
export function Badge({ tone = 'neutral', className, ...rest }: BadgeProps) {
  const status = tone !== 'accent' && tone !== 'neutral';
  return (
    <span
      className={cx('ui-chip', className)}
      data-variant="badge"
      data-tone={status ? undefined : tone}
      data-status={status ? tone : undefined}
      {...rest}
    />
  );
}
