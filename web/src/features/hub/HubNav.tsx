// The small nav a hub's views wear in their headers: the hub itself and the pages that open from it, so a reader on
// a block, the mempool or the rich list is one click from the others. It is a list of real links; the current one
// is marked with aria-current and a lit rim.

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ShellLink } from '../../shell/frame/ShellLink';
import type { WindowRef } from '../../shell/wm/types';
import { cx } from '../../ui';
import './hub.css';

export interface HubNavItem {
  id: string;
  label: ReactNode;
  to: WindowRef | string;
  icon?: LucideIcon;
  /** A link that has nowhere to go yet (the latest block before the first block arrives) is left out. */
  hidden?: boolean;
}

export interface HubNavProps {
  /** Names the nav for assistive technology ("Explorer"). */
  label: string;
  items: readonly HubNavItem[];
  /** The id of the item that is the page you are on. */
  current?: string;
  className?: string;
}

export function HubNav({ label, items, current, className }: HubNavProps) {
  return (
    <nav aria-label={label} className={cx('hub-nav', className)}>
      <ul className="hub-nav__list">
        {items
          .filter((i) => !i.hidden)
          .map(({ id, label: text, to, icon: Icon }) => (
            <li key={id}>
              <ShellLink to={to} className="hub-nav__link" aria-current={id === current ? 'page' : undefined}>
                {Icon ? <Icon size={14} strokeWidth={1.5} aria-hidden="true" /> : null}
                {text}
              </ShellLink>
            </li>
          ))}
      </ul>
    </nav>
  );
}
