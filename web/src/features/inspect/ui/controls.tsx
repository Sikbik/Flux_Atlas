import { Check, Copy } from 'lucide-react';
import { type ComponentPropsWithRef, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { cx } from './cx';

type BtnProps = Omit<ComponentPropsWithRef<'button'>, 'type'> & {
  variant?: 'primary' | 'ghost';
  icon?: ReactNode;
  size?: 'icon';
};

/** A secondary button; `aria-pressed` turns it into a toggle with the lit state. `ref`, `className` and
 * every `data-*` attribute pass through, so the shared interaction layer can attach to it later. */
export function Btn({ variant, icon, size, className, children, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      className={cx('ix-btn', className)}
      data-variant={variant}
      data-size={size}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="ix-switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

function legacyCopy(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    ta.remove();
  }
}

/** Copies `value`; the icon turns into a check for a moment and a status line says so. */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      legacyCopy(value);
    }
    setDone(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), 1400);
  }, [value]);
  return (
    <>
      <button
        type="button"
        className="ix-copy"
        data-done={done || undefined}
        aria-label={label}
        title={done ? 'Copied' : label}
        onClick={copy}
      >
        {done ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.75} />}
      </button>
      <span className="ix-sr" role="status">
        {done ? 'Copied' : ''}
      </span>
    </>
  );
}
