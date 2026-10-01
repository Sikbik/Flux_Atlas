import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Fingerprint, House, MapPin, SearchX, Server } from 'lucide-react';
import { useMemo } from 'react';
import { queries } from '../../../api/queries';
import { useNetwork, useTip } from '../../../app/context';
import { formatInt, middleTruncate, parseEndpoint } from '../../../lib/format';
import { countryName } from '../derive/appSpec';
import { blocksSinceConfirm } from '../derive/expiry';
import { nodeStateChips } from '../derive/nodeState';
import { fluxPerDay, positionOf } from '../derive/queue';
import { useHostRows } from '../sources/hooks';
import { useHostLive } from '../sources/host';
import { type NodeLive, useQueues, useTierInfo } from '../sources/live';
import {
  Block,
  Chip,
  Digits,
  Disclosure,
  Disclosures,
  Dot,
  Grid,
  HeroCard,
  HostLadder,
  Kv,
  KvRow,
  type MapPoint,
  NodeLink,
  OperatorLink,
  QueueCell,
  Sk,
  State,
  TierChip,
  TierGlyph,
  Tile,
  tierLabel,
  useOpenSet,
} from '../ui';
import './host.css';

const TIER_ORDER = ['stratus', 'nimbus', 'cumulus'] as const;

function HostRow({ n }: { n: NodeLive }) {
  const tip = useTip();
  const since = blocksSinceConfirm(tip?.height, n.lastConfirmed);
  const chip = nodeStateChips({ status: n.status, reachable: n.reachable, sinceConfirm: since })[0];
  const port = parseEndpoint(n.endpoint)?.port;
  const tone = chip?.tone ?? 'off';
  return (
    <li className="ix-hrow-cell">
      <NodeLink nodeKey={n.endpoint || n.id} className="ix-hrow" data-tier={n.tier}>
        <span className="ix-hrow-glyph">
          <TierGlyph tier={n.tier} size={18} />
        </span>
        <span className="ix-hrow-main">
          <b className="ix-mono ix-hrow-port">{port ? `:${port}` : n.endpoint}</b>
          <span className="ix-hrow-sub">
            <Dot tone={tone} />
            {tierLabel(n.tier)} · {chip?.label ?? 'Unknown'}
            {n.appCount > 0 ? ` · ${n.appCount} ${n.appCount === 1 ? 'app' : 'apps'}` : ''}
          </span>
        </span>
        <QueueCell id={n.id} />
        <ChevronRight className="ix-hrow-chev" size={15} strokeWidth={1.75} aria-hidden="true" />
      </NodeLink>
    </li>
  );
}

function HostSkeleton() {
  return (
    <article className="ix ix-host" aria-busy="true" aria-label="Loading the host">
      <header className="ix-hero">
        <div className="ix-hero-card">
          <Sk h={176} r={0} />
        </div>
      </header>
      <div className="ix-lead">
        <Sk h={64} r={14} />
        <div className="ix-gap">
          <Sk h={170} r={12} />
        </div>
      </div>
    </article>
  );
}

/**
 * A host: every node that shares an IP (UPnP hosts run up to eight on ports 16127 to 16197), with the
 * ports, tiers, queue places, location and provider. A host with several nodes is one failure domain,
 * so the view says so when one address is paid by all of them.
 */
