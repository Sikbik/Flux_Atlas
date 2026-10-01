import { ChevronDown, type LucideIcon } from 'lucide-react';
import {
  type ComponentPropsWithRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { formatHeight, formatUtcDateTime, UNKNOWN } from '../../lib/format';
import '../base.css';
import { useKitClock } from '../internal/clock';
import { cx } from '../internal/cx';
import { pressHandlers } from '../internal/press';
import { useMotionMode } from '../internal/useMotion';
import { AnimatedNumber } from '../live/AnimatedNumber';
import './Timeline.css';
import { isGroup, isoTime, relativeLabel, splitDateTime, type TimelineTone, threadStops } from './timeline';

export interface TimelineItem {
  /** Stable key for the row. */
  id: string | number;
  /** Unix ms (shown per `timeMode`; a time in the future reads as an ETA) or a ready label such as `Block 2,996,914`. */
  time: number | string;
  /** What happened, as inline content. In an expandable item it sits inside the disclosure button: put links in `meta`, not here. */
  title: ReactNode;
  /** A second line under the title: amounts, who, why. Links are fine here. */
  meta?: ReactNode;
  /** Marker icon (a lucide icon component). An item with an icon gets a 22 px marker, one without a 12 px dot. */
  icon?: LucideIcon;
  /** Marker colour: a status role, `accent` (default), `hot` (white, for attention) or `neutral` (quiet, for repeats). */
  tone?: TimelineTone;
  /** Block height of the event, shown in mono before the meta. */
  block?: number;
  /** Detail shown when the item is expanded (a DiffBlock, a list of renewals). Makes the item a disclosure button. */
  children?: ReactNode;
  /** A grouped run: the title is the verb and the count follows, "Renewed 9 times". The count ticks live. */
  count?: number;
  /** A projected event that has not happened yet: a hollow marker and a dashed thread. */
  upcoming?: boolean;
  /** Start expanded. */
  defaultOpen?: boolean;
}

/** Props of a Timeline: the options below plus every `<div>` attribute (on the root), including `ref`, `className` and `style`. */
export interface TimelineProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** The events, in the order to show them (a history is newest first). */
  items: readonly TimelineItem[];
  /** `relative` (default) counts live on the shared clock (`12 s ago`); `absolute` shows the UTC date and time. */
  timeMode?: 'relative' | 'absolute';
  /** Items inserted after the first render expand in over 280 ms and glow for 1.6 s. Key the Timeline by its entity so a new entity's history does not animate in as events. */
  live?: boolean;
  /** Accessible name of the list. */
  label?: string;
  /** Shown instead of the list when there are no items. */
  empty?: ReactNode;
}

function RelativeTime({ ts }: { ts: number }) {
  const clock = useKitClock();
  const subscribe = useCallback((cb: () => void) => clock.subscribe(cb), [clock]);
  const get = () => relativeLabel(ts, clock.now());
  const text = useSyncExternalStore(subscribe, get, get);
  return (
    <time dateTime={isoTime(ts)} title={formatUtcDateTime(ts)}>
      {text}
    </time>
  );
}

function AbsoluteTime({ ts }: { ts: number }) {
  const { date, time } = splitDateTime(ts);
  return (
    <time dateTime={isoTime(ts)} title={formatUtcDateTime(ts)} className="ui-tl__abs">
      <span>{date}</span> <span>{time}</span>
    </time>
  );
}

function TimeCell({ time, mode }: { time: number | string; mode: 'relative' | 'absolute' }) {
  if (typeof time === 'string') return <span className="ui-tl__label">{time}</span>;
  if (!Number.isFinite(time)) return <span className="ui-unknown">{UNKNOWN}</span>;
  return mode === 'relative' ? <RelativeTime ts={time} /> : <AbsoluteTime ts={time} />;
}

function Title({ item }: { item: TimelineItem }) {
  return (
    <>
      <span className="ui-tl__title">{item.title}</span>
      {isGroup(item.count) ? (
        <span className="ui-tl__count">
          <AnimatedNumber value={item.count} font="mono" /> times
        </span>
      ) : null}
    </>
  );
}

interface RowProps {
  item: TimelineItem;
  index: number;
  total: number;
  timeMode: 'relative' | 'absolute';
  /** True when rows mounted now count as insertions (live, and the first batch is already on screen). */
  insertion: RefObject<boolean>;
  animate: boolean;
}

