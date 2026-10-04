import { Select, type SelectOption } from '../../../ui';
import type { Money } from '../hooks/useMoney';
import { CURRENCY_META } from '../lib/money';
import { CURRENCIES, type CurrencyCode } from '../types';

const OPTIONS: readonly SelectOption<CurrencyCode>[] = CURRENCIES.map((c) => ({
  value: c,
  label: CURRENCY_META[c].label,
  description: CURRENCY_META[c].name,
}));

/** The currency money is shown in, remembered for this viewer. */
export function CurrencySelect({
  money,
  className,
}: {
  money: Pick<Money, 'currency' | 'setCurrency'>;
  className?: string;
}) {
  return (
    <Select
      size="sm"
      aria-label="Currency"
      className={className}
      options={OPTIONS}
      value={money.currency}
      onChange={money.setCurrency}
      placement="bottom-end"
      mono
    />
  );
}
