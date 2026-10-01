// The phone's tab bar (design 3.6): Globe, Live, Search, Apps, You. It replaces the dock, so every tab does what
// the matching dock launcher or top bar control does (launchers.tsx): Globe is the bare globe (G), Live the
// sheet of everything happening, Search the palette, Apps the app launcher (A) and You the operator view (O),
// or settings while no operator window is open. The lit tab follows what is on screen (phonetabs.ts), and
// pressing the lit Live tab again takes the sheet back to its top.

import { useRouterState } from '@tanstack/react-router';
import { Activity, Boxes, Globe, type LucideIcon, Search, UserRound } from 'lucide-react';
import { type ComponentPropsWithRef, useEffect } from 'react';
import { useLiveView } from '../../features/chrome/live';
import { usePhone } from '../../features/chrome/phone';
import { cx, LiveDot } from '../../ui';
import { pressHandlers } from '../../ui/internal/press';
import { visibleWindows, windowOfType } from '../wm/machine';
import { useWindowManager, useWm } from '../wm/react';
import { useShellActions } from './actions';
import { liveSheet } from './livegate';
import { useShellNav } from './nav';
import { activeTab, PHONE_TABS, type PhoneTab } from './phonetabs';
import './phonetabs.css';

const ICON: Record<PhoneTab, LucideIcon> = {
  globe: Globe,
  live: Activity,
  search: Search,
  apps: Boxes,
  you: UserRound,
};

/** The tab bar. The root takes a ref, a class and a style; a tab is `button.shell-tab` with `data-tab`,
 * `aria-current` when lit and `data-pressed` while held. */
export function PhoneTabs({ className, ...rest }: ComponentPropsWithRef<'nav'>) {
  const nav = useShellNav();
  const { launch } = useShellActions();
  const wm = useWindowManager();
  const view = useLiveView();
  const liveOpen = usePhone((s) => s.live);
  const setLive = usePhone((s) => s.setLive);
  const sheet = useWm((s) => visibleWindows(s)[0]?.type ?? null, Object.is);
  const paletteOpen = useRouterState({
    select: (s) => new URLSearchParams(s.location.searchStr).has('q'),
  });
  const active = activeTab({ paletteOpen, liveOpen, sheet });

  // The sheet's chunk is fetched once the first paint is behind us, so the tab opens it without a wait.
  useEffect(() => {
    const t = window.setTimeout(liveSheet.preload, 2500);
    return () => window.clearTimeout(t);
  }, []);

  const press = (id: PhoneTab) => {
    switch (id) {
      case 'globe':
        setLive(false);
        launch('globe');
        return;
      case 'live':
        if (active === 'live') {
          document.querySelector('.wm-window[data-window-type="live"] .wm-body')?.scrollTo({ top: 0 });
          return;
        }
        // Asked for first, then the windows go: the sheet shows when the last one has left.
        setLive(true);
        if (sheet) nav.globe();
        return;
      case 'search':
        if (!paletteOpen) nav.palette();
        return;
      case 'apps':
        setLive(false);
        launch('apps');
        return;
      case 'you':
        setLive(false);
        launch(windowOfType(wm.getState(), 'operator') ? 'operator' : 'settings');
        return;
    }
  };

  return (
    <nav className={cx('shell-tabs', className)} data-region="tabs" aria-label="Sections" {...rest}>
      {PHONE_TABS.map(({ id, label }) => {
        const Icon = ICON[id];
        return (
          <button
            key={id}
            type="button"
            className="shell-tab"
            data-tab={id}
            aria-current={active === id ? 'page' : undefined}
            {...pressHandlers<HTMLButtonElement>({
              onPointerDown: id === 'live' ? liveSheet.preload : undefined,
            })}
            onClick={() => press(id)}
          >
            <span className="tab-icon">
              <Icon size={22} strokeWidth={1.6} aria-hidden="true" />
              {id === 'live' ? <LiveDot status={view.tone} className="tab-live" /> : null}
            </span>
            <span className="tab-label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
