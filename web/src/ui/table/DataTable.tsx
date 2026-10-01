// biome-ignore-all lint/a11y/useSemanticElements: a div grid (role="grid") is required so windowing, a sticky first column and a sticky header can work together; a real <table> cannot do all three
// biome-ignore-all lint/a11y/useFocusableInteractive: rows and cells are not focusable on purpose; the grid is the single tab stop and exposes the active row through aria-activedescendant
// DataTable: the kit's one table (design 8.12). A div grid (role="grid") rather than a <table>, so
// that windowing, a sticky first column and a sticky header work together. Rows are memoised by row
// identity, so a live update of one row re-renders one row; above 200 rows only the visible rows
// exist in the DOM. One tab stop, a roving active row (aria-activedescendant), Enter activates.

import { useRouter } from '@tanstack/react-router';
import { ArrowUp } from 'lucide-react';
import {
  type CSSProperties,
  memo,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import '../base.css';
import { type EntityRef, entityHref, entityRoute } from '../identity/entityRoute';
import { cx } from '../internal/cx';
import { useMotionMode } from '../internal/useMotion';
import { EmptyState } from '../states/EmptyState';
import { Skeleton } from '../states/Skeleton';
import { renderCellValue } from './cellValue';
import { gridTemplate, minTableWidth, resolveRowHeight } from './layout';
import { prependedCount } from './liveList';
import { navigateRow } from './navigation';
import { ariaSort, defaultDir, nextSort, type SortState, sortRows, toSortValue } from './sorting';
import type { DataTableColumn, DataTableProps, RowActivateEvent } from './types';
import { useCoarsePointer } from './useCoarsePointer';
import { computeWindow, rowsPerPage, scrollTopToReveal } from './windowing';
import './DataTable.css';

/** Rows above which `virtualize="auto"` windows the list. */
export const VIRTUALIZE_THRESHOLD = 200;
/** Viewport height assumed before the first measurement (and where nothing can be measured). */
const FALLBACK_VIEWPORT = 600;
/** Rows below this index get an entry stagger step (`--stagger`, capped at `--stagger-max`). */
const STAGGER_ROWS = 8;
/** How long the entry stagger stays armed after mount or after skeleton rows resolve, ms. */
const ENTER_MS = 900;

const INTERACTIVE =
  'a[href],button,input,select,textarea,label,summary,[role="button"],[role="link"],[role="checkbox"],[role="switch"],[role="menuitem"],[role="tab"],[contenteditable="true"]';

const alignOf = (c: DataTableColumn<never>) => c.align ?? (c.numeric ? 'end' : 'start');
const isSticky = (c: { sticky?: boolean }, index: number) => index === 0 && c.sticky !== false;
const px = (v: number | string | undefined): string | undefined =>
  v === undefined ? undefined : typeof v === 'number' ? `${v}px` : v;

function readField(row: unknown, id: string): unknown {
  return typeof row === 'object' && row !== null ? (row as Record<string, unknown>)[id] : undefined;
}

// ------------------------------------------------------------------------------------------------
// Rows
// ------------------------------------------------------------------------------------------------

interface RowProps<Row> {
  row: Row;
  columns: readonly DataTableColumn<Row>[];
  /** Position in the displayed order. */
  index: number;
  domId: string;
  selected: boolean;
  active: boolean;
  fresh: boolean;
  striped: boolean;
  linkable: boolean;
  sortId: string | null;
}

function DataRowImpl<Row>({
  row,
  columns,
  index,
  domId,
  selected,
  active,
  fresh,
  striped,
  linkable,
  sortId,
}: RowProps<Row>) {
  const ctx = { index, selected };
  return (
    <div
      id={domId}
      role="row"
      className="ui-table__row"
      aria-rowindex={index + 2}
      aria-selected={selected || undefined}
      data-index={index}
      data-selected={selected || undefined}
      data-active={active || undefined}
      data-fresh={fresh || undefined}
      data-striped={striped || undefined}
      data-link={linkable || undefined}
      style={index < STAGGER_ROWS ? ({ '--ui-i': index } as CSSProperties) : undefined}
    >
      {columns.map((c, ci) => {
        const node = c.cell
          ? c.cell(row, ctx)
          : renderCellValue(c.value ? c.value(row) : readField(row, c.id));
        return (
          <div
            key={c.id}
            role="gridcell"
            aria-colindex={ci + 1}
            className={cx('ui-table__cell', c.className)}
            data-col={c.id}
            data-align={alignOf(c as DataTableColumn<never>)}
            data-mono={c.mono || c.numeric || undefined}
            data-numeric={c.numeric || undefined}
            data-sorted={sortId === c.id || undefined}
            data-sticky={isSticky(c, ci) || undefined}
            data-primary={ci === 0 || undefined}
          >
            <span className="ui-table__content" title={typeof node === 'string' ? node : undefined}>
              {node ?? <span className="ui-unknown">Unknown</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const DataRow = memo(DataRowImpl) as typeof DataRowImpl;

/** Skeleton rows with exactly the geometry of loaded rows: same grid, same height, same stickiness. */
function SkeletonRows<Row>({ columns, count }: { columns: readonly DataTableColumn<Row>[]; count: number }) {
  return (
    <div className="ui-table__skeleton" aria-hidden="true">
      {Array.from({ length: count }, (_, r) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows never reorder
        <div key={r} className="ui-table__row" data-skeleton="" data-striped={r % 2 === 1 || undefined}>
          {columns.map((c, ci) => (
            <div
              key={c.id}
              className="ui-table__cell"
              data-align={alignOf(c as DataTableColumn<never>)}
              data-sticky={isSticky(c, ci) || undefined}
            >
              <Skeleton
                h={10}
                w={`${(c.numeric ? 34 : 46) + ((r * 37 + ci * 53) % (c.numeric ? 22 : 40))}%`}
                radius={5}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// The table
// ------------------------------------------------------------------------------------------------

interface Size {
  /** Scroller client height, px. */
  h: number;
  /** Scroller client width, px. */
  w: number;
  /** Header height, px. */
  headH: number;
}

/**
 * The kit's data table: typed columns, sorting, windowing above 200 rows, keyboard navigation and row
 * links. Give it stable row keys and stable row objects, and define `columns` once.
 */
export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  'aria-label': ariaLabel,
  sort: sortProp,
  defaultSort,
  onSortChange,
  manualSort,
  onRowClick,
  rowLink,
  selectedKey,
  highlightKeys,
  rowHeight,
  height,
  maxHeight,
  fill,
  loading,
  skeletonRows = 8,
  empty,
  stickyHeader = true,
  zebra = true,
  virtualize = 'auto',
  overscan = 8,
  footer,
  className,
}: DataTableProps<Row>) {
  const uid = useId();
  const router = useRouter({ warn: false }) as ReturnType<typeof useRouter> | undefined;
  const coarse = useCoarsePointer();
  const motion = useMotionMode();
  const interactive = Boolean(onRowClick || rowLink);
  const rowH = resolveRowHeight(rowHeight, coarse && interactive);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const shifterRef = useRef<HTMLDivElement>(null);

  // --- sorting -----------------------------------------------------------------------------------
  const [innerSort, setInnerSort] = useState<SortState | null>(defaultSort ?? null);
  const sort = sortProp !== undefined ? sortProp : innerSort;

  const displayed = useMemo(() => {
    if (!sort || manualSort) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col) return rows;
    const key = col.sortValue ?? ((r: Row) => toSortValue(col.value ? col.value(r) : readField(r, col.id)));
    return sortRows(rows, key, sort.dir);
  }, [rows, columns, sort, manualSort]);

  const count = displayed.length;
  const virtual = virtualize === 'auto' ? count > VIRTUALIZE_THRESHOLD : virtualize;
  const bounded = height !== undefined || maxHeight !== undefined || Boolean(fill);
  const scrolls = virtual || bounded;

  // --- keys, active row ----------------------------------------------------------------------------
  const keyOf = useCallback((row: Row) => String(rowKey(row)), [rowKey]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const indexCache = useRef(-1);
  const indexOfKey = (k: string | null | undefined): number => {
    if (k === null || k === undefined || count === 0) return -1;
    const c = indexCache.current;
    if (c >= 0 && c < count && keyOf(displayed[c]!) === k) return c;
    for (let i = 0; i < count; i++) {
      if (keyOf(displayed[i]!) === k) {
        indexCache.current = i;
        return i;
      }
    }
    return -1;
  };
  const domIdOf = (k: string) => `${uid}-${k.replace(/\s+/g, '_')}`;
  const activeIndex = indexOfKey(activeKey);
  const selectedKeyStr = selectedKey === undefined || selectedKey === null ? null : String(selectedKey);

  // --- measurement -------------------------------------------------------------------------------
  const [size, setSize] = useState<Size>({ h: 0, w: 0, headH: 0 });
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => {
      const next = { h: el.clientHeight, w: el.clientWidth, headH: headerRef.current?.offsetHeight ?? 0 };
      setSize((p) => (p.h === next.h && p.w === next.w && p.headH === next.headH ? p : next));
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (headerRef.current) ro.observe(headerRef.current);
    return () => ro.disconnect();
  }, []);

  const minW = minTableWidth(columns);
  const hscroll = !scrolls && size.w > 0 && size.w < minW;
  const viewportRows = Math.max(rowH, (scrolls && size.h > 0 ? size.h : FALLBACK_VIEWPORT) - size.headH);

  // --- windowing ---------------------------------------------------------------------------------
  const [firstRow, setFirstRow] = useState(0);
  const firstRowRef = useRef(0);
  firstRowRef.current = firstRow;

  useEffect(() => {
    const el = scrollerRef.current;
    const root = rootRef.current;
    if (!el || !root) return;
    let raf = 0;
    const run = () => {
      raf = 0;
      root.toggleAttribute('data-scrolled-x', el.scrollLeft > 0);
      root.toggleAttribute('data-scrolled-y', el.scrollTop > 0);
      if (!virtual) return;
      const first = Math.floor(el.scrollTop / rowH);
      // Commit before paint so a fast scroll never shows an unrendered gap.
      if (first !== firstRowRef.current) flushSync(() => setFirstRow(first));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(run);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [virtual, rowH]);

  const win = virtual
    ? computeWindow({
        scrollTop: firstRow * rowH,
        // One extra row: `firstRow` is the floored scroll offset, so the last visible row may be one later.
        viewportHeight: viewportRows + rowH,
        rowHeight: rowH,
        rowCount: count,
        overscan: Math.max(2, overscan),
      })
    : { start: 0, end: count, offsetTop: 0, totalHeight: count * rowH };

  // --- live inserts: keep a scrolled list still, slide a top-of-list insert in ----------------------
  const prev = useRef<{ first: string | null; sig: string }>({ first: null, sig: '' });
  const latest = useRef({ displayed, keyOf, virtual, rowH });
  latest.current = { displayed, keyOf, virtual, rowH };
  const sortSig = sort && !manualSort ? `${sort.id}:${sort.dir}` : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: reads the latest props through a ref on purpose; it runs when the displayed rows change
  useLayoutEffect(() => {
    const { displayed: list, keyOf: kf, virtual: v, rowH: h } = latest.current;
    const first = list.length > 0 ? kf(list[0]!) : null;
    const before = prev.current;
    prev.current = { first, sig: sortSig };
    if (before.first === null || before.sig !== sortSig || first === before.first) return;
    const k = prependedCount(before.first, list.length, (i) => kf(list[i]!));
    if (k <= 0) return;
    const el = scrollerRef.current;
    if (v && el && el.scrollTop > h) {
      el.scrollTop += k * h; // the scroll event re-windows
      return;
    }
    const shifter = shifterRef.current;
    if (shifter && k <= 8) {
      shifter.style.setProperty('--ui-shift', `${-k * h}px`);
      shifter.removeAttribute('data-shift');
      void shifter.offsetWidth; // restart the animation
      shifter.setAttribute('data-shift', '');
    }
  }, [displayed, sortSig]);

  // --- entry and skeleton hand-over ---------------------------------------------------------------
  const showSkeleton = Boolean(loading) && count === 0;
  const showEmpty = !loading && count === 0;
  const [entering, setEntering] = useState(count > 0);
  const [ghost, setGhost] = useState(false);
  const [wasSkeleton, setWasSkeleton] = useState(showSkeleton);
  if (wasSkeleton !== showSkeleton) {
    setWasSkeleton(showSkeleton);
    if (wasSkeleton && count > 0) {
      setGhost(motion !== 'off');
      setEntering(true);
    }
  }
  useEffect(() => {
    if (!entering) return;
    const id = setTimeout(() => setEntering(false), ENTER_MS);
    return () => clearTimeout(id);
  }, [entering]);

  // --- activation --------------------------------------------------------------------------------
  const go = (link: EntityRef, e: RowActivateEvent) => {
    if ('button' in e && (e.ctrlKey || e.metaKey)) {
      window.open(entityHref(link.kind, link.value), '_blank', 'noopener');
      return;
    }
    if (router) void router.navigate(entityRoute(link.kind, link.value));
  };
  const activate = (row: Row, e: RowActivateEvent) => {
    onRowClick?.(row, e);
    const link = rowLink?.(row);
    if (link) go(link, e);
  };

  const onBodyClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const rowEl = target.closest<HTMLElement>('[data-index]');
    if (!rowEl || !e.currentTarget.contains(rowEl)) return;
    const hit = target.closest(INTERACTIVE);
    if (hit && hit !== rowEl && rowEl.contains(hit)) return; // never hijack links and buttons in a cell
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && rowEl.contains(sel.anchorNode)) return; // the user is selecting text
    const row = displayed[Number(rowEl.dataset.index)];
    if (row === undefined) return;
    setActiveKey(keyOf(row));
    activate(row, e);
  };

  // --- keyboard ----------------------------------------------------------------------------------
  const pointerDown = useRef(false);
  const revealOnCommit = useRef(false);

  const reveal = (index: number) => {
    const el = scrollerRef.current;
    if (virtual && el) {
      const top = scrollTopToReveal(index, el.scrollTop, viewportRows, rowH);
      if (top !== el.scrollTop) {
        el.scrollTop = top;
        setFirstRow(Math.floor(top / rowH));
      }
    } else {
      revealOnCommit.current = true;
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after the active row changes; reads the DOM by id
  useLayoutEffect(() => {
    if (!revealOnCommit.current) return;
    revealOnCommit.current = false;
    const row = activeKey === null ? null : document.getElementById(domIdOf(activeKey));
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [activeKey]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.altKey || e.metaKey) return;
    if (e.key === 'Enter') {
      const row = activeIndex >= 0 ? displayed[activeIndex] : undefined;
      if (row !== undefined) {
        e.preventDefault();
        if (onRowClick || rowLink) activate(row, e);
        // A table of linked cells (no row handlers): Enter follows the active row's first link.
        else
          document
            .getElementById(domIdOf(keyOf(row)))
            ?.querySelector<HTMLAnchorElement>('a[href]')
            ?.click();
      }
      return;
    }
    const next = navigateRow(e.key, { current: activeIndex, count, page: rowsPerPage(viewportRows, rowH) });
    if (next === null) return;
    e.preventDefault();
    setActiveKey(keyOf(displayed[next]!));
    reveal(next);
  };

  const onFocus = (e: ReactFocusEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || pointerDown.current || activeIndex >= 0 || count === 0) return;
    const sel = indexOfKey(selectedKeyStr);
    const i = sel >= 0 ? sel : 0;
    setActiveKey(keyOf(displayed[i]!));
    if (sel >= 0) reveal(sel);
  };

  const onPointerDownCapture = () => {
    pointerDown.current = true;
    setTimeout(() => {
      pointerDown.current = false;
    }, 0);
  };

  // --- sort headers ------------------------------------------------------------------------------
  const onHeaderClick = (c: DataTableColumn<Row>) => {
    const next = nextSort(sort, c.id, defaultDir(c));
    if (sortProp === undefined) setInnerSort(next);
    onSortChange?.(next);
    if (scrolls) {
      scrollerRef.current?.scrollTo?.({ top: 0 });
      setFirstRow(0);
    }
  };

  const header = (
    <div
      ref={headerRef}
      role="row"
      className="ui-table__header"
      aria-rowindex={1}
      data-sticky-header={stickyHeader || undefined}
    >
      {columns.map((c, ci) => {
        const sorted = sort?.id === c.id ? sort.dir : null;
        return (
          <div
            key={c.id}
            role="columnheader"
            aria-colindex={ci + 1}
            aria-sort={c.sortable ? ariaSort(sort, c.id) : undefined}
            title={c.title}
            className={cx('ui-table__th', c.className)}
            data-col={c.id}
            data-align={alignOf(c as DataTableColumn<never>)}
            data-sorted={sorted ? '' : undefined}
            data-sticky={isSticky(c, ci) || undefined}
          >
            {c.sortable ? (
              <button type="button" className="ui-table__sort" onClick={() => onHeaderClick(c)}>
                <span className="ui-table__label">{c.header}</span>
                <ArrowUp
                  className="ui-table__arrow"
                  size={12}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  data-dir={sorted ?? undefined}
                />
              </button>
            ) : (
              <span className="ui-table__label">{c.header}</span>
            )}
          </div>
        );
      })}
    </div>
  );

  // --- rows --------------------------------------------------------------------------------------
  const rowEls: ReactNode[] = [];
  for (let i = win.start; i < win.end; i++) {
    const row = displayed[i]!;
    const raw = rowKey(row);
    const k = String(raw);
    rowEls.push(
      <DataRow
        key={k}
        row={row}
        columns={columns}
        index={i}
        domId={domIdOf(k)}
        selected={selectedKeyStr === k}
        active={activeKey === k}
        fresh={highlightKeys?.has(raw) ?? false}
        striped={zebra && i % 2 === 1}
        linkable={rowLink ? Boolean(rowLink(row)) : Boolean(onRowClick)}
        sortId={sort?.id ?? null}
      />,
    );
  }

  const activeRendered = activeIndex >= win.start && activeIndex < win.end;
  const activeDomId = activeRendered && activeKey !== null ? domIdOf(activeKey) : undefined;

  const rootStyle = {
    '--ui-table-cols': gridTemplate(columns),
    '--ui-table-min': `${minW}px`,
    '--ui-table-row-h': `${rowH}px`,
    height: px(height),
    maxHeight: px(maxHeight),
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={cx('ui-table', className)}
      style={rootStyle}
      data-virtual={virtual || undefined}
      data-scrolls={scrolls || undefined}
      data-bounded={bounded || undefined}
      data-hscroll={hscroll || undefined}
      data-fill={fill || undefined}
      data-compact={rowH <= 28 || undefined}
      data-interactive={interactive || undefined}
      data-enter={entering || undefined}
      data-loading={showSkeleton || undefined}
    >
      <div
        ref={scrollerRef}
        className="ui-table__scroller"
        role="grid"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-rowcount={count + 1}
        aria-colcount={columns.length}
        aria-busy={loading || undefined}
        aria-activedescendant={activeDomId}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onMouseDownCapture={onPointerDownCapture}
      >
        {header}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation is handled on the grid (Enter on the active row) */}
        <div
          className="ui-table__body"
          role="rowgroup"
          style={virtual ? { height: win.totalHeight } : undefined}
          onClick={onBodyClick}
        >
          {showSkeleton ? (
            <SkeletonRows columns={columns} count={skeletonRows} />
          ) : showEmpty ? (
            <div role="row" className="ui-table__empty">
              <div role="gridcell" aria-colspan={columns.length}>
                {empty ?? <EmptyState compact title="Nothing to show" />}
              </div>
            </div>
          ) : (
            <div
              className="ui-table__window"
              style={virtual ? { transform: `translateY(${win.offsetTop}px)` } : undefined}
            >
              <div
                ref={shifterRef}
                className="ui-table__shifter"
                onAnimationEnd={(e) => {
                  if (e.target === e.currentTarget) e.currentTarget.removeAttribute('data-shift');
                }}
              >
                {rowEls}
              </div>
            </div>
          )}
          {ghost ? (
            <div
              className="ui-table__ghost"
              onAnimationEnd={(e) => {
                if (e.target === e.currentTarget) setGhost(false);
              }}
            >
              <SkeletonRows columns={columns} count={skeletonRows} />
            </div>
          ) : null}
        </div>
      </div>
      {footer ? <div className="ui-table__footer">{footer}</div> : null}
    </div>
  );
}
