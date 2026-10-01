// The shell's remaining placeholder region: the phone's tab bar. It is replaced by the live chrome
// (features/chrome).

import { Link } from '@tanstack/react-router';
import { Activity, AppWindow, Globe, Search, UserRound } from 'lucide-react';
import type { Ref } from 'react';

/** The phone's five tabs (design 3.6). */
export function PhoneTabs({ ref }: { ref?: Ref<HTMLElement> }) {
  return (
    <nav ref={ref} className="shell-tabs" data-region="tabs" aria-label="Tabs">
      <Link to="/" className="shell-tab" activeOptions={{ exact: true }}>
        <Globe size={20} aria-hidden="true" />
        Globe
      </Link>
      <Link to="/mempool" className="shell-tab">
        <Activity size={20} aria-hidden="true" />
        Live
      </Link>
      <button type="button" className="shell-tab" disabled>
        <Search size={20} aria-hidden="true" />
        Search
      </button>
      <button type="button" className="shell-tab" disabled>
        <AppWindow size={20} aria-hidden="true" />
        Apps
      </button>
      <Link to="/settings" className="shell-tab">
        <UserRound size={20} aria-hidden="true" />
        You
      </Link>
    </nav>
  );
}
