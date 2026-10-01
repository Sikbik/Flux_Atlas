import { Check, ChevronDown, LoaderCircle, type LucideIcon } from 'lucide-react';
import {
  type ChangeEvent,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { navigateIndex, typeaheadIndex } from '../internal/keys';
import type { Placement } from '../internal/position';
import { pressHandlers } from '../internal/press';
import { mergeRefs } from '../internal/refs';
import { useControllableState } from '../internal/useControllable';
import { AnchoredLayer } from '../popover/AnchoredLayer';
import { isTypeaheadKey, nextTypeahead, type TypeaheadState, typeaheadActive } from '../popover/typeahead';
import { describedBy, FieldFrame, fieldIds, hasContent } from './Field';
import './Select.css';
import { indexOfValue, initialActive, pageIndex, scrollTopToReveal } from './select';

export interface SelectOption<T extends string = string> {
  /** The value `onChange` reports. */
  value: T;
  /** Visible label and accessible name; typing matches it. */
  label: string;
  /** A muted second line under the label (an endpoint, a count). Not shown by the `native` select. */
  description?: ReactNode;
  /** Icon before the label (a lucide icon component). Not shown by the `native` select. */
  icon?: LucideIcon;
  /** Cannot be chosen; arrow keys skip it. */
  disabled?: boolean;
}

type SelectAttrs = Omit<
  ComponentPropsWithoutRef<'button'>,
  'value' | 'defaultValue' | 'onChange' | 'children' | 'placeholder' | 'role' | 'type' | 'className' | 'style'
>;

/** Props of a Select: the attributes of a button (a `<select>` when `native`) plus the following. */
export interface SelectProps<T extends string = string> extends SelectAttrs {
  /** The choices, in order. */
  options: readonly SelectOption<T>[];
  /** The selected value (controlled); `null` for none. Omit to let the select keep its own. */
  value?: T | null;
  /** Initial value when uncontrolled. */
  defaultValue?: T;
  /** Called with the value the user picked (not when the same value is picked again). */
  onChange?: (value: T) => void;
  /** Shown while nothing is selected (default `Select`). */
  placeholder?: string;
  /** Visible label above the control (sentence case). Without a label, pass `aria-label`. */
  label?: ReactNode;
  /** Helper text below the control. Replaced by `error` while there is one. */
  hint?: ReactNode;
  /** Error message: marks the control invalid and replaces the hint. */
  error?: ReactNode;
  /** `md` is 36 px (44 px on touch); `sm` is 30 px for toolbars and table filters. */
  size?: 'md' | 'sm';
  /** Data options (hashes, addresses, heights): IBM Plex Mono, tabular. */
  mono?: boolean;
  /** Shows a spinner in place of the chevron while options load; the control stays usable. */
  loading?: boolean;
  /** Render a styled native `<select>` (OS picker on phones). Icons and descriptions are not shown. */
  native?: boolean;
  /** Keep the message line's height when there is no hint or error, so an error does not shift the layout. */
  reserveMessage?: boolean;
  /** Preferred list placement (default `bottom-start`); flips and clamps to stay on screen. */
  placement?: Placement;
  /** Whether the list is open (controlled). */
  open?: boolean;
  /** Initial open state when uncontrolled. */
  defaultOpen?: boolean;
  /** Called when the list asks to open or close. */
  onOpenChange?: (open: boolean) => void;
  /** Shown in the list when there are no options (default `No options`). */
  emptyText?: string;
  /** Extra class for the outer frame (label, control and message). */
  className?: string;
  /** Style for the outer frame. */
  style?: CSSProperties;
  /** The control: the trigger button, or the `<select>` when `native`. */
  ref?: Ref<HTMLElement>;
}

const optionId = (listId: string, index: number): string => `${listId}-opt-${index}`;

/** Clearance kept above and below a highlighted row in a scrolled list (the list's padding). */
const LIST_PAD = 6;
/** How far PageUp and PageDown move. */
const PAGE = 8;

/**
 * A single choice from a list (design 8.9): a field-style trigger and a glass listbox that follows the
 * trigger's width, with optional icons and descriptions, a check on the selected row and a quiet wash
 * on the highlighted one. Focus stays on the trigger (an ARIA select-only combobox): arrow keys,
 * Home, End and PageUp and PageDown move the highlight, typing jumps to a label, Enter or Space chooses,
 * Escape closes. With `native` it renders a styled native `<select>` instead.
 */
export function Select<T extends string = string>({ native, ...props }: SelectProps<T>) {
  return native ? <NativeSelect {...props} /> : <ListSelect {...props} />;
}

function ListSelect<T extends string>({
  options,
  value,
  defaultValue,
  onChange,
  placeholder = 'Select',
  label,
  hint,
  error,
  size = 'md',
  mono,
  loading,
  reserveMessage,
  placement = 'bottom-start',
  open: openProp,
  defaultOpen,
  onOpenChange,
  emptyText = 'No options',
  className,
  style,
  id,
  disabled,
  ref,
  onClick,
  onKeyDown,
  onKeyUp,
  'aria-describedby': describedByProp,
  'aria-label': ariaLabel,
  ...rest
}: Omit<SelectProps<T>, 'native'>) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const listId = `${controlId}-list`;
  const ids = fieldIds(controlId);
  const invalid = hasContent(error);
  const hasLabel = hasContent(label);

  const [selected, setSelected] = useControllableState<T | null>(value, defaultValue ?? null);
  const [open, setOpen] = useControllableState(openProp, defaultOpen ?? false, onOpenChange);
  const [active, setActive] = useState(-1);

  const anchorRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const typed = useRef<TypeaheadState>({ buffer: '', at: 0 });
  const start = useRef<{ from: 'first' | 'last'; at: number | null }>({ from: 'first', at: null });
  const justOpened = useRef(false);
  const swallowSpace = useRef(false);

  const labels = useMemo(() => options.map((o) => o.label), [options]);
  const isDisabled = useCallback((i: number) => !!options[i]?.disabled, [options]);
  const selectedIndex = indexOfValue(options, selected);
  const current = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const activeIdx = open && active >= 0 && active < options.length ? active : -1;
  const hasLead = options.some((o) => o.icon);
  const TriggerIcon = current?.icon;

  // Opening highlights the chosen option (or the one a key asked for); closing clears the highlight.
  // Only opening and closing reset the highlight, not a change of options.
  useLayoutEffect(() => {
    if (open) {
      const { from, at } = start.current;
      setActive(at ?? initialActive(options, selected, from));
      justOpened.current = true;
    } else {
      setActive(-1);
    }
    start.current = { from: 'first', at: null };
  }, [open]);

  // Keep the highlighted row inside a scrolled list: centred when the list opens, nearest edge after.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!open || !list || activeIdx < 0) return;
    const row = list.querySelectorAll<HTMLElement>('[role="option"]')[activeIdx];
    if (!row) return;
    const view = { scrollTop: list.scrollTop, height: list.clientHeight };
    const item = { top: row.offsetTop, height: row.offsetHeight };
    if (justOpened.current) {
      justOpened.current = false;
      list.scrollTop = Math.max(0, item.top - (view.height - item.height) / 2);
    } else {
      list.scrollTop = scrollTopToReveal(view, item, LIST_PAD);
    }
  }, [open, activeIdx]);

  const openList = (from: 'first' | 'last' = 'first', at: number | null = null) => {
    if (disabled) return;
    start.current = { from, at };
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    setOpen(false);
    if (option.value === selected) return;
    setSelected(option.value);
    onChange?.(option.value);
  };

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || disabled) return;
    if (open) setOpen(false);
    else openList();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || disabled || e.ctrlKey || e.metaKey || e.altKey) return;
    const { key } = e;
    const now = Date.now();
    const midWord = typeaheadActive(typed.current, now);
    const typing = isTypeaheadKey(e) && (key !== ' ' || midWord);

    if (!open) {
      // Enter and Space reach the click handler, which opens the list.
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        e.preventDefault();
        openList(key === 'ArrowUp' ? 'last' : 'first');
      } else if (key === 'Home' || key === 'End') {
        e.preventDefault();
        openList('first', navigateIndex(key, -1, options.length, { orientation: 'vertical', isDisabled }));
      } else if (typing) {
        e.preventDefault();
        typed.current = nextTypeahead(typed.current, key, now);
        const hit = typeaheadIndex(labels, typed.current.buffer, selectedIndex, isDisabled);
        if (hit !== null) openList('first', hit);
      }
      return;
    }

    if (key === 'Enter' || (key === ' ' && !midWord)) {
      e.preventDefault();
      swallowSpace.current = key === ' ';
      if (activeIdx >= 0) choose(activeIdx);
      else setOpen(false);
    } else if (key === 'Tab') {
      // The highlighted option is chosen and focus moves on, like a native select.
      if (activeIdx >= 0) choose(activeIdx);
      else setOpen(false);
    } else if (key === 'PageDown' || key === 'PageUp') {
      e.preventDefault();
      const next = pageIndex(options, activeIdx, key === 'PageDown' ? PAGE : -PAGE);
      if (next >= 0) setActive(next);
    } else if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
      e.preventDefault();
      const next = navigateIndex(key, activeIdx, options.length, {
        orientation: 'vertical',
        loop: false,
        isDisabled,
      });
      if (next !== null) setActive(next);
    } else if (typing) {
      e.preventDefault();
      typed.current = nextTypeahead(typed.current, key, now);
      const hit = typeaheadIndex(labels, typed.current.buffer, activeIdx, isDisabled);
      if (hit !== null) setActive(hit);
    }
  };

  // Space chose an option on key down; its key up must not click the trigger and reopen the list.
  const handleKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    onKeyUp?.(e);
    if (e.key === ' ' && swallowSpace.current) {
      swallowSpace.current = false;
      e.preventDefault();
    }
  };

  const state = open ? 'open' : loading ? 'loading' : 'closed';

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
      <button
        {...rest}
        ref={mergeRefs<HTMLElement>(anchorRef, ref)}
        id={controlId}
        type="button"
        role="combobox"
        className="ui-field__box ui-select__trigger"
        data-size={size}
        data-mono={mono || undefined}
        data-state={state}
        data-invalid={invalid || undefined}
        data-disabled={disabled || undefined}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={activeIdx >= 0 ? optionId(listId, activeIdx) : undefined}
        aria-labelledby={hasLabel ? ids.labelId : undefined}
        aria-label={hasLabel ? undefined : ariaLabel}
        aria-invalid={invalid || undefined}
        aria-busy={loading || undefined}
        aria-describedby={describedBy(controlId, { hint, error }, describedByProp)}
        {...pressHandlers<HTMLButtonElement>({ ...rest, onKeyDown: handleKeyDown, onKeyUp: handleKeyUp })}
        onClick={handleClick}
      >
        {TriggerIcon ? (
          <TriggerIcon className="ui-select__lead" size={16} strokeWidth={1.5} aria-hidden="true" />
        ) : null}
        <span className="ui-select__value" data-placeholder={current ? undefined : ''}>
          {current ? current.label : placeholder}
        </span>
        {loading ? (
          <LoaderCircle className="ui-select__spin" size={16} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <ChevronDown className="ui-select__chevron" size={16} strokeWidth={1.5} aria-hidden="true" />
        )}
      </button>
      <AnchoredLayer
        open={open}
        anchor={anchorRef}
        placement={placement}
        matchWidth
        onDismiss={() => setOpen(false)}
        layerRef={listRef}
        id={listId}
        role="listbox"
        aria-labelledby={hasLabel ? ids.labelId : undefined}
        aria-label={hasLabel ? undefined : ariaLabel}
        className="ui-select__list"
        data-size={size}
        data-mono={mono || undefined}
        data-lead={hasLead || undefined}
        onMouseDown={(e) => e.preventDefault()}
      >
        {options.length === 0 ? <div className="ui-select__empty">{emptyText}</div> : null}
        {options.map((o, i) => {
          const Icon = o.icon;
          const isSelected = i === selectedIndex;
          return (
            // biome-ignore lint/a11y/useFocusableInteractive: focus stays on the trigger; options are reached through aria-activedescendant
            // biome-ignore lint/a11y/useKeyWithClickEvents: the trigger owns the keyboard (aria-activedescendant); an option is only clicked
            <div
              key={o.value}
              id={optionId(listId, i)}
              role="option"
              aria-selected={isSelected}
              aria-disabled={o.disabled || undefined}
              className="ui-select__option"
              data-state={isSelected ? 'selected' : 'idle'}
              data-active={activeIdx === i || undefined}
              data-disabled={o.disabled || undefined}
              data-described={hasContent(o.description) || undefined}
              onPointerMove={() => {
                if (activeIdx !== i && !o.disabled) setActive(i);
              }}
              onClick={() => choose(i)}
              {...pressHandlers<HTMLDivElement>()}
            >
              {hasLead ? (
                <span className="ui-select__lead" aria-hidden="true">
                  {Icon ? <Icon size={16} strokeWidth={1.5} /> : null}
                </span>
              ) : null}
              <span className="ui-select__text">
                <span className="ui-select__label">{o.label}</span>
                {hasContent(o.description) ? <span className="ui-select__desc">{o.description}</span> : null}
              </span>
              <span className="ui-select__check" aria-hidden="true">
                {isSelected ? <Check size={16} strokeWidth={1.5} /> : null}
              </span>
            </div>
          );
        })}
      </AnchoredLayer>
    </FieldFrame>
  );
}

