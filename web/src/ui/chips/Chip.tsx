import type { LucideIcon } from 'lucide-react';
import type { ComponentPropsWithoutRef, MouseEventHandler, ReactNode } from 'react';
import { cx } from '../internal/cx';
import './Chip.css';

export type ChipTone = 'neutral' | 'accent' | 'ghost';
export type ChipSize = 'sm' | 'md' | 'lg';

export interface ChipProps extends Omit<ComponentPropsWithoutRef<'span'>, 'onClick'> {
  /** `neutral` (default), `accent` (filters applied, links) or `ghost` (outline only). */
  tone?: ChipTone;
  /** 20 px (`sm`, tables), 22 px (`md`, default) or 26 px (`lg`, the aim strip). */
  size?: ChipSize;
  /** Leading icon (a lucide icon component). */
  icon?: LucideIcon;
  /** Set the label in Plex Mono (ids, amounts, counts). */
  mono?: boolean;
  /** Makes the chip a toggle button (a filter): renders a `<button>` with `aria-pressed={selected}`. */
  onClick?: MouseEventHandler<HTMLButtonElement>;
  /** Pressed state for a toggle chip. */
  selected?: boolean;
  children?: ReactNode;
}

const ICON_PX: Record<ChipSize, number> = { sm: 12, md: 14, lg: 14 };

/**
 * The base chip: a 22 px pill for a short fact (a place, a version, a count). Pass `onClick` to make
 * it a filter toggle. Tier and status have their own chips (TierChip, StatusChip).
 */
export function Chip({
  tone = 'neutral',
  size = 'md',
  icon: Icon,
  mono,
  onClick,
  selected,
  className,
  children,
  ...rest
}: ChipProps) {
  const body = (
    <>
      {Icon ? <Icon size={ICON_PX[size]} strokeWidth={1.5} /> : null}
      {children}
    </>
  );
  const common = {
    className: cx('ui-chip', className),
    'data-tone': tone,
    'data-size': size,
    'data-mono': mono || undefined,
  };
  if (onClick) {
    return (
      <button
        type="button"
        {...(rest as ComponentPropsWithoutRef<'button'>)}
        {...common}
        aria-pressed={selected}
        data-selected={selected || undefined}
        onClick={onClick}
      >
        {body}
      </button>
    );
  }
  return (
    <span {...common} {...rest}>
      {body}
    </span>
  );
}
