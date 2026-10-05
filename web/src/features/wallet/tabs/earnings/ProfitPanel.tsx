// Profit: what the fleet earns against what hosting it costs. The costs are the viewer's own (what one node of each tier
// costs per month, in their currency) and live only in this browser; the earnings are the server's run-rate at today's
// price. The result is net per month, margin, the yield on the collateral and the price at which it just breaks even.

import { Lock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatInt, formatPercent } from '../../../../lib/format';
import { useUi } from '../../../../store/ui';
import { Button, Meter, Stat, StatGrid, Switch, TextField, TierGlyph, tierLabel } from '../../../../ui';
import { EarningsBasis } from '../../../earnings/EarningsBasis';
import { useWalletCtx } from '../../context';
import { convertMoney, flux, formatPrice, MONTH_DAYS } from '../../lib/money';
import { factorText, parseCostInput, profitability } from '../../lib/projection';
import { MAX_COST, useWalletPrefs } from '../../prefs';
import { PAY_TIERS, type PayTier } from '../../types';
import { FitStat } from '../../ui/FitStat';
import { Panel } from '../../ui/Panel';

const TEN = 10;

/** A cost as the field shows it: no trailing zeros, at most two decimals (eight for bitcoin). */
export function costText(v: number, digits = 2): string {
  if (!(v > 0)) return '';
  return String(Math.round(v * TEN ** digits) / TEN ** digits);
}

