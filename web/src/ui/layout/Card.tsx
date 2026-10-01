import type { ComponentPropsWithRef, ElementType } from 'react';
import { cx } from '../internal/cx';
import { pressHandlers } from '../internal/press';
import './Card.css';

/** Props of a Card: every `<div>` attribute, including `ref`, `className` and `style`. A press shows as `data-pressed` on an interactive card. */
export interface CardProps extends ComponentPropsWithRef<'div'> {
  /** Inner padding: `none` (for tables and full-bleed content), `sm`, `md` (default) or `lg`. */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** `raised` (default) sits one ink step above the slab with a lit rim; `flat` is a quiet outline. */
  tone?: 'raised' | 'flat';
  /** A faint light in the top-left corner in the card's accent (the tier colour on node views); off by default. */
  glow?: boolean;
  /** Brighten on hover and show a pointer (for cards that are links or buttons). */
  interactive?: boolean;
  /** Element to render (default `div`; use `section` or `article` for landmarks). */
  as?: ElementType;
}

/** A raised card inside a window slab: ink-1 with a rim that is lit at the top left, and optionally a corner light. */
export function Card({
  padding = 'md',
  tone = 'raised',
  glow,
  interactive,
  as: Tag = 'div',
  className,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={cx('ui-card', className)}
      data-padding={padding}
      data-tone={tone}
      data-glow={glow || undefined}
      data-interactive={interactive || undefined}
      {...rest}
      {...(interactive ? pressHandlers(rest) : null)}
    />
  );
}
