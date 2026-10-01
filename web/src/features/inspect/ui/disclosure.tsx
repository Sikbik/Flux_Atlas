import { ChevronRight } from 'lucide-react';
import { type CSSProperties, type ReactNode, useCallback, useId, useState } from 'react';
import { cx } from './cx';

/**
 * A section that tells what is inside on one live line and opens on demand. This is how the inspectors
 * keep the first screen to the few facts people come for: the rest waits behind a row that already
 * answers "is it fine?". The body mounts the first time it opens (so its queries start then) and stays
 * mounted, inert, once closed. Height animates with grid rows; under reduced motion the tokens shorten it.
 */
export function Disclosure({
  title,
  icon,
  summary,
  open,
  onToggle,
  index = 0,
  compact,
  className,
  children,
}: {
  title: ReactNode;
  icon?: ReactNode;
  /** One line of live facts, shown while closed and open. */
  summary?: ReactNode;
  open: boolean;
  onToggle: (next: boolean) => void;
  /** Staggers the entrance (capped by the design at 8). */
  index?: number;
  /** A lighter row without the icon box, for disclosures nested inside a disclosure. */
  compact?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const uid = useId();
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);
  return (
    <div
      className={cx('ix-disc ix-rise', className)}
      data-open={open || undefined}
      data-state={open ? 'open' : 'closed'}
      data-size={compact ? 'sm' : undefined}
      style={{ '--ix-i': index } as CSSProperties}
    >
      <h3 className="ix-disc-h">
        <button
          type="button"
          id={`${uid}-b`}
          className="ix-disc-btn"
          aria-expanded={open}
          aria-controls={`${uid}-p`}
          onClick={() => onToggle(!open)}
        >
          <span className="ix-disc-ico" aria-hidden="true">
            {icon}
          </span>
          <span className="ix-disc-t">
            <span className="ix-disc-title">{title}</span>
            {summary ? <span className="ix-disc-sum">{summary}</span> : null}
          </span>
          <ChevronRight className="ix-disc-chev" size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </h3>
      <section className="ix-disc-body" id={`${uid}-p`} aria-labelledby={`${uid}-b`} inert={!open}>
        <div className="ix-disc-in">{seen ? <div className="ix-disc-pad">{children}</div> : null}</div>
      </section>
    </div>
  );
}

/** The wrapper that gives a stack of disclosures their rhythm. */
export function Disclosures({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('ix-discs', className)}>{children}</div>;
}

const remembered = new Map<string, Set<string>>();

/**
 * Which disclosures of a view are open. The choice outlives the window (it is kept for the session, per
 * `scope`), so browsing one node after another keeps the sections you opened open.
 */
export function useOpenSet(scope: string, initial: readonly string[] = []) {
  const [, bump] = useState(0);
  let set = remembered.get(scope);
  if (!set) {
    set = new Set(initial);
    remembered.set(scope, set);
  }
  const live = set;
  const isOpen = useCallback((id: string) => live.has(id), [live]);
  const setOpen = useCallback(
    (id: string, next: boolean) => {
      if (next) live.add(id);
      else live.delete(id);
      bump((n) => n + 1);
    },
    [live],
  );
  return { isOpen, setOpen };
}

/** A small status dot for summaries (`ok`, `warn`, `crit`, `off`, `pending`). */
export function Dot({ tone }: { tone: 'ok' | 'warn' | 'crit' | 'off' | 'pending' }) {
  return <i className="ix-dot" data-status={tone} aria-hidden="true" />;
}
