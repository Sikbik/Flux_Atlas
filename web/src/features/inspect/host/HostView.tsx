import { useQuery } from '@tanstack/react-query';
import { House, LocateFixed, SearchX, Server } from 'lucide-react';
import { useMemo } from 'react';
import { queries } from '../../../api/queries';
import { useNetwork, useTip } from '../../../app/context';
import { useGlobeEngine } from '../../../globe';
import { formatInt, parseEndpoint } from '../../../lib/format';
import {
  AnimatedNumber,
  Chip,
  CopyButton,
  EmptyState,
  EntityLink,
  IconButton,
  Section,
  Skeleton,
  Stat,
  StatGrid,
  StatusChip,
  TierChip,
  tierLabel,
  ViewHeader,
} from '../../../ui';
import { countryName } from '../derive/appSpec';
import { blocksSinceConfirm } from '../derive/expiry';
import { fluxPerDay, positionOf } from '../derive/queue';
import { isQuietKind, type NodeStatusKind, nodeStatusKind } from '../derive/statusKind';
import { useHostRows } from '../sources/hooks';
import { useHostLive } from '../sources/host';
import { useQueues, useTierInfo } from '../sources/live';
import { HostLadder } from '../ui';
import { LocationMap } from '../ui/locationmap';
import type { MapPoint } from '../ui/map';
import { useOpenSet } from '../ui/openset';
import '../ui/parts.css';
import { type HostPlace, LocationFold, OperatorsFold } from './Details';
import { HostNodes, type HostRow } from './Nodes';
import './host.css';

const TIER_ORDER = ['stratus', 'nimbus', 'cumulus'] as const;

/**
 * Three tiles: three across when each can hold its figure, otherwise two with the third across the whole
 * row (see `.ix-host-trio` in host.css).
 */
const TRIO_MIN = 156;

const fmt2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const WORD: Partial<Record<NodeStatusKind, string>> = {
  'at-risk': 'at risk',
  expired: 'expired',
  offline: 'offline',
  unreachable: 'unreachable',
  started: 'not confirmed',
  dos: 'DoS listed',
  departed: 'gone',
  unknown: 'unknown',
};

