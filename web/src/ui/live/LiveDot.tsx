import type { CSSProperties } from 'react';
import { cx } from '../internal/cx';
import type { StatusTone } from '../internal/status';
import './LiveDot.css';

export interface LiveDotProps {
  /** Status colour: `ok` (default, green), `pending`, `warn`, `crit` or `off`. */
  status?: StatusTone;
  /** Draw the slow ping ring (default true for `ok`, false otherwise). Steady under reduced motion. */
  ping?: boolean;
  /** Diameter in px (default 7). */
  size?: number;
  className?: string;
}

/** A small status dot; the green one pings every 2.4 s while the live stream is healthy (design 8.10). */
export function LiveDot({ status = 'ok', ping, size, className }: LiveDotProps) {
  const pinging = ping ?? status === 'ok';
  return (
    <span
      aria-hidden="true"
      className={cx('ui-livedot', className)}
      data-status={status}
      data-ping={pinging || undefined}
      style={size ? ({ '--ui-dot': `${size}px` } as CSSProperties) : undefined}
    />
  );
}
