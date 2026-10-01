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
} from 'lucide-react';
import { FluxMarkWhite } from '../../features/chrome/brand';
import { TierGlyph } from '../../features/chrome/glyphs';
import type { WindowType } from './types';

export const WINDOW_ICON: Record<WindowType, LucideIcon | null> = {
  node: Server,
  host: Network,
  app: Boxes,
  block: Blocks,
  tx: ArrowLeftRight,
  address: Wallet,
  mempool: Layers2,
  supply: Coins,
  richlist: ListOrdered,
  queue: Coins,
  analytics: ChartNoAxesCombined,
  operator: UserRoundCheck,
  terminal: SquareTerminal,
  time: History,
  weather: CloudRain,
  about: null,
  settings: SlidersHorizontal,
};

/** The accent a window type wears by default (a Flux blue tone or white; node windows take their tier). */
export const WINDOW_ACCENT: Record<WindowType, string> = {
  node: 'operator',
  host: 'operator',
  app: 'app',
  block: 'chain',
  tx: 'chain',
  address: 'chain',
  mempool: 'chain',
  supply: 'chain',
  richlist: 'chain',
  queue: 'chain',
  analytics: 'analytics',
  operator: 'operator',
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
