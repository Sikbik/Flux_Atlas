// The data credits in the bootstrap the runtime loaded at boot. The bootstrap is large (hundreds of kB), so this
// only reads it from the query cache and follows it when a resync replaces it: it never fetches, however
// long the page has been open.

import { skipToken, useQuery } from '@tanstack/react-query';
import type { BootstrapDto } from '../../../api/generated/BootstrapDto';
import type { DataAttribution } from '../../../api/generated/DataAttribution';
import { qk } from '../../../api/queryKeys';

const NONE: readonly DataAttribution[] = [];

export function useAttributions(): readonly DataAttribution[] {
  const { data } = useQuery<BootstrapDto, Error, readonly DataAttribution[]>({
    queryKey: qk.bootstrap(),
    queryFn: skipToken,
    select: (b) => b.attributions ?? NONE,
  });
  return data ?? NONE;
}
