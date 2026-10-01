// How far down the globe's overlays must stay to clear the chrome. The place labels and the hover cards are
// separate chunks and both read it: the anchor loop every frame, so it is a plain object that is refreshed on
// mount and on resize and never measured per frame.

import { useEffect } from 'react';
import { MOON_LEFT_CLEAR } from '../cardplace';

/**
 * The first y an overlay may use: under the top bar and, on the desktop frame, under the aim strip's row
 * (14 px gap, 38 px strip, 10 px air); on the phone under its header, which writes its bottom edge to the shell
 * (`--phone-top`).
 */
function overlayTop(shell: Element | null): number {
  if (typeof document === 'undefined') return 114;
  if (shell?.getAttribute('data-layout') === 'phone') {
    const top = Number.parseFloat(getComputedStyle(shell).getPropertyValue('--phone-top'));
    return (Number.isFinite(top) ? top : 158) + 10;
  }
  const bar = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'));
  return (Number.isFinite(bar) ? bar : 52) + 14 + 38 + 10;
}

/** `top`: the first y an overlay may use; `left`: how far from the screen's left edge a card keeps (the dock). */
export const clearance = { top: 114, left: 42 };

export function useClearance(): void {
  useEffect(() => {
    const shell = document.querySelector('.shell');
    const sync = () => {
      clearance.top = overlayTop(shell);
      clearance.left = shell?.getAttribute('data-layout') === 'phone' ? 0 : MOON_LEFT_CLEAR;
    };
    sync();
    window.addEventListener('resize', sync);
    // The phone's header writes its height to the shell, and the layout attribute changes with the width.
    const watch = shell ? new MutationObserver(sync) : null;
    if (shell) watch?.observe(shell, { attributes: true, attributeFilter: ['style', 'data-layout'] });
    return () => {
      window.removeEventListener('resize', sync);
      watch?.disconnect();
    };
  }, []);
}
