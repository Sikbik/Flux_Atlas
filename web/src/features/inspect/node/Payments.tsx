import { useMemo, useState } from 'react';
import type { PaymentRow } from '../../../api/generated/PaymentRow';
import { useNodePayments } from '../../../api/queries';
import { useTip } from '../../../app/context';
import { formatInt, formatUtcDateTime } from '../../../lib/format';
import { useUi } from '../../../store/ui';
import {
  Amount,
  Button,
  DataTable,
  type DataTableColumn,
  Height,
  KeyValue,
  RelativeTime,
  tierLabel,
} from '../../../ui';
import { earnedSats } from '../../earnings/basis';
import { EarningsBasis } from '../../earnings/EarningsBasis';
import { cycleHours } from '../derive/queue';
import { useFirstIngestMs } from '../sources/hooks';
import { useNodeCtx } from './context';
import { NOT_QUEUED, usePayInfo } from './pay';

const columns: DataTableColumn<PaymentRow>[] = [
  { id: 'when', header: 'When', cell: (p) => <RelativeTime ts={p.time_ms} />, minWidth: 110 },
  {
    id: 'amount',
    header: 'Amount, main chain',
    numeric: true,
    cell: (p) => <Amount value={p.amount} sign="always" />,
    minWidth: 110,
  },
  {
    id: 'block',
    header: 'Block',
    numeric: true,
    cell: (p) => <Height value={p.height} link={false} />,
    minWidth: 96,
  },
];

const rowKey = (p: PaymentRow) => p.height;
const rowLink = (p: PaymentRow) => ({ kind: 'block' as const, value: String(p.height) });

/** Where the node stands in its queue, and the latest payments from our own ledger. */
export function PaymentsBody() {
  const { apiKey } = useNodeCtx();
  const pay = usePayInfo();
  const tip = useTip();
  const q = useNodePayments(apiKey, { limit: 50 });
  const first = useFirstIngestMs();
  const [shown, setShown] = useState(5);
  const flat = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const rows = useMemo(() => flat.slice(0, shown), [flat, shown]);
  const includePa = useUi((s) => s.includePa);
  const page = q.data?.pages[0];
  const total = page ? earnedSats(page.total_paid, page.pa_total_paid, includePa) : null;
  const more = flat.length > shown || q.hasNextPage;
  const since = tip && pay.lastPaid > 0 ? Math.max(0, tip.height - pay.lastPaid) : null;

  return (
    <div className="ix-stack">
      <KeyValue
        items={[
          {
            label: 'Place in queue',
            value:
              pay.queued && pay.position !== null
                ? `#${formatInt(pay.position + 1)} of ${formatInt(pay.size)}`
                : null,
            unknown: NOT_QUEUED[pay.status] ?? 'Not known yet',
            mono: true,
            note:
              pay.queued && pay.tier !== 'unknown'
                ? `About 30 s per block; ${tierLabel(pay.tier)} pays one node every block.`
                : undefined,
          },
          {
            label: 'Full cycle',
            value: pay.queued ? `${cycleHours(pay.size).toFixed(1)} hours` : null,
            mono: true,
          },
          {
            label: 'Last paid',
            value:
              pay.lastPaid > 0 ? (
                <>
                  <Height value={pay.lastPaid} />
                  {since !== null ? <span className="ix-dim"> · {formatInt(since)} blocks ago</span> : null}
                </>
              ) : null,
            unknown: 'None seen yet',
          },
          {
            label: includePa ? 'Earned since first ingest' : 'Paid since first ingest',
            value: total !== null && total > 0n ? <Amount value={total} /> : null,
            unknown: 'Nothing yet',
            note: <EarningsBasis size="sm" realized />,
          },
        ]}
      />
      {!q.isPending && flat.length === 0 ? (
        <p className="ix-cap">
          No payment recorded yet.{' '}
          {first
            ? `Our ledger starts on ${formatUtcDateTime(first)}.`
            : 'The ledger starts at our first ingest.'}
        </p>
      ) : (
        <DataTable
          aria-label="Latest payments, main chain"
          rows={rows}
          columns={columns}
          rowKey={rowKey}
          rowLink={rowLink}
          loading={q.isPending}
          skeletonRows={3}
          footer={
            more && flat.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const next = Math.min(50, shown + 10);
                  setShown(next);
                  if (flat.length < next && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
                }}
              >
                Show more
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
