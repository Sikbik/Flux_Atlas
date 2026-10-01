// A ranked list of horizontal bars: label and value on one line, a thin track under them. Rows can be
// selected (a click-through filter), and a rule can mark where a cumulative threshold is crossed, which
// is how a Nakamoto coefficient reads: "the rows above this line hold more than half".

import { Fragment, type ReactNode, useEffect, useState } from 'react';
import './viz.css';

export interface BarItem {
  key: string;
  label: ReactNode;
  /** Quiet text after the label (a code, a count of hosts). */
  sub?: ReactNode;
  /** Drives the bar length. */
  value: number;
  /** The main figure at the right (formatted by the caller). */
  valueLabel: ReactNode;
  /** A second figure: share, cumulative share. */
  extra?: ReactNode;
  color?: string;
  /** Tooltip text for pointer users (also used as the accessible description). */
  title?: string;
}

export interface BarListProps {
  items: readonly BarItem[];
  label: string;
  /** The value that fills the track; defaults to the largest item. */
  max?: number;
  selected?: string | null;
  onSelect?: (key: string) => void;
  /** Insert a rule after this many rows (the Nakamoto crossing). */
  ruleAfter?: number;
  ruleLabel?: string;
}

export function BarList({
  items,
  label,
  max,
  selected = null,
  onSelect,
  ruleAfter,
  ruleLabel,
}: BarListProps) {
  // Bars grow from zero on first paint (transform only), then follow live changes smoothly.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="vz-bars" aria-label={label}>
      {items.map((it, i) => {
        const w = mounted ? Math.max(0, Math.min(1, it.value / top)) : 0;
        const body = (
          <>
            <span className="vz-bar-label">
              <span>{it.label}</span>
              {it.sub ? <span className="vz-bar-sub">{it.sub}</span> : null}
            </span>
            <span className="vz-bar-value tabular">
              <strong>{it.valueLabel}</strong>
              {it.extra ? <span>{it.extra}</span> : null}
            </span>
            <span className="vz-bar-track" aria-hidden="true">
              <span className="vz-bar-fill" style={{ ['--w' as string]: w, ['--c' as string]: it.color }} />
            </span>
          </>
        );
        return (
          <Fragment key={it.key}>
            <li>
              {onSelect ? (
                <button
                  type="button"
                  className="vz-bar-row"
                  data-interactive=""
                  data-selected={selected === it.key || undefined}
                  data-dim={(selected && selected !== it.key) || undefined}
                  aria-pressed={selected === it.key}
                  title={it.title}
                  onClick={() => onSelect(it.key)}
                  style={{
                    font: 'inherit',
                    textAlign: 'left',
                    border: 0,
                    background: 'none',
                    width: 'calc(100% + var(--space-4) * 2)',
                  }}
                >
                  {body}
                </button>
              ) : (
                <div className="vz-bar-row" title={it.title}>
                  {body}
                </div>
              )}
            </li>
            {ruleAfter !== undefined && ruleAfter === i + 1 && ruleLabel ? (
              <li className="vz-bars-rule" aria-hidden="true">
                {ruleLabel}
              </li>
            ) : null}
          </Fragment>
        );
      })}
    </ul>
  );
}
