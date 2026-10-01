import { Activity, Check, HeartPulse, Network, OctagonX, ShieldAlert, TriangleAlert } from 'lucide-react';
import { type CSSProperties, useMemo } from 'react';
import type { NodeHistoryDto } from '../../../api/generated/NodeHistoryDto';
import { useNodeHistory } from '../../../api/queries';
import { useNetwork, useRuntime, useTip } from '../../../app/context';
import {
  formatAgo,
  formatInt,
  formatPercent,
  formatUtcDateTime,
  middleTruncate,
  parseEndpoint,
} from '../../../lib/format';
import { spanText } from '../derive/eta';
import { CHECKIN, checkinGauge, GAUGE_ZONES, lifeStage } from '../derive/expiry';
import { positionOf } from '../derive/queue';
import { heartbeatTicks, ipHistory, uptimeCells } from '../derive/uptime';
import { useFirstIngestMs, useHostRows } from '../sources/hooks';
import { LADDER_PORTS, useHostNodes } from '../sources/host';
import { type NodeLive, readNodeLive, useQueues } from '../sources/live';
import { Alert, Digits, HostLink, NodeLink, OperatorLink, Section, Sk, TierGlyph, tierLabel } from '../ui';
import { useNodeCtx } from './context';

const DAY_MS = 86_400_000;

// ---- host ladder ------------------------------------------------------------------------------------

/** The host's eight UPnP ports with the node on each, and who is paid. */
export function HostSection() {
  const { ip, id } = useNodeCtx();
  const store = useRuntime().store;
  const ids = useHostNodes(ip);
  const queues = useQueues();
  // Subscribes to the node slice so the ladder follows every change; reading up to eight rows is cheap.
  useNetwork((s) => s.versions.Nodes);
  const { rows } = useHostRows(ip);

  const live = ids.map((i) => readNodeLive(store, i)).filter((n): n is NodeLive => n !== null);
  if (!ip) return null;

  const byPort = new Map<number, NodeLive>();
  const other: NodeLive[] = [];
  for (const n of live) {
    const port = parseEndpoint(n.endpoint)?.port ?? 0;
    if ((LADDER_PORTS as readonly number[]).includes(port) && !byPort.has(port)) byPort.set(port, n);
    else other.push(n);
  }
  const used = live.length;
  const addresses = new Set(rows.map((r) => r.payment_address).filter(Boolean));
  const single = addresses.size === 1 ? [...addresses][0]! : null;

  return (
    <Section
      title={`Host ${ip}`}
      icon={<Network size={16} strokeWidth={1.75} />}
      index={3}
      aside={`${used} of ${LADDER_PORTS.length} ports in use`}
    >
      <ul className="ix-ladder" aria-label={`Nodes on ${ip}`}>
        {LADDER_PORTS.map((port) => {
          const n = byPort.get(port);
          if (!n) {
            return (
              <li className="ix-slot" data-free="" key={port}>
                <span>{port}</span>
                <small>free</small>
              </li>
            );
          }
          const pos = positionOf(queues, n.id);
          return (
            <li key={port} className="ix-slot-cell">
              <NodeLink
                nodeKey={n.endpoint || n.id}
                className="ix-slot"
                data-tier={n.tier}
                data-sel={n.id === id}
                title={`${n.endpoint}, ${tierLabel(n.tier)}${pos ? `, queue position ${formatInt(pos.position + 1)}` : ''}`}
              >
                <TierGlyph tier={n.tier} size={14} />
                <span>{port}</span>
                <small>{pos ? `#${formatInt(pos.position + 1)}` : 'n/a'}</small>
              </NodeLink>
            </li>
          );
        })}
      </ul>
      {other.length ? (
        <p className="ix-cap">
          Also on{' '}
          {other.map((n, i) => (
            <span key={n.id}>
              {i ? ', ' : ''}
              <NodeLink nodeKey={n.endpoint || n.id} className="ix-mono">
                :{parseEndpoint(n.endpoint)?.port ?? '?'}
              </NodeLink>{' '}
              ({tierLabel(n.tier)})
            </span>
          ))}
          .
        </p>
      ) : null}
      <p className="ix-cap">
        {used <= 1 ? (
          'One node on this host.'
        ) : single ? (
          <>
            All {used} nodes pay <span className="ix-mono">{middleTruncate(single, 6, 4)}</span>. One host,
            one point of failure. <OperatorLink addr={single}>View operator</OperatorLink>
          </>
        ) : addresses.size > 1 ? (
          <>
            {used} nodes on this host, paid to {addresses.size} addresses.{' '}
            <HostLink ip={ip}>Open the host</HostLink>
          </>
        ) : (
          `${used} nodes on this host.`
        )}
      </p>
    </Section>
  );
}

