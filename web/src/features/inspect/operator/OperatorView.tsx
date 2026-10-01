import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Eye, UserRoundX } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { isApiError } from '../../../api/http';
import { useNetwork } from '../../../app/context';
import { useGlobeEngine } from '../../../globe';
import { formatInt } from '../../../lib/format';
import { useUi } from '../../../store/ui';
import { Card, EmptyState, EntityLink, ErrorState, Section, Skeleton, Stat, StatGrid } from '../../../ui';
import {
  attention,
  concentration,
  type FleetNode,
  type FleetState,
  fleetCentroid,
  flyRangeFor,
  sortByNextPayout,
  stateCounts,
  summarizeFleet,
} from '../derive/operator';
import { useFleet, useFleetEarnings, WATCHLIST_KEY } from '../sources/fleet';
import { useWatchMany } from '../sources/hooks';
import { useOpenSet } from '../ui/openset';
import { WatchAlerts } from '../watch/WatchAlerts';
import { AttentionCallouts, ConcentrationCallout } from './Callouts';
import { AddressFold, AppsFold, HardwareFold, VersionsFold } from './Details';
import { FleetGrid, STATE_WORDS } from './FleetGrid';
import { FleetTable } from './FleetTable';
import { FleetHeader } from './Header';
import { EarningsSection, FleetStats } from './Lead';
import { AlertsFold, WatchAdd } from './WatchPanel';
import '../ui/parts.css';
import './operator.css';

const LEGEND: readonly FleetState[] = ['ok', 'risk', 'down', 'pending', 'gone'];

function Legend({ counts }: { counts: Record<FleetState, number> }) {
  const shown = LEGEND.filter((k) => counts[k] > 0);
  return (
    <ul className="ix-legend" aria-label="Nodes by state">
      {shown.map((k) => (
        <li key={k} data-state={k}>
          <i aria-hidden="true" />
          <b className="ui-mono">{formatInt(counts[k])}</b> {STATE_WORDS[k].toLowerCase()}
        </li>
      ))}
    </ul>
  );
}

function OperatorSkeleton() {
  return (
    <article className="ix ix-operator" aria-busy="true" aria-label="Loading the operator">
      <div className="ix-skel-head">
        <Skeleton w={84} h={12} />
        <Skeleton w="64%" h={24} />
        <Skeleton w="48%" h={12} />
      </div>
      <div className="ix-pad ix-gap-top">
        <Skeleton h={132} radius={14} />
      </div>
      <Section>
        <StatGrid columns={3} min={104}>
          <Stat label="Healthy" loading />
          <Stat label="Next payout" loading />
          <Stat label="Per day" loading />
        </StatGrid>
      </Section>
      <Section title="Earnings">
        <StatGrid columns={3} min={104}>
          <Stat label="24 hours" loading />
          <Stat label="7 days" loading />
          <Stat label="30 days" loading />
        </StatGrid>
      </Section>
    </article>
  );
}

/** Opens a node while leaving the camera, layers and filters in the URL alone (a stale selection goes). */
function useOpenNode() {
  const navigate = useNavigate();
  return useCallback(
    (n: FleetNode) => {
      void navigate({
        to: '/node/$key',
        params: { key: n.endpoint || String(n.id) },
        search: ((prev: Record<string, unknown>) => ({ ...prev, sel: undefined })) as never,
      });
    },
    [navigate],
  );
}

/**
 * An operator: every node paid to a payment address, or (at `/operator/watchlist`) the nodes you follow.
 * It leads with what an operator comes for (how many nodes are fine, when the next payment lands, what
 * the fleet earns), then the nodes themselves, and keeps versions, hardware, apps and the address one
 * fold away. Everything follows the live node table: statuses, queue places and countdowns move on their own.
 */
