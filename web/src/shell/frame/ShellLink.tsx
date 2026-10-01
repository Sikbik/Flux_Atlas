// A link that works like every other link (middle click, copy address, open in a new tab) and, on a plain
// click, opens its subject the way the shell does: as a window over the globe, keeping the windows
// already open (design 2.2). Subjects are window references (a block, a node, an app) or paths.

import type { AnchorHTMLAttributes, MouseEvent, Ref } from 'react';
import { pathForWindow, windowForPath } from '../wm/route';
import type { WindowRef } from '../wm/types';
import { useShellNav } from './nav';

export interface ShellLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: WindowRef | string;
  ref?: Ref<HTMLAnchorElement>;
}

/** The path a link points at (null when a keyed window type has no key). */
export function hrefFor(to: WindowRef | string): string | null {
  return typeof to === 'string' ? to : pathForWindow(to.type, to.key);
}

export function ShellLink({ to, onClick, children, ref, ...rest }: ShellLinkProps) {
  const nav = useShellNav();
  const href = hrefFor(to);
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (href === null) return;
    e.preventDefault();
    const target = typeof to === 'string' ? windowForPath(to) : to;
    if (target) nav.open(target);
    else nav.go(href, {});
  };
  return (
    <a ref={ref} href={href ?? '/'} onClick={click} {...rest}>
      {children}
    </a>
  );
}
