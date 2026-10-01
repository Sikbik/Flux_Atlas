import type { ReactNode } from 'react';
import { LiveDot } from '../live/LiveDot';
import { Chip, type ChipProps } from './Chip';
import { type StatusKind, statusMeta } from './statusMeta';

export interface StatusChipProps extends Omit<ChipProps, 'tone' | 'icon' | 'mono' | 'onClick' | 'selected'> {
  /** The state; a `NodeStatus` from the API works as is. Unrecognised values show as Unknown. */
  status: StatusKind | (string & {}) | null | undefined;
  /** Replaces the default word ("Confirmed"), for example "Confirmed 4 min ago". */
  label?: ReactNode;
  /** `chip` (default, sentence case) or `badge` (the one ALL CAPS style, 20 px). */
  variant?: 'chip' | 'badge';
}

/** A state as an icon plus a word on a soft status fill. Pending is never drawn as confirmed. */
export function StatusChip({ status, label, variant = 'chip', size = 'md', ...rest }: StatusChipProps) {
  const meta = statusMeta(status);
  const Icon = meta.icon;
  const px = size === 'sm' || variant === 'badge' ? 12 : 14;
  return (
    <Chip
      size={size}
      data-status={meta.tone}
      data-variant={variant === 'badge' ? 'badge' : undefined}
      data-spin={meta.spin || undefined}
      {...rest}
    >
      {meta.dot ? (
        <LiveDot status={meta.tone} size={7} />
      ) : (
        <Icon size={px} strokeWidth={1.5} aria-hidden="true" />
      )}
      {label ?? meta.label}
    </Chip>
  );
}
