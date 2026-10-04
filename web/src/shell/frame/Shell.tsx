// The shell frame: the structural regions over the persistent globe (design 2.1, 3.1, 3.6).
//
//   desktop                                    phone (under 720 px)
//   +-----------------------------------+      +-----------------+
//   | top bar                           |      | header + search |
//   +------+--------------------+-------+      |                 |
//   | dock |   globe stage      | right |      |   globe stage   |
//   |      |   (free area)      | dock- |      |                 |
//   |      |                    | ed    |      +-----------------+
//   +------+--------------------+-------+      | sheet (window)  |
//   | timeline strip + block rail       |      +-----------------+
//   | status bar                        |      | tabs            |
//   +-----------------------------------+      +-----------------+
//
// The window manager owns window geometry; the frame measures the workspace (between the top bar
// and the rail, right of the dock) and hands it over, binds windows to the URL (routing.ts), keeps
// the globe centred in the free area (setInset), and draws window tethers through the anchor system.
// Routes without a window (`/`, `/dev/live`, `/q/...`, not found) and the strip and layer types (time
// machine, weather) render in the stage's page slot.

import { Outlet, useRouterState } from '@tanstack/react-router';
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNetwork } from '../../app/context';
import { AimStrip } from '../../features/chrome/AimStrip';
import { Boot } from '../../features/chrome/boot/Boot';
import { bootInstant, finishBoot, useBootPhase } from '../../features/chrome/boot/state';
import { GlobeFocus } from '../../features/chrome/GlobeFocus';
import { useApplyLayers } from '../../features/chrome/layers';
import { lazyCard } from '../../features/chrome/lazyCard';
import { usePhone } from '../../features/chrome/phone';
import { useRootPrefs } from '../../features/chrome/prefs';
import { BlockRail } from '../../features/chrome/Rail';
import { StatusBar } from '../../features/chrome/StatusBar';
import { ToastHost } from '../../features/chrome/toasthost';
import { CommandLayer } from '../../features/command';
import {
  type Anchor,
  GlobeOverlay,
  GlobeTooltip,
  MoonProxy,
  PlaceLabels,
  Tether,
  useGlobeBinding,
} from '../../globe';
import { MoonHint } from '../../globe/overlays';
import { windowContent } from '../windowContent';
import { visibleWindows } from '../wm/machine';
import { useWm, WindowLayer, WindowManagerProvider } from '../wm/react';
import { windowForPath } from '../wm/route';
import { PHONE_MAX_W, WINDOW_SPECS } from '../wm/specs';
import { createWindowManager, type WindowManager } from '../wm/store';
import type { WindowState } from '../wm/types';
import { ShellActionsContext } from './actions';
import { Dock } from './Dock';
import { useShellKeys } from './keys';
import { useLauncher } from './launchers';
import { liveSheet } from './livegate';
import { moonParked } from './moonpark';
import { isPagePanel } from './nav';
import { PhoneHeader } from './PhoneHeader';
import { PhoneTabs } from './PhoneTabs';
import { useGlobeInsetSync, usePageEdge, useWindowRouting } from './routing';
import { focusContent } from './skip';
import { TopBar } from './TopBar';
import { WatchAlertsGate } from './watchgate';
import './frame.css';

/** The Pulse is its own chunk: it mounts with the shell and is long loaded by the time the boot is over. */
const pulse = lazyCard(() => import('../../features/chrome/Pulse').then((m) => m.Pulse));

/** The workspace stops this far from the right edge: a docked inspector floats clear of the screen (design 3.1). */
const WORKSPACE_MARGIN = 12;

const viewportNow = () => ({
  w: typeof window === 'undefined' ? 1600 : window.innerWidth,
  h: typeof window === 'undefined' ? 900 : window.innerHeight,
});

/** The whole shell; mounted once by the root route around the route outlet. */
export function Shell() {
  const [wm] = useState(() => createWindowManager({ viewport: viewportNow() }));
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const ambient = pathname === '/ambient';
  return (
    <WindowManagerProvider wm={wm}>
      <ShellFrame wm={wm} ambient={ambient} pathname={pathname} />
    </WindowManagerProvider>
  );
}

