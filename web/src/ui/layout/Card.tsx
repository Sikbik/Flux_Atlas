import type { ComponentPropsWithoutRef, ElementType, PointerEvent } from 'react';
import { cx } from '../internal/cx';
import { useSpotlight } from '../internal/spotlight';
import './Card.css';

export interface CardProps extends ComponentPropsWithoutRef<'div'> {
  /** Inner padding: `none` (for tables and full-bleed content), `sm`, `md` (default) or `lg`. */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** `raised` (default) sits one ink step above the slab with a lit rim; `flat` is a quiet outline. */
  tone?: 'raised' | 'flat';
  /** A stronger Flux-blue light in the top-left corner (the one light source); follows `data-tier`/`data-accent`. */
  glow?: boolean;
  /** Lift on hover, follow the pointer with a soft light and show a pointer (for cards that are links or buttons). */
  interactive?: boolean;
  /** Element to render (default `div`; use `section` or `article` for landmarks). */
  as?: ElementType;
}

/** A raised card inside a window slab: ink-1, a rim that is lit at the top left, a corner light, and on hover a light that follows the pointer. */
export function Card({
  padding = 'md',
  tone = 'raised',
  glow,
  interactive,
  as: Tag = 'div',
  className,
  onPointerMove,
  ...rest
}: CardProps) {
  const follow = useSpotlight<HTMLDivElement>();
  return (
    <Tag
      className={cx('ui-card', interactive && 'ui-spot', className)}
      data-padding={padding}
      data-tone={tone}
      data-glow={glow || undefined}
      data-interactive={interactive || undefined}
      onPointerMove={
        interactive
          ? (e: PointerEvent<HTMLDivElement>) => {
              follow(e);
              onPointerMove?.(e);
            }
          : onPointerMove
      }
      {...rest}
    />
  );
}