// ---- lifecycle --------------------------------------------------------------------------------------

const STATIONS = ['started', 'joined', 'heartbeat', 'atRisk', 'expired'] as const;
type Station = (typeof STATIONS)[number];

const STAGE_INDEX: Record<string, number> = {
  started: 0,
  joined: 1,
  heartbeat: 2,
  atRisk: 3,
  expired: 4,
  dos: 2,
  unknown: -1,
};

function useSince(): number | null {
  const { node, live } = useNodeCtx();
  const tip = useTip();
  const lastConfirmed = Math.max(live?.lastConfirmed ?? 0, node?.last_confirmed_height ?? 0);
  return lastConfirmed && tip ? Math.max(0, tip.height - lastConfirmed) : null;
}

function Stepper() {
  const { node, live } = useNodeCtx();
  const since = useSince();
  const status = live?.status ?? node?.status ?? 'unknown';
  const stage = lifeStage(status, since);
  const at = STAGE_INDEX[stage] ?? -1;

  const meta: Record<Station, { label: string; sub: string; icon: typeof Check }> = {
    started: {
      label: 'Started',
      sub: node?.added_height ? formatInt(node.added_height) : 'Unknown',
      icon: Check,
    },
    joined: {
      label: 'Joined',
      sub: node?.confirmed_height
        ? formatInt(node.confirmed_height)
        : status === 'started'
          ? 'waiting'
          : 'Unknown',
      icon: Check,
    },
    heartbeat: { label: 'Heartbeat', sub: 'every ~4.2 h', icon: Activity },
    atRisk: { label: 'At risk', sub: `${CHECKIN.atRisk} blocks`, icon: TriangleAlert },
    expired: { label: 'Expired', sub: `${CHECKIN.expire} blocks`, icon: OctagonX },
  };

  return (
    <ol
      className="ix-stepper"
      aria-label="Node lifecycle"
      style={{ '--ix-p': at < 0 ? 0 : at / 4 } as CSSProperties}
    >
      {STATIONS.map((s, i) => {
        const m = meta[s];
        const Icon = m.icon;
        const state = i < at ? 'done' : i === at ? 'now' : 'next';
        const tone = s === 'atRisk' ? 'warn' : s === 'expired' ? 'crit' : undefined;
        return (
          <li
            className="ix-stp"
            data-state={state}
            data-tone={state !== 'next' ? tone : undefined}
            key={s}
            aria-current={state === 'now' ? 'step' : undefined}
          >
            <i>
              <Icon size={12} strokeWidth={2} aria-hidden="true" />
            </i>
            <span>{m.label}</span>
            <small>{m.sub}</small>
          </li>
        );
      })}
    </ol>
  );
}

