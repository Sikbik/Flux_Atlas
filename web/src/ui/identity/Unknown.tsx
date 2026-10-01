import type { ComponentPropsWithRef } from 'react';
import { UNKNOWN } from '../../lib/format';
import { cx } from '../internal/cx';
import '../base.css';

/** Props of an Unknown: the replacement word, plus `className`, `style`, `ref` and the other `<span>` attributes. */
export type UnknownProps = ComponentPropsWithRef<'span'>;

/** The one rendering of "no value": the word Unknown in muted text. Honest data: never 0, never blank. */
export function Unknown({ children = UNKNOWN, className, ...rest }: UnknownProps) {
  return (
    <span className={cx('ui-unknown', className)} {...rest}>
      {children}
    </span>
  );
}

/** True when a value should render as Unknown: null, undefined, an empty string or NaN. */
export function isUnknownValue(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));
}
