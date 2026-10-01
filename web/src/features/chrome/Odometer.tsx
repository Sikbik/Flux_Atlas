// A ticking number (design 6.4 D). Only the characters that changed animate, from the last digit
// backward, 40 ms apart: a digit rolls on a vertical strip, up when the value rises and down when it
// falls, and the number holds a direction tint for 600 ms. Tiny changes swap silently, big jumps count
// up. Width is stable because the cells are tabular; the real number sits in a visually hidden span.
// Under reduced motion the swap is instant and only the (longer) tint remains.

import { useEffect, useState } from 'react';
import { formatInt, UNKNOWN } from '../../lib/format';
import { useMotion } from './motion';
import { type Cell, countUpValue, type Direction, type Plan, planChange, ROLL_STAGGER_MS } from './odometer';
import './odometer.css';

export interface OdometerProps {
  value: number | null;
  format?: (n: number) => string;
  className?: string;
  unknown?: string;
}

interface State {
  text: string;
  value: number | null;
  from: number | null;
  plan: Plan;
  epoch: number;
}

const COUNT_UP_MS = 900;

export function Odometer({ value, format = formatInt, className, unknown = UNKNOWN }: OdometerProps) {
  const motion = useMotion();
  const target = value === null ? unknown : format(value);
  const [st, setSt] = useState<State>(() => ({
    text: target,
    value,
    from: null,
    plan: { kind: 'none' },
    epoch: 0,
  }));
  // Adjusting state while rendering: the plan for this change is computed from the previous text.
  if (st.text !== target || st.value !== value) {
    const plan: Plan = motion === 'full' ? planChange(st.text, target, st.value, value) : { kind: 'none' };
    setSt({ text: target, value, from: st.value, plan, epoch: st.epoch + 1 });
  }

  const [counted, setCounted] = useState<string | null>(null);
  const { plan, from, epoch } = st;
  // The count restarts per change (epoch); the formatter is stable for a given instance.
  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch identifies the change
  useEffect(() => {
    if (plan.kind !== 'count' || from === null || value === null) {
      setCounted(null);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = (now - t0) / COUNT_UP_MS;
      if (t >= 1) {
        setCounted(null);
        return;
      }
      setCounted(format(countUpValue(from, value, t)));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [epoch]);

  const dir: Direction | null =
    st.from !== null && st.value !== null && st.from !== st.value
      ? st.value > st.from
        ? 'up'
        : 'down'
      : null;
  const shown = counted ?? target;
  return (
    <span className={className ? `odo ${className}` : 'odo'} data-dir={dir ?? undefined} key={`o${epoch}`}>
      <span className="sr-only">{target}</span>
      <span className="odo-text" aria-hidden="true">
        {plan.kind === 'roll' && counted === null
          ? plan.cells.map((c) => <OdoCell key={`${c.pos}:${c.ch}`} cell={c} dir={plan.dir} />)
          : shown}
      </span>
    </span>
  );
}

function OdoCell({ cell, dir }: { cell: Cell; dir: Direction }) {
  if (cell.from === null) return <span className="odo-c">{cell.ch}</span>;
  return (
    <span
      className="odo-c odo-roll"
      data-dir={dir}
      style={{ '--odo-d': `${cell.rank * ROLL_STAGGER_MS}ms` } as React.CSSProperties}
    >
      <span className="odo-out">{cell.from}</span>
      <span className="odo-in">{cell.ch}</span>
    </span>
  );
}
