// What every tab of the wallet workspace reads: the wallet itself, the viewer's money settings, the parallel assets,
// the fleet joined with the live table and the globe actions. One provider at the top of the view, so a tab is a
// function of this and nothing else, and a tab that is not open costs nothing.

import type { UseQueryResult } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext } from 'react';
import type { WalletTab } from '../../app/search';
import type { WalletFleet } from './hooks/useFleetRows';
import type { GlobeActions } from './hooks/useGlobeActions';
import type { Money } from './hooks/useMoney';
import type { Landing } from './lib/landing';
import type { ParallelAssetsDto, WalletDto } from './types';

export interface WalletCtx {
  /** The address in the route (the server may spell it differently: `dto.address`). */
  addr: string;
  dto: WalletDto;
  /** When the wallet was last fetched, unix ms of the browser's clock. */
  fetchedMs: number;
  money: Money;
  assets: UseQueryResult<ParallelAssetsDto>;
  fleet: WalletFleet;
  globe: GlobeActions;
  /** Payments that landed while the page was open, newest first. */
  landings: readonly Landing[];
  tab: WalletTab;
  setTab: (tab: WalletTab) => void;
}

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ value, children }: { value: WalletCtx; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWalletCtx(): WalletCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWalletCtx must be used inside the wallet view');
  return v;
}
