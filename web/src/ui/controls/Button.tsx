import type { LucideIcon } from 'lucide-react';
import { LoaderCircle } from 'lucide-react';
import type { ComponentPropsWithRef } from 'react';
import { cx } from '../internal/cx';
import { pressHandlers } from '../internal/press';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

/** Props of a Button: every `<button>` attribute, including `ref`, `className` and `style`. A press shows as `data-pressed`; busy as `data-loading`. */
export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  /** `primary` (chamfered, one per view), `secondary` (default), `ghost` or `danger`. */
  variant?: ButtonVariant;
  /** `md` is 32 px (36 px for primary); `sm` is 26 px. */
  size?: ButtonSize;
  /** Fully rounded ends. */
  pill?: boolean;
  /** Icon before the label (a lucide icon component). */
  icon?: LucideIcon;
  /** Icon after the label. */
  iconRight?: LucideIcon;
  /** Shows a spinner, sets `aria-busy` and ignores presses. */
  loading?: boolean;
}

const ICON_PX = { sm: 14, md: 16 } as const;

/** A button. One `primary` per view; `secondary` for everything else; `danger` only for destructive actions. */
export function Button({
  variant = 'secondary',
  size = 'md',
  pill,
  icon: Icon,
  iconRight: IconRight,
  loading,
  disabled,
  type = 'button',
  className,
  children,
  onClick,
  ...rest
}: ButtonProps) {
  const px = ICON_PX[size];
  return (
    <button
      type={type}
      className={cx('ui-button', className)}
      data-variant={variant}
      data-size={size}
      data-pill={pill || undefined}
      data-loading={loading || undefined}
      data-state={loading ? 'loading' : undefined}
      aria-busy={loading || undefined}
      aria-disabled={disabled || loading || undefined}
      disabled={disabled}
      onClick={loading ? undefined : onClick}
      {...rest}
      {...pressHandlers(rest)}
    >
      {loading ? (
        <LoaderCircle className="ui-button__spin" size={px} strokeWidth={1.5} />
      ) : Icon ? (
        <Icon size={px} strokeWidth={1.5} />
      ) : null}
      {children ? <span className="ui-button__label">{children}</span> : null}
      {IconRight ? <IconRight size={px} strokeWidth={1.5} /> : null}
    </button>
  );
}

/** Props of an IconButton: every `<button>` attribute except children, including `ref`, `className` and `style`. */
export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  /** The icon (a lucide icon component). */
  icon: LucideIcon;
  /** Accessible name; also the title. Required because the button has no visible text. */
  label: string;
  variant?: Exclude<ButtonVariant, 'primary'>;
  /** `md` is a 32 px square; `sm` is 26 px. */
  size?: ButtonSize;
}

/** A square icon-only button with a required accessible name. */
export function IconButton({
  icon: Icon,
  label,
  variant = 'ghost',
  size = 'md',
  type = 'button',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx('ui-button', className)}
      data-variant={variant}
      data-size={size}
      data-icon-only=""
      aria-label={label}
      title={label}
      {...rest}
      {...pressHandlers(rest)}
    >
      <Icon size={ICON_PX[size] + 2} strokeWidth={1.5} />
    </button>
  );
}
