import type { ComponentPropsWithoutRef, ElementType } from 'react';
import { cx } from '../internal/cx';
import './Card.css';

export interface CardProps extends ComponentPropsWithoutRef<'div'> {
  /** Inner padding: `none` (for tables and full-bleed content), `sm`, `md` (default) or `lg`. */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** `raised` (default) sits one ink step above the slab with a lit top edge; `flat` is a quiet outline. */
  tone?: 'raised' | 'flat';
  /** A faint Flux-blue light in the top-left corner (the one light source); follows `data-tier`/`data-accent`. */
  glow?: boolean;
  /** Lift slightly on hover and show a pointer (for cards that are links or buttons). */
  interactive?: boolean;
  /** Element to render (default `div`; use `section` or `article` for landmarks). */
  as?: ElementType;
}

/** A raised card inside a window slab: ink-1, a hairline, a lit top edge, optional corner light. */
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
    />
  );
}