function NativeSelect<T extends string>({
  options,
  value,
  defaultValue,
  onChange,
  placeholder = 'Select',
  label,
  hint,
  error,
  size = 'md',
  mono,
  loading,
  reserveMessage,
  className,
  style,
  id,
  disabled,
  ref,
  'aria-describedby': describedByProp,
  // The list-only props are accepted so both modes share one prop type, and ignored here.
  placement: _placement,
  open: _open,
  defaultOpen: _defaultOpen,
  onOpenChange: _onOpenChange,
  emptyText: _emptyText,
  ...rest
}: Omit<SelectProps<T>, 'native'>) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const invalid = hasContent(error);
  const [selected, setSelected] = useControllableState<T | null>(value, defaultValue ?? null);
  // The attributes are those of a button in the shared prop type; on a select they are the same names.
  const attrs = rest as ComponentPropsWithoutRef<'select'>;

  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    attrs.onChange?.(e);
    const next = options.find((o) => o.value === e.target.value)?.value;
    if (next === undefined) return;
    setSelected(next);
    onChange?.(next);
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
      <div className="ui-select__wrap">
        <select
          {...attrs}
          ref={ref as Ref<HTMLSelectElement> | undefined}
          id={controlId}
          className="ui-field__box ui-select__native"
          data-size={size}
          data-mono={mono || undefined}
          data-state={loading ? 'loading' : undefined}
          data-placeholder={selected === null ? '' : undefined}
          data-invalid={invalid || undefined}
          data-disabled={disabled || undefined}
          disabled={disabled}
          value={selected ?? ''}
          aria-invalid={invalid || undefined}
          aria-busy={loading || undefined}
          aria-describedby={describedBy(controlId, { hint, error }, describedByProp)}
          {...pressHandlers<HTMLSelectElement>(attrs)}
          onChange={handleChange}
        >
          {selected === null ? (
            <option value="" disabled hidden>
              {placeholder}
            </option>
          ) : null}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        {loading ? (
          <LoaderCircle className="ui-select__spin" size={16} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <ChevronDown className="ui-select__chevron" size={16} strokeWidth={1.5} aria-hidden="true" />
        )}
      </div>
    </FieldFrame>
  );
}
