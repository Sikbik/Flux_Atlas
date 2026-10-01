import { Eye, EyeOff, Globe, LocateFixed, UserRound } from 'lucide-react';
import { useMemo } from 'react';
import { useGlobeEngine } from '../../../globe';
import { formatInt } from '../../../lib/format';
import { Button, Hash, IconButton, StatusChip, TierChip, ViewHeader } from '../../../ui';
import {
  type FleetNode,
  type FleetState,
  fleetCentroid,
  fleetPlace,
  fleetState,
  flyRangeFor,
  type TierMix,
  tierMix,
} from '../derive/operator';
import type { QueueTier } from '../derive/queue';
import { useSoleGeo } from '../sources/watchRoster';
import { LocationMap } from '../ui/locationmap';
import type { MapPoint } from '../ui/map';

const TONE: Record<FleetState, MapPoint['tone']> = {
  ok: 'ok',
  risk: 'warn',
  down: 'crit',
  pending: 'off',
  gone: 'off',
};

/** The fleet's one-line health as chips: everything fine, or the problems by weight. */
function HealthChips({ counts, total }: { counts: Record<FleetState, number>; total: number }) {
  if (total === 0) return null;
  if (counts.ok === total) return <StatusChip status="confirmed" label="All healthy" size="sm" />;
  return (
    <>
      {counts.down > 0 ? (
        <StatusChip status="offline" label={`${formatInt(counts.down)} down`} size="sm" />
      ) : null}
      {counts.risk > 0 ? (
        <StatusChip status="at-risk" label={`${formatInt(counts.risk)} need attention`} size="sm" />
      ) : null}
      {counts.pending > 0 ? (
        <StatusChip status="pending" label={`${formatInt(counts.pending)} not confirmed`} size="sm" />
      ) : null}
      {counts.gone > 0 ? (
        <StatusChip status="departed" label={`${formatInt(counts.gone)} gone`} size="sm" />
      ) : null}
    </>
  );
}

export interface FleetHeaderProps {
  mode: 'operator' | 'watchlist';
  addr: string;
  nodes: readonly FleetNode[];
  counts: Record<FleetState, number>;
  /** The fleet is on the globe (selection or watched filter in the URL). */
  onGlobe: boolean;
  onShowOnGlobe: () => void;
  /** Watching the whole fleet: how many of its nodes are on the watchlist and the toggle. */
  watching: { all: boolean; some: number; room: number };
  onToggleWatch: () => void;
}

/** The head of an operator or watchlist view: kind, address, place, health chips and the few actions. */
export function FleetHeader({
  mode,
  addr,
  nodes,
  counts,
  onGlobe,
  onShowOnGlobe,
  watching,
  onToggleWatch,
}: FleetHeaderProps) {
  const engine = useGlobeEngine();
  const watchlist = mode === 'watchlist';
  const mix: TierMix = useMemo(() => tierMix(nodes), [nodes]);
  const dominant: QueueTier | undefined = (['stratus', 'nimbus', 'cumulus'] as const).find((t) => mix[t] > 0);
  const centre = useMemo(() => fleetCentroid(nodes), [nodes]);
  const sole = useSoleGeo(nodes);
  const place = useMemo(() => fleetPlace(nodes, sole), [nodes, sole]);

  return (
    <>
      <ViewHeader
        kind={watchlist ? 'Watchlist' : 'Operator'}
        icon={watchlist ? Eye : UserRound}
        title={watchlist ? 'Your watchlist' : <Hash value={addr} head={8} tail={6} what="payment address" />}
        mono={!watchlist}
        subtitle={
          watchlist
            ? `${formatInt(nodes.length)} ${nodes.length === 1 ? 'node' : 'nodes'} you follow, kept on this device`
            : `${formatInt(nodes.length)} ${nodes.length === 1 ? 'node' : 'nodes'} paid to this address`
        }
        tier={dominant}
        freshness={
          <span className="ix-tools">
            {watchlist ? null : (
              <Button
                size="sm"
                icon={watching.all ? EyeOff : Eye}
                aria-pressed={watching.all}
                disabled={nodes.length === 0 || (!watching.all && watching.room === 0)}
                onClick={onToggleWatch}
                title={
                  watching.all
                    ? 'Stop watching this fleet'
                    : watching.room < nodes.length
                      ? `Watch the first ${formatInt(watching.room)} nodes: the server follows up to 64 nodes live`
                      : 'Watch every node of this fleet: alerts when one goes offline, nears expiry, is paid or moves'
                }
              >
                {watching.all ? 'Watching' : 'Watch all'}
              </Button>
            )}
            <IconButton
              size="sm"
              variant="secondary"
              icon={LocateFixed}
              label="Fly to the fleet"
              disabled={!centre || !engine}
              onClick={() => {
                if (centre)
                  void engine?.flyTo(centre.lat, centre.lon, flyRangeFor(centre.spread), { tilt: 0.3 });
              }}
            />
            <IconButton
              size="sm"
              variant="secondary"
              icon={Globe}
              label={onGlobe ? 'The fleet is shown on the globe' : 'Show the fleet on the globe'}
              aria-pressed={onGlobe}
              disabled={nodes.length === 0}
              onClick={onShowOnGlobe}
            />
          </span>
        }
      >
        <HealthChips counts={counts} total={nodes.length} />
        {(['stratus', 'nimbus', 'cumulus'] as const).map((t) =>
          mix[t] > 0 ? (
            <TierChip key={t} tier={t} size="sm" label={`${formatInt(mix[t])} ${tierName(t)}`} />
          ) : null,
        )}
      </ViewHeader>
      <div className="ix-pad ix-gap-top">
        <FleetMap nodes={nodes} dominant={dominant} place={place} />
      </div>
    </>
  );
}

const tierName = (t: QueueTier) => t.charAt(0).toUpperCase() + t.slice(1);

function FleetMap({
  nodes,
  dominant,
  place,
}: {
  nodes: readonly FleetNode[];
  dominant: QueueTier | undefined;
  place: { lead: string; detail: string };
}) {
  const points = useMemo<MapPoint[]>(
    () =>
      nodes
        .filter((n) => n.lat !== null && n.lon !== null)
        .slice(0, 600)
        .map((n) => ({
          id: n.id,
          lat: n.lat as number,
          lon: n.lon as number,
          tier: n.tier,
          tone: TONE[fleetState(n)],
        })),
    [nodes],
  );
  return (
    <LocationMap
      points={points}
      label={`Map of ${place.lead}`}
      tier={dominant}
      minSpan={nodes.length > 1 ? 10 : 13}
      caption={
        <>
          <b>{place.lead}</b>
          <span>{place.detail}</span>
        </>
      }
    />
  );
}