export function OperatorView({ addr }: { addr: string }) {
  const data = useFleet(addr);
  const watchlist = data.mode === 'watchlist';
  const loaded = useNetwork((s) => s.loaded);
  const watched = useUi((s) => s.watched);
  const open = useOpenSet(watchlist ? 'watchlist' : 'operator', ['alerts']);
  const engine = useGlobeEngine();
  const navigate = useNavigate();
  const search = useRouterState({
    select: (s) => s.location.search as { sel?: string; watched?: boolean },
  });
  const openNode = useOpenNode();

  const nodes = data.nodes;
  const ids = useMemo(() => nodes.map((n) => n.id), [nodes]);
  const sorted = useMemo(() => sortByNextPayout(nodes), [nodes]);
  const summary = useMemo(() => summarizeFleet(nodes), [nodes]);
  const counts = useMemo(() => stateCounts(nodes), [nodes]);
  const groups = useMemo(() => attention(nodes), [nodes]);
  const risk = useMemo(() => concentration(nodes), [nodes]);
  const earn = useFleetEarnings(data);
  const watching = useWatchMany(ids);

  const endpoints = useMemo(
    () =>
      sorted
        .filter((n) => n.present && n.endpoint)
        .slice(0, 50)
        .map((n) => n.endpoint)
        .join(','),
    [sorted],
  );
  const onGlobe = watchlist ? search.watched === true : endpoints !== '' && search.sel === endpoints;
  const showOnGlobe = useCallback(() => {
    void navigate({
      to: '.',
      replace: true,
      search: ((prev: Record<string, unknown>) =>
        watchlist
          ? { ...prev, watched: onGlobe ? undefined : true }
          : { ...prev, sel: onGlobe ? undefined : endpoints }) as never,
    });
    const c = fleetCentroid(nodes);
    if (!onGlobe && c) void engine?.flyTo(c.lat, c.lon, flyRangeFor(c.spread), { tilt: 0.3 });
  }, [navigate, watchlist, onGlobe, endpoints, nodes, engine]);

  // ---- states before the data ----
  if (!watchlist && data.pending) return <OperatorSkeleton />;
  if (!watchlist && data.error) {
    const code = isApiError(data.error) ? data.error.code : null;
    if (code === 'bad_request' || code === 'not_found') {
      return (
        <article className="ix ix-operator" aria-label="Operator not found">
          <EmptyState
            icon={UserRoundX}
            title={code === 'bad_request' ? 'That is not a payment address' : 'No operator at that address'}
            pattern
          >
            Operators are found by the address their nodes are paid to (a t1 or t3 address) or by ZelID.
          </EmptyState>
        </article>
      );
    }
    return (
      <article className="ix ix-operator" aria-label="Operator unavailable">
        <ErrorState error={data.error} />
      </article>
    );
  }
  if (watchlist && watched.length === 0) {
    return (
      <article className="ix ix-operator" aria-label="Your watchlist" data-mode="watchlist">
        <EmptyState icon={Eye} title="Nothing on your watchlist yet" pattern>
          Watch a node from its page, or find one here. You are told when it goes offline, nears expiry, is
          paid or changes address.
        </EmptyState>
        <div className="ix-pad ix-gap-top">
          <WatchAdd />
        </div>
        <WatchAlerts />
      </article>
    );
  }
  if (!watchlist && loaded && nodes.length === 0) {
    return (
      <article className="ix ix-operator" aria-label="No nodes at this address">
        <EmptyState icon={UserRoundX} title="No node is paid to this address" pattern>
          The address may be new, or its nodes may have left the network.{' '}
          <EntityLink kind="address" value={addr}>
            Open the address page
          </EntityLink>
          .
        </EmptyState>
      </article>
    );
  }
  if (!loaded && nodes.length === 0) return <OperatorSkeleton />;

  const dto = data.operator;
  return (
    <article
      className="ix ix-operator"
      data-mode={data.mode}
      aria-label={watchlist ? 'Your watchlist' : `Operator ${addr}`}
    >
      <FleetHeader
        mode={data.mode}
        addr={addr === WATCHLIST_KEY ? '' : addr}
        nodes={nodes}
        counts={counts}
        settling={data.settling}
        onGlobe={onGlobe}
        onShowOnGlobe={showOnGlobe}
        watching={watching}
        onToggleWatch={watching.toggle}
      />
      {watchlist ? (
        <div className="ix-pad ix-gap-top">
          <WatchAdd />
        </div>
      ) : null}
      <AttentionCallouts groups={groups} />
      <Section>
        <FleetStats
          total={nodes.length}
          counts={counts}
          next={summary.next}
          perDay={summary.perDay}
          settling={data.settling}
        />
      </Section>
      <EarningsSection
        earnings={earn.earnings}
        pending={earn.pending}
        scope={watchlist && nodes.length > 24 ? 'open an operator for totals' : undefined}
      />
      <Section title="Nodes" aside={<span>{formatInt(nodes.length)} · soonest payout first</span>}>
        <div className="ix-stack">
          <ConcentrationCallout concentration={risk} />
          {nodes.length >= 12 ? (
            <Card tone="flat" padding="sm" className="ix-fleet-card">
              <FleetGrid nodes={sorted} onOpen={openNode} />
              <Legend counts={counts} />
            </Card>
          ) : null}
          <FleetTable nodes={sorted} label={watchlist ? 'Watched nodes' : 'Nodes of this operator'} />
        </div>
      </Section>
      <VersionsFold nodes={nodes} open={open} />
      <HardwareFold nodes={nodes} open={open} />
      <AppsFold nodes={nodes} open={open} />
      {watchlist ? (
        <AlertsFold open={open} />
      ) : (
        <AddressFold
          addr={addr}
          collateral={dto?.collateral_locked ?? null}
          tiers={dto?.tiers ?? { cumulus: 0, nimbus: 0, stratus: 0 }}
          open={open}
        />
      )}
      <WatchAlerts />
    </article>
  );
}