function Gauge() {
  const { node, live, detail } = useNodeCtx();
  const since = useSince();
  const g = checkinGauge(since);
  const status = live?.status ?? node?.status ?? 'unknown';
  const tone =
    g.state === 'atRisk' ? 'warn' : g.state === 'expired' ? 'crit' : g.state === 'due' ? 'accent' : undefined;

  if (status === 'started') {
    return (
      <p className="ix-cap">
        A start transaction is in the chain. The node joins at its first confirmation; an unconfirmed start
        expires after 240 blocks.
      </p>
    );
  }
  const note =
    since === null
      ? 'The last check-in is not known yet; it appears with the next block that carries one.'
      : g.state === 'expired'
        ? 'Past 640 blocks without a check-in: the network drops the node unless a confirm is already on its way.'
        : g.state === 'atRisk'
          ? `At risk: expires in ${formatInt(g.blocksToExpiry ?? 0)} blocks (${spanText(g.msToExpiry ?? 0)}) if no check-in arrives.`
          : g.state === 'due'
            ? `A check-in is due now; the node expires in ${formatInt(g.blocksToExpiry ?? 0)} blocks (${spanText(g.msToExpiry ?? 0)}) without one.`
            : `Next check-in due in ${formatInt(g.blocksToDue ?? 0)} blocks (${spanText((g.blocksToDue ?? 0) * 30_000)}). Expires after ${CHECKIN.expire} blocks without one.`;
  return (
    <div className="ix-gauge-wrap">
      <div className="ix-gauge-head">
        <span className="ix-dim">Last check-in</span>
        <span className="ix-mono">
          {since === null ? (
            'Unknown'
          ) : (
            <>
              <b>
                <Digits value={formatInt(since)} />
              </b>{' '}
              blocks ago <span className="ix-dim">({spanText(since * 30_000)})</span>
            </>
          )}
        </span>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a styled gauge; a native meter cannot take the zones and the moving marker */}
      <div
        className="ix-gauge"
        role="meter"
        aria-label="Blocks since the last check-in"
        aria-valuemin={0}
        aria-valuemax={CHECKIN.expire}
        aria-valuenow={since ?? undefined}
        style={{ '--ix-at': g.fraction } as CSSProperties}
        data-state={g.state}
      >
        <span className="ix-gauge-mk" hidden={since === null} />
      </div>
      <div className="ix-gauge-l" aria-hidden="true">
        <span style={{ left: '0%' }}>0</span>
        <span style={{ left: `${GAUGE_ZONES.due * 100}%` }}>{CHECKIN.due} due</span>
        <span style={{ left: `${GAUGE_ZONES.atRisk * 100}%` }}>{CHECKIN.atRisk}</span>
        <span style={{ left: '100%' }}>{CHECKIN.expire}</span>
      </div>
      <p className="ix-cap" data-tone={tone}>
        {note}
        {detail?.expires_in_blocks != null && since === null
          ? ` The server counts ${formatInt(detail.expires_in_blocks)} blocks to expiry.`
          : ''}
      </p>
    </div>
  );
}

