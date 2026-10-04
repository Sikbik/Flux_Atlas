// The glyph each window type wears in its title bar disc and in the Window menu (design 5.4, 8.3):
// Lucide line icons, the tier capsule for a node, the symbol mark for About Flux.

import {
  ArrowLeftRight,
  Blocks,
  Boxes,
  ChartNoAxesCombined,
  CloudRain,
  Coins,
  History,
  Layers2,
  ListOrdered,
  type LucideIcon,
  Network,
  Server,
  SlidersHorizontal,
  SquareTerminal,
  UserRoundCheck,
  Wallet,
  WalletCards,
} from 'lucide-react';
import { FluxMarkWhite } from '../../features/chrome/brand';
import { TierGlyph } from '../../ui';
import type { WindowType } from './types';

export const WINDOW_ICON: Record<WindowType, LucideIcon | null> = {
  nodes: Server,
  node: Server,
  host: Network,
  apps: Boxes,
  app: Boxes,
  explorer: Blocks,
  block: Blocks,
  tx: ArrowLeftRight,
  address: Wallet,
  mempool: Layers2,
  supply: Coins,
  richlist: ListOrdered,
  queue: Coins,
  analytics: ChartNoAxesCombined,
  operator: UserRoundCheck,
  wallet: WalletCards,
  terminal: SquareTerminal,
  time: History,
  weather: CloudRain,
  about: null,
  settings: SlidersHorizontal,
};

/** The accent a window type wears by default (a Flux blue tone or white; node windows take their tier). */
export const WINDOW_ACCENT: Record<WindowType, string> = {
  nodes: 'operator',
  node: 'operator',
  host: 'operator',
  apps: 'app',
  app: 'app',
  explorer: 'chain',
  block: 'chain',
  tx: 'chain',
  address: 'chain',
  mempool: 'chain',
  supply: 'chain',
  richlist: 'chain',
  queue: 'chain',
  analytics: 'analytics',
  operator: 'operator',
  wallet: 'operator',
  terminal: 'terminal',
  time: 'time',
  weather: 'time',
  about: 'chain',
  settings: 'pulse',
};

export function WindowGlyph({ type, tier, size = 16 }: { type: WindowType; tier?: string; size?: number }) {
  if (type === 'about') return <FluxMarkWhite size={size} />;
  if (type === 'node' && tier && tier !== 'unknown')
    return <TierGlyph tier={tier as 'cumulus' | 'nimbus' | 'stratus'} size={size + 2} />;
  const Icon = WINDOW_ICON[type];
  return Icon ? <Icon size={size} strokeWidth={1.5} aria-hidden="true" /> : null;
}
