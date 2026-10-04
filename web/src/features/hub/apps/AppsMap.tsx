// The biggest apps as a treemap: each app's area is its share of the instances running, or of the network's capacity
// it holds, the biggest at the top left. The squarified layout is the wallet's (`wallet/lib/treemap.ts`); a cell is a
// real link to the app, and pointing at one says what it is. Choosing the other measure moves every cell to its new
// place (the cells are positioned by transform, so nothing reflows), and the cells hold still while the window is
// being resized.
//
// Only the biggest apps are drawn, to scale against each other. Most apps run an instance or two, so a block for "all
// the rest" would take most of the area and say nothing; what the rest hold is a share bar under the picture.
//
// The cells are for the pointer. The ranked list beside the picture names the biggest in order and is the way to them
// by keyboard, so the picture is hidden from assistive technology and described in words under it.

import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { formatInt, formatPercent } from '../../../lib/format';
import { ShellLink } from '../../../shell/frame/ShellLink';
import { ShareBar, Tooltip } from '../../../ui';
import { useSize } from '../../analytics/viz/useSize';
import { appColorSlot } from '../../wallet/lib/apps';
import { fitsLabel, squarify } from '../../wallet/lib/treemap';
import type { AppRank, RankBy } from './lib/apps';
import {
  cellBudget,
  cellFacts,
  fitName,
  footprintText,
  type Measure,
  mapCaption,
  mapItems,
  nameLines,
  tailSplit,
  valueText,
} from './lib/treemap';
import './top.css';

const GAP = 3;
/** A cell this big carries its name and its figure. */
const LABEL = { w: 64, h: 42 };
/** A cell this tall lets the name take two lines. */
const TWO_LINES_H = 72;
/** The padding of a cell, both sides, in px. */
const CELL_PAD = 16;
/** A cell this big has room for its share as well. */
const ROOMY = { w: 124, h: 66 };
/** The cells hold still (no glide) while the box is being resized, and this long after. */
const RESIZE_QUIET_MS = 180;

/** Whether the box has been resized since it first had a size: the first size is the picture appearing. */
function useResizing(width: number, height: number): boolean {
  const [resizing, setResizing] = useState(false);
  const last = useRef({ w: 0, h: 0 });
  useEffect(() => {
    const w = Math.round(width);
    const h = Math.round(height);
    if (last.current.w === w && last.current.h === h) return;
    const first = last.current.w === 0;
    last.current = { w, h };
    if (first) return;
    setResizing(true);
    const timer = setTimeout(() => setResizing(false), RESIZE_QUIET_MS);
    return () => clearTimeout(timer);
  }, [width, height]);
  return resizing;
}

/**
 * A measure of text in the names' own face, made with a canvas (so no layout is read), or null until there is one. The
 * names are fitted to the cells with it, so a line never ends in an ellipsis that eats the digits which tell one app of
 * a family from the next. The face may still be arriving when the picture first draws; it is measured again once it is.
 */
function useNameMeasure(host: RefObject<HTMLElement | null>): Measure | null {
  const [measure, setMeasure] = useState<Measure | null>(null);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const build = (): Measure | null => {
      const probe = document.createElement('span');
      probe.className = 'ap-tree__name';
      probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
      el.appendChild(probe);
      const cs = getComputedStyle(probe);
      const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      probe.remove();
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return null;
      ctx.font = font;
      const seen = new Map<string, number>();
      return (text) => {
        let width = seen.get(text);
        if (width === undefined) {
          width = ctx.measureText(text).width;
          seen.set(text, width);
        }
        return width;
      };
    };
    const first = build();
    setMeasure(() => first);
    let live = true;
    void document.fonts?.ready.then(() => {
      const again = build();
      if (live) setMeasure(() => again);
    });
    return () => {
      live = false;
    };
  }, [host]);
  return measure;
}

export interface AppsMapProps {
  /** The apps, biggest first for `by`. */
  ranked: readonly AppRank[];
  by: RankBy;
  /** Every running instance, for the share in a tooltip; 0 when it is not known. */
  totalInstances: number;
  /** Enterprise apps with an instance running, which a footprint picture leaves out. */
  leftOut: number;
  /** The app the pointer or the keyboard is on in the list, or in this picture. */
  hot: string | null;
  onHot: (name: string | null) => void;
}

