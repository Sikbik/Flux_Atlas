import type { ComponentPropsWithRef, CSSProperties } from 'react';
import { cx } from '../internal/cx';
import type { StatusTone } from '../internal/status';
import './LiveDot.css';

/** Props of a LiveDot: the options below plus every `<span>` attribute, including `ref`, `className` and `style`. */
export interface LiveDotProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
  /** Status colour: `ok` (default, green), `pending`, `warn`, `crit` or `off`. */
  status?: StatusTone;
  /** Draw the slow ping ring (default true for `ok`, false otherwise). Steady under reduced motion. */
  ping?: boolean;
  /** Diameter in px (default 7). */
  size?: number;
}

/**
 * A small status dot; the green one pings every 2.4 s while the live stream is healthy (design 8.10).
 * It is decorative (`aria-hidden`) unless the caller overrides it; the root carries `data-status` and
 * `data-ping`.
 */
export function LiveDot({ status = 'ok', ping, size, className, style, ...rest }: LiveDotProps) {
  const pinging = ping ?? status === 'ok';
  return (
    <span
      aria-hidden="true"
      {...rest}
      className={cx('ui-livedot', className)}
      data-status={status}
      data-ping={pinging || undefined}
      style={size ? ({ ...style, '--ui-dot': `${size}px` } as CSSProperties) : style}
    />
  );
}