function ShellFrame({ wm, ambient, pathname }: { wm: WindowManager; ambient: boolean; pathname: string }) {
  const [phone, setPhone] = useState(() => viewportNow().w < PHONE_MAX_W);
  const topRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const bottomRef = useRef<HTMLElement>(null);
  const statusRef = useRef<HTMLElement>(null);
  const tabsRef = useRef<HTMLElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const { requestClose, focusWindow } = useWindowRouting(wm);
  const launch = useLauncher();
  const boot = useBootPhase();
  const liveOpen = usePhone((s) => s.live);
  const setLive = usePhone((s) => s.setLive);
  const sheetOpen = useWm((s) => s.layout === 'phone' && visibleWindows(s).length > 0, Object.is);
  // The bare globe: no window of any kind and no Live sheet. The first-visit hint belongs to it alone.
  const anyWindow = useWm((s) => visibleWindows(s).length > 0, Object.is);
  const bareGlobe = pathname === '/' && !anyWindow && !(phone && liveOpen);
  const actions = useMemo(() => ({ requestClose, focusWindow, launch }), [requestClose, focusWindow, launch]);
  useGlobeInsetSync(wm, ambient);
  useRootPrefs();
  useApplyLayers();
  useShellKeys(launch, !ambient);
  // The ambient screen is the moon and the planet alone: there is no boot to wait for.
  useEffect(() => {
    if (ambient) finishBoot({ instant: true });
  }, [ambient]);

  // The phone has one sheet. A window that opens over the bare globe takes it (the Live sheet gives way) and
  // the sheet rises to half; the Live sheet opening rises to half too (design 3.6). A window retargeting or
  // replacing another keeps the height the finger left.
  const sheetKind = sheetOpen ? 'window' : phone && liveOpen ? 'live' : 'none';
  // A full sheet is the whole screen: what it covers (the header) is out of reach for the keyboard and for a screen reader too.
  const sheetFull = useWm((st) => st.sheet === 'full', Object.is) && sheetKind !== 'none';
  // The moon in the header's Beat ring has a door of its own there (PhoneHeader.tsx); the proxy steps aside for it,
  // unless the sheet is full and the header is out of reach, when the proxy stays the moon's one control.
  const moonInHeader = useWm((st) => moonParked(st, liveOpen), Object.is) && !sheetFull;
  const lastKind = useRef(sheetKind);
  useEffect(() => {
    const before = lastKind.current;
    lastKind.current = sheetKind;
    if (before === sheetKind) return;
    if (sheetKind === 'window') setLive(false);
    if (before === 'none' && sheetKind !== 'none') wm.dispatch({ t: 'setSheet', snap: 'half' });
  }, [sheetKind, setLive, wm]);

  // Measure the workspace and hand it to the window manager (on resize and layout changes).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measures when the layout (ambient, phone) swaps regions
  useLayoutEffect(() => {
    const measure = () => {
      const v = viewportNow();
      const isPhone = v.w < PHONE_MAX_W;
      setPhone(isPhone);
      const top = topRef.current?.getBoundingClientRect().bottom ?? 52;
      const bottomEdge = isPhone
        ? (tabsRef.current?.getBoundingClientRect().top ?? v.h - 64)
        : (bottomRef.current?.getBoundingClientRect().top ?? v.h - 154);
      const left = isPhone ? 0 : (dockRef.current?.getBoundingClientRect().right ?? 76) + 8;
      // The tab bar stands on the bottom safe area; the window manager's sheets stand on the tab bar, so the
      // viewport it is given ends where the safe area begins.
      const safeBottom =
        isPhone && tabsRef.current
          ? Number.parseFloat(getComputedStyle(tabsRef.current).paddingBottom) || 0
          : 0;
      wm.dispatch({
        t: 'setViewport',
        viewport: { w: v.w, h: v.h - safeBottom },
        workspace: {
          x: left,
          y: top,
          w: Math.max(1, v.w - left - (isPhone ? 0 : WORKSPACE_MARGIN)),
          h: Math.max(1, bottomEdge - top),
        },
      });
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    // Every region whose size moves an edge of the free area: the top bar, the dock, the rail, the status bar
    // (a taller status bar lifts the rail without resizing it) and the phone's tab bar.
    for (const el of [topRef.current, bottomRef.current, statusRef.current, tabsRef.current, dockRef.current])
      if (el) ro?.observe(el);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [wm, ambient, phone]);

  const primary = windowForPath(pathname);
  const pageRoute = !primary || WINDOW_SPECS[primary.type].chrome !== 'window';
  // A page that draws a panel in the stage's left column, where the Pulse and the aim strip stand: they step
  // aside for it (frame.css), and the globe gives it its side like a left-floating window (usePageEdge).
  const pagePanel = isPagePanel(pathname);
  usePageEdge(pageRef, pagePanel && !phone && !ambient);

  if (ambient) {
    // Ambient: no chrome; the globe and the moon (orbit mode) are the screen (design 6.4 K).
    return (
      <div className="shell" data-layout={phone ? 'phone' : 'desktop'} data-ambient="">
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </div>
    );
  }

  return (
    <ShellActionsContext.Provider value={actions}>
      <div
        className="shell"
        data-layout={phone ? 'phone' : 'desktop'}
        data-boot={boot}
        data-boot-instant={boot === 'done' && bootInstant() ? '' : undefined}
        data-page={pagePanel ? '' : undefined}
      >
        {/* biome-ignore lint/a11y/useValidAnchor: a skip link is a link (that is what a screen reader announces); its fragment is the fallback, and it moves focus itself so the router's hash (`#all`) is left alone */}
        <a
          className="skip-link"
          href="#shell-stage"
          onClick={(e) => {
            // To what is open, not the stage's top: the window's body, the page panel, else the globe (skip.ts).
            e.preventDefault();
            focusContent(wm.getState());
          }}
        >
          Skip to content
        </a>
        <GlobeOverlay>
          <PlaceLabels />
          <GlobeTooltip />
          <MoonProxy hidden={moonInHeader} />
          <MoonHint home={bareGlobe} />
        </GlobeOverlay>
        <WindowTethers />
        {phone ? <PhoneHeader ref={topRef} inert={sheetFull || undefined} /> : <TopBar ref={topRef} />}
        {phone ? null : <Dock ref={dockRef} />}
        {phone ? null : <AimStrip />}
        {phone ? null : <GlobeFocus />}
        {phone ? null : <pulse.Card />}
        <main className="shell-stage" id="shell-stage" tabIndex={-1} data-region="stage" aria-label="Globe">
          {pageRoute ? (
            <div
              ref={pageRef}
              className="shell-page"
              data-chrome={primary ? WINDOW_SPECS[primary.type].chrome : 'page'}
            >
              <Suspense fallback={null}>
                <Outlet />
              </Suspense>
            </div>
          ) : null}
        </main>
        {phone ? <PhoneTabs ref={tabsRef} /> : <BlockRail ref={bottomRef} />}
        {phone ? null : <StatusBar ref={statusRef} />}
        <WindowLayer
          renderContent={(win: WindowState) =>
            win.binding === 'primary' && !pageRoute ? <Outlet /> : windowContent(win)
          }
          onRequestClose={requestClose}
          onFocusWindow={focusWindow}
        />
        {phone && liveOpen && !sheetOpen ? <liveSheet.Card /> : null}
        <ToastHost />
        <WatchAlertsGate />
        <CommandLayer />
        <Boot />
      </div>
    </ShellActionsContext.Provider>
  );
}

/**
 * Tethers from each window's subject on the globe to its title bar (design 6.4 A): the node marker
 * for a node inspector, the host's site for a host, just outside the moon's ring for About Flux.
 */
function WindowTethers() {
  const wins = useWm(visibleWindows);
  const layout = useWm((s) => s.layout);
  if (layout === 'phone') return null;
  return (
    <>
      {wins
        .filter((w) => WINDOW_SPECS[w.type].tether)
        .map((w) => (
          <WindowTether key={w.id} win={w} />
        ))}
    </>
  );
}

function WindowTether({ win }: { win: WindowState }) {
  const binding = useGlobeBinding();
  // Keys resolve once the snapshot is in (and again after a resync).
  const nodesLoaded = useNetwork((s) => (s.loaded ? s.snapshotGen : -1));
  const [header, setHeader] = useState<Element | null>(null);
  useEffect(() => {
    const sel = `[data-window-id="${CSS.escape(win.id)}"] .wm-titlebar`;
    setHeader(document.querySelector(sel));
  }, [win.id]);
  const docked = win.placement === 'docked';
  const kind = WINDOW_SPECS[win.type].tether;
  // biome-ignore lint/correctness/useExhaustiveDependencies: nodesLoaded re-resolves the key after a (re)load
  const from = useMemo<Anchor | null>(() => {
    if (!binding || !win.key) return kind === 'moon' ? { kind: 'moon', at: 'tether' } : null;
    if (kind === 'node') {
      const id = binding.resolveKey(win.key);
      return id === null ? null : { kind: 'node', id };
    }
    if (kind === 'cluster') {
      const site = binding.hostSite(win.key);
      return site ? { kind: 'world', lat: site.lat, lon: site.lon, alt: 0.01 } : null;
    }
    return null;
  }, [binding, kind, win.key, nodesLoaded]);
  const to = useMemo<Anchor | null>(
    () => (header ? { kind: 'element', el: header, fx: docked ? 0 : 1, fy: 0.5, dx: docked ? -2 : 2 } : null),
    [header, docked],
  );
  return <Tether from={from} to={to} />;
}
