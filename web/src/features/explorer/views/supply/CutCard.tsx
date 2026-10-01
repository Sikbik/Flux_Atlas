// The next reward cut: a countdown in blocks and time, how far the era has run, and what each tier is
// paid before and after. The cut is a fixed schedule in the chain's consensus parameters; only the
// date is an estimate (30 second blocks from the tip).

import { Scissors } from 'lucide-react';
import { useRuntime, useTip } from '../../../../app/context';
import {
  formatDuration,
  formatInt,
  formatPercent,
  formatSats,
  formatUtcDateTime,
  heightEta,
} from '../../../../lib/format';
import { useNow } from '../../../../lib/useClock';
import { Meter } from '../../../analytics/viz/Meter';
import {
  nextReductionHeight,
  PON_ACTIVATION_HEIGHT,
  payoutSchedule,
  reductionHeight,
  reductionsAt,
} from '../../lib/emission';
import { Section, TIER_LABEL, TierGlyph, type TierName } from '../../parts';
import './supply.css';

export function CutCard({ compact }: { compact?: boolean }) {
  const tip = useTip();
  const { clock } = useRuntime();
  const now = useNow(clock);
  if (!tip) return null;
  const cut = nextReductionHeight(tip.height);
  if (cut === null) return null;
  const k = reductionsAt(tip.height);
  const from = k === 0 ? PON_ACTIVATION_HEIGHT : reductionHeight(k);
  const progress = Math.max(0, Math.min(1, (tip.height - from) / (cut - from)));
  const eta = heightEta(cut, { height: tip.height, timeMs: tip.time_ms }, now);
  const before = payoutSchedule(cut - 1);
  const after = payoutSchedule(cut);
  const tiers: TierName[] = ['stratus', 'nimbus', 'cumulus'];
  const body = (
    <div className="ex-cut" data-compact={compact || undefined}>
      <div className="ex-cut__count">
        <span className="ex-cut__blocks">{formatInt(eta.blocks)}</span>
        <span className="ex-cut__unit">blocks to go</span>
        <span className="ex-cut__eta">
          about <strong>{formatDuration(eta.etaMs)}</strong>, around{' '}
          {formatUtcDateTime(eta.atMs).slice(0, 10)}
        </span>
      </div>
      <div className="ex-cut__progress">
        <Meter value={progress} label={`Era progress: ${formatPercent(progress, 1)}`} />
        <div className="ex-cut__ends ex-mono">
          <span>{formatInt(from)}</span>
          <span>{formatPercent(progress, 1)}</span>
          <span>cut at {formatInt(cut)}</span>
        </div>
      </div>
      {before && after ? (
        <ul className="ex-cut__tiers" aria-label="Payout per block before and after the cut">
          {tiers.map((t) => (
            <li key={t} data-tier={t}>
              <span className="ex-cut__tier">
                <TierGlyph tier={t} size={13} />
                {TIER_LABEL[t]}
              </span>
              <span className="ex-cut__change ex-mono">
                {formatSats(before[t], { decimals: 2, unit: false })}
                <i aria-hidden="true">to</i>
                <b>{formatSats(after[t], { decimals: 2, unit: false })}</b>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
  if (compact) return body;
  return (
    <Section title="Next reward cut" icon={Scissors} aside="10 percent, then every 1,051,200 blocks">
      {body}
    </Section>
  );
}
