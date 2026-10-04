// The wallet's standing: what it holds, how much of that is locked as collateral, where it ranks (by balance among
// all addresses, by node count among operators) and how much of each tier it runs. The balance is the one hero figure
// of the view; everything else here is supporting.

import { Link } from '@tanstack/react-router';
import { Lock } from 'lucide-react';
import type { CSSProperties } from 'react';
import { formatInt, formatPercent } from '../../../../lib/format';
import {
  AnimatedNumber,
  Delta,
  ShareBar,
  type ShareSegment,
  Stat,
  StatGrid,
  TierGlyph,
  tierLabel,
} from '../../../../ui';
import { useWalletCtx } from '../../context';
import { figureEm } from '../../lib/figure';
import { flux, fluxOrNull } from '../../lib/money';
import { PAY_TIERS } from '../../types';

const fmt2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const formatFlux2 = (n: number): string => fmt2.format(n);

/** Where an operator stands among all of them, as a fraction from the smallest (0) to the largest (1). */
export function standingFraction(rank: number | null, count: number): number | null {
  if (rank === null || count <= 0 || rank < 1) return null;
  if (count === 1) return 1;
  return Math.min(1, Math.max(0, 1 - (rank - 1) / (count - 1)));
}

/** `Top 0.2%`, `Top 12%`, `Top half`: the share of operators at or above this rank. */
export function topShareText(rank: number | null, count: number): string | null {
  if (rank === null || count <= 0 || rank < 1) return null;
  const share = rank / count;
  if (share <= 0.0005) return 'Top 0.1%';
  if (share < 0.1) return `Top ${(share * 100).toFixed(1)}%`;
  if (share <= 0.5) return `Top ${Math.round(share * 100)}%`;
  return `${Math.round(share * 100)}th percentile from the top`;
}

export function Standing() {
  const { dto, money } = useWalletCtx();
  const s = dto.standing;
  const balance = fluxOrNull(s.balance);
  const locked = flux(s.collateral_locked);
  const liquid = fluxOrNull(s.liquid) ?? (balance === null ? null : Math.max(0, balance - locked));

  const segments: ShareSegment[] = [
    { id: 'locked', label: 'Locked as node collateral', value: locked },
    { id: 'liquid', label: 'Liquid', value: liquid },
  ];

  const frac = standingFraction(s.operator_rank, s.operator_count);
  const top = topShareText(s.operator_rank, s.operator_count);
  // The balance is the longest figure in the view: the tile sizes it so every digit fits on a phone.
  const fit = (
    balance === null ? {} : { '--wl-em': figureEm(formatFlux2(balance)).toFixed(3) }
  ) as CSSProperties;

  return (
    <section className="wl-standing" aria-label="Standing">
      <div className="wl-standing__main" style={fit}>
        <Stat
          hero
          label="Balance"
          value={
            balance === null ? null : (
              <AnimatedNumber value={balance} format={formatFlux2} countUpOnMount maxHz={0} />
            )
          }
          unit="FLUX"
          delta={
            money.change24h === null ? undefined : (
              <Delta value={money.change24h} kind="percent" decimals={2} period="price, 24 h" />
            )
          }
          caption={
            balance === null
              ? 'Waiting for the explorer'
              : `${money.text(balance)}${money.price === null ? '' : ` at ${money.priceText} per FLUX`}`
          }
        />
        <div className="wl-split">
          {balance === null ? (
            <p className="wl-note">
              <Lock size={12} strokeWidth={1.5} aria-hidden="true" className="wl-inline-icon" />{' '}
              {locked > 0
                ? `${formatInt(Math.round(locked))} FLUX of the balance is locked as node collateral. `
                : ''}
              The explorer is slow to answer right now, so the balance is left blank rather than guessed. It
              fills in by itself.
            </p>
          ) : (
            <>
              <ShareBar
                segments={segments}
                size="md"
                legend="inline"
                format={(v) => `${formatInt(Math.round(v))} FLUX`}
                label="Balance split between collateral and liquid FLUX"
              />
              <p className="wl-note">
                <Lock size={12} strokeWidth={1.5} aria-hidden="true" className="wl-inline-icon" /> Collateral
                is locked to your nodes. It counts in the balance, and spending it stops the node.
              </p>
            </>
          )}
        </div>
      </div>

      <div className="wl-standing__side">
        <StatGrid min={150} columns={2}>
          <Stat
            label="Rich list"
            value={
              s.richlist_rank !== null
                ? `#${formatInt(s.richlist_rank)}`
                : balance === null
                  ? null
                  : 'Unranked'
            }
            caption={
              <>
                {s.richlist_rank !== null
                  ? 'by balance. '
                  : balance === null
                    ? 'Waiting for the explorer. '
                    : 'Outside the top 1,000 by balance. '}
                <Link
                  to="/richlist"
                  search={(prev: Record<string, unknown>) => prev as never}
                  className="wl-link"
                >
                  Open the list
                </Link>
              </>
            }
          />
          <Stat
            label="Operator rank"
            value={s.operator_rank === null ? 'Unranked' : `#${formatInt(s.operator_rank)}`}
            unit={s.operator_count > 0 ? `of ${formatInt(s.operator_count)}` : undefined}
            caption={
              frac === null ? (
                'by number of nodes'
              ) : (
                <>
                  <span
                    className="wl-ruler"
                    role="img"
                    aria-label={`${top}: rank ${s.operator_rank} of ${s.operator_count} operators by number of nodes`}
                  >
                    <i style={{ left: `${(frac * 100).toFixed(2)}%` }} />
                  </span>
                  <span>{top} by nodes</span>
                </>
              )
            }
          />
        </StatGrid>

        <ul className="wl-shares" aria-label="Share of each tier this wallet runs">
          {PAY_TIERS.slice()
            .reverse()
            .map((t) => {
              const n = dto.tiers[t];
              if (n <= 0) return null;
              const share = s.share_of_tier[t] ?? 0;
              return (
                <li key={t} data-tier={t}>
                  <TierGlyph tier={t} size={14} />
                  <span className="wl-shares__name">{tierLabel(t)}</span>
                  <span className="wl-shares__bar" aria-hidden="true">
                    <i style={{ width: `${Math.max(1.5, Math.min(100, share * 100)).toFixed(2)}%` }} />
                  </span>
                  <span className="wl-shares__val ui-mono">{formatPercent(share, share < 0.1 ? 2 : 1)}</span>
                  <span className="wl-shares__n">
                    {formatInt(n)} {n === 1 ? 'node' : 'nodes'} of the tier
                  </span>
                </li>
              );
            })}
        </ul>
      </div>
    </section>
  );
}
