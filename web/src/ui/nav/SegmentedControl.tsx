import type { LucideIcon } from 'lucide-react';
import { type ComponentPropsWithRef, type CSSProperties, useRef } from 'react';
import { cx } from '../internal/cx';
import { pressHandlers } from '../internal/press';
import { mergeRefs } from '../popover/refs';
import './SegmentedControl.css';
import { useRoving } from './useRoving';

export interface SegmentedOption<T extends string = string> {
  /** The value `onChange` reports. */
  value: T;
  /** Visible label and accessible name (sentence case; short). */
  label: string;
  /** Icon before the label (a lucide icon component). */
  icon?: LucideIcon;
  /** Not selectable; arrow keys skip it. */
  disabled?: boolean;
}

type SegmentedLabel =
  | { 'aria-label': string; 'aria-labelledby'?: undefined }
  | { 'aria-labelledby': string; 'aria-label'?: undefined };

export type SegmentedControlProps<T extends string = string> = SegmentedLabel &
  Omit<ComponentPropsWithRef<'div'>, 'onChange' | 'children' | 'aria-label' | 'aria-labelledby' | 'role'> & {
    /** The segments, in order. Segments share one width (the widest label), like a hardware switch. */
    options: readonly SegmentedOption<T>[];
    /** The selected value (controlled). */
    value: T;
    /** Called with the value the user picked. */
    onChange: (value: T) => void;
    /** `md` is a 36 px control; `sm` is 30 px (both 44 px on touch). */
    size?: 'sm' | 'md';
    /** Stretch to the container's width, segments sharing it equally. */
    fullWidth?: boolean;
    /** Show only the icons; the labels stay as accessible names and tooltips. */
    iconOnly?: boolean;
    /** Disable the whole control. */
    disabled?: boolean;
  };

/**
 * A radio group drawn as a capsule of segments (design 8.9), for a small set of mutually exclusive
 * choices: a filter (All, Blocks, Nodes), a period (1h, 24h, 7d), a view mode. The selected pill glides
 * between segments on a transform. Roving tabindex; arrow keys select as focus moves, like native
 * radios.
 */
export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  size = 'md',
  fullWidth,
  iconOnly,
  disabled,
  className,
  style,
  ref: refProp,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  ...rest
}: SegmentedControlProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const items = options.map((o) => ({ id: o.value, disabled: o.disabled || disabled }));
  const index = options.findIndex((o) => o.value === value);
  const roving = useRoving({
    ref,
    items,
    selectedId: value,
    itemSelector: '[role="radio"]',
    orientation: 'both',
    onNavigate: (item) => onChange(item.id as T),
  });

  return (
    <div
      {...rest}
      ref={mergeRefs<HTMLDivElement>(ref, refProp)}
      role="radiogroup"
      className={cx('ui-seg', className)}
      data-size={size}
      data-full={fullWidth || undefined}
      data-icon-only={iconOnly || undefined}
      data-disabled={disabled || undefined}
      data-empty={index < 0 || undefined}
      aria-disabled={disabled || undefined}
      style={
        {
          ...style,
          '--ui-seg-i': Math.max(index, 0),
          '--ui-seg-n': Math.max(options.length, 1),
        } as CSSProperties
      }
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      {...roving.handlers}
    >
      <span className="ui-seg__pill" aria-hidden="true" />
      {options.map((o) => {
        const checked = o.value === value;
        const Icon = o.icon;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a button with role radio keeps the roving tabindex, Home and End, and the segment styling that a native radio input cannot carry
          <button
            key={o.value}
            type="button"
            role="radio"
            className="ui-seg__opt"
            data-state={checked ? 'selected' : 'idle'}
            aria-checked={checked}
            aria-label={iconOnly ? o.label : undefined}
            title={iconOnly ? o.label : undefined}
            tabIndex={roving.tabIndexFor(o.value)}
            disabled={o.disabled || disabled}
            onClick={() => {
              if (!checked) onChange(o.value);
            }}
            {...pressHandlers<HTMLButtonElement>()}
          >
            {Icon ? <Icon size={size === 'sm' ? 13 : 14} strokeWidth={1.5} aria-hidden="true" /> : null}
            {iconOnly && Icon ? null : <span className="ui-seg__label">{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
