import { CircleCheck, CircleDashed, Loader, OctagonX, ShieldAlert, TriangleAlert } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import type { Tier } from '../../../api/generated/Tier';
import type { StateChip, StateIcon, Tone } from '../derive/nodeState';
import { cx } from './cx';
import { TierGlyph } from './glyphs';

const TIER_LABEL: Record<string, string> = {
  cumulus: 'Cumulus',
  nimbus: 'Nimbus',
  stratus: 'Stratus',
  unknown: 'Unknown tier',
};

export const tierLabel = (tier: string): string => TIER_LABEL[tier] ?? tier;

type SpanRest = Omit<ComponentPropsWithRef<'span'>, 'children' | 'className' | 'title'>;

interface ChipBase {
  children?: ReactNode;
  className?: string;
  title?: string;
  size?: 'sm';
  mono?: boolean;
  /** A white ring and glow: "mine" or watched. */
  ring?: boolean;
}

/** A plain pill. */
export function Chip({
  children,
  className,
  title,
  size,
  mono,
  ring,
  icon,
  ...rest
}: ChipBase & SpanRest & { icon?: ReactNode }) {
  return (
    <span
      {...rest}
      className={cx('ix-chip', className)}
      title={title}
      data-size={size}
      data-mono={mono || undefined}
      data-ring={ring || undefined}
    >
      {icon}
      {children}
    </span>
  );
}

/** The accent-tinted pill used for links and applied filters. */
export function AccentChip({
  children,
  className,
  title,
  size,
  icon,
  ...rest
}: ChipBase & SpanRest & { icon?: ReactNode }) {
  return (
    <span {...rest} className={cx('ix-chip', className)} title={title} data-size={size} data-accent="">
      {icon}
      {children}
    </span>
  );
}

/** Tier capsule glyph plus the tier name; the glyph carries the tier even in greyscale. */
export function TierChip({
  tier,
  label,
  size,
  ring,
  className,
  ...rest
}: { tier: Tier | string; label?: string } & Pick<ChipBase, 'size' | 'ring' | 'className'> & SpanRest) {
  return (
    <span
      {...rest}
      className={cx('ix-chip', className)}
      data-tier={tier}
      data-size={size}
      data-ring={ring || undefined}
      title={tierLabel(tier)}
    >
      <TierGlyph tier={tier} size={size === 'sm' ? 12 : 14} />
      {label ?? tierLabel(tier)}
    </span>
  );
}

const STATE_ICONS: Record<StateIcon, typeof CircleCheck> = {
  check: CircleCheck,
  pending: Loader,
  alert: TriangleAlert,
  x: OctagonX,
  dashed: CircleDashed,
  shield: ShieldAlert,
};

/** A state: tone, icon and word together, never colour alone. */
export function StatusChip({
  tone,
  icon = 'check',
  children,
  title,
  size,
  className,
  ...rest
}: { tone: Tone; icon?: StateIcon } & Pick<ChipBase, 'children' | 'title' | 'size' | 'className'> &
  SpanRest) {
  const Icon = STATE_ICONS[icon];
  return (
    <span {...rest} className={cx('ix-chip', className)} data-status={tone} data-size={size} title={title}>
      <Icon size={size === 'sm' ? 11 : 13} strokeWidth={1.75} aria-hidden="true" />
      {children}
    </span>
  );
}

/** The chips of `nodeStateChips`. */
export function StateChips({ chips, size }: { chips: readonly StateChip[]; size?: 'sm' }) {
  return (
    <>
      {chips.map((c) => (
        <StatusChip key={c.key} tone={c.tone} icon={c.icon} title={c.hint} size={size}>
          {c.label}
        </StatusChip>
      ))}
    </>
  );
}
