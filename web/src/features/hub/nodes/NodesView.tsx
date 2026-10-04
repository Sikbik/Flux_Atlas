// /nodes: the network, node by node. What the Nodes dock button opens. The hero is how many nodes the network has
// confirmed, by tier and how healthy; under it a search that finds a node or a host in place, the go-to tiles, and
// panels for who runs the nodes, what is happening to them right now, where they run and what they run, how spread out
// the network is, who is paid next, how the nodes benchmark, how old they are and which are the newest. Every panel
// owns its own loading, empty and error state, so one endpoint being down never blanks the page.

import { Server } from 'lucide-react';
import { ViewHeader } from '../../../ui';
import { Hub, HubGrid, HubSearch, HubStack, useHashAnchor, useOperators } from '..';
import { ActivityPanel } from './ActivityPanel';
import { AgePanel } from './AgePanel';
import { BenchmarksPanel } from './BenchmarksPanel';
import { DecentralizationPanel } from './DecentralizationPanel';
import { GeographyPanel, HostingPanel, VersionsPanel } from './DistributionPanels';
import { NewestPanel } from './NewestPanel';
import { NodesHero } from './NodesHero';
import { NodeTiles } from './NodeTiles';
import { OperatorsPanel } from './OperatorsPanel';
import { QueuePanel } from './QueuePanel';

const GROUPS = ['nodes', 'hosts'] as const;

const EXAMPLES = [
  { label: 'Hetzner', text: 'hetzner' },
  { label: 'OVH', text: 'ovh' },
];

export function NodesView() {
  const operators = useOperators('zelid');
  // `/nodes#operators` scrolls to the leaderboard once it has something to show in place of its skeleton.
  useHashAnchor(!operators.isPending);

  return (
    <Hub>
      <ViewHeader
        kind="Nodes"
        icon={Server}
        title="The network, node by node"
        subtitle="Who runs the nodes, where they run, how they are doing and who is paid next."
      />
      <HubStack>
        <HubSearch
          label="Search the nodes"
          placeholder="IP address, collateral outpoint or provider"
          groups={GROUPS}
          hint="Paste an IP address or a node's collateral outpoint, or type a provider. Enter opens the first match."
          examples={EXAMPLES}
          emptyTitle={(text) => `No node, host or provider matches '${text}'`}
          emptyText="Check the spelling, or paste the whole IP address or outpoint."
        />
        <NodesHero />
        <NodeTiles />
        <HubGrid>
          <OperatorsPanel />
          <ActivityPanel />
          <QueuePanel />
          <GeographyPanel />
          <HostingPanel />
          <VersionsPanel />
          <DecentralizationPanel />
          <AgePanel />
          <BenchmarksPanel />
          <NewestPanel />
        </HubGrid>
      </HubStack>
    </Hub>
  );
}
