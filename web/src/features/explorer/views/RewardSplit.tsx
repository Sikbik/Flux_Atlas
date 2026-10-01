// Where a block's reward went: one proportional bar (Stratus, Nimbus, Cumulus, dev fund) and a table of
// the recipients. Tier colours appear here because a payout ARRIVES here (design 5.2).

import { Landmark } from 'lucide-react';
import type { PayoutDto } from '../../../api/generated/PayoutDto';
import { formatPercent, parseFlux } from '../../../lib/format';
import {
  Amount,
  Chip,
  DataTable,
  type DataTableColumn,
  ShareBar,
  type ShareSegment,
  Stack,
  TierChip,
  type TierName,
  tierLabel,
} from '../../../ui';
import { DEV_FUND_ADDRESS } from '../lib/entities';
import { AddressTag, Dense, NodeLink } from './shared';

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
      label: tierLabel(p.tier),
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

export function RewardSplit({ slices }: { slices: readonly Slice[] }) {
  const total = slices.reduce((s, x) => s + x.sats, 0n);
  const share = (x: Slice) => (total > 0n ? Number((x.sats * 10_000n) / total) / 10_000 : 0);
  const segments: ShareSegment[] = slices.map((s) => ({
    id: s.key,
    label: s.label,
    value: Number(s.sats) / 1e8,
    tier: s.tier,
  }));
  const columns: readonly DataTableColumn<Slice>[] = [
    {
      id: 'who',
      header: 'Recipient',
      cell: (s) =>
        s.tier ? (
          <TierChip tier={s.tier} size="sm" />
        ) : (
          <Chip size="sm" icon={Landmark} title={s.note}>
            {s.label}
          </Chip>
        ),
      minWidth: 120,
    },
    {
      id: 'amount',
      header: 'Amount',
      numeric: true,
      cell: (s) => <Amount value={s.sats} decimals={s.sats % 1_000_000n === 0n ? 2 : 8} />,
    },
    { id: 'share', header: 'Share', numeric: true, cell: (s) => formatPercent(share(s), 1) },
    {
      id: 'node',
      header: 'Node',
      cell: (s) =>
        s.tier ? <NodeLink id={s.node ?? null} glyph={false} /> : <span className="ex-note">{s.note}</span>,
      minWidth: 210,
    },
    {
      id: 'address',
      header: 'Address',
      cell: (s) => <AddressTag address={s.address} hideLabel />,
      minWidth: 150,
    },
  ];
  return (
    <Stack gap={6}>
      <ShareBar
        segments={segments}
        legend="none"
        size="lg"
        label="How the block reward was split"
        format={(v) => `${v.toFixed(2)} FLUX`}
      />
      <Dense>
        <DataTable
          aria-label="Recipients of the block reward"
          rows={slices}
          columns={columns}
          rowKey={(s) => s.key}
          rowHeight="compact"
          zebra={false}
        />
      </Dense>
    </Stack>
  );
}
