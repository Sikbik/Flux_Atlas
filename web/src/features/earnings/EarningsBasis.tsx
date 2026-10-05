// The earnings basis marker: one small pill beside a group of earnings figures that says what they count, main
// chain plus parallel assets or main chain only, and opens a short explanation with the split and the switch
// that sets it everywhere. The glyph is the charts' own pair of swatches: solid for the main chain, hatched for
// the parallel assets (dimmed when they do not count). Used once per panel or group, never per number.
//
// `kind="payments"` marks per-payment amounts instead (a payout, the next payment): those are main-chain
// transactions whatever the preference, and the marker says so, so they never read as contradicting a total that
// includes parallel assets.

import { useUi } from '../../store/ui';
import { cx, Popover, Switch } from '../../ui';
import {
  BASIS_LABEL,
  BASIS_TEXT,
  basisOf,
  earned,
  PA_RULE,
  PAYMENT_TEXT,
  type PaSplit,
  REALIZED_TEXT,
} from './basis';
import './basis.css';

const flux2 = (v: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The preference, for a component that sums earnings. */
export const useIncludePa = (): boolean => useUi((s) => s.includePa);

export interface EarningsBasisProps {
  /** `earnings` (default) follows the preference; `payments` marks per-payment main-chain amounts. */
  kind?: 'earnings' | 'payments';
  /** The figures are what was paid (realized): adds that parallel assets are accrued, not received. */
  realized?: boolean;
  /** The group's main chain and parallel assets, in FLUX, for the breakdown; what the split stands for. */
  split?: PaSplit | null;
  /** What the split is ("a day", "in 24 hours"), said after each row of the breakdown. */
  per?: string;
  /** FLUX as money in the viewer's currency, for the breakdown (null while the price is unknown). */
  money?: (flux: number) => string | null;
  /** `sm` for a table header or a dense row. */
  size?: 'sm' | 'md';
  className?: string;
}

export function EarningsBasis({
  kind = 'earnings',
  realized,
  split,
  per,
  money,
  size = 'md',
  className,
}: EarningsBasisProps) {
  const includePa = useUi((s) => s.includePa);
  const setIncludePa = useUi((s) => s.setIncludePa);
  const payments = kind === 'payments';
  const basis = payments ? 'main' : basisOf(includePa);
  const label = payments ? 'Main chain' : BASIS_LABEL[basis];
  const suffix = per ? ` ${per}` : '';
  const row = (v: number) => {
    const m = money?.(v) ?? null;
    return (
      <>
        <b className="ui-mono">{flux2(v)}</b> FLUX{suffix}
        {m ? <span className="eb-pop__money">{m}</span> : null}
      </>
    );
  };

  return (
    <Popover
      aria-label={payments ? 'About these payment amounts' : 'What these earnings count'}
      placement="bottom-end"
      width={320}
      className="eb-pop"
      trigger={
        <button
          type="button"
          className={cx('eb', className)}
          data-basis={basis}
          data-kind={kind}
          data-size={size}
          title={payments ? 'Payments on the main chain' : `Earnings: ${label.toLowerCase()}`}
        >
          <span className="eb__glyph" aria-hidden="true">
            <i />
            {payments ? null : <i />}
          </span>
          <span className="eb__label">{label}</span>
        </button>
      }
      content={
        <div className="eb-pop__body">
          <p className="eb-pop__head">
            <span className="eb__glyph" data-basis={basis} aria-hidden="true">
              <i />
              {payments ? null : <i />}
            </span>
            {label}
          </p>
          <p>{payments ? PAYMENT_TEXT : PA_RULE}</p>
          {payments ? null : <p>{BASIS_TEXT[basis]}</p>}
          {split && !payments ? (
            <dl className="eb-pop__split">
              <div data-part="main">
                <dt>
                  <i className="eb-sw" aria-hidden="true" />
                  Main chain
                </dt>
                <dd>{row(split.native)}</dd>
              </div>
              <div data-part="pa" data-off={includePa ? undefined : ''}>
                <dt>
                  <i className="eb-sw" data-pa="" aria-hidden="true" />
                  Parallel assets{includePa ? '' : ', not counted'}
                </dt>
                <dd>{row(split.pa)}</dd>
              </div>
              <div data-part="total">
                <dt>Counted</dt>
                <dd>{row(earned(split, includePa))}</dd>
              </div>
            </dl>
          ) : null}
          {realized && !payments && includePa ? <p className="eb-pop__aside">{REALIZED_TEXT}</p> : null}
          {payments ? null : (
            <Switch
              className="eb-pop__switch"
              checked={includePa}
              onChange={setIncludePa}
              label="Count parallel assets in earnings"
              description="Applies to every earnings figure in Atlas, and is also in Settings."
            />
          )}
        </div>
      }
    />
  );
}
