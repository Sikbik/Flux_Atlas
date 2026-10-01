import type { ReactNode } from 'react';
import './specimens.css';

/** A quiet tile: a label, a figure and a mono note saying where the value comes from. */
export function Tile({
  label,
  note,
  size = 'lg',
  children,
}: {
  label: string;
  note?: string;
  size?: 'lg' | 'md';
  children: ReactNode;
}) {
  return (
    <div className="kg-live-tile">
      <span className="kg-live-tile__label">{label}</span>
      <span className="kg-live-tile__value" data-size={size}>
        {children}
      </span>
      {note ? <span className="kg-live-tile__note">{note}</span> : null}
    </div>
  );
}

/** Marks a value or a control as synthetic, so nobody mistakes it for live data. */
export function DemoTag({ children = 'Synthetic' }: { children?: ReactNode }) {
  return <span className="kg-live-demo-tag">{children}</span>;
}
