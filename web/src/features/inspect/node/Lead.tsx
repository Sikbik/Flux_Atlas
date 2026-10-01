// The lead of the node inspector: what an operator opens it for. When is the next payment, what does the
// node earn, how far through its queue is it. Everything else is a fold below.

import { useMemo } from 'react';
import { useNodePayments } from '../../../api/queries';
import { useRuntime } from '../../../app/context';
import { fluxToNumber, formatInt } from '../../../lib/format';
import {
  AnimatedNumber,
  FlashOnChange,
  Meter,
  Section,
  Sparkline,
  Stat,
  StatGrid,
  tierLabel,
} from '../../../ui';
import { etaShort } from '../derive/eta';
import { paymentDays, windowTotals } from '../derive/payments';
import { estimatePayment, queueProgress } from '../derive/queue';
import { useFirstIngestMs } from '../sources/hooks';
import { useChainClock } from '../sources/live';
import { useNodeCtx } from './context';
import { NOT_QUEUED, type PayInfo, usePayInfo } from './pay';

const DAY_MS = 86_400_000;
const fmt2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtEta = (s: number) => etaShort(s * 1000);
/** `Oct 1`: the day our ledger starts, in UTC like every time in the inspectors. */
const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The next payment, counting down. The only tile that re-renders every second. */
function NextPayment({ pay }: { pay: PayInfo }) {
  const { tip, anchorMs, nowMs } = useChainClock();
  const { queued, position, size, tier, status, payout, lastPaid } = pay;
  const est =
    queued && position !== null && tip !== null && anchorMs !== null
      ? estimatePayment(position, size, tip, anchorMs, nowMs)
      : null;
  const next = queued && position === 0;
  const place = tier === 'unknown' ? 'Place' : tierLabel(tier);

  if (!queued || position === null) {
    // Not in a queue: a plain tile (no hero numerals) that says why, so the lead stays calm.
    return (
      <Stat
        className="ix-wide"
        label="Next payment"
        value={size === 0 && status === 'confirmed' ? null : 'Not queued'}
        caption={NOT_QUEUED[status] ?? 'The payment queue position is not known yet'}
        tier={tier === 'unknown' ? undefined : tier}
      />
    );
  }
  const amount = payout !== null ? `+${fmt2(payout)} FLUX` : null;
  const figure = next ? (
    'Next block'
  ) : est ? (
    <AnimatedNumber value={Math.round(est.etaMs / 1000)} format={fmtEta} roll={false} />
  ) : null;
  return (
    <Stat
      hero
      label={next ? 'Paid in the next block' : 'Next payment'}
      value={
        figure === null ? null : (
          <FlashOnChange value={lastPaid} tone="white">
            {figure}
          </FlashOnChange>
        )
      }
      caption={
        <span title="Atlas derives this from the live queue; the network does not publish it">
          {place} #{formatInt(position + 1)} of {formatInt(size)}
          {next && est && est.etaMs > 0 ? ` · in ${etaShort(est.etaMs)}` : ''}
          {amount ? ` · ${amount}` : ''} · estimate
        </span>
      }
      tier={tier === 'unknown' ? undefined : tier}
    />
  );
}

/** How the node's last 30 days of payments look: the total, the count and a bar per day. */
function ThirtyDays() {
  const { apiKey } = useNodeCtx();
  const q = useNodePayments(apiKey, { limit: 50 });
  const first = useFirstIngestMs();
  const { clock } = useRuntime();
  const now = clock.now();
  // The windows only need the data and the day, not every render's clock.
  const day = Math.floor(now / DAY_MS);
  const flat = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const { totals, days } = useMemo(
    () => ({
      totals: windowTotals(flat, {
        nowMs: day * DAY_MS,
        windowMs: 30 * DAY_MS,
        firstMs: first,
        toFlux: fluxToNumber,
      }),
      days: paymentDays(flat, { nowMs: day * DAY_MS, days: 30, firstMs: first, toFlux: fluxToNumber }),
    }),
    [flat, day, first],
  );

  if (q.isPending) return <Stat label="30 days" loading />;
  // A ledger younger than 30 days says so in the label, so the figure is never read as a full month.
  const young = !totals.complete && first !== null;
  const count = `${formatInt(totals.count)} ${totals.count === 1 ? 'payment' : 'payments'}`;
  return (
    <Stat
      label={young ? 'Paid so far' : '30 days'}
      value={<AnimatedNumber value={totals.flux} format={fmt2} />}
      unit="FLUX"
      caption={young && first !== null ? `${count} since ${shortDate(first)}` : count}
      spark={<Sparkline form="bars" values={days.map((d) => d.flux)} decorative />}
    />
  );
}

/** The walk through the queue: where the node is between the back and being paid. */
function QueueMeter({ pay }: { pay: PayInfo }) {
  if (!pay.queued || pay.position === null) return null;
  const { position, size } = pay;
  return (
    <Meter
      label="How far through the queue"
      value={queueProgress(position, size)}
      size="md"
      startLabel="Back of the queue"
      endLabel="Paid"
      format={() => `Place ${formatInt(position + 1)} of ${formatInt(size)}`}
    />
  );
}

export function PayLead() {
  const pay = usePayInfo();
  return (
    <Section>
      <div className="ix-stack">
        <StatGrid columns={2} className="ix-paylead">
          <NextPayment pay={pay} />
          <Stat
            label="Per day"
            value={pay.perDay === null ? null : <AnimatedNumber value={pay.perDay} format={fmt2} />}
            unit="FLUX"
            caption="estimate"
          />
          <ThirtyDays />
        </StatGrid>
        <QueueMeter pay={pay} />
      </div>
    </Section>
  );
}
