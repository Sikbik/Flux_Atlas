import {
  Eye,
  EyeOff,
  House,
  LocateFixed,
  OctagonX,
  Server,
  ShieldAlert,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTip } from '../../../app/context';
import { useGlobeEngine } from '../../../globe';
import { formatInt } from '../../../lib/format';
import { Button, Chip, EntityLink, IconButton, TierChip, ViewHeader } from '../../../ui';
import { countryName } from '../derive/appSpec';
import { spanText } from '../derive/eta';
import { blocksSinceConfirm, checkinGauge } from '../derive/expiry';
import { nodeStateChips } from '../derive/nodeState';
import { useWatch } from '../sources/hooks';
import { ArcaneGlyph } from '../ui';
import { Callout } from '../ui/callout';
import { LocationMap } from '../ui/locationmap';
import type { MapPoint } from '../ui/map';
import { type NodeCtx, useNodeCtx } from './context';
import { StateChips } from './StateChips';

const formatCoord = (v: number, pos: string, neg: string) =>
  `${Math.abs(v).toFixed(2)} ${v >= 0 ? pos : neg}`;

/** The place line of a node: its city (or region, or country) and, under it, the provider. */
export function placeOf(ctx: NodeCtx): { city: string; sub: string } {
  const geo = ctx.node?.geo;
  const cc = geo?.country_code || ctx.live?.country || '';
  const country = geo?.country || (cc ? countryName(cc) : '');
  const city = geo?.city || geo?.region || country || 'Location unknown';
  const parts = [geo?.city ? geo.region : null, geo?.city || geo?.region ? country : null].filter(
    (p): p is string => !!p && p !== city,
  );
  const org = geo?.org || ctx.live?.org || '';
  const asn = geo?.asn ? ` AS${geo.asn}` : '';
  const tail = org ? `${org}${asn}` : '';
  return { city, sub: [parts.join(', '), tail].filter(Boolean).join(' · ') };
}

/** The head of the node inspector: who it is, what state it is in, the few actions, and where it is. */
export function NodeHeader() {
  const ctx = useNodeCtx();
  const tip = useTip();
  const engine = useGlobeEngine();
  const { watched, toggle } = useWatch(ctx.id);
  const { node, live, tier } = ctx;

  const lat = node?.geo?.lat ?? live?.lat ?? null;
  const lon = node?.geo?.lon ?? live?.lon ?? null;
  const points = useMemo<MapPoint[]>(
    () => (lat !== null && lon !== null ? [{ id: 'node', lat, lon, tier, ring: true, size: 1.15 }] : []),
    [lat, lon, tier],
  );

  const lastConfirmed = Math.max(live?.lastConfirmed ?? 0, node?.last_confirmed_height ?? 0);
  const since = blocksSinceConfirm(tip?.height, lastConfirmed);
  const chips = nodeStateChips({
    status: live?.status ?? node?.status ?? 'unknown',
    reachable: live?.reachable ?? node?.reachable ?? null,
    sinceConfirm: since,
  });
  const hosting = node?.geo?.hosting ?? null;
  const place = placeOf(ctx);
  const known = ctx.id !== null;
  const tierName = tier === 'unknown' ? undefined : tier;

  return (
    <>
      <ViewHeader
        kind="Node"
        icon={Server}
        title={ctx.endpoint || (ctx.id !== null ? `Node ${ctx.id}` : ctx.routeKey)}
        mono
        tier={tierName}
        subtitle={
          node?.payment_address ? (
            <>
              Paid to <EntityLink kind="operator" value={node.payment_address} />
            </>
          ) : undefined
        }
        freshness={
          <span className="ix-tools">
            <Button
              size="sm"
              icon={watched ? EyeOff : Eye}
              aria-pressed={watched}
              disabled={!known}
              onClick={toggle}
              title={
                watched
                  ? 'Stop watching: the node leaves your watchlist and its live probe'
                  : 'Watch: probe this node live and alert on its changes'
              }
            >
              {watched ? 'Watching' : 'Watch'}
            </Button>
            <IconButton
              size="sm"
              variant="secondary"
              icon={LocateFixed}
              label="Fly to the node"
              disabled={lat === null || lon === null || !engine}
              onClick={() => {
                if (lat !== null && lon !== null) void engine?.flyTo(lat, lon, 0.5, { tilt: 0.32 });
              }}
            />
          </span>
        }
      >
        {tier !== 'unknown' ? <TierChip tier={tier} size="sm" /> : <Chip size="sm">Unknown tier</Chip>}
        <StateChips chips={chips} />
        {node?.arcane ? (
          <Chip size="sm" title="Runs ArcaneOS">
            <ArcaneGlyph size={12} />
            ArcaneOS
          </Chip>
        ) : null}
        {hosting !== null ? (
          <Chip
            size="sm"
            icon={hosting ? Server : House}
            title={hosting ? 'The IP belongs to a hosting provider' : 'A residential or office network'}
          >
            {hosting ? 'Datacenter' : 'Residential'}
          </Chip>
        ) : null}
      </ViewHeader>
      <div className="ix-pad ix-gap-top">
        <LocationMap
          points={points}
          label={`Map of ${place.city}`}
          tier={tierName}
          caption={
            <>
              <b>{place.city}</b>
              {place.sub ? <span>{place.sub}</span> : null}
            </>
          }
          corner={
            lat !== null && lon !== null ? (
              <>
                <span>{formatCoord(lat, 'N', 'S')}</span>
                <span>{formatCoord(lon, 'E', 'W')}</span>
              </>
            ) : undefined
          }
          cornerTitle="Approximate: placed from the IP address"
        />
      </div>
    </>
  );
}