function Row({ item, index, total, timeMode, insertion, animate }: RowProps) {
  const detailId = useId();
  const expandable = item.children !== undefined && item.children !== null && item.children !== false;
  const [open, setOpen] = useState(item.defaultOpen === true);
  // Decided once, when the row mounts: rows that were part of the first render never animate in.
  const [entering] = useState(() => animate && insertion.current);
  const Icon = item.icon;
  const stops = threadStops(index, total);
  const style = { '--ui-tl-a': `${stops.from}%`, '--ui-tl-b': `${stops.to}%` } as CSSProperties;
  const hasMeta = item.block !== undefined || (item.meta !== undefined && item.meta !== null);

  return (
    <li
      className="ui-tl__item"
      data-tone={item.tone ?? 'accent'}
      data-enter={entering || undefined}
      data-upcoming={item.upcoming || undefined}
      data-state={expandable ? (open ? 'open' : 'closed') : undefined}
      data-last={index === total - 1 || undefined}
      style={style}
    >
      <div className="ui-tl__time">
        <TimeCell time={item.time} mode={timeMode} />
      </div>
      <div className="ui-tl__rail" aria-hidden="true">
        <span className="ui-tl__marker" data-icon={Icon ? '' : undefined}>
          {Icon ? <Icon size={12} strokeWidth={1.5} /> : null}
        </span>
      </div>
      <div className="ui-tl__body">
        {expandable ? (
          <button
            type="button"
            className="ui-tl__head"
            data-expandable=""
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen((o) => !o)}
            {...pressHandlers<HTMLButtonElement>()}
          >
            <Title item={item} />
            <ChevronDown className="ui-tl__chevron" size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        ) : (
          <div className="ui-tl__head">
            <Title item={item} />
          </div>
        )}
        {hasMeta ? (
          <div className="ui-tl__meta">
            {item.block !== undefined ? (
              <span className="ui-tl__block">Block {formatHeight(item.block)}</span>
            ) : null}
            {item.meta !== undefined && item.meta !== null ? (
              <span className="ui-tl__meta-text">{item.meta}</span>
            ) : null}
          </div>
        ) : null}
        {expandable ? (
          <div id={detailId} className="ui-tl__detail" inert={!open}>
            <div className="ui-tl__clip">
              <div className="ui-tl__detail-body">{item.children}</div>
            </div>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * A vertical thread of events with a time gutter, for lifecycles, spec histories and event logs.
 * The thread runs from Flux blue at the newest item to graphite at the oldest; markers take the
 * colour of their tone. Items with `children` are disclosure buttons; a grouped run reads "Renewed 9
 * times". With `live`, items inserted after the first render grow in over 280 ms and wash with their
 * tone for 1.6 s (a 120 ms fade and a steady 1 s wash under reduced motion, nothing when motion is
 * off). In a narrow window (under 360 px wide) the gutter moves above each title. Relative times
 * count on the shared clock and re-render only when their text changes.
 *
 * Data attributes: the root has `data-mode` (the motion mode), `data-live`, `data-time`
 * (`relative` or `absolute`) and `data-state="empty"` when there are no items (`empty` shows in
 * the root then); a row has `data-tone`, `data-last`, `data-upcoming`, `data-enter`
 * (while it is an insertion) and, when it expands, `data-state` (`open` or `closed`); the disclosure
 * button shows `data-pressed` while held.
 */
export function Timeline({
  items,
  timeMode = 'relative',
  live = false,
  label,
  empty,
  className,
  ...rest
}: TimelineProps) {
  const motion = useMotionMode();
  // Rows mounted after the first non-empty render are insertions; the first batch is not.
  const insertion = useRef(false);
  const count = items.length;
  useEffect(() => {
    insertion.current = count > 0;
  }, [count]);

  return (
    <div
      {...rest}
      className={cx('ui-tl', className)}
      data-mode={motion}
      data-live={live || undefined}
      data-time={timeMode}
      data-state={count === 0 ? 'empty' : undefined}
    >
      {count === 0 ? (
        empty
      ) : (
        // An explicit list role keeps the semantics in Safari, which drops them when list-style is none.
        // biome-ignore lint/a11y/noRedundantRoles: see above
        <ol className="ui-tl__list" role="list" aria-label={label}>
          {items.map((item, i) => (
            <Row
              key={item.id}
              item={item}
              index={i}
              total={count}
              timeMode={timeMode}
              insertion={insertion}
              animate={live && motion !== 'off'}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
