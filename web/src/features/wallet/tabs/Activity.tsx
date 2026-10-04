// Activity: what has happened to the fleet. The chart of the fleet over the days Atlas has kept, and the feed of the
// newest events with a chart of when they happened. Every kind of event is a filter, and a search finds a node.

import { Activity } from 'lucide-react';
import { EmptyState, EntityLink } from '../../../ui';
import { useWalletCtx } from '../context';
import { Panel } from '../ui/Panel';
import { Feed } from './activity/Feed';
import { FleetPanel } from './activity/FleetPanel';
import './activity.css';

export function ActivityTab() {
  const { dto } = useWalletCtx();

  if (dto.nodes.length === 0 && dto.activity.length === 0) {
    return (
      <div className="wl-page wl-activity">
        <Panel title="Activity" icon={Activity}>
          <EmptyState compact title="No node, so nothing has happened">
            Activity is what happens to the nodes paid to an address, and none is paid to this one.{' '}
            <EntityLink kind="address" value={dto.address}>
              Open the address in the explorer
            </EntityLink>
            .
          </EmptyState>
        </Panel>
      </div>
    );
  }

  return (
    <div className="wl-page wl-activity">
      <FleetPanel />
      <Feed />
    </div>
  );
}
