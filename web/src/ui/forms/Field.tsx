// The frame around a form control: a visible label linked to the control, and one message line
// below it that shows the hint, or the error in its place. Shared by TextField and Select.

import { TriangleAlert } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../internal/cx';
import './Field.css';

/** True for a node that renders something (not `undefined`, `null`, `false` or an empty string). */
export function hasContent(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

/** DOM ids derived from a control id, so label, hint and error can be linked to it. */
export function fieldIds(controlId: string): { labelId: string; hintId: string; errorId: string } {
  return { labelId: `${controlId}-label`, hintId: `${controlId}-hint`, errorId: `${controlId}-error` };
}

/** The `aria-describedby` value for a control: the visible message (error over hint) plus any extra ids. */
export function describedBy(
  controlId: string,
  state: { hint: ReactNode; error: ReactNode },
  extra?: string,
): string | undefined {
  const ids = fieldIds(controlId);
  const parts = [
    hasContent(state.error) ? ids.errorId : hasContent(state.hint) ? ids.hintId : undefined,
    extra,
  ];
  const out = parts.filter(Boolean).join(' ');
  return out || undefined;
}

export interface FieldFrameProps {
  /** DOM id of the labelled control (the label's `for`). */
  controlId: string;
  /** Visible label above the control (sentence case). Without it the control needs an `aria-label`. */
  label?: ReactNode;
  /** Helper text below the control. Replaced by `error` while there is one. */
  hint?: ReactNode;
  /** Error message. Sets the invalid state and takes the hint's place. */
  error?: ReactNode;
  /**
   * Keep the message line's height even when there is no hint or error, so the layout does not jump
   * when an error appears. Implied when a hint or error is given.
   */
  reserveMessage?: boolean;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/** Label, control and message line, stacked. The message line is a polite live region. */
export function FieldFrame({
  controlId,
  label,
  hint,
  error,
  reserveMessage,
  disabled,
  className,
  style,
  children,
}: FieldFrameProps) {
  const ids = fieldIds(controlId);
  const showError = hasContent(error);
  const showHint = !showError && hasContent(hint);
  const foot = showError || showHint || reserveMessage || hasContent(hint);
  return (
    <div
      className={cx('ui-field', className)}
      style={style}
      data-invalid={showError || undefined}
      data-disabled={disabled || undefined}
    >
      {hasContent(label) ? (
        <label className="ui-field__label" id={ids.labelId} htmlFor={controlId}>
          {label}
        </label>
      ) : null}
      {children}
      {foot ? (
        <div className="ui-field__foot" aria-live="polite">
          {showError ? (
            <p className="ui-field__msg" id={ids.errorId} data-kind="error">
              <TriangleAlert size={13} strokeWidth={1.5} aria-hidden="true" />
              <span>{error}</span>
            </p>
          ) : showHint ? (
            <p className="ui-field__msg" id={ids.hintId} data-kind="hint">
              {hint}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
