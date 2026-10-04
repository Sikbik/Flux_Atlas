// The frame every hub window shares (the Explorer, Nodes and Apps landings): a container-query root, the stack that
// lays out the rows under the view header, and the grid the section panels sit in. A hub is a window, so it folds by
// the width of its window, not of the viewport: three columns of panels in a wide window, two in a medium one, one on
// a phone.

import type { ComponentPropsWithoutRef } from 'react';
import { cx } from '../../ui';
import './hub.css';

/** The root of a hub window. Put the view header first, then a `HubStack`. */
export function Hub({ className, ...rest }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cx('hub', className)} {...rest} />;
}

/** The rows under the header: search, hero, links, then the grid of panels. */
export function HubStack({ className, ...rest }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cx('hub__stack', className)} {...rest} />;
}

/** How wide a panel is in the grid (six columns in a wide window): the whole row, two thirds, half or a third. */
export type HubSpan = 'full' | 'twothirds' | 'half' | 'third';

/** The grid of section panels. Children set their own span (`HubPanel span="half"`). */
export function HubGrid({ className, ...rest }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cx('hub-grid', className)} {...rest} />;
}
