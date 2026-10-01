import type { ComponentPropsWithRef, CSSProperties, ElementType } from 'react';
import { cx } from '../internal/cx';
import './Stack.css';

/** A step of the 4 px space scale: 1 is 2 px, 2 is 4, 3 is 6, 4 is 8, 5 is 12, 6 is 16, 7 is 20, 8 is 24, 9 is 32. */
export type SpaceStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

interface LayoutProps extends ComponentPropsWithRef<'div'> {
  /** Gap between children as a `--space-N` step (default 5, 12 px). */
  gap?: SpaceStep;
  /** Element to render (default `div`; `ul`, `section`, ...). */
  as?: ElementType;
}

const gapStyle = (gap: SpaceStep, style?: CSSProperties): CSSProperties =>
  ({
    ...style,
    '--ui-gap': `var(--space-${gap})`,
  }) as CSSProperties;

export interface StackProps extends LayoutProps {
  /** Cross-axis alignment (default `stretch`). */
  align?: 'start' | 'center' | 'end' | 'stretch';
}

/** Children in a column with a token gap. */
export function Stack({ gap = 5, align, as: Tag = 'div', className, style, ...rest }: StackProps) {
  return (
    <Tag className={cx('ui-stack', className)} data-align={align} style={gapStyle(gap, style)} {...rest} />
  );
}

export interface RowProps extends LayoutProps {
  /** Wrap onto further lines when the row is too narrow (default true). */
  wrap?: boolean;
  /** Cross-axis alignment (default `center`). */
  align?: 'start' | 'center' | 'end' | 'baseline' | 'stretch';
  /** Main-axis distribution (default `start`). */
  justify?: 'start' | 'center' | 'end' | 'between';
}

/** Children in a row with a token gap, wrapping when narrow. */
export function Row({
  gap = 4,
  wrap = true,
  align,
  justify,
  as: Tag = 'div',
  className,
  style,
  ...rest
}: RowProps) {
  return (
    <Tag
      className={cx('ui-row', className)}
      data-wrap={wrap || undefined}
      data-align={align}
      data-justify={justify}
      style={gapStyle(gap, style)}
      {...rest}
    />
  );
}
