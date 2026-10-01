// Collateral by tier from the live tier stats, for "locked in nodes" figures.

import { useMemo } from 'react';
import { useNetwork } from '../../../app/context';
import { parseFlux } from '../../../lib/format';
import { shallowEqual } from '../../../store/react';
import type { TierName } from '../../../ui';

export function useCollateral(): Record<TierName, bigint> {
  const t = useNetwork(
    (s) =>
      ['cumulus', 'nimbus', 'stratus'].map((k) => s.tierStats.find((x) => x.tier === k)?.collateral ?? ''),
    shallowEqual,
  );
  return useMemo(
    () => ({
      cumulus: parseFlux(t[0]) ?? 1_000n * 100_000_000n,
      nimbus: parseFlux(t[1]) ?? 12_500n * 100_000_000n,
      stratus: parseFlux(t[2]) ?? 40_000n * 100_000_000n,
    }),
    [t],
  );
}
