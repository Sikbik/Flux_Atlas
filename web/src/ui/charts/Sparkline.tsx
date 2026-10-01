import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type Ref,
  type RefObject,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cx } from '../internal/cx';
import { mergeRefs } from '../internal/refs';
import { useAnimate } from '../internal/useMotion';
import { clamp01, easeOut, r2 } from './scale';
import './Sparkline.css';
import {
  DOMAIN_MS,
  type Domain,
  describeSeries,
  detectTransition,
  framePaths,
  isEmpty,
  isFlat,
  REVEAL_MS,
  type Sample,
  SPARK_PRESETS,
  type SparkBox,
  type SparkForm,
  type SparkPoint,
  sparkBox,
  staticFrame,
  transitionFrame,
} from './sparkline';

/**
 * Props of a Sparkline: the data and look, plus `className`, `style`, `ref` and the other `<span>`
 * attributes. The root reports `data-state` (`ready`, `flat` or `empty`) and `data-form`.
 */
export interface SparklineProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children' | 'color'> {
  /** The samples, oldest first. `null` is a gap: the line breaks there. */
  values: readonly (number | null)[];
  /** `line` (default), `area` (line plus a fading wash) or `bars` (rounded data ends, zero baseline). */
  form?: SparkForm;
  /** Size preset: `tile` is 64 by 26 (stat tiles, default), `card` is 120 by 34. */
  size?: 'tile' | 'card';
  /** Width in px, or `fluid` to fill the container (re-measured on resize). Overrides the preset. */
  width?: number | 'fluid';
  /** Height in px. Overrides the preset. */
  height?: number;
  /** Mark colour as any CSS colour value (a token reference such as `var(--viz-2)`); default `var(--viz-1)`. */
  color?: string;
  /** Draw the end dot: an 8 px disc with a 2 px surface ring that rides the line as data arrives (default true). */
  endDot?: boolean;
  /** Fixed y domain `[min, max]`; by default the data extent (bars start at zero). */
  domain?: readonly [number, number];
  /** Accessible name; generated from the data when omitted ("Trend over 12 samples, from 0.0718 to 0.0746, up 3.9 percent"). */
  label?: string;
  /** Hide the sparkline from assistive technology (use when a nearby value already says it all). */
  decorative?: boolean;
  /** Formats a sample for the generated accessible name. */
  format?: (value: number) => string;
  /** Ref to the root element. */
  ref?: Ref<HTMLSpanElement>;
}

function useFluidWidth(ref: RefObject<HTMLElement | null>, enabled: boolean): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    setWidth(Math.max(8, Math.round(el.getBoundingClientRect().width)));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.max(8, Math.round(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled, ref]);
  return enabled ? width : null;
}

const dotTransform = (p: SparkPoint) => `translate(${r2(p.x)} ${r2(p.y)})`;

/**
 * A tiny trend glyph: line, area or bars, with an end dot that rides the line. When `values` grows
 * by one sample the new segment slides in from the right edge, the oldest sample leaves on the left
 * and the y domain eases (design 6.4 E); under reduced motion it redraws instantly.
 */
