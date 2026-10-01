import type { ComponentPropsWithRef } from 'react';
import { cx } from '../internal/cx';
import './Kbd.css';

export type KbdProps = ComponentPropsWithRef<'kbd'>;

/** One key cap: `<Kbd>K</Kbd>`. Show the real shortcut wherever it is offered. */
export function Kbd({ className, ...rest }: KbdProps) {
  return <kbd className={cx('ui-kbd', className)} {...rest} />;
}

/** Props of a KbdCombo: the key list, plus `className`, `style`, `ref` and the other `<span>` attributes. */
export interface KbdComboProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
  /** One entry per key, in press order: `['ctrl', 'K']`. Never a single "Ctrl+K" string. */
  keys: readonly string[];
}

/** A shortcut as separate key caps (`ctrl` `K`), with a screen-reader friendly label. */
export function KbdCombo({ keys, className, ...rest }: KbdComboProps) {
  return (
    <span className={cx('ui-kbd-combo', className)} {...rest}>
      <span className="ui-kbd-combo__sr">{keys.join(' plus ')}</span>
      {keys.map((k, i) => (
        <Kbd key={i} aria-hidden="true">
          {k}
        </Kbd>
      ))}
    </span>
  );
}
