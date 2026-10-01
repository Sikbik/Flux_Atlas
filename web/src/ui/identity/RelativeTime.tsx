import type { ComponentPropsWithRef } from 'react';
import { useAgo } from '../../lib/useClock';
import { useKitClock } from '../internal/clock';
import { cx } from '../internal/cx';
import { formatUtcStamp, isoOrUndefined } from './time';
import { Unknown } from './Unknown';
import './identity.css';

/** Props of a RelativeTime: the options below, plus `className`, `style`, `ref` and the other `<time>` attributes. */
export interface RelativeTimeProps extends Omit<ComponentPropsWithRef<'time'>, 'children' | 'dateTime'> {
  /** The moment, in unix milliseconds (`time_ms` fields). Null or undefined renders Unknown. */
  ts: number | null | undefined;
  /** Drop the word "ago": `12 s` instead of `12 s ago`. */
  ageOnly?: boolean;
}

/**
 * A live "12 s ago" on the shared 1 Hz event clock (no timer of its own). It re-renders only when
 * its text changes (once a minute past one minute) and the full UTC time is in its title.
 */
export function RelativeTime({ ts, ageOnly, className, ...rest }: RelativeTimeProps) {
  const clock = useKitClock();
  const label = useAgo(clock, ts, !ageOnly);
  if (label === null) return <Unknown />;
  return (
    <time
      className={cx('ui-reltime ui-mono', className)}
      dateTime={isoOrUndefined(ts)}
      title={formatUtcStamp(ts)}
      {...rest}
    >
      {label}
    </time>
  );
}
