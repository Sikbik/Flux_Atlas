// The small nav every explorer view wears in its header: the landing, the latest block, the mempool, the supply and the
// rich list. A reader on any of them is one click from the others, and the way back to the landing is always there.

import { Blocks, Box } from 'lucide-react';
import { useTip } from '../../../app/context';
import { WINDOW_ICON } from '../../../shell/wm/glyphs';
import { HubNav, type HubNavItem } from '../../hub';

export type ExplorerPage = 'explorer' | 'latest' | 'mempool' | 'supply' | 'richlist';

export function ExplorerNav({ current }: { current?: ExplorerPage }) {
  const tip = useTip();
  const items: HubNavItem[] = [
    { id: 'explorer', label: 'Explorer', to: { type: 'explorer', key: null }, icon: Blocks },
    {
      id: 'latest',
      label: 'Latest block',
      to: { type: 'block', key: String(tip?.height ?? 0) },
      icon: Box,
      hidden: !tip,
    },
    {
      id: 'mempool',
      label: 'Mempool',
      to: { type: 'mempool', key: null },
      icon: WINDOW_ICON.mempool ?? undefined,
    },
    {
      id: 'supply',
      label: 'Supply',
      to: { type: 'supply', key: null },
      icon: WINDOW_ICON.supply ?? undefined,
    },
    {
      id: 'richlist',
      label: 'Rich list',
      to: { type: 'richlist', key: null },
      icon: WINDOW_ICON.richlist ?? undefined,
    },
  ];
  return <HubNav label="Explorer" items={items} current={current} className="hub-nav--row" />;
}
