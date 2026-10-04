// The ways a hub leads deeper: a small "Open ..." link at the foot of a panel, a row of go-to tiles under the hero,
// and the nav the explorer views wear in their headers. All are real links (middle click, copy address) that open
// their subject as a window, keeping the windows already open.

import { ArrowRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ShellLink, type ShellLinkProps } from '../../shell/frame/ShellLink';
import { cx } from '../../ui';
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

/** A row of go-to tiles. Name it for assistive technology ("Quick links"). */
export function HubTiles({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav aria-label={label}>
      <ul className="hub-tiles">{children}</ul>
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
    <li className="hub-tiles__item">
      <ShellLink className={cx('hub-tile', className)} data-emphasis={emphasis || undefined} {...rest}>
        <span className="hub-tile__icon" aria-hidden="true">
          <Icon size={16} strokeWidth={1.5} />
        </span>
        <span className="hub-tile__text">
          <span className="hub-tile__title">{title}</span>
          {caption ? <span className="hub-tile__caption">{caption}</span> : null}
        </span>
        <ArrowRight className="hub-tile__go" size={14} strokeWidth={1.5} aria-hidden="true" />
      </ShellLink>
    </li>
  );
}
