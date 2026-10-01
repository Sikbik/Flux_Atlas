import { LoaderCircle, Search, X } from 'lucide-react';
import { type KeyboardEvent, useRef } from 'react';
import { pressHandlers } from '../internal/press';
import { mergeRefs } from '../internal/refs';
import { useControllableState } from '../internal/useControllable';
import { TextField, type TextFieldProps } from './TextField';
import { useDebouncedCallback } from './useDebouncedCallback';

export interface SearchFieldProps
  extends Omit<
    TextFieldProps,
    | 'type'
    | 'icon'
    | 'value'
    | 'defaultValue'
    | 'onChange'
    | 'onValueChange'
    | 'onSubmit'
    | 'trailing'
    | 'prefix'
    | 'suffix'
  > {
  /** The text (controlled). */
  value?: string;
  /** Initial text when uncontrolled. */
  defaultValue?: string;
  /** Called with the new text on every change, and with an empty string when the field is cleared. */
  onValueChange?: (value: string) => void;
  /** Called when Enter is pressed. A pending debounced change is flushed first. */
  onSubmit?: (value: string) => void;
  /**
   * Called with the text once typing pauses for `delayMs`, and immediately on Enter or clear. This is
   * input handling only: debounce typing here, then let the caller's query (not a timer) fetch.
   */
  onDebouncedChange?: (value: string) => void;
  /** How long typing must pause before `onDebouncedChange` fires, in ms (default 250). */
  delayMs?: number;
  /** Shows a spinner while a search is in flight. */
  loading?: boolean;
  /** Accessible name of the clear button (default `Clear search`). */
  clearLabel?: string;
}

/**
 * A search box: a `role="search"` landmark around a text field with a search glyph, a clear button
 * while there is text, Escape to clear (only while there is text, so an empty field still lets Escape
 * reach the window), Enter to submit and an optional debounced change callback.
 */
export function SearchField({
  value,
  defaultValue,
  onValueChange,
  onSubmit,
  onDebouncedChange,
  delayMs = 250,
  loading,
  clearLabel = 'Clear search',
  placeholder = 'Search',
  label,
  'aria-label': ariaLabel,
  onKeyDown,
  ref,
  ...rest
}: SearchFieldProps) {
  const [text, setText] = useControllableState(value, defaultValue ?? '', onValueChange);
  const debounced = useDebouncedCallback(onDebouncedChange, delayMs);
  const input = useRef<HTMLInputElement>(null);
  const name = ariaLabel ?? (typeof label === 'string' ? label : 'Search');

  const change = (next: string) => {
    setText(next);
    if (onDebouncedChange) debounced(next);
  };

  const clear = () => {
    setText('');
    if (onDebouncedChange) {
      debounced('');
      debounced.flush();
    }
    input.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === 'Escape' && text !== '') {
      e.preventDefault();
      e.stopPropagation();
      clear();
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      debounced.flush();
      onSubmit?.(text);
    }
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: role search on a div keeps the landmark in browsers without the search element
    <div
      role="search"
      aria-label={name}
      className="ui-search"
      data-state={loading ? 'loading' : undefined}
      aria-busy={loading || undefined}
    >
      <TextField
        {...rest}
        ref={mergeRefs(input, ref)}
        type="search"
        label={label}
        aria-label={label ? undefined : name}
        placeholder={placeholder}
        icon={Search}
        value={text}
        onValueChange={change}
        onKeyDown={handleKeyDown}
        enterKeyHint="search"
        autoComplete="off"
        trailing={
          <>
            {loading ? (
              <LoaderCircle className="ui-field__spin" size={16} strokeWidth={1.5} aria-hidden="true" />
            ) : null}
            {text !== '' && !rest.disabled && !rest.readOnly ? (
              <button
                type="button"
                className="ui-field__clear"
                aria-label={clearLabel}
                tabIndex={-1}
                onClick={clear}
                {...pressHandlers<HTMLButtonElement>()}
              >
                <X size={13} strokeWidth={1.5} aria-hidden="true" />
              </button>
            ) : null}
          </>
        }
      />
    </div>
  );
}
