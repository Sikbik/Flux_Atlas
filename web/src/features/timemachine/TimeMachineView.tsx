// The time machine (`/time`): the shell's timeline strip opens, the globe takes the archive grade and
// replays the recorded network at the playhead. This is not a window: it renders nothing in the page
// and lays its three layers (the grade under the interface, the strip over the shell's own, the chip
// at the top of the globe) into the shell, so they share its stacking and leave it with it.
//
// Leaving is not an abrupt cut. When the view unmounts, a static copy of each layer stays for the
// length of its exit animation (the grade fades over 600 ms, the strip folds back to 22 px while the
// shell's strip does the same) and then goes.

import { type ReactNode, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnimate } from '../../ui';
import { useTimeMachine } from './hooks/useTimeMachine';
import { ArchiveChip } from './ui/ArchiveChip';
import { Grade } from './ui/Grade';
import { Strip } from './ui/Strip';
import './timemachine.css';

/** How long the copies of the layers stay while they animate out. */
const EXIT_MS = 700;

/** The element the layers go into: the shell, or the page itself where there is no shell (tests). */
function shellHost(): HTMLElement {
  return document.querySelector<HTMLElement>('.shell') ?? document.body;
}

export function TimeMachineView({ t, speed }: { t?: string | undefined; speed?: number | undefined }) {
  const data = useTimeMachine(t, speed);
  const [host] = useState(shellHost);
  const animate = useAnimate();
  const { state, ready, start, curve, now, tm } = data;
  const archive = state.mode === 'archive';

  // The hint ("drag the handle back") is for the first visit only; once the archive has shown it is done.
  const [hintDone, setHintDone] = useState(false);
  useEffect(() => {
    if (archive) setHintDone(true);
  }, [archive]);

  // Entering and leaving the archive is announced once, not every time the handle moves.
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    setAnnounce((prev) => (archive ? 'Archive view' : prev === '' ? '' : 'Back to live'));
  }, [archive]);

  useExitCopies(host, animate);
  useSheetHeight(host);

  return (
    <>
      {createPortal(
        <>
          <Grade on={archive && state.info !== null} />
          <Strip data={data} />
          <ArchiveChip
            tm={tm}
            state={state}
            now={now}
            curve={curve}
            start={start}
            ready={ready}
            hintDone={hintDone}
          />
          <Announcer>{announce}</Announcer>
        </>,
        host,
      )}
    </>
  );
}

/**
 * On a phone the strip is a sheet resting on the tab bar. Its height goes to the shell as `--tm-sheet-h`
 * (in px, only while the sheet is up), the way the phone header writes `--phone-top`, so whatever else
 * rests above the tab bar, such as the toasts, can clear it.
 */
function useSheetHeight(host: HTMLElement) {
  useLayoutEffect(() => {
    const strip = host.querySelector<HTMLElement>(':scope > .tm-strip:not([data-ghost])');
    if (!strip) return;
    const write = () => {
      if (host.dataset.layout === 'phone') {
        host.style.setProperty('--tm-sheet-h', `${Math.round(strip.getBoundingClientRect().height)}px`);
      } else {
        host.style.removeProperty('--tm-sheet-h');
      }
    };
    write();
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(write);
    watch?.observe(strip);
    // A turned or resized screen can change the layout without changing the strip's size.
    window.addEventListener('resize', write);
    return () => {
      watch?.disconnect();
      window.removeEventListener('resize', write);
      host.style.removeProperty('--tm-sheet-h');
    };
  }, [host]);
}

/** A polite live region, read once per change. */
function Announcer({ children }: { children: ReactNode }) {
  return (
    <div className="ui-sr-only" role="status" aria-live="polite">
      {children}
    </div>
  );
}

/**
 * When the view unmounts, leaves a static, inert copy of each layer in the shell for the length of its
 * exit animation. (React removes the live layers at once; the copies are what the eye follows out.)
 */
function useExitCopies(host: HTMLElement, animate: boolean) {
  useLayoutEffect(() => {
    return () => {
      if (!animate) return;
      const copies: HTMLElement[] = [];
      for (const el of host.querySelectorAll<HTMLElement>(
        ':scope > .tm-strip, :scope > .tm-chip, :scope > .tm-grade',
      )) {
        const copy = el.cloneNode(true) as HTMLElement;
        copy.setAttribute('data-ghost', '');
        copy.setAttribute('aria-hidden', 'true');
        copy.setAttribute('inert', '');
        copy.removeAttribute('id');
        host.appendChild(copy);
        copies.push(copy);
      }
      if (copies.length > 0) setTimeout(() => removeAll(copies), EXIT_MS);
    };
  }, [host, animate]);
}

function removeAll(copies: readonly HTMLElement[]): void {
  for (const c of copies) c.remove();
}