function Strips({ hist }: { hist: { data: NodeHistoryDto | undefined; isPending: boolean } }) {
  const { node, detail } = useNodeCtx();
  const first = useFirstIngestMs();
  const { clock } = useRuntime();
  const now = clock.now();
  const q = hist;
  const hour = Math.floor(now / 3_600_000);

  // Derived at hour resolution: the strips need the data and the hour, not every render's clock.
  const cells = useMemo(
    () =>
      q.data
        ? uptimeCells(q.data.segments, {
            nowMs: hour * 3_600_000,
            days: 90,
            coverageFromMs: first ?? q.data.segments[0]?.from_ms ?? null,
          })
        : null,
    [q.data, first, hour],
  );
  const ticks = useMemo(
    () => (q.data ? heartbeatTicks(q.data.events, hour * 3_600_000, DAY_MS) : []),
    [q.data, hour],
  );
  const ips = useMemo(
    () => ipHistory([...(q.data?.events ?? []), ...(detail?.recent_events ?? [])]),
    [q.data, detail],
  );
  const observedDays = cells ? cells.filter((c) => c.fraction !== null).length : 0;

  return (
    <>
      <div className="ix-sub-h">
        <span>Check-ins, last 24 h</span>
        <span className="ix-dim">{ticks.length ? `${ticks.length} seen` : 'none seen yet'}</span>
      </div>
      <div className="ix-beats" role="img" aria-label={`${ticks.length} check-ins in the last 24 hours`}>
        {q.isPending ? (
          <Sk h={14} />
        ) : (
          <>
            <span className="ix-beats-track" />
            {ticks.map((t) => (
              <i
                key={t.tsMs}
                style={{ left: `${Math.max(0, Math.min(1, (t.tsMs - (now - DAY_MS)) / DAY_MS)) * 100}%` }}
                title={`Check-in${t.height ? ` at block ${formatInt(t.height)}` : ''}, ${formatAgo(now - t.tsMs)}`}
              />
            ))}
            <span className="ix-beats-now" />
          </>
        )}
      </div>
      <div className="ix-sub-h">
        <span>Uptime, 90 days</span>
        <span className="ix-dim ix-mono">
          {q.data
            ? `${formatPercent(q.data.uptime_pct / 100)} over ${observedDays > 0 ? `${observedDays} d observed` : 'no observed days'}`
            : ''}
        </span>
      </div>
      {cells ? (
        <div
          className="ix-uptime"
          role="img"
          aria-label={`Uptime per day for 90 days, ${formatPercent((q.data?.uptime_pct ?? 0) / 100)} of the observed time`}
        >
          {cells.map((c) => (
            <i
              key={c.dayMs}
              data-state={
                c.fraction === null ? 'none' : c.fraction >= 0.995 ? 'up' : c.fraction > 0 ? 'part' : 'down'
              }
              style={
                c.fraction !== null && c.fraction > 0 && c.fraction < 0.995
                  ? { opacity: 0.45 + c.fraction * 0.5 }
                  : undefined
              }
              title={`${new Date(c.dayMs).toISOString().slice(0, 10)}: ${c.fraction === null ? 'not observed' : formatPercent(c.fraction)}`}
            />
          ))}
        </div>
      ) : (
        <Sk h={16} />
      )}
      <p className="ix-cap">
        {first
          ? `Atlas has watched since ${formatUtcDateTime(first)}. Earlier days are blank, not down.`
          : 'History starts at our first ingest.'}
      </p>
      <div className="ix-sub-h">
        <span>IP history</span>
        <span className="ix-dim">
          {ips.length ? `${ips.length} change${ips.length === 1 ? '' : 's'}` : 'no changes seen'}
        </span>
      </div>
      {ips.length ? (
        <ul className="ix-iplist">
          {ips.slice(0, 5).map((c) => (
            <li key={`${c.tsMs}:${c.to}`}>
              <time className="ix-dim ix-mono" dateTime={new Date(c.tsMs).toISOString()}>
                {formatUtcDateTime(c.tsMs)}
              </time>
              <span className="ix-mono">
                {c.from ? `${c.from} to ${c.to ?? 'unknown'}` : `first seen at ${c.to ?? 'unknown'}`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ix-cap">
          The address has not changed since we started watching{node?.endpoint ? ` (${node.endpoint})` : ''}.
        </p>
      )}
    </>
  );
}

/** Lifecycle, check-in gauge, heartbeat timeline, uptime and IP history. */
export function HealthSection() {
  const { node, live, apiKey } = useNodeCtx();
  const { clock } = useRuntime();
  // A day-aligned window keeps the query key stable across renders.
  const from = Math.floor(clock.now() / DAY_MS) * DAY_MS - 89 * DAY_MS;
  const hist = useNodeHistory(apiKey, { from });
  const status = live?.status ?? node?.status ?? 'unknown';
  return (
    <Section
      title="Health"
      icon={<HeartPulse size={16} strokeWidth={1.75} />}
      index={4}
      aside={hist.data ? `uptime ${formatPercent(hist.data.uptime_pct / 100)}` : undefined}
    >
      {status === 'dos' ? (
        <div className="ix-gap">
          <Alert tone="crit" icon={<ShieldAlert size={16} strokeWidth={1.75} />} title="DoS listed">
            This node is banned for 720 blocks after a failed benchmark or a network violation. It is skipped
            by the payment queue until the ban ends.
          </Alert>
        </div>
      ) : null}
      <Stepper />
      <Gauge />
      <Strips hist={hist} />
    </Section>
  );
}