/**
 * The one thing worth interrupting for: a node that is gone, banned, past expiry, close to expiring or
 * unreachable. Nothing at all while the node is fine, so a healthy node's first screen stays calm.
 */
export function NodeAlert({ onOpenHealth }: { onOpenHealth: () => void }) {
  const { node, live } = useNodeCtx();
  const tip = useTip();
  const status = live?.status ?? node?.status ?? 'unknown';
  const lastConfirmed = Math.max(live?.lastConfirmed ?? 0, node?.last_confirmed_height ?? 0);
  const since = blocksSinceConfirm(tip?.height, lastConfirmed);
  const g = checkinGauge(since);
  const gone = node?.status === 'departed' || (node?.departed_ms ?? null) !== null;
  const reachable = live?.reachable ?? node?.reachable ?? null;

  let alert: { tone: 'off' | 'warn' | 'crit'; icon: typeof OctagonX; title: string; body: string } | null =
    null;
  if (gone) {
    alert = {
      tone: 'off',
      icon: OctagonX,
      title: 'This node has left the network',
      body: 'It no longer appears on the node list, so it is not paid. Its history stays here.',
    };
  } else if (status === 'dos') {
    alert = {
      tone: 'crit',
      icon: ShieldAlert,
      title: 'DoS listed',
      body: 'Banned for 720 blocks after a failed benchmark or a network violation. The payment queue skips it until the ban ends.',
    };
  } else if (status === 'confirmed' || status === 'offline') {
    if (g.state === 'expired') {
      alert = {
        tone: 'crit',
        icon: OctagonX,
        title: 'Past expiry',
        body: `${formatInt(since ?? 0)} blocks without a check-in. The network drops the node unless a confirm is already on its way.`,
      };
    } else if (g.state === 'atRisk') {
      alert = {
        tone: 'warn',
        icon: TriangleAlert,
        title: 'At risk of expiring',
        body: `Expires in ${formatInt(g.blocksToExpiry ?? 0)} blocks (${spanText(g.msToExpiry ?? 0)}) unless it checks in.`,
      };
    } else if (reachable === false) {
      alert = {
        tone: 'warn',
        icon: WifiOff,
        title: 'Not reachable',
        body: 'The last stats round could not reach this node. It keeps its place in the queue while it checks in.',
      };
    }
  }
  if (!alert) return null;
  const Icon = alert.icon;
  return (
    <div className="ix-pad ix-gap-top">
      <Callout
        tone={alert.tone}
        title={alert.title}
        icon={<Icon size={16} strokeWidth={1.5} />}
        actions={
          // Check-ins explain an expiry or a silent node; a ban or a departed node has none to show.
          status === 'confirmed' || status === 'offline' ? (
            <Button size="sm" variant="ghost" onClick={onOpenHealth}>
              Show check-ins
            </Button>
          ) : undefined
        }
      >
        {alert.body}
      </Callout>
    </div>
  );
}
