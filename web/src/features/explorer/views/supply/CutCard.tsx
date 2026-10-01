// The next reward cut: a countdown in blocks and time, how far the era has run, and what each tier is
// paid before and after. The cut is a fixed schedule in the chain's consensus parameters; only the
// date is an estimate (30 second blocks from the tip).

import { Scissors } from 'lucide-react';
import { useRuntime, useTip } from '../../../../app/context';
import {
  formatDuration,
  formatInt,
  formatPercent,
  formatUtcDateTime,
  heightEta,
} from '../../../../lib/format';
import { useNow } from '../../../../lib/useClock';
import {
  Amount,
  clamp,
  KeyValue,
  Meter,
  Section,
  Stack,
  Stat,
  StatGrid,
  TierChip,
  type TierName,
} from '../../../../ui';
import {
  nextReductionHeight,
  PON_ACTIVATION_HEIGHT,
  payoutSchedule,
  reductionHeight,
  reductionsAt,
} from '../../lib/emission';

const TIERS: readonly TierName[] = ['stratus', 'nimbus', 'cumulus'];

export function CutCard() {
  const tip = useTip();
  const { clock } = useRuntime();
  const now = useNow(clock);
  if (!tip) return null;
  const cut = nextReductionHeight(tip.height);
  if (cut === null) return null;
  const k = reductionsAt(tip.height);
  const from = k === 0 ? PON_ACTIVATION_HEIGHT : reductionHeight(k);
  const progress = clamp((tip.height - from) / (cut - from), 0, 1);
  const eta = heightEta(cut, { height: tip.height, timeMs: tip.time_ms }, now);
  const before = payoutSchedule(cut - 1);
  const after = payoutSchedule(cut);
  return (
    <Section title="Next reward cut" icon={Scissors} aside="minus 10 percent">
      <Stack gap={6}>
        <StatGrid min={220}>
          <Stat
            label="Blocks to go"
            value={formatInt(eta.blocks)}
            caption={
              <>
                about {formatDuration(eta.etaMs)}, around {formatUtcDateTime(eta.atMs).slice(0, 10)}
              </>
            }
          />
        </StatGrid>
        <Meter
          label={`Progress through the current era: ${formatPercent(progress, 1)}`}
          value={progress}
          startLabel={formatInt(from)}
          midLabel={formatPercent(progress, 1)}
          endLabel={`cut at ${formatInt(cut)}`}
        />
        {before && after ? (
          <KeyValue
            align="start"
            aria-label="Payout per block before and after the cut"
            items={TIERS.map((t) => ({
              label: <TierChip tier={t} size="sm" />,
              value: (
                <span>
                  <Amount value={before[t]} decimals={2} unit={false} /> to{' '}
                  <Amount value={after[t]} decimals={2} />
                </span>
              ),
            }))}
          />
        ) : null}
        <p className="ex-note">
          The cut is written into the chain's rules: every payout falls by 10 percent, then again every
          1,051,200 blocks. Only the date is an estimate.
        </p>
      </Stack>
    </Section>
  );
}
