// The apps of a fleet as a treemap: each app's area is its share of the instances running on the fleet, the biggest at
// the top left, and when there are more apps than the box has room to point at, the long tail is folded into one grey
// cell. A cell that is big enough carries its name; pointing at one says everything, pressing one selects the app. The
// table beside it says the same in rows and is the way to the picture by keyboard, so the cells are for the pointer and
// the figure is described in words underneath.

import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatInt, formatPercent } from '../../../lib/format';
import { Tooltip } from '../../../ui';
import { type AppRow, appColorSlot } from '../lib/apps';
import { cellLimit, fitsLabel, foldTail, OTHER_ID, squarify, type TreemapItem } from '../lib/treemap';
import './treemap.css';

const GAP = 3;
/** Each cell has at least this many px squared to be pointed at (a 26 px square). */
const MIN_CELL_AREA = 700;
/** A cell this big carries its name and its count. */
const LABEL = { w: 64, h: 42 };
/** A cell this big has room for its share as well. */
const ROOMY = { w: 124, h: 66 };
/** The cells hold still (no glide) while the box is being resized, and this long after. */
const RESIZE_QUIET_MS = 180;

export interface AppsTreemapProps {
  /** The apps, the most instances first. */
  apps: readonly AppRow[];
  /** The selected app's name. */
  selected: string | null;
  onSelect: (name: string | null) => void;
}

export function AppsTreemap({ apps, selected, onSelect }: AppsTreemapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [resizing, setResizing] = useState(false);
  const quiet = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const last = useRef({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      if (w === last.current.w && h === last.current.h) return;
      // The first size is the picture appearing; every later one is the window being resized, which must not lag.
      if (last.current.w > 0) {
        setResizing(true);
        clearTimeout(quiet.current);
        quiet.current = setTimeout(() => setResizing(false), RESIZE_QUIET_MS);
      }
      last.current = { w, h };
      setBox({ w: r.width, h: r.height });
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => clearTimeout(quiet.current), []);

  const byName = useMemo(() => new Map(apps.map((a) => [a.name, a])), [apps]);
  const limit = cellLimit(box.w, box.h, MIN_CELL_AREA);
  const items = useMemo<TreemapItem[]>(
    () =>
      foldTail(
        apps.map((a) => ({ id: a.name, label: a.label, value: a.instances })),
        limit,
        (n) => `${formatInt(n)} smaller apps`,
      ),
    [apps, limit],
  );
  const cells = useMemo(() => squarify(items, box.w, box.h, GAP), [items, box.w, box.h]);
  const total = useMemo(() => apps.reduce((s, a) => s + a.instances, 0), [apps]);

  const biggest = apps[0];
  const folded = items.some((i) => i.id === OTHER_ID) ? apps.length - (items.length - 1) : 0;
  const caption = [
    'Area is the number of instances.',
    biggest ? `${biggest.label} is the biggest, ${formatPercent(biggest.share, 0)} of all.` : '',
    folded > 0 ? `${formatInt(folded)} smaller apps are folded into the dotted block.` : '',
    'The table below lists every app and is the way to choose one by keyboard.',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <figure className="wl-treefig">
      <div
        className="wl-tree"
        ref={ref}
        data-resizing={resizing || undefined}
        data-selecting={selected !== null || undefined}
        aria-hidden="true"
      >
        {cells.map((c, i) => {
          const app = byName.get(c.id);
          const other = c.id === OTHER_ID;
          const share = total > 0 ? c.value / total : 0;
          const style = {
            width: c.w,
            height: c.h,
            transform: `translate(${c.x}px, ${c.y}px)`,
            '--wl-c': other ? 'var(--ink-4)' : `var(--viz-${appColorSlot(c.id)})`,
            '--i': Math.min(i, 24),
          } as CSSProperties;
          const roomy = c.w >= ROOMY.w && c.h >= ROOMY.h;
          return (
            <Tooltip
              key={c.id}
              placement="top"
              content={
                other ? (
                  `${c.label}, ${formatInt(c.value)} instances together`
                ) : (
                  <span className="wl-tree__tip">
                    <b>{c.label}</b>
                    <span>
                      {formatInt(c.value)} {c.value === 1 ? 'instance' : 'instances'},{' '}
                      {formatPercent(share, 1)} of all
                    </span>
                    <span>
                      on {formatInt(app?.nodes ?? 0)} {app?.nodes === 1 ? 'node' : 'nodes'}
                    </span>
                  </span>
                )
              }
            >
              <button
                type="button"
                tabIndex={-1}
                className="wl-tree__cell"
                style={style}
                data-selected={selected === c.id || undefined}
                data-other={other || undefined}
                onClick={() => {
                  if (!other) onSelect(selected === c.id ? null : c.id);
                }}
              >
                {fitsLabel(c, LABEL.w, LABEL.h) ? (
                  <span className="wl-tree__in">
                    <span className="wl-tree__name">{c.label}</span>
                    <span className="wl-tree__n ui-mono">
                      {formatInt(c.value)}
                      {roomy ? <span className="wl-tree__share">{formatPercent(share, 0)}</span> : null}
                    </span>
                  </span>
                ) : null}
              </button>
            </Tooltip>
          );
        })}
      </div>
      <figcaption className="wl-note">{caption}</figcaption>
    </figure>
  );
}
