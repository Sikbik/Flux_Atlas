// The shell's remaining placeholder regions: the block rail, the phone's tab bar and the boot veil.
// They are replaced one by one by the live chrome (features/chrome).

import { Link } from '@tanstack/react-router';
import { Activity, AppWindow, Globe, Search, UserRound } from 'lucide-react';
import type { Ref } from 'react';
import { useNetwork } from '../../app/context';
import { useGlobeStatus } from '../../globe';

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

/** The boot veil placeholder: lifted once the snapshot is in and the globe has drawn or cannot. */
export function BootVeil() {
  const loaded = useNetwork((s) => s.loaded);
  const status = useGlobeStatus();
  const done = loaded && status !== 'loading';
  return (
    <div className="shell-boot" data-testid="boot" data-done={done || undefined} aria-hidden={done}>
      <p className="shell-boot-line">{loaded ? 'Placing the network on the globe' : 'Connecting to Atlas'}</p>
    </div>
  );
}
