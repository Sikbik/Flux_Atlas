import type { LucideIcon } from 'lucide-react';
import {
  type ChangeEvent,
  type ComponentPropsWithRef,
  type MouseEvent,
  type ReactNode,
  useId,
  useRef,
} from 'react';
import { KbdCombo } from '../controls/Kbd';
import { mergeRefs } from '../popover/refs';
import { describedBy, FieldFrame, hasContent } from './Field';
import './TextField.css';

export interface TextFieldProps extends Omit<ComponentPropsWithRef<'input'>, 'size' | 'prefix'> {
  /** Visible label above the field (sentence case). Without a label, pass `aria-label`. */
  label?: ReactNode;
  /** Helper text below the field. Replaced by `error` while there is one. */
  hint?: ReactNode;
  /** Error message: marks the field invalid (`aria-invalid`) and replaces the hint. */
  error?: ReactNode;
  /** Icon before the text (a lucide icon component). */
  icon?: LucideIcon;
  /** Text before the value inside the field (`https://`). Not part of the value. */
  prefix?: ReactNode;
  /** Text after the value inside the field (`ms`, `.flux`). Not part of the value. */
  suffix?: ReactNode;
  /** Content at the right edge: an `IconButton`, a spinner. */
  trailing?: ReactNode;
  /** Key caps shown at the right edge, one entry per key (`['ctrl', 'K']`). Hidden on touch. */
  kbd?: readonly string[];
  /** Data input: IBM Plex Mono, tabular, no spellcheck (hashes, addresses, IPs, amounts). */
  mono?: boolean;
  /** `md` is 38 px (16 px text on touch); `sm` is 32 px for toolbars and table filters. */
  size?: 'md' | 'sm';
  /** Keep the message line's height when there is no hint or error, so an error does not shift the layout. */
  reserveMessage?: boolean;
  /** Called with the new text on every change (in addition to `onChange`). */
  onValueChange?: (value: string) => void;
}

/**
 * A single-line text field: label, a 38 px control with an optional leading icon, prefix, suffix, key
 * caps and trailing slot, and a hint or error line below. Works controlled (`value`) or uncontrolled
 * (`defaultValue`) like a native input, and passes every other input attribute through.
 */
export function TextField({
  label,
  hint,
  error,
  icon: Icon,
  prefix,
  suffix,
  trailing,
  kbd,
  mono,
  size = 'md',
  reserveMessage,
  onValueChange,
  onChange,
  className,
  style,
  id,
  disabled,
  readOnly,
  ref,
  'aria-describedby': describedByProp,
  ...rest
}: TextFieldProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const inner = useRef<HTMLInputElement>(null);
  const invalid = hasContent(error);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange?.(e);
    onValueChange?.(e.target.value);
  };

  // A press on the box's padding, icon or affixes focuses the input, like clicking the field.
  const focusInput = (e: MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (e.button !== 0 || t === inner.current || t.closest('button, a, [role="button"]')) return;
    e.preventDefault();
    inner.current?.focus();
  };

  return (
    <FieldFrame
      controlId={controlId}
      label={label}
      hint={hint}
      error={error}
      reserveMessage={reserveMessage}
      disabled={disabled}
      className={className}
      style={style}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the box forwards presses on its padding to the input it contains */}
      <div
        className="ui-field__box"
        data-size={size}
        data-mono={mono || undefined}
        data-state={invalid ? 'invalid' : undefined}
        data-invalid={invalid || undefined}
        data-disabled={disabled || undefined}
        data-readonly={readOnly || undefined}
        onMouseDown={focusInput}
      >
        {Icon ? <Icon className="ui-field__icon" size={16} strokeWidth={1.5} aria-hidden="true" /> : null}
        {hasContent(prefix) ? <span className="ui-field__affix">{prefix}</span> : null}
        <input
          ref={mergeRefs(inner, ref)}
          id={controlId}
          className="ui-field__input"
          disabled={disabled}
          readOnly={readOnly}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy(controlId, { hint, error }, describedByProp)}
          spellCheck={mono ? false : undefined}
          autoComplete={mono ? 'off' : undefined}
          onChange={handleChange}
          {...rest}
        />
        {hasContent(suffix) ? <span className="ui-field__affix">{suffix}</span> : null}
        {trailing}
        {kbd && kbd.length > 0 ? <KbdCombo keys={kbd} className="ui-field__kbd" /> : null}
      </div>
    </FieldFrame>
  );
}
