import { type ChangeEvent, type ComponentPropsWithRef, type ReactNode, useId } from 'react';
import { cx } from '../internal/cx';
import { pressHandlers } from '../internal/press';
import { useControllableState } from '../internal/useControllable';
import './Switch.css';

export interface SwitchProps
  extends Omit<ComponentPropsWithRef<'input'>, 'type' | 'role' | 'size' | 'onChange' | 'value' | 'children'> {
  /** Visible label. The whole label is a click target. Without it, pass `aria-label`. */
  label?: ReactNode;
  /** A second, muted line under the label saying what the switch does. */
  description?: ReactNode;
  /** On or off (controlled). */
  checked?: boolean;
  /** Initial state when uncontrolled. */
  defaultChecked?: boolean;
  /** Called with the new state. */
  onChange?: (checked: boolean, event: ChangeEvent<HTMLInputElement>) => void;
  /** `inline` puts the label after the switch; `row` is a full-width settings row, label left and switch right. */
  layout?: 'inline' | 'row';
}

/**
 * A two-state switch (design 8.9): a 36 by 20 px track and a 16 px knob that moves on a soft spring.
 * It is a native checkbox with `role="switch"`, so Space toggles it and forms and assistive tech
 * understand it; the label is always clickable.
 */
export function Switch({
  label,
  description,
  checked,
  defaultChecked,
  onChange,
  layout = 'inline',
  className,
  style,
  id,
  disabled,
  ref,
  'aria-describedby': describedByProp,
  ...rest
}: SwitchProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const descId = `${controlId}-desc`;
  const hasDescription = description !== undefined && description !== null && description !== false;
  const [on, setOn] = useControllableState(checked, defaultChecked ?? false);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.checked;
    setOn(next);
    onChange?.(next, e);
  };

  return (
    <label
      className={cx('ui-switch', className)}
      style={style}
      data-layout={layout}
      data-state={on ? 'on' : 'off'}
      data-disabled={disabled || undefined}
      htmlFor={controlId}
      {...pressHandlers<HTMLLabelElement>()}
    >
      <input
        {...rest}
        ref={ref}
        id={controlId}
        type="checkbox"
        // biome-ignore lint/a11y/useAriaPropsForRole: a native checkbox with role switch conveys its state through checked
        role="switch"
        className="ui-switch__input"
        checked={on}
        disabled={disabled}
        aria-describedby={
          [hasDescription ? descId : undefined, describedByProp].filter(Boolean).join(' ') || undefined
        }
        onChange={handleChange}
      />
      <span className="ui-switch__track" aria-hidden="true">
        <span className="ui-switch__knob" />
      </span>
      {label !== undefined && label !== null && label !== false ? (
        <span className="ui-switch__text">
          <span className="ui-switch__label">{label}</span>
          {hasDescription ? (
            <span className="ui-switch__desc" id={descId}>
              {description}
            </span>
          ) : null}
        </span>
      ) : null}
    </label>
  );
}
