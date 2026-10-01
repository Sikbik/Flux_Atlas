import { Network } from 'lucide-react';
import { useMemo } from 'react';
import type { NodeHistoryDto } from '../../../api/generated/NodeHistoryDto';
import { useNodeHistory } from '../../../api/queries';
import { useRuntime } from '../../../app/context';
import { formatAgo, formatInt, formatPercent, formatUtcDateTime } from '../../../lib/format';
import { Meter, Skeleton, Timeline, type TimelineItem } from '../../../ui';
import { spanText } from '../derive/eta';
import { CHECKIN, checkinGauge, START_EXPIRY_BLOCKS } from '../derive/expiry';
import { heartbeatTicks, ipHistory, uptimeCells } from '../derive/uptime';
import { useFirstIngestMs } from '../sources/hooks';
import { useSince, useStartLeft } from './checkin';
import { useNodeCtx } from './context';
import { SubHead } from './SubHead';

const DAY_MS = 86_400_000;

/** The check-in gauge: blocks since the last check-in against the three bands that decide the node's fate. */
function CheckinGauge() {
  const { node, live, detail } = useNodeCtx();
  const since = useSince();
  const g = checkinGauge(since);
  const left = useStartLeft();
  const status = live?.status ?? node?.status ?? 'unknown';

  if (status === 'started') {
    if (left === null) {
      return (
        <p className="ix-cap">
          A start transaction is in the chain. The node joins at its first confirmation; an unconfirmed start
          expires after {START_EXPIRY_BLOCKS} blocks.
        </p>
      );
    }
    return (
      <div className="ix-stack">
        <Meter
          label="Waiting for confirmation"
          showLabel
          showValue
          value={START_EXPIRY_BLOCKS - left}
          min={0}
          max={START_EXPIRY_BLOCKS}
          size="lg"
          zones={[{ from: 0, to: START_EXPIRY_BLOCKS, tone: 'accent' }]}
          startLabel="0"
          endLabel={`${START_EXPIRY_BLOCKS} expires`}
          format={(v) => `${formatInt(Math.round(v))} blocks (${spanText(v * 30_000)})`}
        />
        <p className="ix-cap" data-tone={left === 0 ? 'crit' : undefined}>
          {left === 0
            ? `No confirmation within ${START_EXPIRY_BLOCKS} blocks: the start expires unless one is already on its way.`
            : `A start transaction is in the chain. The node joins at its first confirmation; it has ${formatInt(left)} blocks (${spanText(left * 30_000)}) left before an unconfirmed start expires.`}
        </p>
      </div>
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
    <div className="ix-stack">
      <Meter
        label="Last check-in"
        showLabel
        showValue
        value={since}
        min={0}
        max={CHECKIN.expire}
        size="lg"
        zones={[
          { from: 0, to: CHECKIN.due, tone: 'ok', label: 'On time' },
          { from: CHECKIN.due, to: CHECKIN.atRisk, tone: 'accent', label: 'Due' },
          { from: CHECKIN.atRisk, to: CHECKIN.expire, tone: 'warn', label: 'At risk' },
        ]}
        startLabel="0"
        endLabel={`${CHECKIN.expire} expires`}
        format={(v) => `${formatInt(Math.round(v))} blocks ago (${spanText(v * 30_000)})`}
      />
      <p
        className="ix-cap"
        data-tone={g.state === 'atRisk' ? 'warn' : g.state === 'expired' ? 'crit' : undefined}
      >
        {note}
        {detail?.expires_in_blocks != null && since === null
          ? ` The server counts ${formatInt(detail.expires_in_blocks)} blocks to expiry.`
          : ''}
      </p>
    </div>
  );
}

/** The heartbeat strip, the 90-day uptime cells and the IP history. */
function History({ hist }: { hist: { data: NodeHistoryDto | undefined; isPending: boolean } }) {
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
  const ipItems = useMemo<TimelineItem[]>(
    () =>
      ips.slice(0, 5).map((c) => ({
        id: `${c.tsMs}:${c.to}`,
        time: c.tsMs,
        icon: Network,
        tone: 'warn',
        title: (
          <span className="ui-mono">
            {c.from ? `${c.from} to ${c.to ?? 'unknown'}` : `First seen at ${c.to ?? 'unknown'}`}
          </span>
        ),
      })),
    [ips],
  );
  const observedDays = cells ? cells.filter((c) => c.fraction !== null).length : 0;

  return (
    <>
      <div>
        <SubHead
          title="Check-ins, last 24 h"
          note={ticks.length ? `${ticks.length} seen` : 'none seen yet'}
        />
        <div className="ix-beats" role="img" aria-label={`${ticks.length} check-ins in the last 24 hours`}>
          {q.isPending ? (
            <Skeleton h={14} />
          ) : (
            <>
              <span className="ix-beats-track" />
              {ticks.map((t) => (
                <i
                  key={t.tsMs}
                  style={{
                    left: `${Math.max(0, Math.min(1, (t.tsMs - (now - DAY_MS)) / DAY_MS)) * 100}%`,
                  }}
                  title={`Check-in${t.height ? ` at block ${formatInt(t.height)}` : ''}, ${formatAgo(now - t.tsMs)}`}
                />
              ))}
              <span className="ix-beats-now" />
            </>
          )}
        </div>
      </div>
      <div>
        <SubHead
          title="Uptime, 90 days"
          note={
            q.data
              ? q.data.uptime_pct === null
                ? 'Not observed yet'
                : `${formatPercent(q.data.uptime_pct / 100)} over ${observedDays > 0 ? `${observedDays} d observed` : 'no observed days'}`
              : undefined
          }
        />
        {cells ? (
          <div
            className="ix-uptime"
            role="img"
            aria-label={
              q.data?.uptime_pct == null
                ? 'Uptime per day for 90 days, not observed yet'
                : `Uptime per day for 90 days, ${formatPercent(q.data.uptime_pct / 100)} of the observed time`
            }
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
          <Skeleton h={16} />
        )}
        <p className="ix-cap">
          {first
            ? `Atlas has watched since ${formatUtcDateTime(first)}. Earlier days are blank, not down.`
            : 'History starts at our first ingest.'}
        </p>
      </div>
      <div>
        <SubHead
          title="IP history"
          note={ips.length ? `${ips.length} change${ips.length === 1 ? '' : 's'}` : 'no changes seen'}
        />
        {ips.length ? (
          <Timeline items={ipItems} timeMode="absolute" label="IP address changes" />
        ) : (
          <p className="ix-cap">
            The address has not changed since we started watching{node?.endpoint ? ` (${node.endpoint})` : ''}
            .
          </p>
        )}
      </div>
    </>
  );
}

/** The check-in gauge, the heartbeat and uptime strips, and the IP history. */
export function HealthBody() {
  const { apiKey } = useNodeCtx();
  const { clock } = useRuntime();
  // A day-aligned window keeps the query key stable across renders.
  const from = Math.floor(clock.now() / DAY_MS) * DAY_MS - 89 * DAY_MS;
  const hist = useNodeHistory(apiKey, { from });
  return (
    <div className="ix-stack ix-stack-lg">
      <CheckinGauge />
      <History hist={hist} />
    </div>
  );
}
