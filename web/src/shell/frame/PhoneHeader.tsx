// The phone's header (design 3.6): no bar, the globe runs under it. Three rows: the L1 lockup with the Beat mini
// and the Live chip, the search pill (it opens the palette, `?q=`, which F2b renders full screen on a phone), and
// the aim chips, which scroll sideways. It writes its own height to the shell (`--phone-top`) so the stage and the
// windows' workspace start under it.

import { Search } from 'lucide-react';
import { type Ref, useLayoutEffect, useRef } from 'react';
import { AimStrip } from '../../features/chrome/AimStrip';
import { BeatChip, LiveChip } from '../../features/chrome/Beat';
import { FluxRound } from '../../features/chrome/brand';
import { useShellNav } from './nav';
import './phoneheader.css';

export function PhoneHeader({ ref }: { ref?: Ref<HTMLElement> }) {
  const nav = useShellNav();
  const own = useRef<HTMLElement | null>(null);

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
      ref={(el) => {
        own.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      className="phone-header"
      data-region="topbar"
    >
      <div className="ph-row">
        <a
          href="/"
          className="brand"
          aria-label="Flux Atlas, home"
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
          <BeatChip />
          <LiveChip compact />
        </div>
      </div>
      <button
        type="button"
        className="ph-search"
        onClick={() => nav.palette()}
        aria-label="Search, command palette"
      >
        <Search size={18} strokeWidth={1.5} aria-hidden="true" />
        <span>Search nodes, apps, blocks</span>
      </button>
      <AimStrip inline />
    </header>
  );
}
