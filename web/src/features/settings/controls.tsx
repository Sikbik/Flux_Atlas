// The form controls the settings (and any later quiet panel) are built from. They are native inputs under
// the styling, so keyboard, screen readers, form restoration and the platform's own behaviour come for
// free: a segmented control is a radio group, a switch is a checkbox with the switch role, a select is a
// select. Each exposes `data-*` state and a className pass-through so the motion layer can attach later.

import { ChevronDown, ChevronRight } from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from 'react';

/** Text for assistive technology only. */
export function Sr({ children }: { children: ReactNode }) {
  return <span className="set-sr">{children}</span>;
}

export function Section({
  id,
  title,
  aside,
  children,
  className,
}: {
  id?: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const heading = useId();
  return (
    <section id={id} className={`set-sec${className ? ` ${className}` : ''}`} aria-labelledby={heading}>
      <header className="set-sec-h">
        <h3 id={heading} className="set-sec-t">
          {title}
        </h3>
        {aside ? <span className="set-sec-aside">{aside}</span> : null}
      </header>
      <div className="set-sec-b">{children}</div>
    </section>
  );
}

/** A setting: its name and one line of help, with the control inline or below. */
export function Field({
  title,
  hint,
  children,
  stacked,
  labelId,
}: {
  title: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  stacked?: boolean;
  labelId?: string;
}) {
  return (
    <div className="set-field" data-stacked={stacked ? '' : undefined}>
      <div className="set-field-text">
        <div className="set-field-title" id={labelId}>
          {title}
        </div>
        {hint ? <p className="set-field-hint">{hint}</p> : null}
      </div>
      <div className="set-field-ctl">{children}</div>
    </div>
  );
}

export interface SegOption<T extends string> {
  value: T;
  label: string;
}

/** A row of exclusive choices with one sliding highlight. Arrow keys move and choose, as any radio group. */
export function Segmented<T extends string>({
  legend,
  value,
  options,
  onChange,
  className,
}: {
  legend: string;
  value: T;
  options: readonly SegOption<T>[];
  onChange: (v: T) => void;
  className?: string;
}) {
  const name = useId();
  const i = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <fieldset
      className={`set-seg${className ? ` ${className}` : ''}`}
      data-value={value}
      style={{ '--n': options.length, '--i': i } as CSSProperties}
    >
      <legend className="set-sr">{legend}</legend>
      <span className="set-seg-ind" aria-hidden="true" />
      {options.map((o) => (
        <label key={o.value} className="set-seg-opt">
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={o.value === value}
            onChange={() => onChange(o.value)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={`set-switch${className ? ` ${className}` : ''}`} data-on={checked ? '' : undefined}>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="set-switch-track" aria-hidden="true">
        <span className="set-switch-knob" />
      </span>
    </label>
  );
}

export function SelectBox<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <span className="set-select">
      <select
        aria-label={label}
        value={String(value)}
        onChange={(e) => {
          const hit = options.find((o) => String(o.value) === e.target.value);
          if (hit) onChange(hit.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}

/** A native disclosure whose body is only built while it is open. */
export function Disclosure({
  id,
  title,
  aside,
  open: openInitially,
  children,
}: {
  id: string;
  title: string;
  aside?: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(openInitially ?? false);
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (openInitially) setOpen(true);
  }, [openInitially]);
  return (
    <details
      id={id}
      ref={ref}
      className="set-disc"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="set-disc-sum">
        <ChevronRight size={15} strokeWidth={2.2} className="set-disc-chev" aria-hidden="true" />
        <span className="set-disc-title">{title}</span>
        {aside ? <span className="set-disc-aside">{aside}</span> : null}
      </summary>
      {open ? <div className="set-disc-body">{children}</div> : null}
    </details>
  );
}
