import { StatusChip, type StatusKind } from '../../../ui';
import type { StateChip } from '../derive/nodeState';

/** The kit's status word for each chip `nodeStateChips` can produce. */
const KIND: Record<string, StatusKind> = {
  'past-expiry': 'expired',
  'at-risk': 'at-risk',
  offline: 'offline',
  confirmed: 'confirmed',
  started: 'started',
  dos: 'dos',
  expired: 'expired',
  departed: 'departed',
  unknown: 'unknown',
  unreachable: 'unreachable',
};

/** The chips of `nodeStateChips`: an icon and a word each, with the reason as the tooltip. */
export function StateChips({ chips, size = 'sm' }: { chips: readonly StateChip[]; size?: 'sm' | 'md' }) {
  return (
    <>
      {chips.map((c) => (
        <StatusChip
          key={c.key}
          status={KIND[c.key] ?? 'unknown'}
          label={c.label}
          title={c.hint}
          size={size}
        />
      ))}
    </>
  );
}
