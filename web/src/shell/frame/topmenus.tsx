// The top bar's menu triggers (design 8.4). The bar shows plain buttons; the menus behind them (the UI kit's
// Menu and Popover, the items, the places list) are their own chunk (menus.tsx), fetched when the pointer or
// focus first nears a trigger and mounted, already open, by the click that asks for one.

import { lazy, type ReactNode, Suspense, useState } from 'react';
import type { MenuKind } from './menus';

const loadMenus = () => import('./menus');
const MenuImpl = lazy(() => loadMenus().then((m) => ({ default: m.MenuImpl })));

export interface TopMenuProps {
  which: MenuKind;
  /** The text of a text button, or the accessible name of an icon button. */
  label: string;
  className?: string;
  title?: string;
  /** An icon in place of the text label. */
  children?: ReactNode;
}

/** The three text menus of the bar, in a row. */
export function MenuBar() {
  return (
    <nav className="menubar" aria-label="Menus">
      <TopMenu which="view" label="View" />
      <TopMenu which="go" label="Go" />
      <TopMenu which="window" label="Window" />
    </nav>
  );
}

export function TopMenu({ which, label, className = 'menu-trigger', title, children }: TopMenuProps) {
  const [asked, setAsked] = useState(false);
  const popup = which === 'view' || which === 'layers' ? 'dialog' : 'menu';
  const plain = (
    <button
      type="button"
      className={className}
      aria-haspopup={popup}
      aria-expanded={false}
      aria-label={children ? label : undefined}
      title={title}
      onPointerEnter={() => void loadMenus()}
      onFocus={() => void loadMenus()}
      onClick={() => setAsked(true)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          setAsked(true);
        }
      }}
    >
      {children ?? label}
    </button>
  );
  if (!asked) return plain;
  return (
    <Suspense fallback={plain}>
      <MenuImpl which={which} label={label} className={className} title={title}>
        {children}
      </MenuImpl>
    </Suspense>
  );
}
