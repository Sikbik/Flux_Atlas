// The phone's header (design 3.6): no bar, the globe runs under it. Three rows: the L1 lockup with the Beat mini
// and the Live chip, the search pill (it opens the palette, `?q=`, which F2b renders full screen on a phone), and
// the aim chips, which scroll sideways. It writes its own height to the shell (`--phone-top`) so the stage and the
// windows' workspace start under it. While a tall sheet covers the moon's orbit the moon parks in the Beat mini's
// ring (moonpark.ts): the header opens a window in its scrim there and the ring's tap opens About Flux.

import { Search } from 'lucide-react';
import { type ComponentPropsWithRef, useLayoutEffect, useMemo, useRef } from 'react';
import { AimStrip } from '../../features/chrome/AimStrip';
import { BeatChip, LiveChip } from '../../features/chrome/Beat';
import { FluxRound } from '../../features/chrome/brand';
import { GlobeFocus } from '../../features/chrome/GlobeFocus';
import { usePhone } from '../../features/chrome/phone';
import { useGlobeEngine } from '../../globe';
import { cx } from '../../ui';
import { pressHandlers } from '../../ui/internal/press';
import { mergeRefs } from '../../ui/internal/refs';
import { useWm } from '../wm/react';
import { moonParked, useMoonPark } from './moonpark';
import { useShellNav } from './nav';
import './phoneheader.css';

/** The header. The root takes a ref, a class and a style; its controls carry `data-pressed` while held. */
export function PhoneHeader({ ref, className, ...rest }: ComponentPropsWithRef<'header'>) {
  const nav = useShellNav();
  const engine = useGlobeEngine();
  const own = useRef<HTMLElement | null>(null);
  const setRoot = useMemo(() => mergeRefs<HTMLElement>(own, ref), [ref]);
  // The moon parks in the Beat ring while a tall sheet covers its orbit.
  const liveOpen = usePhone((s) => s.live);
  const parked = useWm((s) => moonParked(s, liveOpen), Object.is);
  useMoonPark(own, parked);

  // The header's height is the stage's top edge; the shell's CSS reads it.
  useLayoutEffect(() => {
    const el = own.current;
    const shell = el?.closest<HTMLElement>('.shell');
    if (!el || !shell || typeof ResizeObserver === 'undefined') return;
    const sync = () =>
      shell.style.setProperty('--phone-top', `${Math.round(el.getBoundingClientRect().bottom)}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      ro.disconnect();
      shell.style.removeProperty('--phone-top');
    };
  }, []);

  return (
    <header
      ref={setRoot}
      className={cx('phone-header', className)}
      data-region="topbar"
      data-parked={parked ? '' : undefined}
      {...rest}
    >
      <div className="ph-row">
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
        <div className="ph-live">
          <div className="ph-beat">
            {parked ? (
              // The moon's door while it sits in the ring: a tap on the moon opens About Flux (design 3.6). It is
              // the one control for the moon then (the proxy steps aside, Shell.tsx), so it carries the same name.
              <button
                type="button"
                className="ph-moon-door"
                aria-label="About Flux, live network totals"
                aria-haspopup="dialog"
                {...pressHandlers<HTMLButtonElement>()}
                onClick={() => engine?.moonClick()}
              />
            ) : null}
            <BeatChip />
          </div>
          <LiveChip compact />
        </div>
      </div>
      <button
        type="button"
        className="ph-search"
        {...pressHandlers<HTMLButtonElement>()}
        onClick={() => nav.palette()}
        aria-label="Search, command palette"
      >
        <Search size={18} strokeWidth={1.5} aria-hidden="true" />
        <span>Search nodes, apps, blocks</span>
      </button>
      <AimStrip inline />
      <GlobeFocus inline />
    </header>
  );
}
