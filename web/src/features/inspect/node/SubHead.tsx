import type { ReactNode } from 'react';

/** A quiet heading inside a fold: a title at the left, a short note at the right. */
export function SubHead({ title, note }: { title: ReactNode; note?: ReactNode }) {
  return (
    <div className="ix-sub-h">
      <span>{title}</span>
      {note ? <span className="ix-dim">{note}</span> : null}
    </div>
  );
}
