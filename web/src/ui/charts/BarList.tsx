import { useRouter } from '@tanstack/react-router';
import { ChartNoAxesColumn, ChevronDown, ChevronUp } from 'lucide-react';
import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useId,
  useRef,
  useState,
} from 'react';
import { Button } from '../controls/Button';
import { type EntityRef, entityHref } from '../identity/entityRoute';
import { useEntityLinkProps } from '../identity/useEntityLinkProps';
import { cx } from '../internal/cx';
import { navigateIndex } from '../internal/keys';
import { pressHandlers } from '../internal/press';
import { EmptyState } from '../states/EmptyState';
import { Skeleton } from '../states/Skeleton';
import { barFraction, barScale, columnCh, defaultDisplay, isTruncated, visibleItems } from './barList';
import './BarList.css';

export interface BarListItem {
  /** Stable identity (a country code, a provider's ASN): keys the row and matches `selectedId`. */
  id: string;
  /** What the bar is for. Truncated with an ellipsis; the full text is the row's title. */
  label: ReactNode;
  /** The number the bar's length encodes; `null` is unknown (an empty dashed track and the word Unknown). */
  value: number | null;
  /** The formatted value (Plex Mono, right-aligned); defaults to a grouped integer. */
  display?: ReactNode;
  /** A secondary figure after the value, such as a share (`21.6%`), in a quieter style. */
  detail?: ReactNode;
  /** Bar colour as a CSS colour value; defaults to `var(--viz-1)`. Colour follows the entity, never the rank. */
  color?: string;
  /** Makes the row a real link to this entity (country, provider, version, node, ...). */
  to?: EntityRef;
  /** Makes the row a button; called when it is pressed (the list-level `onSelect` is the fallback). */
  onSelect?: (item: BarListItem) => void;
  /** Plain-text name for the title and accessible name when `label` is not a string. */
  title?: string;
}

/**
 * Props of a BarList: the rows, plus `className`, `style`, `ref` and the other `<div>` attributes.
 * The root reports `data-state` (`ready`, `loading` or `empty`); each row reports its kind as
 * `data-kind` (`link`, `button` or `plain`), `data-selected`, and a press as `data-pressed`.
 */
export interface BarListProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'onSelect'> {
  /** The rows, in the order to show them (rank them before passing them in). */
  items: readonly BarListItem[];
  /** Scale bars against this total (the whole network) so lengths read as shares; default the largest value. */
  total?: number;
  /** Scale bars against this value instead of the largest. */
  max?: number;
  /** The `id` of the selected row (accent wash and a 2 px bar; also `aria-current` or `aria-pressed`). */
  selectedId?: string | null;
  /** Show only this many rows until "Show all" is pressed. */
  limit?: number;
  /** Called when a row without its own `onSelect` or link is pressed; makes every row a button. */
  onSelect?: (item: BarListItem) => void;
  /** Show skeleton rows instead of data. */
  loading?: boolean;
  /** How many skeleton rows to draw (default the `limit`, else 5). */
  skeletonRows?: number;
  /** Sentence under "No data" when the list is empty. */
  emptyText?: ReactNode;
  /** Replaces the whole empty state. */
  empty?: ReactNode;
  /** Label column width: a px number or any CSS grid track (default `minmax(88px, 34%)`). */
  labelWidth?: number | string;
  /** Accessible name of the list. */
  label?: string;
  /** Ref to the root element. */
  ref?: Ref<HTMLDivElement>;
}

function RouterRow({
  to,
  children,
  ...rest
}: { to: EntityRef; children: ReactNode } & Omit<ComponentPropsWithoutRef<'a'>, 'href' | 'children'>) {
  const linkProps = useEntityLinkProps(to.kind, to.value);
  return (
    <a {...linkProps} {...rest} {...pressHandlers<HTMLAnchorElement>()}>
      {children}
    </a>
  );
}

interface RowProps {
  item: BarListItem;
  fraction: number;
  selected: boolean;
  hasDetail: boolean;
  onSelect?: (item: BarListItem) => void;
}

