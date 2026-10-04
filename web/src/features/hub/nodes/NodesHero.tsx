// The Nodes hub's hero: how many nodes the network has confirmed as the one big figure, the nodes by tier as a
// honeycomb beside it, how healthy they are as a strip under it, and the figures that say how they are spread (hosts,
// countries, providers) and how many are on their way in or out (started, listed for DoS). The figure and the
// honeycomb come from the live summary and need no request; the health strip reads the nodes overview and owns its own
// states. Every figure that is not known says so; none shows a zero in its place.

import { useSummary } from '../../../app/context';
import { AnimatedNumber, StatusChip } from '../../../ui';
import { useLiveView } from '../../chrome/live';
import { HubFigure, HubFigures, HubHero } from '..';
import { HealthStrip } from './HealthStrip';
import { TierGraphic } from './TierGraphic';
import './nodes.css';

/** The connection states as the kit's status words. */
const CONNECTION_STATUS: Record<string, string> = {
  live: 'live',
  syncing: 'syncing',
  connecting: 'syncing',
  idle: 'syncing',
  reconnecting: 'degraded',
  offline: 'error',
  closed: 'unknown',
};

export function NodesHero() {
  const summary = useSummary();
  const live = useLiveView();
  const loading = summary === null;

  return (
    <HubHero
      className="nd-hero"
      aria-label="The nodes now"
      label="Confirmed nodes"
      loading={loading}
      value={<AnimatedNumber value={summary?.node_count ?? null} countUpOnMount />}
      aside={
        <StatusChip
          size="sm"
          status={CONNECTION_STATUS[live.status]}
          label={live.detail ? `${live.label} ${live.detail}` : live.label}
        />
      }
      caption="Nodes the network has confirmed, in three tiers."
      visual={<TierGraphic counts={summary?.tiers} />}
    >
      <div className="nd-hero__lower">
        <HealthStrip />
        <HubFigures>
          <HubFigure
            label="Hosts"
            value={summary ? <AnimatedNumber value={summary.host_count} /> : null}
            note="distinct IP addresses"
            loading={loading}
          />
          <HubFigure
            label="Countries"
            value={summary ? <AnimatedNumber value={summary.country_count} /> : null}
            note="with a located node"
            loading={loading}
          />
          <HubFigure
            label="Providers"
            value={summary ? <AnimatedNumber value={summary.provider_count} /> : null}
            note="by network (AS)"
            loading={loading}
          />
          <HubFigure
            label="Started"
            value={summary ? <AnimatedNumber value={summary.started_count} /> : null}
            note="waiting to confirm"
            loading={loading}
          />
          <HubFigure
            label="On the DoS list"
            value={summary ? <AnimatedNumber value={summary.dos_count} /> : null}
            note="missed their confirmation"
            loading={loading}
          />
        </HubFigures>
      </div>
    </HubHero>
  );
}