const coord = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(2)} ${v >= 0 ? pos : neg}`;

/**
 * The host's health as chips: everything fine, or the problems by kind with how many nodes have each. While the
 * server's node list, which says whether each node is reachable, is still arriving, a problem is shown as soon as
 * it is known but "healthy" waits, since it would only be a guess.
 */
function HealthChips({ kinds, settling }: { kinds: readonly NodeStatusKind[]; settling: boolean }) {
  if (kinds.length === 0) return null;
  if (kinds.every(isQuietKind)) {
    if (settling) return null;
    return <StatusChip status="confirmed" label={kinds.length === 1 ? 'Healthy' : 'All healthy'} size="sm" />;
  }
  const by = new Map<NodeStatusKind, number>();
  for (const k of kinds) if (!isQuietKind(k)) by.set(k, (by.get(k) ?? 0) + 1);
  return (
    <>
      {[...by].map(([k, n]) => (
        <StatusChip
          key={k}
          status={k}
          size="sm"
          {...(kinds.length > 1 ? { label: `${formatInt(n)} ${WORD[k] ?? k}` } : null)}
        />
      ))}
    </>
  );
}

function HostSkeleton() {
  return (
    <article className="ix ix-host" aria-busy="true" aria-label="Loading the host">
      <div className="ix-host-skel">
        <Skeleton w={72} h={12} />
        <Skeleton w="58%" h={24} />
        <Skeleton w="46%" h={12} />
      </div>
      <div className="ix-pad ix-gap-top">
        <Skeleton h={140} radius={14} />
      </div>
      <Section>
        <StatGrid min={TRIO_MIN} className="ix-host-trio">
          <Stat label="Nodes" loading />
          <Stat label="Per day" loading />
          <Stat label="Paid to" loading />
        </StatGrid>
      </Section>
      <Section title="Nodes">
        <div className="ix-host-skel">
          <Skeleton h={34} />
          <Skeleton h={34} />
          <Skeleton h={34} />
        </div>
      </Section>
    </article>
  );
}

/**
 * A host: every node that shares an IP (UPnP hosts run up to eight on ports 16127 to 16197). It leads with
 * where the host is, how many nodes it runs and what they earn, then lists the nodes by port with their
 * queue places. A host whose nodes all pay one address is one failure domain, so the Operators fold says so.
 */
export function HostView({ ip }: { ip: string }) {
  const loaded = useNetwork((s) => s.loaded);
  const tip = useTip()?.height;
  const engine = useGlobeEngine();
  const { live, other } = useHostLive(ip);
  const { rows: apiRows, pending: rowsPending } = useHostRows(ip);
  const queues = useQueues();
  const tiers = useTierInfo();
  const open = useOpenSet('host');
  const first = live[0] ?? null;
  const detail = useQuery({ ...queries.nodeDetail(first?.id ?? 0), enabled: first !== null });
  const geo = detail.data?.node.geo ?? null;

  const lat = geo?.lat ?? first?.lat ?? null;
  const lon = geo?.lon ?? first?.lon ?? null;
  const dominant = TIER_ORDER.find((t) => live.some((n) => n.tier === t)) ?? 'unknown';
  const points = useMemo<MapPoint[]>(
    () =>
      lat !== null && lon !== null ? [{ id: 'host', lat, lon, tier: dominant, ring: true, size: 1.15 }] : [],
    [lat, lon, dominant],
  );

  const mix = TIER_ORDER.map((t) => ({ tier: t, count: live.filter((n) => n.tier === t).length })).filter(
    (m) => m.count > 0,
  );

  // The live table learns reachability and check-ins as sweeps and blocks arrive; until it has, the server's
  // node list (already fetched for the operators) fills the gap, so a node that cannot be reached is not
  // drawn as healthy.
  const apiById = useMemo(() => new Map(apiRows.map((r) => [r.id, r])), [apiRows]);
  const rows = useMemo<HostRow[]>(
    () =>
      live.map((n) => {
        const pos = positionOf(queues, n.id);
        const api = apiById.get(n.id);
        return {
          ...n,
          reachable: n.reachable ?? api?.reachable ?? null,
          lastConfirmed: Math.max(n.lastConfirmed, api?.last_confirmed_height ?? 0),
          position: pos ? pos.position : null,
          size: pos ? pos.size : 0,
        };
      }),
    [live, queues, apiById],
  );
  const kinds = useMemo(
    () =>
      rows.map((n) =>
        nodeStatusKind({
          status: n.status,
          reachable: n.reachable,
          sinceConfirm: blocksSinceConfirm(tip, n.lastConfirmed),
        }),
      ),
    [rows, tip],
  );

  const perDay = useMemo(() => {
    let sum = 0;
    let known = false;
    for (const n of live) {
      const pos = positionOf(queues, n.id);
      const info = tiers.find((t) => t.tier === pos?.tier);
      if (!pos || info?.payout == null) continue;
      const v = fluxPerDay(info.payout, pos.size);
      if (v !== null) {
        sum += v;
        known = true;
      }
    }
    return known ? sum : null;
  }, [live, queues, tiers]);

  const operators = useMemo(() => {
    const by = new Map<string, number>();
    for (const r of apiRows) by.set(r.payment_address, (by.get(r.payment_address) ?? 0) + 1);
    return [...by.entries()].sort((a, b) => b[1] - a[1]);
  }, [apiRows]);

  if (!loaded && live.length === 0) return <HostSkeleton />;
  if (loaded && live.length === 0) {
    return (
      <article className="ix ix-host" aria-label="Host not found">
        <EmptyState icon={SearchX} title="No node on that IP" pattern>
          Nothing in the network runs at {ip}. A host appears here once a node is listed on its address.
        </EmptyState>
      </article>
    );
  }

  const countryCode = geo?.country_code || first?.country || '';
  const country = geo?.country || (countryCode ? countryName(countryCode) : '');
  const provider = geo?.org || first?.org || 'Unknown provider';
  const city = geo?.city || '';
  const parts = [city, geo?.region && geo.region !== city ? geo.region : null, country].filter(Boolean);
  const place = parts.join(', ');
  // The map names the most specific place in bold, and the rest of the address after it.
  const lead = parts[0] ?? 'Location unknown';
  const detailLine = parts.slice(1).join(', ');
  const asn = geo?.asn ? `AS${geo.asn}` : null;
  const hosting = geo?.hosting ?? null;
  const multi = live.length > 1;
  const single = operators.length === 1 && multi;
  // A host of one node says who it pays, as a link, rather than leaving the tile's caption empty.
  const soleOperator = operators.length === 1 && !multi ? (operators[0]?.[0] ?? null) : null;
  const ports = live
    .map((n) => parseEndpoint(n.endpoint)?.port)
    .filter((p): p is number => typeof p === 'number');
  const hostPlace: HostPlace = {
    provider,
    asn,
    place,
    city,
    country,
    countryCode,
    hosting,
    lat,
    lon,
    geo,
  };

  return (
    <article className="ix ix-host" data-tier={dominant} aria-label={`Host ${ip}`}>
      <ViewHeader
        kind="Host"
        icon={hosting === false ? House : Server}
        title={ip}
        mono
        subtitle={
          [place || null, provider === 'Unknown provider' ? null : provider].filter(Boolean).join(' · ') ||
          undefined
        }
        tier={dominant === 'unknown' ? undefined : dominant}
        freshness={
          <span className="ix-tools">
            <IconButton
              size="sm"
              variant="secondary"
              icon={LocateFixed}
              label="Fly to the host"
              disabled={lat === null || lon === null || !engine}
              onClick={() => {
                if (lat !== null && lon !== null) void engine?.flyTo(lat, lon, 0.22, { tilt: 0.32 });
              }}
            />
            <CopyButton size="md" value={ip} what="IP address" />
          </span>
        }
      >
        <HealthChips kinds={kinds} settling={rowsPending && rows.some((n) => n.reachable === null)} />
        {mix.map((m) => (
          <TierChip
            key={m.tier}
            tier={m.tier}
            size="sm"
            label={`${formatInt(m.count)} ${tierLabel(m.tier)}`}
          />
        ))}
        {hosting !== null ? (
          <Chip size="sm" icon={hosting ? Server : House}>
            {hosting ? 'Datacenter' : 'Residential'}
          </Chip>
        ) : null}
      </ViewHeader>

      <div className="ix-pad ix-gap-top">
        <LocationMap
          points={points}
          label={`Map of ${place || ip}`}
          tier={dominant}
          caption={
            <>
              <b>{lead}</b>
              {detailLine ? <span>{detailLine}</span> : null}
            </>
          }
          corner={
            lat !== null && lon !== null ? (
              <>
                <span>{coord(lat, 'N', 'S')}</span>
                <span>{coord(lon, 'E', 'W')}</span>
              </>
            ) : undefined
          }
          cornerTitle="Approximate: placed from the IP address"
        />
      </div>

      <Section>
        <StatGrid min={TRIO_MIN} className="ix-host-trio">
          <Stat
            label="Nodes"
            value={<AnimatedNumber value={live.length} />}
            unit={live.length === 1 ? 'node' : 'nodes'}
            caption={
              multi
                ? `${formatInt(live.length)} of 8 ports in use`
                : ports[0]
                  ? `on port ${ports[0]}`
                  : undefined
            }
            tier={dominant === 'unknown' ? undefined : dominant}
          />
          <Stat
            label="Per day"
            value={perDay === null ? null : <AnimatedNumber value={perDay} format={fmt2} />}
            unit="FLUX"
            caption="estimate"
          />
          <Stat
            label="Paid to"
            value={apiRows.length === 0 ? null : <AnimatedNumber value={operators.length} />}
            unit={operators.length === 1 ? 'address' : 'addresses'}
            caption={
              single ? (
                'one operator'
              ) : soleOperator ? (
                <EntityLink kind="operator" value={soleOperator} />
              ) : undefined
            }
          />
        </StatGrid>
      </Section>

      <Section title="Nodes" aside={multi ? `${formatInt(live.length)} of 8 ports` : undefined}>
        <div className="ix-host-body">
          {multi ? (
            <div className="ix-host-ladder">
              <HostLadder ip={ip} />
              {other.length ? (
                <p className="ix-cap">
                  Also on{' '}
                  {other.map((n, i) => (
                    <span key={n.id}>
                      {i ? ', ' : ''}
                      <EntityLink kind="node" value={n.endpoint || String(n.id)} mono>
                        :{parseEndpoint(n.endpoint)?.port ?? '?'}
                      </EntityLink>
                    </span>
                  ))}
                  .
                </p>
              ) : null}
            </div>
          ) : null}
          <HostNodes ip={ip} rows={rows} />
        </div>
      </Section>

      <OperatorsFold operators={operators} nodes={live.length} open={open} />
      <LocationFold p={hostPlace} open={open} />
      <span className="ui-sr-only">{formatInt(live.length)} nodes on this host</span>
    </article>
  );
}