export function AppsMap({ ranked, by, totalInstances, leftOut, hot, onHot }: AppsMapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { width, height } = useSize(ref);
  const resizing = useResizing(width, height);
  const measure = useNameMeasure(ref);

  const byName = useMemo(() => new Map(ranked.map((r) => [r.name, r])), [ranked]);
  const limit = cellBudget(width, height);
  const items = useMemo(() => mapItems(ranked, by, limit), [ranked, by, limit]);
  const cells = useMemo(() => squarify(items, width, height, GAP), [items, width, height]);
  const split = useMemo(() => tailSplit(ranked, by, limit), [ranked, by, limit]);
  const drawn = Math.min(limit, ranked.length);

  return (
    <figure className="ap-treefig">
      <div
        className="ap-tree"
        ref={ref}
        data-resizing={resizing || undefined}
        data-hot={hot !== null || undefined}
        aria-hidden="true"
      >
        {cells.map((c, i) => {
          const r = byName.get(c.id);
          if (!r) return null;
          const style = {
            width: c.w,
            height: c.h,
            transform: `translate(${c.x}px, ${c.y}px)`,
            '--ap-c': `var(--viz-${appColorSlot(c.id)})`,
            '--i': Math.min(i, 24),
          } as CSSProperties;
          const named = fitsLabel(c, LABEL.w, LABEL.h);
          const lines = c.h >= TWO_LINES_H ? 2 : 1;
          // One pixel short of the inside of the cell, so a line that fits by a hair does not end in an ellipsis.
          const inner = c.w - CELL_PAD - 1;
          const name: readonly string[] =
            lines === 1
              ? [fitName(c.label, inner, measure ?? undefined)]
              : nameLines(c.label, inner, measure ?? undefined);
          const roomy = c.w >= ROOMY.w && c.h >= ROOMY.h;
          const share = totalInstances > 0 ? r.instances / totalInstances : 0;
          return (
            <Tooltip
              key={c.id}
              placement="top"
              content={
                <span className="ap-tip">
                  <b>{r.label}</b>
                  {cellFacts(r, totalInstances).map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </span>
              }
            >
              <ShellLink
                to={{ type: 'app', key: r.name }}
                tabIndex={-1}
                className="ap-tree__cell"
                style={style}
                data-hot={hot === r.name || undefined}
                onPointerEnter={() => onHot(r.name)}
                onPointerLeave={() => onHot(null)}
              >
                {named ? (
                  <span className="ap-tree__in">
                    <span className="ap-tree__name">
                      <span className="ap-tree__ln">{name[0]}</span>
                      {name[1] !== undefined ? <span className="ap-tree__ln">{name[1]}</span> : null}
                    </span>
                    <span className="ap-tree__n">
                      {valueText(r, by)}
                      {roomy && by === 'instances' && share > 0 ? (
                        <span className="ap-tree__share">{formatPercent(share, 1)}</span>
                      ) : null}
                    </span>
                  </span>
                ) : null}
              </ShellLink>
            </Tooltip>
          );
        })}
      </div>
      {split.restApps > 0 ? (
        <ShareBar
          className="ap-treefig__tail"
          label={
            by === 'instances'
              ? 'Instances held, biggest apps and the rest'
              : 'Footprint held, biggest apps and the rest'
          }
          show={by === 'instances' ? 'both' : 'percent'}
          format={by === 'instances' ? formatInt : footprintText}
          segments={[
            {
              id: 'drawn',
              label: `The ${formatInt(drawn)} biggest`,
              value: split.drawn,
              color: 'var(--viz-1)',
            },
            {
              id: 'rest',
              label: `${formatInt(split.restApps)} smaller apps`,
              value: split.rest,
              color: 'var(--viz-other)',
            },
          ]}
        />
      ) : null}
      <figcaption className="ap-note ap-treefig__cap">{mapCaption(ranked, by, drawn, leftOut)}</figcaption>
    </figure>
  );
}
