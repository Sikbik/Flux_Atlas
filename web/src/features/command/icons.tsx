// Row glyphs: one Lucide icon per row kind, the kit's tier glyph for nodes and the official Flux mark for the
// moon (About). Shared by the palette, the results page and the terminal's link rows.

import {
  ArrowLeftRight,
  Award,
  Binary,
  Box,
  Boxes,
  Building2,
  ChartColumn,
  CloudSun,
  Compass,
  Eye,
  Flag,
  Gauge,
  Globe,
  History,
  Info,
  Link2,
  ListFilter,
  ListOrdered,
  type LucideIcon,
  MapPin,
  Network,
  Orbit,
  Palette,
  Search,
  Server,
  Settings,
  Sparkles,
  SquareTerminal,
  Tag,
  Telescope,
  UserRound,
  Volume2,
  Wallet,
  WalletCards,
  Wind,
} from 'lucide-react';
import { TierGlyph } from '../../ui';
import { FLUX_MARK_WHITE } from './brand';
import type { IconId, TierName } from './palette/types';

const ICONS: Record<Exclude<IconId, 'moon'>, LucideIcon> = {
  node: Server,
  host: Server,
  provider: Building2,
  app: Boxes,
  block: Box,
  tx: ArrowLeftRight,
  address: Wallet,
  wallet: WalletCards,
  operator: UserRound,
  country: Flag,
  city: MapPin,
  version: Tag,
  place: Compass,
  globe: Globe,
  queue: ListOrdered,
  analytics: ChartColumn,
  explorer: Telescope,
  time: History,
  weather: CloudSun,
  terminal: SquareTerminal,
  settings: Settings,
  award: Award,
  ambient: Orbit,
  mesh: Network,
  filter: ListFilter,
  art: Palette,
  perf: Gauge,
  motion: Wind,
  sound: Volume2,
  link: Link2,
  info: Info,
  egg: Sparkles,
  search: Search,
  watch: Eye,
};

/** The glyph of a row: the tier meter for nodes, the Flux mark for the moon, a Lucide icon otherwise. */
export function RowIcon({ id, tier, size = 16 }: { id: IconId; tier?: TierName | undefined; size?: number }) {
  if (id === 'node' && tier) return <TierGlyph tier={tier} size={size + 2} />;
  if (id === 'moon')
    return <img src={FLUX_MARK_WHITE} alt="" width={size - 1} height={size} draggable={false} />;
  const Icon = ICONS[id] ?? Binary;
  return <Icon size={size} strokeWidth={1.75} aria-hidden="true" />;
}
