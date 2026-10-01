import type { LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import './stepper.css';

export interface Step {
  key: string;
  label: string;
  /** A short fact under the label (a block height, a count, a threshold). */
  sub?: ReactNode;
  icon: LucideIcon;
  /** Tints the station once it is reached: the later stations of a decline are warm. */
  tone?: 'warn' | 'crit';
}

/**
 * A lifecycle as stations on a line: the stations behind are done, the current one is lit and the line
 * fills to it. `at` is the index of the current station (-1 when unknown). Scales with `scaleX`.
 */
export function Stepper({ steps, at, label }: { steps: readonly Step[]; at: number; label: string }) {
  const n = steps.length;
  const style = { '--ix-p': at < 0 || n < 2 ? 0 : at / (n - 1), '--ix-n': n } as CSSProperties;
  return (
    <ol className="ix-stepper" aria-label={label} style={style}>
      {steps.map((s, i) => {
        const Icon = s.icon;
        const state = i < at ? 'done' : i === at ? 'now' : 'next';
        return (
          <li
            className="ix-stp"
            key={s.key}
            data-state={state}
            data-tone={state !== 'next' ? s.tone : undefined}
            aria-current={state === 'now' ? 'step' : undefined}
          >
            <i>
              <Icon size={12} strokeWidth={2} aria-hidden="true" />
            </i>
            <span>{s.label}</span>
            {s.sub !== undefined ? <small>{s.sub}</small> : null}
          </li>
        );
      })}
    </ol>
  );
}
