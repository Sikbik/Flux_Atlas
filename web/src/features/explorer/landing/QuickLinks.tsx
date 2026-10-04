// The row of go-to tiles under the hero: the latest block, the mempool, the supply, the rich list and the payment queue.
// Each carries one live line. The rich list is the tile the reader came for, so it is lit a little more.

import { Box } from 'lucide-react';
import { useMemo } from 'react';
import { useRichList, useSupply } from '../../../api/queries';
import { formatCompact, formatInt } from '../../../lib/format';
import { WINDOW_ICON } from '../../../shell/wm/glyphs';
import { useBeatView } from '../../chrome/Beat';
import { HubTile, HubTiles } from '../../hub';
import { useMempoolLive } from '../hooks/useMempoolLive';
import { concentration } from '../lib/richlist';
import { supplyGlance } from './lib/supply';

export function QuickLinks() {
  const { height } = useBeatView();
  const pending = useMempoolLive();
  const supply = useSupply();
  const rich = useRichList();

  const total = useMemo(() => supplyGlance(supply.data, []).total, [supply.data]);
  const top10 = useMemo(() => {
    const entries = rich.data?.entries;
    return entries && entries.length > 0 ? concentration(entries).top(10) : null;
  }, [rich.data]);

  const Mempool = WINDOW_ICON.mempool ?? Box;
  const Supply = WINDOW_ICON.supply ?? Box;
  const RichList = WINDOW_ICON.richlist ?? Box;
  const Queue = WINDOW_ICON.queue ?? Box;

  return (
    <HubTiles label="Quick links">
      <HubTile
        icon={Box}
        title="Latest block"
        caption={height === null ? 'Reading the chain tip' : `Block ${formatInt(height)}`}
        to={{ type: 'block', key: String(height ?? 0) }}
        pending={height === null}
      />
      <HubTile
        icon={Mempool}
        title="Mempool"
        caption={
          pending.isError && pending.rows.length === 0 ? undefined : `${formatInt(pending.size)} pending`
        }
        to={{ type: 'mempool', key: null }}
      />
      <HubTile
        icon={Supply}
        title="Supply"
        caption={total === null ? undefined : `${formatCompact(total)} FLUX`}
        to={{ type: 'supply', key: null }}
      />
      <HubTile
        emphasis
        icon={RichList}
        title="Rich list"
        caption={top10 === null ? 'Who holds the supply' : `Top 10 hold ${top10.toFixed(1)}%`}
        to={{ type: 'richlist', key: null }}
      />
      <HubTile
        icon={Queue}
        title="Payment queue"
        caption="Who is paid next"
        to={{ type: 'queue', key: null }}
      />
    </HubTiles>
  );
}
