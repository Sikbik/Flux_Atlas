// One glyph per achievement: a Lucide icon, or the Flux mark for the first one. Lucide only, no emoji.

import {
  Activity,
  Blocks,
  Boxes,
  CircleDashed,
  Clock,
  Coins,
  Command,
  Crosshair,
  Eye,
  Globe,
  History,
  Link,
  type LucideIcon,
  Network,
  Orbit,
  Rewind,
  Server,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  TrendingDown,
  UserRoundCheck,
  Wifi,
  ZoomIn,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { FLUX_MARK_WHITE } from '../command/brand';
import type { AchievementIcon } from './catalog';

const ICONS: Record<Exclude<AchievementIcon, 'mark'>, LucideIcon> = {
  server: Server,
  globe: Globe,
  'zoom-in': ZoomIn,
  network: Network,
  boxes: Boxes,
  history: History,
  rewind: Rewind,
  blocks: Blocks,
  coins: Coins,
  crosshair: Crosshair,
  orbit: Orbit,
  clock: Clock,
  'trending-down': TrendingDown,
  wifi: Wifi,
  command: Command,
  'circle-dashed': CircleDashed,
  'square-terminal': SquareTerminal,
  activity: Activity,
  eye: Eye,
  'user-round-check': UserRoundCheck,
  link: Link,
  'sliders-horizontal': SlidersHorizontal,
  sparkles: Sparkles,
};

/** The Flux symbol mark at icon size (the first achievement's glyph). */
export function FluxMarkIcon({ size = 16 }: { size?: number }) {
  return <img src={FLUX_MARK_WHITE} alt="" width={Math.round(size * 0.86)} height={size} draggable={false} />;
}

/** The component for an icon id, taking the icon `size` prop. */
export function achievementIcon(id: AchievementIcon): ComponentType<{ size?: number }> {
  return id === 'mark' ? FluxMarkIcon : ICONS[id];
}

export function AchievementGlyph({ icon, size = 18 }: { icon: AchievementIcon; size?: number }) {
  const Icon = achievementIcon(icon);
  return <Icon size={size} />;
}
