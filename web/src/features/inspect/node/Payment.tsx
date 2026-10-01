import { Coins, History } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNodePayments } from '../../../api/queries';
import { useNetwork, useRuntime } from '../../../app/context';
import { fluxToNumber, formatAgo, formatFlux, formatInt, formatUtcDateTime } from '../../../lib/format';
import { etaParts } from '../derive/eta';
import { paymentDays, windowTotals } from '../derive/payments';
import { cycleHours, estimatePayment, fluxPerDay, positionOf, queueProgress } from '../derive/queue';
import { useFirstIngestMs, useRiseFlash } from '../sources/hooks';
import { useChainClock, useQueues, useTierInfo } from '../sources/live';
import { BlockLink, Btn, Digits, Grid, MiniBars, Section, Sk, Swap, Tile, tierLabel } from '../ui';
import { useNodeCtx } from './context';

const DAY_MS = 86_400_000;

const NOT_QUEUED: Record<string, string> = {
  started: 'Waiting for the first confirmation',
  dos: 'DoS listed nodes are skipped',
  expired: 'This node is no longer paid',
  departed: 'This node has left the network',
};

/** The next-payment tile: queue position, ETA that counts down, amount and how far through the queue. */
function PayTile() {
  const { id, tier, live, node, detail } = useNodeCtx();
  const queues = useQueues();
  const { tip, anchorMs, nowMs } = useChainClock();
  const payout = useNetwork((s) => s.tierStats.find((t) => t.tier === tier)?.payout ?? null);

  const pos = id !== null ? positionOf(queues, id) : null;
  const server = detail?.payment_eta ?? null;
  const position = pos ? pos.position : server ? server.rank : null;
  const size = pos?.size ?? server?.tier_size ?? 0;
  const lastPaid = Math.max(live?.lastPaid ?? 0, node?.last_paid_height ?? 0);
  const flash = useRiseFlash(lastPaid);
  const status = live?.status ?? node?.status ?? 'unknown';

  const queued = position !== null && size > 0 && (status === 'confirmed' || status === 'offline');
  const est =
    queued && tip !== null && anchorMs !== null
      ? estimatePayment(position, size, tip, anchorMs, nowMs)
      : null;
  const amount = payout ? formatFlux(payout, { unit: false, sign: 'always' }) : null;
  const since = tip !== null && lastPaid > 0 ? Math.max(0, tip - lastPaid) : null;
  const next = queued && position === 0;
  const label = flash ? 'Paid just now' : next ? 'Paid in the next block' : 'Next payment';
  const parts = est && !next ? etaParts(est.etaMs) : null;
  const nextIn = est && next ? etaParts(est.etaMs) : null;

  return (
    <div
      className="ix-pay"
      data-tier={tier}
      data-flash={flash || undefined}
      data-next={next || undefined}
      aria-live="off"
    >
      <div className="ix-pay-k">
        <Coins size={14} strokeWidth={1.75} aria-hidden="true" />
        <Swap k={label}>{label}</Swap>
      </div>
      <div className="ix-pay-big">
        {queued && est ? (
          next ? (
            <b className="ix-pay-eta">
              <Swap k="next">Next block</Swap>
              {nextIn ? (
                <small className="ix-pay-in">
                  {est.etaMs > 0 ? (
                    <>
                      in <Digits value={nextIn.value} /> {nextIn.unit}
                    </>
                  ) : (
                    'any moment'
                  )}
                </small>
              ) : null}
            </b>
          ) : parts ? (
            <b className="ix-pay-eta">
              <span className="ix-sr">{`Next payment ${parts.phrase}`}</span>
              <span aria-hidden="true">
                <Digits value={parts.value} />
                {parts.unit ? <small>{parts.unit}</small> : null}
              </span>
            </b>
          ) : null
        ) : (
          <b className="ix-pay-eta" data-muted="">
            {size === 0 && !pos && status === 'confirmed' ? 'Unknown' : 'Not queued'}
          </b>
        )}
        {amount ? <em className="ix-pay-amt">{amount} FLUX</em> : null}
      </div>
      <div className="ix-pay-sub">
        {queued ? (
          <>
            Queue position <span className="ix-mono">#{formatInt(position + 1)}</span> of{' '}
            <span className="ix-mono">{formatInt(size)}</span>
            {since !== null ? (
              <>
                {' '}
                · last paid <span className="ix-mono">{formatInt(since)}</span> blocks ago (block{' '}
                <BlockLink height={lastPaid}>{formatInt(lastPaid)}</BlockLink>)
              </>
            ) : (
              ' · no payment seen yet'
            )}
          </>
        ) : (
          (NOT_QUEUED[status] ?? 'The payment queue position is not known yet')
        )}
      </div>
      <div className="ix-pay-foot">
        <span className="ix-pay-est">
          {queued ? `Estimate at about 30 s per block. ${tierLabel(tier)} pays one node every block.` : ' '}
        </span>
      </div>
      <div className="ix-pay-bar" aria-hidden="true">
        <i style={{ transform: `scaleX(${queued ? queueProgress(position, size) : 0})` }} />
      </div>
    </div>
  );
}

