import { useMemo } from 'react';
import { Select, type SelectOption } from '../../../ui';
import type { Money } from '../hooks/useMoney';
import { CURRENCY_META } from '../lib/money';
import { CURRENCIES, type CurrencyCode } from '../types';

/** The currency money is shown in, remembered for this viewer. A currency the prices do not quote is not offered. */
export function CurrencySelect({
  money,
  className,
}: {
  money: Pick<Money, 'currency' | 'setCurrency' | 'available' | 'ready' | 'fellBack' | 'preferred'>;
  className?: string;
}) {
  // With the prices not yet here every currency is offered (the choice can be made before they arrive); once they
  // are, only the quoted ones are, and the rest say why.
  const options = useMemo<SelectOption<CurrencyCode>[]>(
    () =>
      CURRENCIES.map((c) => {
        const off = money.ready && money.available.length > 0 && !money.available.includes(c);
        return {
          value: c,
          label: CURRENCY_META[c].label,
          description: off ? `${CURRENCY_META[c].name}, not quoted right now` : CURRENCY_META[c].name,
          disabled: off,
        };
      }),
    [money.available, money.ready],
  );
  return (
    <Select
      size="sm"
      aria-label="Currency"
      className={className}
      options={options}
      value={money.currency}
      onChange={money.setCurrency}
      placement="bottom-end"
      mono
      title={
        money.fellBack
          ? `${CURRENCY_META[money.preferred].label} is not quoted right now, so prices show in ${CURRENCY_META[money.currency].label}`
          : undefined
      }
    />
  );
}
