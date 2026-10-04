// The ways a hub leads deeper: a small "Open ..." link at the foot of a panel, a row of go-to tiles under the hero,
// and the nav the explorer views wear in their headers. All are real links (middle click, copy address) that open
// their subject as a window, keeping the windows already open.

import { ArrowRight, type LucideIcon } from 'lucide-react';
import { Children, type CSSProperties, isValidElement, type ReactNode } from 'react';
import { ShellLink, type ShellLinkProps } from '../../shell/frame/ShellLink';
import { cx } from '../../ui';
import { balancedColumns, rowPlan } from './columns';
import './hub.css';

export interface HubLinkProps extends Omit<ShellLinkProps, 'children'> {
  children: ReactNode;
  /** The trailing glyph (an arrow by default). */
  icon?: LucideIcon;
}

/** A text link with a trailing arrow ("Open the rich list"). */
export function HubLink({ icon: Icon = ArrowRight, className, children, ...rest }: HubLinkProps) {
  return (
    <ShellLink className={cx('hub-link', className)} {...rest}>
      <span>{children}</span>
      <Icon className="hub-link__icon" size={14} strokeWidth={1.5} aria-hidden="true" />
    </ShellLink>
  );
}

/**
 * The widest row the tiles take in each band of the hub's width (a container query in hub.css): two on a phone, then
 * three, four, five and six as the window grows. A tile is at least 178 px wide, so these are the most that fit.
 */
const TILE_BANDS = [
  ['s', 2],
  ['m', 3],
  ['l', 4],
  ['xl', 5],
  ['xxl', 6],
] as const;

/**
 * How the tiles lie in each band of the hub's width: the columns are chosen by how many tiles there are, so no row is
 * one tile beside a hole (three over two, never four over one), and rows of different counts share one grid whose
 * columns are fine enough for every row to fill the width. `lead` puts the odd tile out of a two-column phone layout
 * first instead of last, for a row whose first tile is the one the reader came for.
 */
export function tileLayout(count: number, lead = false) {
  return TILE_BANDS.map(([band, max]) => ({ band, ...rowPlan(count, balancedColumns(count, max), lead) }));
}

/** A row of go-to tiles. Name it for assistive technology ("Quick links"). */
export function HubTiles({ label, children }: { label: string; children: ReactNode }) {
  const tiles = Children.toArray(children);
  const first = tiles[0];
  const lead = isValidElement<{ emphasis?: boolean }>(first) && first.props.emphasis === true;
  const layout = tileLayout(tiles.length, lead);
  const list: Record<string, number> = {};
  for (const { band, sub } of layout) list[`--tiles-${band}`] = sub;
  return (
    <nav aria-label={label}>
      <ul className="hub-tiles" style={list as CSSProperties}>
        {tiles.map((tile, i) => {
          const spans: Record<string, number> = {};
          for (const { band, spans: of } of layout) spans[`--span-${band}`] = of[i] ?? 1;
          return (
            <li
              key={isValidElement(tile) && tile.key !== null ? tile.key : i}
              className="hub-tiles__item"
              style={spans as CSSProperties}
            >
              {tile}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export interface HubTileProps extends Omit<ShellLinkProps, 'children' | 'title'> {
  icon: LucideIcon;
  title: ReactNode;
  /** A live line under the title ("#3,007,720, 12 s ago"). */
  caption?: ReactNode;
  /** The tile is the one the reader asked for (the rich list, found easily). */
  emphasis?: boolean;
}

/** One go-to tile: a glyph, a name, a live line, and an arrow that appears on hover and focus. */
export function HubTile({ icon: Icon, title, caption, emphasis, className, ...rest }: HubTileProps) {
  return (
    <ShellLink className={cx('hub-tile', className)} data-emphasis={emphasis || undefined} {...rest}>
      <span className="hub-tile__icon" aria-hidden="true">
        <Icon size={16} strokeWidth={1.5} />
      </span>
      <span className="hub-tile__text">
        <span className="hub-tile__title">{title}</span>
        {caption ? ' ' : null}
        {caption ? <span className="hub-tile__caption">{caption}</span> : null}
      </span>
      <ArrowRight className="hub-tile__go" size={14} strokeWidth={1.5} aria-hidden="true" />
    </ShellLink>
  );
}

export interface HubButtonProps extends Omit<ShellLinkProps, 'children'> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  children: ReactNode;
}

/**
 * A link that wears the kit's Button (which is a `<button>`): the primary action of a hub that leads to a window, such
 * as the latest block. It is a real link, so middle click and copy address work.
 */
export function HubButton({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  className,
  children,
  ...rest
}: HubButtonProps) {
  const px = size === 'sm' ? 14 : 16;
  return (
    <ShellLink
      className={cx('ui-button', 'hub-button', className)}
      data-variant={variant}
      data-size={size}
      {...rest}
    >
      {Icon ? <Icon size={px} strokeWidth={1.5} aria-hidden="true" /> : null}
      <span className="ui-button__label">{children}</span>
      {IconRight ? <IconRight size={px} strokeWidth={1.5} aria-hidden="true" /> : null}
    </ShellLink>
  );
}
