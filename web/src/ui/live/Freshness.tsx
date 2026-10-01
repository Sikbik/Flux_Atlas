import { type ComponentPropsWithRef, useCallback, useMemo, useSyncExternalStore } from 'react';
import { UNKNOWN } from '../../lib/format';
import { useKitClock } from '../internal/clock';
import { cx } from '../internal/cx';
import { flashPhase } from './flash';
import './Freshness.css';
import { useMotionMode } from '../internal/useMotion';
import {
  ageUnit,
  type FreshnessView,
  freshnessInlineText,
  freshnessTitle,
  parseViewKey,
  viewKey,
} from './freshness';
import { useChangeSeq } from './useChangeSeq';

/** Props of a Freshness: the options below plus every `<span>` attribute, including `ref`, `className` and `style`. */
export interface FreshnessProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
  /** Unix ms of the source's last update. `null` or `undefined` shows Unknown. */
  ts: number | null | undefined;
  /** The source's own cadence in ms (tip 4000, nodes and apps 90000, stats 420000). Fresh is under 1.5x it, aging to 3x, stale to 10x, then lost. */
  cadenceMs: number;
  /** The source's name in the chip: `nodes`, `tip`, `stats`. */
  label?: string;
  /** `chip` (default): a mono pill with a dot, `nodes 4 s`. `inline`: running text, `updated 3 s ago`. */
  variant?: 'chip' | 'inline';
}

/** Subscribes to the shared 1 Hz clock through a snapshot that changes only when the visible text can. */
function useFreshnessView(ts: number | null | undefined, cadenceMs: number): FreshnessView {
  const clock = useKitClock();
  const subscribe = useCallback((cb: () => void) => clock.subscribe(cb), [clock]);
  const get = () => viewKey(ts, clock.now(), cadenceMs);
  const key = useSyncExternalStore(subscribe, get, get);
  return useMemo(() => parseViewKey(key), [key]);
}

/**
 * How fresh a source is, judged against its own cadence and counting up on the shared clock. The
 * chip keeps a stable width as the age ticks (`9 s` to `10 s` does not move its neighbours),
 * seconds swap instantly and never roll, and a new update gives the dot a single soft ping. Bad
 * states carry a word, not just a colour: `stale` past 3x the cadence, `lost` past 10x. It is a
 * `status` landmark with live announcements off, so a ticking age is never read out. Hover for the
 * absolute UTC time. The root carries `data-variant` and `data-state` (`fresh`, `aging`, `stale`,
 * `dead` or `unknown`).
 */
export function Freshness({
  ts,
  cadenceMs,
  label,
  variant = 'chip',
  className,
  title: titleProp,
  ...rest
}: FreshnessProps) {
  const v = useFreshnessView(ts, cadenceMs);
  const mode = useMotionMode();
  const { seq } = useChangeSeq(ts ?? null);
  const title = titleProp ?? freshnessTitle(ts, v);

  if (variant === 'inline') {
    return (
      <span
        {...rest}
        role="status"
        aria-live="off"
        className={cx('ui-fresh', className)}
        data-variant="inline"
        data-state={v.state}
        title={title}
      >
        {freshnessInlineText(label, v)}
      </span>
    );
  }

  return (
    <span
      {...rest}
      role="status"
      aria-live="off"
      className={cx('ui-fresh', className)}
      data-variant="chip"
      data-state={v.state}
      title={title}
    >
      <span
        className="ui-fresh__dot"
        aria-hidden="true"
        data-ping={mode === 'full' ? flashPhase(seq) : undefined}
      />
      {/* The spaces between the parts are not drawn (flex items), but they keep the text readable as "tip 2 s". */}
      {label ? (
        <>
          <span className="ui-fresh__label">{label}</span>{' '}
        </>
      ) : null}
      <span className="ui-fresh__age" data-unit={ageUnit(v.age) ?? undefined}>
        {v.age ?? UNKNOWN}
      </span>
      {v.word ? (
        <>
          {' '}
          <span className="ui-fresh__word">{v.word}</span>
        </>
      ) : null}
    </span>
  );
}
