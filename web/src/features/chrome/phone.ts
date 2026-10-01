// What only the phone has: the Live sheet (design 3.6). The sheet is the Pulse, the beat, the next payees, the
// recent blocks and the totals in one place, because the phone has no Pulse card, no rail and no status bar. It
// is a view over the bare globe, not a route: opening any window closes it, and opening it closes the windows.

import { create } from 'zustand';

interface PhoneState {
  live: boolean;
  setLive(open: boolean): void;
}

export const usePhone = create<PhoneState>()((set) => ({
  live: false,
  setLive: (live) => set((s) => (s.live === live ? s : { live })),
}));
