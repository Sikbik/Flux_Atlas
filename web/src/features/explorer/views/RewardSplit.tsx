// Where a block's reward went: one proportional strip (Stratus, Nimbus, Cumulus, dev fund) and a card
// per recipient. Hover or focus on either side lights the matching part of the other, so the strip
// reads as an instrument and the cards as its legend. Tier colours appear here because a payout
// ARRIVES here (design 5.2); nowhere else on the page.

import { Landmark } from 'lucide-react';
import { useState } from 'react';
import type { PayoutDto } from '../../../api/generated/PayoutDto';
import { formatPercent, parseFlux } from '../../../lib/format';
import { DEV_FUND_ADDRESS } from '../lib/entities';
import { Amount, cx, TIER_LABEL, TierGlyph, type TierName } from '../parts';
import { AddressTag, NodeLink } from './shared';
import './reward.css';

export interface Slice {
  key: string;
  label: string;
  tier?: TierName;
  sats: bigint;
  address: string | null;
  node?: number | null;
  note?: string;
}

const TIER_ORDER: Record<string, number> = { stratus: 0, nimbus: 1, cumulus: 2 };

export function buildSlices(
  payouts: readonly PayoutDto[],
  devFund: string | null,
  devFundMinSats: bigint | null,
): Slice[] {
  const slices: Slice[] = [];
  const sorted = [...payouts].sort((a, b) => (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9));
  sorted.forEach((p, i) => {
    const sats = parseFlux(p.amount);
    if (sats === null || (p.tier !== 'stratus' && p.tier !== 'nimbus' && p.tier !== 'cumulus')) return;
    slices.push({
      key: `${p.tier}:${i}`,
      label: TIER_LABEL[p.tier],
      tier: p.tier,
      sats,
      address: p.address,
      node: p.node,
    });
  });
  const dev = parseFlux(devFund);
  if (dev !== null && dev > 0n) {
    const fees = devFundMinSats !== null && dev > devFundMinSats ? dev - devFundMinSats : 0n;
    slices.push({
      key: 'devfund',
      label: 'Dev fund',
      sats: dev,
      address: DEV_FUND_ADDRESS,
      note: fees > 0n ? 'Includes the fees of this block' : 'The fixed share',
    });
  }
  return slices;
}

const color = (s: Slice) => (s.tier ? `var(--tier-${s.tier}-ink)` : 'var(--accent-500)');

export function RewardSplit({ slices, loading }: { slices: readonly Slice[]; loading?: boolean }) {
  const [hot, setHot] = useState<string | null>(null);
  const total = slices.reduce((s, x) => s + x.sats, 0n);
  const pct = (x: Slice) => (total > 0n ? Number((x.sats * 10_000n) / total) / 10_000 : 0);
  const summary = slices.map((s) => `${s.label} ${Number(s.sats) / 1e8} FLUX`).join(', ');
  return (
    <div className="ex-split" data-loading={loading || undefined} onPointerLeave={() => setHot(null)}>
      <div
        className="ex-strip"
        role="img"
        aria-label={`Reward split: ${summary}`}
        data-hot={hot ? '' : undefined}
      >
        {slices.map((s, i) => (
          <i
            key={s.key}
            className="ex-strip__seg"
            data-hot={hot === s.key || undefined}
            data-tier={s.tier}
            style={{
              flexGrow: Math.max(1, Number(s.sats / 1_000_000n)),
              ['--c' as string]: color(s),
              ['--i' as string]: i,
            }}
            onPointerEnter={() => setHot(s.key)}
          />
        ))}
      </div>
      <ul className="ex-payouts" aria-label="Recipients">
        {slices.map((s, i) => (
          <li
            key={s.key}
            className={cx('ex-payout')}
            data-tier={s.tier}
            data-devfund={s.tier ? undefined : ''}
            data-hot={hot === s.key || undefined}
            style={{ ['--i' as string]: i }}
            onPointerEnter={() => setHot(s.key)}
            onFocus={() => setHot(s.key)}
            onBlur={() => setHot(null)}
          >
            <div className="ex-payout__head">
              {s.tier ? (
                <TierGlyph tier={s.tier} size={15} />
              ) : (
                <Landmark size={15} strokeWidth={1.5} aria-hidden="true" />
              )}
              <span className="ex-payout__name">{s.label}</span>
              <span className="ex-payout__share">{formatPercent(pct(s), 1)}</span>
            </div>
            <Amount
              className="ex-payout__amt"
              value={s.sats}
              decimals={s.sats % 1_000_000n === 0n ? 2 : 8}
              dimFraction
              unit="FLUX"
            />
            <div className="ex-payout__who">
              {s.tier ? (
                <NodeLink id={s.node ?? null} glyph={false} />
              ) : (
                <span className="ex-payout__note">{s.note}</span>
              )}
              <AddressTag address={s.address} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
