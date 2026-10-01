// Tabs, a windowed list and a freshness chip.

import type { LucideIcon } from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useRuntime } from '../../../app/context';
import { freshness } from '../../../lib/clock';
import { formatAge } from '../../../lib/format';
import { useNow } from '../../../lib/useClock';
import { cx } from './basics';

// ---- tabs ---------------------------------------------------------------------------------------

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: LucideIcon;
  badge?: number | string;
  disabled?: boolean;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
  id,
}: {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
  id?: string;
}) {
  const auto = useId();
  const base = id ?? auto;
  const list = useRef<HTMLDivElement>(null);
  const ink = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const place = useCallback(() => {
    const l = list.current;
    const i = ink.current;
    if (!l || !i) return;
    const tab = l.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!tab) return;
    if (!placed.current) {
      i.style.transition = 'none';
    }
    i.style.setProperty('--x', `${tab.offsetLeft + 8}px`);
    i.style.setProperty('--sx', String(Math.max(0, tab.offsetWidth - 16) / 100));
    if (!placed.current) {
      void i.offsetWidth;
      i.style.transition = '';
      placed.current = true;
    }
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure the ink when the selection or the tab set changes
  useLayoutEffect(place, [place, value, items]);
  useEffect(() => {
    const l = list.current;
    if (!l) return;
    const ro = new ResizeObserver(place);
    ro.observe(l);
    return () => ro.disconnect();
  }, [place]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = items.filter((t) => !t.disabled);
    const at = enabled.findIndex((t) => t.id === value);
    let next = at;
    if (e.key === 'ArrowRight') next = (at + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') next = (at - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    else return;
    e.preventDefault();
    const t = enabled[next];
    if (t) {
      onChange(t.id);
      requestAnimationFrame(() =>
        list.current?.querySelector<HTMLElement>(`#${CSS.escape(`${base}-tab-${t.id}`)}`)?.focus(),
      );
    }
  };
  return (
    <div
      ref={list}
      className={cx('ex-tabs', className)}
      role="tablist"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKey}
    >
      {items.map((t) => {
        const Icon = t.icon;
        const sel = t.id === value;
        return (
          <button
            key={t.id}
            id={`${base}-tab-${t.id}`}
            type="button"
            role="tab"
            className="ex-tab"
            aria-selected={sel}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={sel ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.id)}
          >
            {Icon ? <Icon size={14} strokeWidth={1.5} aria-hidden="true" /> : null}
            {t.label}
            {t.badge !== undefined ? <span className="ex-tab__badge">{t.badge}</span> : null}
          </button>
        );
      })}
      <span ref={ink} className="ex-tabs__ink" aria-hidden="true" />
    </div>
  );
}

export function TabPanel({
  tabsId,
  id,
  children,
  className,
}: {
  tabsId: string;
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      id={`${tabsId}-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`${tabsId}-tab-${id}`}
      tabIndex={-1}
      className={cx('ex-panel', className)}
    >
      {children}
    </div>
  );
}

// ---- segmented choice ---------------------------------------------------------------------------

export interface SegmentedItem<T extends string = string> {
  id: T;
  label: string;
  hint?: string;
}

/**
 * One choice from a few, for switching what a chart shows. Real radio inputs underneath, so arrow
 * keys, focus and the screen reader's "1 of 2" come from the platform.
 */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: readonly SegmentedItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={cx('ex-seg', className)}>
      <legend className="ex-sr">{label}</legend>
      {items.map((it) => (
        <label key={it.id} className="ex-seg__opt" data-on={it.id === value || undefined} title={it.hint}>
          <input
            type="radio"
            name={name}
            value={it.id}
            checked={it.id === value}
            onChange={() => onChange(it.id)}
          />
          <span>{it.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

// ---- windowed list ------------------------------------------------------------------------------

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let p = el?.parentElement ?? null;
  while (p) {
    const o = getComputedStyle(p).overflowY;
    if (o === 'auto' || o === 'scroll') return p;
    p = p.parentElement;
  }
  return null;
}

/**
 * Renders only the rows near the viewport of the nearest scrolling ancestor (the window body), so a
 * 1,000-row list costs the same as a 20-row one. Rows have a fixed height.
 */
export function Windowed({
  count,
  rowHeight,
  overscan = 6,
  renderRow,
  label,
  className,
  onNearEnd,
  rowKey,
}: {
  count: number;
  rowHeight: number;
  overscan?: number;
  renderRow: (i: number) => ReactNode;
  label: string;
  className?: string;
  /** Called when the visible window reaches the last rows (load the next page). */
  onNearEnd?: () => void;
  /** Stable keys let rows glide to their new place when items are inserted above them. */
  rowKey?: (i: number) => string;
}) {
  const ref: RefObject<HTMLDivElement | null> = useRef(null);
  const [range, setRange] = useState<[number, number]>([0, Math.min(count, 24)]);
  const nearEnd = useRef(onNearEnd);
  nearEnd.current = onNearEnd;
  useEffect(() => {
    if (nearEnd.current && count > 0 && range[1] >= count - 3) nearEnd.current();
  }, [range, count]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sp = scrollParent(el);
    let raf = 0;
    const compute = () => {
      raf = 0;
      const top = el.getBoundingClientRect().top;
      const view = sp ? sp.getBoundingClientRect() : { top: 0, height: window.innerHeight };
      const rel = view.top - top;
      const start = Math.max(0, Math.floor(rel / rowHeight) - overscan);
      const end = Math.min(count, Math.ceil((rel + view.height) / rowHeight) + overscan);
      setRange((r) => (r[0] === start && r[1] === end ? r : [start, end]));
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    compute();
    (sp ?? window).addEventListener('scroll', queue, { passive: true });
    const ro = new ResizeObserver(queue);
    ro.observe(sp ?? document.documentElement);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      (sp ?? window).removeEventListener('scroll', queue);
      ro.disconnect();
    };
  }, [count, rowHeight, overscan]);
  const rows: ReactNode[] = [];
  for (let i = range[0]; i < Math.min(range[1], count); i++) {
    rows.push(
      // biome-ignore lint/a11y/useSemanticElements: a virtualized list cannot use <li>
      <div
        key={rowKey ? rowKey(i) : i}
        role="listitem"
        aria-posinset={i + 1}
        aria-setsize={count}
        className="ex-win__row"
        style={{ height: rowHeight, transform: `translateY(${i * rowHeight}px)` }}
      >
        {renderRow(i)}
      </div>,
    );
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: a virtualized list cannot use <ul>
    <div
      ref={ref}
      role="list"
      aria-label={label}
      className={cx('ex-win', className)}
      style={{ height: count * rowHeight }}
    >
      {rows}
    </div>
  );
}

// ---- freshness ----------------------------------------------------------------------------------

/** "supply 9 min": a dot (fresh, aging, stale) and the age of the data, on the shared clock. */
export function Freshness({
  label,
  at,
  cadenceMs,
}: {
  label: string;
  at: number | null | undefined;
  cadenceMs: number;
}) {
  const { clock } = useRuntime();
  const now = useNow(clock);
  if (at === null || at === undefined) return null;
  const age = Math.max(0, now - at);
  const f = freshness(age, cadenceMs);
  const status = f === 'fresh' ? 'ok' : f === 'aging' ? 'pending' : f === 'stale' ? 'warn' : 'crit';
  return (
    <span className="ex-fresh" data-status={status} title={`${label} updated ${formatAge(age)} ago`}>
      <i aria-hidden="true" />
      <span>
        {label} <span className="ex-fresh__age">{formatAge(age)}</span>
      </span>
    </span>
  );
}
