import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { cx } from './cx';

/**
 * A fixed-row-height list that renders only the rows in view (plus a margin), for any list that can
 * pass 200 rows. Rows are absolutely positioned with `transform`, so scrolling never reflows; the
 * list is a `list` with positions announced to assistive technology.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  height,
  overscan = 6,
  renderRow,
  keyOf,
  className,
  label,
  scrollTo,
}: {
  items: readonly T[];
  rowHeight: number;
  /** Visible height in px. */
  height: number;
  overscan?: number;
  renderRow: (item: T, index: number) => ReactNode;
  keyOf: (item: T, index: number) => string | number;
  className?: string;
  label: string;
  /** Scrolls this index into view when it changes. */
  scrollTo?: number | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const raf = useRef(0);

  const onScroll = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      setTop(ref.current?.scrollTop ?? 0);
    });
  }, []);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  useEffect(() => {
    if (scrollTo === null || scrollTo === undefined || scrollTo < 0) return;
    const el = ref.current;
    if (!el) return;
    const y = scrollTo * rowHeight;
    if (y < el.scrollTop || y + rowHeight > el.scrollTop + height) {
      el.scrollTop = Math.max(0, y - height / 2 + rowHeight / 2);
      setTop(el.scrollTop);
    }
  }, [scrollTo, rowHeight, height]);

  const total = items.length * rowHeight;
  const first = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const last = Math.min(items.length, Math.ceil((top + height) / rowHeight) + overscan);
  const rows: ReactNode[] = [];
  for (let i = first; i < last; i++) {
    const item = items[i] as T;
    rows.push(
      <li
        key={keyOf(item, i)}
        className="ix-vl-row"
        aria-posinset={i + 1}
        aria-setsize={items.length}
        style={{ height: rowHeight, transform: `translateY(${i * rowHeight}px)` }}
      >
        {renderRow(item, i)}
      </li>,
    );
  }
  return (
    <div ref={ref} className={cx('ix-vl', className)} style={{ height }} onScroll={onScroll}>
      <ul className="ix-vl-spacer" style={{ height: total }} aria-label={label}>
        {rows}
      </ul>
    </div>
  );
}