function Row({ item, fraction, selected, hasDetail, onSelect }: RowProps) {
  const router = useRouter({ warn: false });
  const unknown = item.value === null || !Number.isFinite(item.value);
  const text = item.title ?? (typeof item.label === 'string' ? item.label : undefined);
  const press = item.onSelect ?? onSelect;
  const kind = item.to ? 'link' : press ? 'button' : 'plain';
  const style = {
    '--ui-bl-frac': fraction,
    ...(item.color ? { '--ui-bl-c': item.color } : null),
  } as CSSProperties;
  const body = (
    <>
      <span className="ui-barlist__label" title={text}>
        {item.label}
      </span>
      <span className="ui-barlist__track" data-unknown={unknown || undefined} aria-hidden="true">
        <span className="ui-barlist__fill" data-none={fraction === 0 || undefined} />
      </span>
      <span className="ui-barlist__value" data-unknown={unknown || undefined}>
        {unknown ? 'Unknown' : (item.display ?? defaultDisplay(item.value))}
      </span>
      {hasDetail ? <span className="ui-barlist__detail">{item.detail}</span> : null}
    </>
  );
  const common = {
    className: 'ui-barlist__row',
    'data-kind': kind,
    'data-selected': selected || undefined,
  };

  let row: ReactNode;
  if (item.to) {
    const props = { ...common, 'aria-current': selected ? ('true' as const) : undefined };
    row = router ? (
      <RouterRow to={item.to} {...props}>
        {body}
      </RouterRow>
    ) : (
      <a href={entityHref(item.to.kind, item.to.value)} {...props} {...pressHandlers<HTMLAnchorElement>()}>
        {body}
      </a>
    );
  } else if (press) {
    row = (
      <button
        type="button"
        {...common}
        aria-pressed={selected}
        onClick={() => press(item)}
        {...pressHandlers<HTMLButtonElement>()}
      >
        {body}
      </button>
    );
  } else {
    row = <div {...common}>{body}</div>;
  }
  return (
    <li className="ui-barlist__item" style={style}>
      {row}
    </li>
  );
}

const SKELETON_LABEL = [88, 64, 104, 72, 96, 58, 80, 68];
const SKELETON_BAR = [100, 82, 66, 52, 40, 32, 26, 20];

/**
 * Ranked horizontal bars (top countries, providers, versions): a quiet gradient bar with a rounded
 * data end, the value in Plex Mono, the label truncating with a title. Rows can be real links
 * (`to`), buttons (`onSelect`) or plain; `limit` adds a "Show all" toggle; loading and empty are
 * built in. Bars slide to new lengths when the data changes; reduced motion is instant.
 */
export function BarList({
  items,
  total,
  max,
  selectedId,
  limit,
  onSelect,
  loading,
  skeletonRows,
  emptyText,
  empty,
  labelWidth,
  label,
  className,
  style: styleProp,
  ref,
  ...rest
}: BarListProps) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);

  const shown = visibleItems(items, limit, expanded);
  const scale = barScale(
    items.map((i) => i.value),
    total,
    max,
  );
  const hasDetail = items.some((i) => i.detail !== undefined && i.detail !== null);
  const valueCh = columnCh(items.map((i) => (i.display !== undefined ? i.display : defaultDisplay(i.value))));
  const detailCh = columnCh(items.map((i) => i.detail));
  const style = {
    ...(labelWidth !== undefined
      ? { '--ui-bl-label': typeof labelWidth === 'number' ? `${labelWidth}px` : labelWidth }
      : null),
    '--ui-bl-value': `${Math.max(valueCh, 4.5)}ch`,
    '--ui-bl-detail': `${Math.max(detailCh, 4.5)}ch`,
    ...styleProp,
  } as CSSProperties;
  const root = { ref, ...rest, className: cx('ui-barlist', className), style };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('a.ui-barlist__row, button.ui-barlist__row') ?? [],
    );
    if (rows.length === 0) return;
    const current = rows.indexOf(document.activeElement as HTMLElement);
    const next = navigateIndex(e.key, current, rows.length, { orientation: 'vertical', loop: false });
    if (next === null) return;
    e.preventDefault();
    rows[next]?.focus();
  };

  if (loading) {
    const n = skeletonRows ?? (limit && limit > 0 ? limit : 5);
    return (
      <div {...root} data-state="loading" aria-busy="true">
        <ul className="ui-barlist__list" aria-hidden="true">
          {Array.from({ length: n }, (_, i) => (
            // static placeholder rows never reorder
            <li key={i} className="ui-barlist__item">
              <div className="ui-barlist__row" data-kind="plain">
                <Skeleton w={SKELETON_LABEL[i % SKELETON_LABEL.length]} h={10} />
                <Skeleton w={`${SKELETON_BAR[i % SKELETON_BAR.length]}%`} h={8} radius="0 4px 4px 0" />
                <Skeleton w={28} h={10} className="ui-barlist__skeleton-value" />
                {hasDetail ? <Skeleton w={28} h={10} className="ui-barlist__skeleton-value" /> : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div {...root} data-state="empty">
        {empty ?? (
          <EmptyState compact role="status" icon={ChartNoAxesColumn} title="No data">
            {emptyText}
          </EmptyState>
        )}
      </div>
    );
  }

  return (
    <div {...root} data-state="ready" data-detail={hasDetail || undefined}>
      {/* Arrow keys step between interactive rows; every row is also a normal tab stop. */}
      <ul id={listId} ref={listRef} className="ui-barlist__list" aria-label={label} onKeyDown={onKeyDown}>
        {shown.map((item) => (
          <Row
            key={item.id}
            item={item}
            fraction={barFraction(item.value, scale)}
            selected={selectedId === item.id}
            hasDetail={hasDetail}
            onSelect={onSelect}
          />
        ))}
      </ul>
      {isTruncated(items.length, limit) ? (
        <div className="ui-barlist__more">
          <Button
            size="sm"
            variant="ghost"
            icon={expanded ? ChevronUp : ChevronDown}
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Show fewer' : `Show all ${items.length}`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
