// The dock (design 2.7, 8.5): a 56 px glass pill at the left holding the launchers. Each shows its state
// (an open tick, a focus tint, a dim tick when only minimized), its label and key on hover and focus,
// and the minimized windows wait under the divider as small restore buttons. About Flux is last and is
// the brand mark itself: gray at rest, white when hovered, open or focused.

import { type CSSProperties, type Ref, useMemo } from 'react';
import { FluxMarkToggle } from '../../features/chrome/brand';
import { useWm, WindowDots } from '../wm/react';
import { useShellActions } from './actions';
import { type DockState, dockKey, parseDockKey } from './dock';
import { DOCK_MAIN, DOCK_UTILITY, keyCaps, LAUNCHERS, type LauncherId } from './launchers';
import './dock.css';

const ALL: readonly LauncherId[] = [...DOCK_MAIN, ...DOCK_UTILITY, 'about'];

const ACCENT_VAR: Record<string, string> = {
  chain: 'var(--accent-chain)',
  app: 'var(--accent-app)',
  analytics: 'var(--accent-analytics)',
  time: 'var(--accent-time)',
  operator: 'var(--accent-operator)',
  terminal: 'var(--accent-terminal)',
  pulse: 'var(--accent-pulse)',
};

function DockItem({ id, state }: { id: LauncherId; state: DockState }) {
  const { launch } = useShellActions();
  const l = LAUNCHERS[id];
  const caps = keyCaps(l);
  const Icon = l.icon;
  return (
    <button
      type="button"
      className="dk"
      data-launcher={id}
      data-state={state}
      style={{ '--dk-accent': ACCENT_VAR[l.accent] } as CSSProperties}
      aria-label={caps.length ? `${l.label}, key ${caps.join(' ')}` : l.label}
      aria-pressed={state === 'focus' ? true : undefined}
      onClick={() => launch(id)}
    >
      <span className="dk-ico">
        {Icon ? <Icon size={21} strokeWidth={1.5} aria-hidden="true" /> : <FluxMarkToggle size={19} />}
      </span>
      <span className="dk-label" aria-hidden="true">
        {l.label}
        {caps.map((k) => (
          <kbd key={k} className="kbd">
            {k}
          </kbd>
        ))}
      </span>
    </button>
  );
}

export function Dock({ ref }: { ref?: Ref<HTMLElement> }) {
  const key = useWm((s) => dockKey(s, ALL), Object.is);
  const states = useMemo(() => parseDockKey(key), [key]);
  const state = (id: LauncherId): DockState => states[id] ?? 'idle';
  return (
    <nav ref={ref} className="dock" data-region="dock" aria-label="Launchers">
      {DOCK_MAIN.map((id) => (
        <DockItem key={id} id={id} state={state(id)} />
      ))}
      <hr className="dock-rule" />
      {DOCK_UTILITY.map((id) => (
        <DockItem key={id} id={id} state={state(id)} />
      ))}
      <DockItem id="about" state={state('about')} />
      <WindowDots className="dock-dots" />
    </nav>
  );
}
