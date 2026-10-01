import type { ComponentPropsWithoutRef, CSSProperties, ReactNode, Ref } from 'react';
import { useState } from 'react';
import { formatInt, formatPercent, UNKNOWN } from '../../lib/format';
import { TierGlyph } from '../chips/TierGlyph';
import { cx } from '../internal/cx';
import type { TierName } from '../internal/status';
import { Skeleton } from '../states/Skeleton';
import { describeShares, segmentColors, segmentText, sharesOf, sumOf } from './shareBar';
import './ShareBar.css';

export interface ShareSegment {
  /** Stable identity: keys the segment so it glides to its new width when the data changes. */
  id: string;
  /** What the part is (a tier, a continent, a version); the legend entry and the hover text. */
  label: string;
  /** The amount; `null` is unknown (no width, and the legend says Unknown). */
  value: number | null;
  /** Fill as a CSS colour value; default the tier ink for a tier, else the next categorical slot in order. */
  color?: string;
  /** A node-tier segment: tier ink colour, and the tier glyph in the legend (so tier is never colour alone). */
  tier?: TierName;
  /** The unknown share: a hatched segment in the reserved off-status gray. */
  unknown?: boolean;
}

/**
 * Props of a ShareBar: the parts, plus `className`, `style`, `ref` and the other `<div>` attributes.
 * The root reports `data-state` (`ready`, `loading` or `empty`); a part under the pointer, in the bar
 * or the legend, carries `data-active` on its segment and its legend entry.
 */
export interface ShareBarProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /** The parts, in the order to draw them left to right. */
  segments: readonly ShareSegment[];
  /** The whole the shares are of; when larger than the sum the rest is an empty track (default the sum). */
  total?: number;
  /** Bar height: `md` 10 px (default) or `lg` 16 px. */
  size?: 'md' | 'lg';
  /** The key under the bar: `inline` flows entries in a row (default), `list` aligns them as rows, `none` hides it. */
  legend?: 'inline' | 'list' | 'none';
  /** Legend columns: the amount and the share (default), or only one of them. */
  show?: 'both' | 'value' | 'percent';
  /** Formats a legend amount (default a grouped integer). */
  format?: (value: number) => string;
  /** Accessible name; the full breakdown follows it, so the bar reads as one sentence. */
  label?: string;
  /** Show a skeleton instead of data. */
  loading?: boolean;
  /** Text under the empty bar (default "No data"). */
  emptyText?: ReactNode;
  /** Ref to the root element. */
  ref?: Ref<HTMLDivElement>;
}

const SKELETON_NAME = [64, 52, 76];

function Key({ segment, color }: { segment: ShareSegment; color: string }) {
  if (segment.tier) return <TierGlyph tier={segment.tier} size={14} className="ui-sharebar__glyph" />;
  return (
    <span
      className="ui-sharebar__key"
      data-unknown={segment.unknown || undefined}
      style={{ '--ui-sb-c': color } as CSSProperties}
    />
  );
}

/**
 * A stacked bar of parts of a whole (node tiers, continents, versions, reachability). Segments are
 * cut apart by 2 px gaps of the surface behind them and glide to new widths; the legend under it
 * lists each part's amount and share, and hovering either marks the part in both. The bar is one
 * labelled image whose name spells every share out, so no part is described by colour alone.
 */
export function ShareBar({
  segments,
  total,
  size = 'md',
  legend = 'inline',
  show = 'both',
  format = (n) => formatInt(n),
  label,
  loading,
  emptyText,
  className,
  ref,
  ...rest
}: ShareBarProps) {
  const [active, setActive] = useState<string | null>(null);
  const root = {
    ref,
    ...rest,
    className: cx('ui-sharebar', className),
    'data-size': size,
    'data-legend': legend,
    'data-show': show,
  };

  if (loading) {
    return (
      <div {...root} data-state="loading" aria-busy="true">
        <div className="ui-sharebar__bar" aria-hidden="true">
          <Skeleton className="ui-sharebar__skeleton-bar" radius="var(--r-xs)" />
        </div>
        {legend === 'none' ? null : (
          <ul className="ui-sharebar__legend" aria-hidden="true">
            {SKELETON_NAME.map((w) => (
              <li key={w} className="ui-sharebar__item">
                <Skeleton w={w} h={10} />
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const rows = sharesOf(segments, total);
  const colors = segmentColors(segments);
  const sum = sumOf(segments);
  const whole = total !== undefined && total > 0 ? total : sum;
  const rest_ = total !== undefined && total > sum ? total - sum : 0;
  const name = describeShares(label, segments, total);

  if (sum <= 0) {
    return (
      <div {...root} data-state="empty">
        <div className="ui-sharebar__bar" role="img" aria-label={name}>
          <span className="ui-sharebar__seg" data-empty />
        </div>
        <p className="ui-sharebar__none">{emptyText ?? 'No data'}</p>
      </div>
    );
  }

  const lift = (id: string | null) => ({
    onPointerEnter: () => setActive(id),
    onPointerLeave: () => setActive(null),
  });

  return (
    <div {...root} data-state="ready">
      <div className="ui-sharebar__bar" role="img" aria-label={name} data-active={active ? '' : undefined}>
        {segments.map((s, i) => {
          const row = rows[i];
          if (!row || row.value <= 0) return null;
          return (
            <span
              key={s.id}
              className="ui-sharebar__seg"
              data-active={active === s.id || undefined}
              data-unknown={s.unknown || undefined}
              title={segmentText(s, row.share)}
              style={{ '--ui-sb-c': colors[i], '--ui-sb-share': (row.value / whole) * 1000 } as CSSProperties}
              {...lift(s.id)}
            />
          );
        })}
        {rest_ > 0 ? (
          <span
            className="ui-sharebar__seg"
            data-rest
            style={{ '--ui-sb-share': (rest_ / whole) * 1000 } as CSSProperties}
          />
        ) : null}
      </div>
      {legend === 'none' ? null : (
        <ul className="ui-sharebar__legend" aria-hidden="true" data-active={active ? '' : undefined}>
          {segments.map((s, i) => {
            const row = rows[i];
            const known = typeof s.value === 'number' && Number.isFinite(s.value);
            return (
              <li
                key={s.id}
                className="ui-sharebar__item"
                data-active={active === s.id || undefined}
                {...lift(s.id)}
              >
                <Key segment={s} color={colors[i] as string} />
                <span className="ui-sharebar__name">{s.label}</span>
                {show !== 'percent' ? (
                  <span className="ui-sharebar__val" data-unknown={!known || undefined}>
                    {known ? format(s.value as number) : UNKNOWN}
                  </span>
                ) : null}
                {show !== 'value' ? (
                  <span className="ui-sharebar__pct">{known && row ? formatPercent(row.share) : ''}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
