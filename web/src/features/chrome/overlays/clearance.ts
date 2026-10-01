// How far down the globe's overlays must stay to clear the chrome. The place labels and the hover cards are
// separate chunks and both read it: the anchor loop every frame, so it is a plain object that is refreshed on
// mount and on resize and never measured per frame.

import { useEffect } from 'react';

/**
 * The first y an overlay may use: under the top bar and, on the desktop frame, under the aim strip's row
 * (14 px gap, 38 px strip, 10 px air).
 */
function overlayTop(): number {
  if (typeof document === 'undefined') return 114;
  const bar = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'));
  const phone = document.querySelector('.shell')?.getAttribute('data-layout') === 'phone';
  return (Number.isFinite(bar) ? bar : 52) + (phone ? 10 : 14 + 38 + 10);
}

export const clearance = { top: 114 };

export function useClearance(): void {
  useEffect(() => {
    const sync = () => {
      clearance.top = overlayTop();
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);
}
