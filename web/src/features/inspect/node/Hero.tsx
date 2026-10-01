import { ExternalLink, Eye, EyeOff, House, LocateFixed, Server, UserRoundCheck } from 'lucide-react';
import { useMemo } from 'react';
import { useTip } from '../../../app/context';
import { useGlobeEngine } from '../../../globe';
import { formatEndpoint } from '../../../lib/format';
import { countryName } from '../derive/appSpec';
import { blocksSinceConfirm } from '../derive/expiry';
import { nodeStateChips } from '../derive/nodeState';
import { useWatch } from '../sources/hooks';
import {
  ArcaneGlyph,
  Btn,
  Chip,
  CopyButton,
  type MapPoint,
  MiniMap,
  OperatorLink,
  StateChips,
  TierChip,
} from '../ui';
import { useNodeCtx } from './context';

const formatCoord = (v: number, pos: string, neg: string) =>
  `${Math.abs(v).toFixed(2)} ${v >= 0 ? pos : neg}`;

function placeOf(ctx: ReturnType<typeof useNodeCtx>): { city: string; sub: string } {
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

/** The identity header: a dot-matrix map of the node's place under its state, plus the actions. */
export function Hero() {
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
  const arcane = node?.arcane ?? null;
  const hosting = node?.geo?.hosting ?? null;
  const place = placeOf(ctx);
  const known = ctx.id !== null;
  const copyValue = formatEndpoint(ctx.endpoint, {}, '');

  return (
    <header className="ix-hero" data-tier={tier}>
      <div className="ix-hero-card" data-empty={points.length === 0 || undefined}>
        {points.length ? (
          <MiniMap
            className="ix-hero-map"
            height={176}
            points={points}
            minSpan={13}
            labels={false}
            label={`Map of ${place.city}`}
          />
        ) : (
          <div className="ix-hero-map ix-hero-lattice" aria-hidden="true" />
        )}
        {points.length ? <div className="ix-hero-reticle" aria-hidden="true" /> : null}
        <div className="ix-hero-veil" aria-hidden="true" />
        <div className="ix-hero-in">
          <div className="ix-chips">
            {tier !== 'unknown' ? <TierChip tier={tier} /> : <Chip>Unknown tier</Chip>}
            <StateChips chips={chips} />
            {arcane ? (
              <Chip icon={<ArcaneGlyph size={13} />} title="Runs ArcaneOS">
                ArcaneOS
              </Chip>
            ) : null}
            {hosting !== null ? (
              <Chip
                icon={
                  hosting ? <Server size={13} strokeWidth={1.75} /> : <House size={13} strokeWidth={1.75} />
                }
                title={hosting ? 'The IP belongs to a hosting provider' : 'A residential or office network'}
              >
                {hosting ? 'Datacenter' : 'Residential'}
              </Chip>
            ) : null}
          </div>
          <div className="ix-hero-foot">
            <div className="ix-hero-place">
              <div className="ix-hero-city">{place.city}</div>
              {place.sub ? <div className="ix-hero-sub">{place.sub}</div> : null}
            </div>
            {lat !== null && lon !== null ? (
              <div className="ix-hero-coord" title="Approximate: placed from the IP address">
                <span>{formatCoord(lat, 'N', 'S')}</span>
                <span>{formatCoord(lon, 'E', 'W')}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="ix-actions ix-hero-actions">
        <Btn
          icon={<LocateFixed size={14} strokeWidth={1.75} />}
          disabled={lat === null || lon === null || !engine}
          onClick={() => {
            if (lat !== null && lon !== null) void engine?.flyTo(lat, lon, 0.5, { tilt: 0.32 });
          }}
        >
          Fly to
        </Btn>
        <Btn
          icon={watched ? <EyeOff size={14} strokeWidth={1.75} /> : <Eye size={14} strokeWidth={1.75} />}
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
        </Btn>
        <span className="ix-actions-gap" aria-hidden="true" />
        {copyValue ? (
          <span className="ix-actions-copy">
            <CopyButton value={copyValue} label="Copy IP and port" />
          </span>
        ) : null}
        {node?.payment_address ? (
          <OperatorLink
            addr={node.payment_address}
            className="ix-btn"
            title="Everything this address is paid for"
          >
            <UserRoundCheck size={14} strokeWidth={1.75} />
            Operator
          </OperatorLink>
        ) : null}
        {node?.ui_url ? (
          <a
            className="ix-btn"
            href={node.ui_url}
            target="_blank"
            rel="noopener noreferrer"
            data-size="icon"
            aria-label="Open the node's FluxOS panel (new tab)"
            title="Open the node's FluxOS panel"
          >
            <ExternalLink size={14} strokeWidth={1.75} />
          </a>
        ) : null}
      </div>
    </header>
  );
}