function PayStats() {
  const { apiKey, tier, id } = useNodeCtx();
  const q = useNodePayments(apiKey, { limit: 50 });
  const first = useFirstIngestMs();
  const { clock } = useRuntime();
  const tiers = useTierInfo();
  const queues = useQueues();
  const info = tiers.find((t) => t.tier === tier);
  const pos = id !== null ? positionOf(queues, id) : null;
  const size = pos?.size ?? info?.count ?? 0;
  const now = clock.now();

  const flat = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const totals = windowTotals(flat, {
    nowMs: now,
    windowMs: 30 * DAY_MS,
    firstMs: first,
    toFlux: fluxToNumber,
  });
  const days = paymentDays(flat, { nowMs: now, days: 30, firstMs: first, toFlux: fluxToNumber });
  const perDay = info?.payout != null && size > 0 ? fluxPerDay(info.payout, size) : null;

  if (q.isPending) {
    return (
      <Grid cols={3}>
        {[0, 1, 2].map((i) => (
          <div className="ix-tile" key={i} aria-hidden="true">
            <Sk h={14} w="60%" />
            <Sk h={24} w="70%" />
            <Sk h={12} w="50%" />
          </div>
        ))}
      </Grid>
    );
  }

  const scope = totals.complete || first === null ? '30 days' : 'Since first ingest';
  return (
    <Grid cols={3}>
      <Tile
        label={scope}
        value={<Digits value={formatInt(totals.count)} />}
        unit={totals.count === 1 ? 'payment' : 'payments'}
        detail={`${totals.flux.toFixed(2)} FLUX`}
      />
      <Tile
        label="Per day"
        value={perDay === null ? 'Unknown' : <Digits value={perDay.toFixed(2)} />}
        unit={perDay === null ? undefined : 'FLUX'}
        detail={size > 0 ? `estimate, cycle ${cycleHours(size).toFixed(1)} h` : 'estimate'}
        detailTone="accent"
      />
      <Tile label="Payout history" detail="30 d">
        <div className="ix-tile-bars">
          <MiniBars values={days.map((d) => d.flux)} hot={3} label="FLUX paid per day, last 30 days" />
        </div>
      </Tile>
    </Grid>
  );
}

/** The payment block: the tile and the three statistics under it. */
export function PaymentBlock() {
  return (
    <Section
      title="Payment"
      icon={<Coins size={16} strokeWidth={1.75} />}
      index={1}
      bare
      className="ix-sec-pay"
    >
      <PayTile />
      <div className="ix-gap">
        <PayStats />
      </div>
    </Section>
  );
}

/** The latest payments from our own ledger. */
export function PaymentHistory() {
  const { apiKey } = useNodeCtx();
  const q = useNodePayments(apiKey, { limit: 50 });
  const first = useFirstIngestMs();
  const { clock } = useRuntime();
  const [shown, setShown] = useState(5);
  const flat = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const total = q.data?.pages[0]?.total_paid ?? null;
  const now = clock.now();
  const more = flat.length > shown || q.hasNextPage;

  return (
    <Section
      title="Recent payments"
      icon={<History size={16} strokeWidth={1.75} />}
      index={2}
      aside={total ? `${formatFlux(total)} since first ingest` : undefined}
    >
      {q.isPending ? (
        <div className="ix-plist" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div className="ix-prow" key={i}>
              <Sk h={14} w="48%" />
            </div>
          ))}
        </div>
      ) : flat.length === 0 ? (
        <p className="ix-cap ix-empty">
          No payment recorded yet.{' '}
          {first
            ? `Our ledger starts on ${formatUtcDateTime(first)}.`
            : 'The ledger starts at our first ingest.'}
        </p>
      ) : (
        <ul className="ix-plist">
          {flat.slice(0, shown).map((p) => (
            <li className="ix-prow ix-fade" key={`${p.height}`}>
              <time dateTime={new Date(p.time_ms).toISOString()}>{formatUtcDateTime(p.time_ms)}</time>
              <span className="ix-dim">{formatAgo(now - p.time_ms)}</span>
              <span className="ix-mono ix-pay-amt-row">{formatFlux(p.amount, { sign: 'always' })}</span>
              <BlockLink height={p.height} className="ix-mono">
                #{formatInt(p.height)}
              </BlockLink>
            </li>
          ))}
        </ul>
      )}
      {more && flat.length > 0 ? (
        <div className="ix-more">
          <Btn
            variant="ghost"
            onClick={() => {
              const next = Math.min(50, shown + 10);
              setShown(next);
              if (flat.length < next && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
            }}
          >
            Show more
          </Btn>
        </div>
      ) : null}
    </Section>
  );
}
