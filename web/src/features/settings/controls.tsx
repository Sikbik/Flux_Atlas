// The two small pieces Settings (and About) add on top of the UI kit: text for assistive technology
// only, and a setting row (its name, one line of help, the control inline or below). The kit has no
// setting row yet; this is the candidate for it. Everything else here is the kit's own: SegmentedControl,
// Switch, Select, Button, Section.

import type { ReactNode } from 'react';

/** Text for assistive technology only. */
export function Sr({ children }: { children: ReactNode }) {
  return <span className="set-sr">{children}</span>;
}

/** A setting: its name and one line of help, with the control inline or, when `stacked`, below. */
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
