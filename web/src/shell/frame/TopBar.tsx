// The desktop top bar (design 3.1, 8.4): the L1 lockup, the three menus, the omnibox, the Beat and Live chips,
// the clock, the layers and ambient buttons and the operator chip. Glass, 52 px, with the block's light
// travelling its lower edge. The omnibox is a button that opens the palette (`?q=`); F2b renders it. The phone
// has its own header (PhoneHeader.tsx).

import { Layers2, Orbit, Search, UserRoundCheck } from 'lucide-react';
import type { ComponentPropsWithRef } from 'react';
import { BeatChip, LiveChip, TopLight, UtcClock } from '../../features/chrome/Beat';
import { FluxRound } from '../../features/chrome/brand';
import { cx } from '../../ui';
import { pressHandlers } from '../../ui/internal/press';
import { useShellActions } from './actions';
import { useShellNav } from './nav';
import { MenuBar, TopMenu } from './topmenus';
import './topbar.css';

const isApple = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** The top bar. The root takes a ref, a class and a style; its controls carry `data-pressed` while held. */
export function TopBar({ className, ...rest }: ComponentPropsWithRef<'header'>) {
  const nav = useShellNav();
  const { launch } = useShellActions();
  return (
    <header className={cx('topbar', className)} data-region="topbar" data-fx-density="dense" {...rest}>
      <a
        href="/"
        className="brand"
        aria-label="Flux Atlas, home"
        {...pressHandlers<HTMLAnchorElement>()}
        onClick={(e) => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          nav.globe();
        }}
      >
        <FluxRound size={26} />
        <b className="brand-word">Atlas</b>
      </a>
      <MenuBar />
      <button
        type="button"
        className="omni"
        {...pressHandlers<HTMLButtonElement>()}
        onClick={() => nav.palette()}
        aria-label="Search, command palette"
      >
        <Search size={16} strokeWidth={1.5} aria-hidden="true" />
        <span className="omni-ph">
          Search nodes, apps, blocks<span className="omni-more">, addresses</span>
        </span>
        <span className="omni-keys" aria-hidden="true">
          <kbd className="kbd">{isApple() ? 'cmd' : 'ctrl'}</kbd>
          <kbd className="kbd">K</kbd>
        </span>
      </button>
      <div className="topright">
        <BeatChip />
        <LiveChip />
        <UtcClock />
        <span className="topbar-sep" aria-hidden="true" />
        <TopMenu which="layers" label="Layers" className="iconbtn" title="Layers">
          <Layers2 size={19} strokeWidth={1.5} aria-hidden="true" />
        </TopMenu>
        <button
          type="button"
          className="iconbtn"
          aria-label="Ambient mode"
          title="Ambient mode"
          {...pressHandlers<HTMLButtonElement>()}
          onClick={() => launch('ambient')}
        >
          <Orbit size={19} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="opchip"
          aria-label="Operator view"
          title="Operator view"
          {...pressHandlers<HTMLButtonElement>()}
          onClick={() => launch('operator')}
        >
          <UserRoundCheck size={15} strokeWidth={1.5} aria-hidden="true" />
          <span className="opchip-word">Operator</span>
        </button>
      </div>
      <TopLight />
    </header>
  );
}
