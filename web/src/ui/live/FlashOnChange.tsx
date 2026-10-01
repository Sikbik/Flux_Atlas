import type { ComponentPropsWithRef, ElementType, ReactNode } from 'react';
import { cx } from '../internal/cx';
import './FlashOnChange.css';
import { useMotionMode } from '../internal/useMotion';
import { type FlashTone, type FlashValue, flashPhase, resolveFlashTone } from './flash';
import { useChangeSeq } from './useChangeSeq';

interface FlashOwnProps {
  /** Any primitive. The flash fires when it changes after mount, never on the first render. */
  value: FlashValue;
  /** `wash` (default): a soft bloom behind the content. `bar`: a 2 px bar at the left and a wash that fades to the right, for list and table rows. */
  variant?: 'wash' | 'bar';
  /** The colour of the light: `accent` (default), `white` (attention), `up` or `down` (the direction colours), or `auto` (up or down when a number rose or fell, accent otherwise). */
  tone?: FlashTone;
  children?: ReactNode;
  className?: string;
}

export type FlashOnChangeProps<T extends ElementType = 'span'> = FlashOwnProps & {
  /** The element to render (default `span`). It is the positioned parent of the light layer, so it must be the row, cell or box that should glow. */
  as?: T;
} & Omit<ComponentPropsWithRef<T>, keyof FlashOwnProps | 'as'>;

/**
 * A breath of light when a value changes: a soft wash blooms behind the content and decays over
 * `--dur-fresh` (1600 ms). Restrained (at most 12% of the light colour), compositor-only (only the
 * opacity of a pseudo layer animates), and restartable: a second change mid-decay restarts it rather
 * than stacking. Under reduced motion it holds a steady tint for 1 s; with motion off it does nothing.
 *
 * Patterns:
 * - Plain text or a number: `<FlashOnChange value={price}>{formatPrice(price)}</FlashOnChange>`.
 * - A table row: `<FlashOnChange as="tr" variant="bar" value={row.version}>...cells...</FlashOnChange>`,
 *   where `value` is any stamp that changes when the row's data does (a height, a status, a version).
 * - A list row: `<FlashOnChange as="li" variant="bar" tone="auto" value={item.count}>...</FlashOnChange>`.
 *
 * Extra props (`ref`, `style`, `id`, `onClick`, `aria-*`, `data-*`) pass through to the element. It
 * carries `data-variant`, `data-tone`, `data-mode` and, from the first change on, `data-flash` (`a`
 * or `b`, alternating so that a second change restarts the animation).
 */
export function FlashOnChange<T extends ElementType = 'span'>(props: FlashOnChangeProps<T>) {
  const { as, value, variant = 'wash', tone = 'accent', className, children, ...rest } = props;
  const mode = useMotionMode();
  const { seq, dir } = useChangeSeq(value);
  const Tag: ElementType = as ?? 'span';
  return (
    <Tag
      {...rest}
      className={cx('ui-flash', className)}
      data-variant={variant}
      data-tone={resolveFlashTone(tone, dir)}
      data-mode={mode}
      data-inline={as === undefined || undefined}
      data-flash={mode === 'off' ? undefined : flashPhase(seq)}
    >
      {children}
    </Tag>
  );
}
