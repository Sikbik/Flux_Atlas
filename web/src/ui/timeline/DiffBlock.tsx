import type { ComponentPropsWithRef } from 'react';
import '../base.css';
import { cx } from '../internal/cx';
import './DiffBlock.css';

export interface DiffLine {
  /** `add` (a new line), `del` (a removed line) or `ctx` (unchanged context). */
  kind: 'add' | 'del' | 'ctx';
  /** The line's text, indentation included. */
  text: string;
}

/** Props of a DiffBlock: the options below plus every `<figure>` attribute, including `ref`, `className` and `style`. */
export interface DiffBlockProps extends Omit<ComponentPropsWithRef<'figure'>, 'children'> {
  /** The lines of the change, in order. */
  lines: readonly DiffLine[];
  /** Accessible name of the block (default "Changes"). */
  label?: string;
}

const SIGN = { add: '+', del: '-', ctx: '' } as const;
const WORD = { add: 'Added: ', del: 'Removed: ', ctx: '' } as const;

/**
 * A small diff for spec changes: added lines in the positive hue, removed lines in the negative
 * hue (the diverging pair, at low alpha), context quiet, a +/- gutter, Plex Mono 12 px. The sign is
 * a glyph as well as a colour, and screen readers hear "Added" and "Removed". Each line carries
 * `data-kind` (`add`, `del` or `ctx`).
 */
export function DiffBlock({ lines, label = 'Changes', className, ...rest }: DiffBlockProps) {
  return (
    <figure aria-label={label} {...rest} className={cx('ui-diff', className)}>
      {lines.map((line, i) => (
        <div key={i} className="ui-diff__line" data-kind={line.kind}>
          <span className="ui-diff__sign" aria-hidden="true">
            {SIGN[line.kind]}
          </span>
          {line.kind === 'ctx' ? null : <span className="ui-sr-only">{WORD[line.kind]}</span>}
          <span className="ui-diff__text">{line.text}</span>
        </div>
      ))}
    </figure>
  );
}
