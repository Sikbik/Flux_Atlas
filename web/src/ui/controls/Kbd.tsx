import type { ComponentPropsWithoutRef } from 'react';
import { cx } from '../internal/cx';
import './Kbd.css';

export type KbdProps = ComponentPropsWithoutRef<'kbd'>;

/** One key cap: `<Kbd>K</Kbd>`. Show the real shortcut wherever it is offered. */
export function Kbd({ className, ...rest }: KbdProps) {
  return <kbd className={cx('ui-kbd', className)} {...rest} />;
}

export interface KbdComboProps {
  /** One entry per key, in press order: `['ctrl', 'K']`. Never a single "Ctrl+K" string. */
  keys: readonly string[];
  className?: string;
}

/** A shortcut as separate key caps (`ctrl` `K`), with a screen-reader friendly label. */
export function KbdCombo({ keys, className }: KbdComboProps) {
  return (
    <span className={cx('ui-kbd-combo', className)}>
      <span className="ui-kbd-combo__sr">{keys.join(' plus ')}</span>
      {keys.map((k, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a key sequence is positional and can repeat a key
        <Kbd key={i} aria-hidden="true">
          {k}
        </Kbd>
      ))}
    </span>
  );
}