export function Sparkline({
  values,
  form = 'line',
  size = 'tile',
  width,
  height,
  color,
  endDot = true,
  domain,
  label,
  decorative,
  format,
  className,
  style: styleProp,
  ref,
  ...rest
}: SparklineProps) {
  const animate = useAnimate();
  const gid = useId().replace(/:/g, '');
  const rootRef = useRef<HTMLSpanElement>(null);
  const setRoot = useMemo(() => mergeRefs<HTMLSpanElement>(rootRef, ref), [ref]);
  const fluid = width === 'fluid';
  const measured = useFluidWidth(rootRef, fluid);
  const preset = SPARK_PRESETS[size];
  const w = fluid ? (measured ?? preset.width) : (width ?? preset.width);
  const h = height ?? preset.height;
  const lo = domain?.[0];
  const hi = domain?.[1];
  const override = useMemo<Domain | undefined>(
    () => (lo === undefined || hi === undefined ? undefined : [lo, hi]),
    [lo, hi],
  );

  const box = useMemo(() => sparkBox(w, h, form, endDot && form !== 'bars'), [w, h, form, endDot]);
  const empty = isEmpty(values);
  const state = empty ? 'empty' : isFlat(values) ? 'flat' : 'ready';
  const frame = useMemo(() => staticFrame(values, form, box, override), [values, form, box, override]);
  const paths = useMemo(() => framePaths(frame, box), [frame, box]);
  const name = decorative ? undefined : (label ?? describeSeries(values, { format }));

  const lineRef = useRef<SVGPathElement>(null);
  const areaRef = useRef<SVGPathElement>(null);
  const barsRef = useRef<SVGPathElement>(null);
  const barLastRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGGElement>(null);
  const prev = useRef<{ values: readonly Sample[]; box: SparkBox } | null>(null);

  // Live draw: when the series moved by one sample, animate from the previous layout to this one by
  // writing SVG attributes straight from requestAnimationFrame (a handful of path strings per
  // frame). The committed markup is already the settled state, so an interrupted or skipped
  // animation always leaves the right picture behind.
  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = { values, box };
    const apply = (p: ReturnType<typeof framePaths>, dot: SparkPoint | null) => {
      lineRef.current?.setAttribute('d', p.line);
      areaRef.current?.setAttribute('d', p.area);
      barsRef.current?.setAttribute('d', p.bars);
      barLastRef.current?.setAttribute('d', p.barLast);
      if (dot && dotRef.current) dotRef.current.setAttribute('transform', dotTransform(dot));
    };
    const sameBox =
      before !== null &&
      before.box.width === box.width &&
      before.box.height === box.height &&
      before.box.padRight === box.padRight;
    const kind = animate && before && sameBox ? detectTransition(before.values, values) : null;
    if (!kind || !before) {
      apply(paths, frame.dot);
      return;
    }

    const ease = easeOut();
    const start = performance.now();
    let raf = 0;
    const draw = (elapsed: number) => {
      const f = transitionFrame({
        kind,
        prev: before.values,
        next: values,
        form,
        box,
        override,
        reveal: ease(clamp01(elapsed / REVEAL_MS)),
        domain: ease(clamp01(elapsed / DOMAIN_MS)),
      });
      apply(framePaths(f, box), f.dot);
    };
    const tick = (now: number) => {
      const elapsed = now - start;
      if (elapsed >= REVEAL_MS) {
        apply(paths, frame.dot);
        return;
      }
      draw(elapsed);
      raf = requestAnimationFrame(tick);
    };
    draw(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [values, box, form, override, animate, paths, frame]);

  const style = color ? ({ '--ui-spark-color': color, ...styleProp } as CSSProperties) : styleProp;
  const edge = box.width - box.padRight;
  const clipW = form === 'bars' ? w : edge + 1;

  return (
    <span
      {...rest}
      ref={setRoot}
      className={cx('ui-spark', className)}
      data-form={form}
      data-state={state}
      data-fluid={fluid || undefined}
      style={style}
    >
      <svg
        className="ui-spark__svg"
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        role={decorative ? undefined : 'img'}
        aria-label={name}
        aria-hidden={decorative || undefined}
        focusable="false"
      >
        {state === 'empty' ? (
          <line className="ui-spark__base" x1={2} x2={Math.max(2, w - 2)} y1={h - 3} y2={h - 3} />
        ) : (
          <>
            <defs>
              <clipPath id={`${gid}c`}>
                <rect x={0} y={-2} width={clipW} height={h + 4} />
              </clipPath>
              {form === 'area' ? (
                <linearGradient id={`${gid}a`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" className="ui-spark__stop" data-end="top" />
                  <stop offset="1" className="ui-spark__stop" data-end="base" />
                </linearGradient>
              ) : null}
            </defs>
            <g clipPath={`url(#${gid}c)`}>
              {form === 'area' ? (
                <path ref={areaRef} className="ui-spark__area" d={paths.area} fill={`url(#${gid}a)`} />
              ) : null}
              {form === 'bars' ? (
                <>
                  <path ref={barsRef} className="ui-spark__bars" d={paths.bars} />
                  <path ref={barLastRef} className="ui-spark__bar-last" d={paths.barLast} />
                </>
              ) : (
                <path ref={lineRef} className="ui-spark__line" d={paths.line} />
              )}
            </g>
            {frame.dot && endDot && form !== 'bars' ? (
              <g ref={dotRef} transform={dotTransform(frame.dot)}>
                <circle className="ui-spark__dot" r={4} />
              </g>
            ) : null}
          </>
        )}
      </svg>
    </span>
  );
}
