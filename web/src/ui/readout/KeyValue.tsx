import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatInt } from '../../lib/format';
import { CopyButton } from '../controls/CopyButton';
import { isUnknownValue, Unknown } from '../identity/Unknown';
import { cx } from '../internal/cx';
import './KeyValue.css';

export interface KeyValueItem {
  /** Stable React key; defaults to the label when it is a string. */
  id?: string;
  /** What the value is ("Collateral", "Rank"): sentence case, no colon. */
  label: ReactNode;
  /** The value: text, a number (formatted with grouping, in Plex Mono) or any element (EntityLink, Amount, Hash...). Null, undefined and empty render Unknown. */
  value: ReactNode | null | undefined;
  /** Set a plain-text value in Plex Mono (ids, endpoints, counts). Elements bring their own styling. */
  mono?: boolean;
  /** Add a copy button: `true` copies the value when it is a string or number, or pass the exact text to copy. */
  copy?: boolean | string;
  /** Make a plain-text value a link (external `http` links open in a new tab). */
  href?: string;
  /** Replaces the word "Unknown" for this row. */
  unknown?: ReactNode;
  /** Extra line under the value (an estimate note, an "as of" time). */
  note?: ReactNode;
}

export interface KeyValueProps {
  /** The rows, as data. Alternatively compose `KeyValueRow` children. */
  items?: readonly KeyValueItem[];
  /** `end` right-aligns values against the label column (inspectors, the default); `start` left-aligns them (wide explorer panes). */
  align?: 'end' | 'start';
  /** Draw a hairline between rows. */
  ruled?: boolean;
  /** Fixed label column width in px (default: as wide as the widest label, at least 96 px). */
  labelWidth?: number;
  /** Accessible name of the list. */
  'aria-label'?: string;
  className?: string;
  children?: ReactNode;
}

function renderValue(item: KeyValueItem): ReactNode {
  const { value, mono, href, unknown } = item;
  if (isUnknownValue(value)) return <Unknown>{unknown}</Unknown>;
  const text = typeof value === 'number' ? formatInt(value) : value;
  const isText = typeof text === 'string';
  const body =
    isText && href ? (
      <a
        className="ui-kv__link"
        href={href}
        {...(/^https?:/.test(href) ? { target: '_blank', rel: 'noreferrer noopener' } : null)}
      >
        <span className="ui-kv__link-text">{text}</span>
        {/^https?:/.test(href) ? <ExternalLink size={11} strokeWidth={1.5} aria-hidden="true" /> : null}
      </a>
    ) : (
      text
    );
  const dataText = typeof value === 'number' || (isText && mono);
  return dataText ? <span className="ui-mono ui-kv__text">{body}</span> : body;
}

function copyValue(item: KeyValueItem): string | null {
  if (!item.copy) return null;
  if (typeof item.copy === 'string') return item.copy;
  const v = item.value;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return null;
}

/** One row of a KeyValue list; compose these directly when the rows are conditional. */
export function KeyValueRow(item: KeyValueItem) {
  const copy = copyValue(item);
  return (
    <div className="ui-kv__row">
      <dt className="ui-kv__label">{item.label}</dt>
      <dd className="ui-kv__value">
        <span className="ui-kv__main">
          {renderValue(item)}
          {copy ? (
            <CopyButton
              value={copy}
              what={typeof item.label === 'string' ? item.label.toLowerCase() : undefined}
              className="ui-kv__copy"
            />
          ) : null}
        </span>
        {item.note ? <span className="ui-kv__note">{item.note}</span> : null}
      </dd>
    </div>
  );
}

/**
 * A definition list of label and value rows. Values are mono when they are data, copyable on
 * request, links when given an href, and Unknown (never zero or blank) when missing.
 */
export function KeyValue({
  items,
  align = 'end',
  ruled,
  labelWidth,
  className,
  children,
  'aria-label': ariaLabel,
}: KeyValueProps) {
  return (
    <dl
      className={cx('ui-kv', className)}
      data-align={align}
      data-ruled={ruled || undefined}
      aria-label={ariaLabel}
      style={labelWidth ? ({ '--ui-kv-label': `${labelWidth}px` } as React.CSSProperties) : undefined}
    >
      {items?.map((item, i) => (
        <KeyValueRow key={item.id ?? (typeof item.label === 'string' ? item.label : i)} {...item} />
      ))}
      {children}
    </dl>
  );
}