export function HostView({ ip }: { ip: string }) {
  const loaded = useNetwork((s) => s.loaded);
  const { live, other } = useHostLive(ip);
  const { rows } = useHostRows(ip);
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
    for (const r of rows) by.set(r.payment_address, (by.get(r.payment_address) ?? 0) + 1);
    return [...by.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  if (!loaded && live.length === 0) return <HostSkeleton />;
  if (loaded && live.length === 0) {
    return (
      <article className="ix ix-host" aria-label="Host not found">
        <State icon={<SearchX size={20} strokeWidth={1.5} />} title="No node on that IP">
          Nothing in the network runs at {ip}. A host appears here once a node is listed on its address.
        </State>
      </article>
    );
  }

  const provider = geo?.org || first?.org || 'Unknown provider';
  const country = geo?.country || (first?.country ? countryName(first.country) : '');
  const place = [geo?.city, geo?.region && geo.region !== geo.city ? geo.region : null, country]
    .filter(Boolean)
    .join(', ');
  const asn = geo?.asn ? `AS${geo.asn}` : null;
  const hosting = geo?.hosting ?? null;
  const single = operators.length === 1 && live.length > 1;
  const opRow = (addr: string, n: number) => (
    <li key={addr} className="ix-oprow">
      <OperatorLink addr={addr} className="ix-mono">
        {middleTruncate(addr, 10, 6)}
      </OperatorLink>
      <span className="ix-dim">
        {n} {n === 1 ? 'node' : 'nodes'} here
      </span>
    </li>
  );

  return (
    <article className="ix ix-host" data-tier={dominant} aria-label={`Host ${ip}`}>
      <header className="ix-hero">
        <HeroCard
          tier={dominant}
          points={points}
          mapLabel={`Map of ${place || ip}`}
          chips={
            <>
              {mix.map((m) => (
                <TierChip key={m.tier} tier={m.tier} label={`${m.count} ${tierLabel(m.tier)}`} />
              ))}
              {hosting !== null ? (
                <Chip
                  icon={
                    hosting ? <Server size={13} strokeWidth={1.75} /> : <House size={13} strokeWidth={1.75} />
                  }
                >
                  {hosting ? 'Datacenter' : 'Residential'}
                </Chip>
              ) : null}
            </>
          }
          title={provider}
          sub={
            <>
              <span className="ix-mono">{ip}</span>
              {[place, asn].filter(Boolean).map((t) => ` · ${t}`)}
            </>
          }
        />
      </header>

      <div className="ix-lead ix-rise" style={{ '--ix-i': 1 } as React.CSSProperties}>
        <Grid cols={3}>
          <Tile label="Nodes" value={<Digits value={String(live.length)} />} unit="of 8 ports" detail=" " />
          <Tile
            label="Per day"
            value={perDay === null ? 'Unknown' : <Digits value={perDay.toFixed(2)} />}
            unit={perDay === null ? undefined : 'FLUX'}
            detail="estimate"
            detailTone="accent"
          />
          <Tile
            label="Paid to"
            value={<Digits value={String(operators.length || (rows.length === 0 ? '?' : 0))} />}
            unit={operators.length === 1 ? 'address' : 'addresses'}
            detail={single ? 'one operator' : ' '}
          />
        </Grid>
        <div className="ix-gap ix-hostblock">
          <Block title="Ports" aside={`${live.length} of 8 in use`}>
            <HostLadder ip={ip} />
            {other.length ? (
              <p className="ix-cap">
                Also on{' '}
                {other.map((n, i) => (
                  <span key={n.id}>
                    {i ? ', ' : ''}
                    <NodeLink nodeKey={n.endpoint || n.id} className="ix-mono">
                      :{parseEndpoint(n.endpoint)?.port ?? '?'}
                    </NodeLink>
                  </span>
                ))}
                .
              </p>
            ) : null}
          </Block>
        </div>
        {single ? (
          <p className="ix-cap ix-hostnote">
            All {live.length} nodes pay one address, so a single failure of this host takes them all out of
            the queue together.
          </p>
        ) : null}
      </div>

      <ul className="ix-hrows" aria-label={`Nodes on ${ip}`}>
        {live.map((n) => (
          <HostRow key={n.id} n={n} />
        ))}
      </ul>

      <Disclosures>
        <Disclosure
          index={3}
          title="Operators"
          icon={<Fingerprint size={15} strokeWidth={1.75} />}
          summary={
            operators.length === 0 ? (
              <Sk h={12} w={140} />
            ) : (
              <span>
                {operators.length} {operators.length === 1 ? 'address' : 'addresses'} paid by this host
              </span>
            )
          }
          open={open.isOpen('operators')}
          onToggle={(v) => open.setOpen('operators', v)}
        >
          <ul className="ix-oplist">{operators.map(([addr, n]) => opRow(addr, n))}</ul>
        </Disclosure>
        <Disclosure
          index={4}
          title="Location and provider"
          icon={<MapPin size={15} strokeWidth={1.75} />}
          summary={<span>{[provider, place].filter(Boolean).join(' · ')}</span>}
          open={open.isOpen('location')}
          onToggle={(v) => open.setOpen('location', v)}
        >
          <Kv>
            <KvRow label="Provider" sans>
              {provider}
              {asn ? <span className="ix-dim"> {asn}</span> : null}
            </KvRow>
            <KvRow label="Place" sans>
              {place || 'Unknown'}
            </KvRow>
            <KvRow label="Network" sans>
              {hosting === null ? 'Unknown' : hosting ? 'Datacenter' : 'Residential or office'}
            </KvRow>
            <KvRow label="Coordinates">
              {lat !== null && lon !== null ? `${lat.toFixed(3)}, ${lon.toFixed(3)}` : 'Unknown'}
            </KvRow>
            <KvRow label="Source" sans>
              {geo ? geoSource(geo.source) : 'Unknown'}
            </KvRow>
          </Kv>
          <p className="ix-cap">
            The place comes from the IP address and is approximate; hosts in the same data center share it.
          </p>
        </Disclosure>
      </Disclosures>
      <span className="ix-sr">{formatInt(live.length)} nodes on this host</span>
    </article>
  );
}

function geoSource(s: string): string {
  switch (s) {
    case 'node_reported':
      return 'Reported by the node';
    case 'stats_lookup':
      return 'Stats lookup by IP';
    case 'local_db':
      return 'Local geo database';
    default:
      return 'Unknown';
  }
}