export function ProfitPanel({ price, factor }: { price: number | null; factor: number }) {
  const { dto, money } = useWalletCtx();
  const stored = useWalletPrefs((s) => s.costs);
  const includePa = useUi((s) => s.includePa);
  const setIncludePa = useUi((s) => s.setIncludePa);
  const clearCosts = useWalletPrefs((s) => s.clearCosts);
  const setCosts = useWalletPrefs((s) => s.setCosts);
  const e = dto.earnings;
  const present = PAY_TIERS.filter((t) => dto.tiers[t] > 0);
  const digits = money.currency === 'btc' ? 8 : 2;

  /** The stored costs in the currency shown (a cost keeps its meaning when the viewer changes currency). */
  const inDisplay = useMemo<Record<PayTier, number>>(() => {
    const out = { cumulus: 0, nimbus: 0, stratus: 0 } as Record<PayTier, number>;
    for (const t of PAY_TIERS) {
      const v = stored.perNode[t] ?? 0;
      out[t] = v > 0 ? (convertMoney(v, stored.currency, money.currency, money.spot) ?? 0) : 0;
    }
    return out;
  }, [stored, money.currency, money.spot]);

  const [text, setText] = useState<Record<PayTier, string>>(() => ({
    cumulus: costText(inDisplay.cumulus, digits),
    nimbus: costText(inDisplay.nimbus, digits),
    stratus: costText(inDisplay.stratus, digits),
  }));
  const [bad, setBad] = useState<Partial<Record<PayTier, true>>>({});

  // A new currency (or costs cleared) restates the fields in it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: restate only when the currency or the stored costs change
  useEffect(() => {
    setText({
      cumulus: costText(inDisplay.cumulus, digits),
      nimbus: costText(inDisplay.nimbus, digits),
      stratus: costText(inDisplay.stratus, digits),
    });
    setBad({});
  }, [
    money.currency,
    stored.currency,
    stored.perNode.cumulus,
    stored.perNode.nimbus,
    stored.perNode.stratus,
  ]);

  const edit = (tier: PayTier, raw: string) => {
    setText((cur) => ({ ...cur, [tier]: raw }));
    const parsed = parseCostInput(raw);
    if (parsed === null || parsed > MAX_COST) {
      setBad((cur) => ({ ...cur, [tier]: true }));
      return;
    }
    setBad((cur) => {
      const { [tier]: _drop, ...rest } = cur;
      return rest;
    });
    // Every tier is stored in the currency shown, so the stored set never mixes two.
    setCosts({ currency: money.currency, perNode: { ...inDisplay, [tier]: parsed } });
  };

  const profit = useMemo(
    () =>
      profitability({
        nativePerDay: flux(e.native_per_day),
        paPerDay: flux(e.pa_per_day),
        includePa,
        nodes: dto.tiers,
        collateralFlux: flux(dto.standing.collateral_locked),
        price,
        costs: inDisplay,
      }),
    [e.native_per_day, e.pa_per_day, includePa, dto.tiers, dto.standing.collateral_locked, price, inDisplay],
  );

  if (present.length === 0) {
    return (
      <Panel title="Profit">
        <p className="wl-note">There is no node to cost, so there is no profit to work out.</p>
      </Panel>
    );
  }

  const noPrice = price === null;
  const when =
    Math.abs(factor - 1) < 0.005 ? "Today's price" : `The scenario's price (${factorText(factor)})`;
  const sign = profit.net === null ? undefined : profit.net >= 0 ? 'pos' : 'neg';
  const ratio = profit.breakEven !== null && price !== null ? price / profit.breakEven : null;
  const gaugeMax = profit.breakEven !== null && price !== null ? Math.max(profit.breakEven, price) * 1.5 : 1;

  return (
    <Panel
      title="Profit"
      aside="what you keep after hosting"
      actions={
        <>
          <EarningsBasis
            split={{ native: flux(e.native_per_day) * MONTH_DAYS, pa: flux(e.pa_per_day) * MONTH_DAYS }}
            per="a month"
            money={(v) => (price === null ? null : money.fmt(v * price))}
          />
          {profit.costed ? (
            <Button size="sm" variant="ghost" onClick={() => clearCosts()}>
              Clear costs
            </Button>
          ) : null}
        </>
      }
    >
      <div className="wl-costs">
        <p className="wl-note">
          What does one node cost you each month? Enter it for each tier you run, in{' '}
          {money.currency.toUpperCase()}.
        </p>
        <div className="wl-costs__fields">
          {present.map((t) => (
            <TextField
              key={t}
              label={
                <span className="wl-costs__label">
                  <TierGlyph tier={t} size={14} /> {tierLabel(t)}, per node per month
                </span>
              }
              mono
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              suffix={money.currency.toUpperCase()}
              value={text[t]}
              error={bad[t] ? 'Enter a number, such as 12.50' : undefined}
              hint={`${formatInt(dto.tiers[t])} ${dto.tiers[t] === 1 ? 'node' : 'nodes'}`}
              reserveMessage
              onValueChange={(v) => edit(t, v)}
            />
          ))}
        </div>
        <p className="wl-note wl-costs__privacy">
          <Lock size={12} strokeWidth={1.5} aria-hidden="true" /> Kept only in this browser. Nothing you type
          here is sent anywhere.
        </p>
      </div>

      <StatGrid min={150}>
        <FitStat
          label="Net per month"
          fit={profit.net === null ? null : money.fmt(profit.net)}
          value={profit.net === null ? null : <span data-sign={sign}>{money.fmt(profit.net)}</span>}
          caption={
            profit.net === null
              ? 'needs a price'
              : profit.costed
                ? `${money.fmt(profit.revenue)} earned, ${money.fmt(profit.cost)} to host`
                : 'no hosting cost entered yet'
          }
          className="wl-profit"
        />
        <FitStat
          label="Earned per month"
          fit={profit.revenue === null ? null : money.fmt(profit.revenue)}
          value={profit.revenue === null ? null : money.fmt(profit.revenue)}
          caption={`${formatInt(Math.round(profit.fluxMonthly))} FLUX${includePa ? ', main chain + parallel assets' : ', main chain only'}`}
        />
        <Stat
          label="Margin"
          value={profit.margin === null || !profit.costed ? null : formatPercent(profit.margin, 1)}
          caption={profit.costed ? 'of what is earned' : 'enter a cost'}
        />
        <Stat
          label="Yield on collateral"
          value={profit.apr === null ? null : formatPercent(profit.apr, 1)}
          caption="net per year over the collateral's value"
        />
      </StatGrid>

      <div className="wl-breakeven">
        <div className="wl-breakeven__head">
          <span className="wl-sub">Break-even price</span>
          <span className="ui-mono wl-breakeven__val">
            {profit.breakEven === null
              ? profit.costed
                ? 'Nothing earned'
                : 'Enter a cost'
              : `${formatPrice(profit.breakEven, money.currency)} per FLUX`}
          </span>
        </div>
        {profit.breakEven !== null && price !== null ? (
          <Meter
            label={
              Math.abs(factor - 1) < 0.005
                ? "Today's FLUX price against break-even"
                : 'Scenario FLUX price against break-even'
            }
            value={price}
            min={0}
            max={gaugeMax}
            size="lg"
            zones={[
              { from: 0, to: profit.breakEven, tone: 'crit', label: 'Loss' },
              { from: profit.breakEven, to: gaugeMax, tone: 'ok', label: 'Profit' },
            ]}
            format={(v) => formatPrice(v, money.currency)}
            showValue
            startLabel={formatPrice(0, money.currency)}
            endLabel={formatPrice(gaugeMax, money.currency)}
          />
        ) : null}
        <p className="wl-note">
          {ratio === null
            ? noPrice
              ? 'The price is not available right now.'
              : 'Hosting at a loss or for free has no break-even; enter what a node costs to see one.'
            : ratio >= 1
              ? `${when} is ${ratio.toFixed(1)} times the break-even price: the fleet earns more than it costs.`
              : `${when} is ${(ratio * 100).toFixed(0)}% of the break-even price: the fleet costs more than it earns.`}
        </p>
      </div>

      <Switch
        checked={includePa}
        onChange={setIncludePa}
        label="Count parallel assets as income"
        description="Counted at the price above, as if sold when earned."
      />
    </Panel>
  );
}
