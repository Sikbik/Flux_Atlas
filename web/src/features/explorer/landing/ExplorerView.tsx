// /explorer: the chain, live. What the Explorer dock button opens. The hero is the chain's height with the way to the
// latest block; under it a search that finds blocks, transactions and addresses in place, the go-to tiles, and panels
// for the latest blocks, the mempool, who holds the supply, the long-range figures and the supply. Every panel owns its
// own loading, empty and error state, so one endpoint being down never blanks the page.

import { Blocks } from 'lucide-react';
import { ViewHeader } from '../../../ui';
import { useBeatView } from '../../chrome/Beat';
import { Hub, HubGrid, HubSearch, HubStack } from '../../hub';
import { DEV_FUND_ADDRESS, SWAP_POOL_ADDRESS } from '../lib/entities';
import { ActivityPanel } from './ActivityPanel';
import { ChainHero } from './ChainHero';
import { LatestBlocksPanel } from './LatestBlocksPanel';
import { MempoolPanel } from './MempoolPanel';
import { QuickLinks } from './QuickLinks';
import { RichListPanel } from './RichListPanel';
import { SupplyPanel } from './SupplyPanel';

const GROUPS = ['blocks', 'txs', 'addresses'] as const;

export function ExplorerView() {
  const { height } = useBeatView();
  const examples = [
    ...(height === null ? [] : [{ label: `Block ${height.toLocaleString('en-US')}`, text: String(height) }]),
    { label: 'Dev fund', text: DEV_FUND_ADDRESS },
    { label: 'Swap pool', text: SWAP_POOL_ADDRESS },
  ];
  return (
    <Hub>
      <ViewHeader
        kind="Explorer"
        icon={Blocks}
        title="The chain, live"
        subtitle="Blocks as they land, what is waiting for the next one, the long view, and who holds the supply."
      />
      <HubStack>
        <HubSearch
          label="Search the chain"
          placeholder="Block height, block or transaction hash, or address"
          groups={GROUPS}
          hint="Paste a height, a hash or an address. Enter opens the first match."
          examples={examples}
          emptyTitle={(text) => `No block, transaction or address matches '${text}'`}
          emptyText="Check the spelling, or paste the whole hash or address."
        />
        <ChainHero />
        <QuickLinks />
        <HubGrid>
          <LatestBlocksPanel />
          <MempoolPanel />
          <RichListPanel />
          <ActivityPanel />
          <SupplyPanel />
        </HubGrid>
      </HubStack>
    </Hub>
  );
}
