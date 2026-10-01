// Churn: is the network growing or shrinking, and how steadily. The headline is the net change over
// the chosen window; the instrument is the net change per bucket as bars from a zero line, with the
// split by tier in the tooltip. The history records counts, not identities, so joins and leaves inside
// one bucket cancel out; the tab says so.

import { ArrowLeftRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatInt } from '../../../lib/format';
import { ErrorState, Section, Skeleton, Stack, Stat, StatGrid, tierLabel, ViewHeader } from '../../../ui';
import { useNodeHistory } from '../hooks/useNodeHistory';
import { CHURN_TIERS, churnBuckets, windowChange } from '../lib/churn';
import { RANGES, type Range } from '../lib/metrics';
import { RangeControl } from '../views/RangeControl';
import { DeltaBars } from '../viz/DeltaBars';

const HOUR = 3_600_000;
const BUCKET: Record<Range, number> = { '24h': HOUR, '7d': 6 * HOUR, '30d': 24 * HOUR };
const BUCKET_WORD: Record<Range, string> = { '24h': 'hour', '7d': 'six hours', '30d': 'day' };

const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '');

export function ChurnTab() {
  const [range, setRange] = useState<Range>('7d');
  const hist = useNodeHistory(range);
  const bucketMs = BUCKET[range];

  const buckets = useMemo(
    () => (hist.frame ? churnBuckets(hist.frame, bucketMs) : []),
    [hist.frame, bucketMs],
  );
  const change = useMemo(() => windowChange(hist.frame?.v.node_count ?? []), [hist.frame]);
  const enough = buckets.filter((b) => b.net !== null).length >= 2;

  return (
    <>
      <ViewHeader
        level={2}
        kind="Churn"
        icon={ArrowLeftRight}
        title="Growth and loss"
        subtitle={
          change
            ? `From ${formatInt(change.from)} to ${formatInt(change.to)} nodes over ${RANGES[range].label}.`
            : 'The server has not recorded enough history for this window yet.'
        }
      />

      <div className="ex-hero">
        <StatGrid min={220}>
          <Stat
            hero
            label={`Net change in ${RANGES[range].label}`}
            value={change ? `${sign(change.change)}${formatInt(Math.abs(change.change))}` : null}
            unit="nodes"
            caption="A node that leaves while another joins in the same bucket cancels out."
          />
        </StatGrid>
      </div>

      <Section title={`Net change per ${BUCKET_WORD[range]}`}>
        <Stack gap={5}>
          <RangeControl value={range} onChange={setRange} />
          {hist.isError && !hist.frame ? (
            <ErrorState title="Could not load the history" onRetry={hist.refetch} />
          ) : !hist.frame ? (
            <Skeleton h={260} radius={12} />
          ) : !enough ? (
            <p className="ex-muted">The server has not recorded enough history for this range yet.</p>
          ) : (
            <DeltaBars
              title="Net change in nodes"
              summary={`Change in the number of nodes per ${BUCKET_WORD[range]} over the last ${RANGES[range].label}`}
              t={buckets.map((b) => b.t)}
              stepMs={bucketMs}
              values={buckets.map((b) => b.net)}
              height={260}
              unit="nodes"
              detail={(i) => {
                const b = buckets[i];
                if (!b) return [];
                return [...CHURN_TIERS].reverse().map((tier) => ({
                  label: tierLabel(tier),
                  value:
                    b.tiers[tier] === null
                      ? 'Unknown'
                      : `${sign(b.tiers[tier])}${formatInt(Math.abs(b.tiers[tier]))}`,
                  color: `var(--tier-${tier}-ink)`,
                }));
              }}
            />
          )}
          <p className="ex-caption">Up is growth, down is loss. These are net changes.</p>
        </Stack>
      </Section>
    </>
  );
}
