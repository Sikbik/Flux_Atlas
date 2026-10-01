// The scrubber: the node-count curve over the recorded history with one handle on it. Drag it, click
// the curve to jump, or use the keys; at the right end it means "live". The playhead's position is
// written straight to a custom property (`--tm-p`) so dragging and playing never re-render React per
// frame; only the labels do, at a calm rate.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { formatInt } from '../../../lib/format';
import { timeTicks } from '../../analytics/viz/scale';
import { useWidth } from '../../explorer/hooks/useDom';
import { useThrottledT } from '../hooks/useThrottledT';
import type { TimeMachine, TmState } from '../lib/controller';
import { BOX, type Curve, curvePaths, readingAt, yDomain } from '../lib/curve';
import { ageLong, ageShort, formatInstantMinutes, fractionOf, instantAt } from '../lib/time';

/** Within this many pixels of the right end, a pointer means "live". */
const LIVE_EDGE_PX = 6;

/** In live, an axis label this close to the right end gives way to the handle that rests there. */
const HANDLE_CLEAR_PX = 30;

export interface ScrubberProps {
  tm: TimeMachine;
  state: TmState;
  /** The first instant on the strip, or null while the recorded range is unknown. */
  start: number | null;
  /** The right end: now. */
  end: number;
  curve: Curve | null;
  curveLoading: boolean;
  /** Enough history to scrub. */
  ready: boolean;
}

export function Scrubber({ tm, state, start, end, curve, curveLoading, ready }: ScrubberProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const dragging = useRef<number | null>(null);
  const width = useWidth(plotRef);
  const live = state.mode === 'live';
  const from = start ?? end;

  // The range as the pointer handlers see it, current without re-binding them.
  const range = useRef({ from, end });
  range.current = { from, end };

  /** Writes the playhead's place on the strip (0 to 1) where CSS reads it. */
  const paint = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const s = tm.getState();
    root.toggleAttribute('data-flying', s.flying);
    const p = s.mode === 'live' ? 1 : fractionOf(tm.getT(), range.current.from, range.current.end);
    root.style.setProperty('--tm-p', p.toFixed(5));
  }, [tm]);
  useLayoutEffect(() => {
    paint();
    return tm.subscribeT(paint);
  }, [tm, paint]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a mode change, a new range or the clock moves the handle without the playhead moving
  useLayoutEffect(paint, [paint, state.mode, state.flying, from, end]);

  // The browser moves focus off the handle (to the page) when the mouse goes down on the curve. Keep it
  // on the handle so the keys work right after a click or a drag.
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const keepFocus = (e: MouseEvent) => e.preventDefault();
    plot.addEventListener('mousedown', keepFocus);
    return () => plot.removeEventListener('mousedown', keepFocus);
  }, []);

  // ---- the picture ------------------------------------------------------------------------------

  const paths = useMemo(
    () => (curve && start !== null ? curvePaths(curve, start, end) : null),
    [curve, start, end],
  );
  const ticks = useMemo(() => {
    if (start === null || end <= start) return [];
    return timeTicks(start, end, Math.max(2, Math.floor(width / 96)));
  }, [start, end, width]);
  // Where the curve's own extremes fall in the strip, so the scale labels sit at their true heights.
  const axis = useMemo(() => {
    if (!curve) return null;
    const [lo, hi] = yDomain(curve.min, curve.max);
    const at = (v: number) => 1 - (v - lo) / (hi - lo);
    return { top: at(curve.max), bottom: at(curve.min) };
  }, [curve]);
  const summary = useMemo(() => {
    if (!curve) return 'The node count over the recorded history is not available yet.';
    return `Confirmed nodes over the recorded history, from ${formatInt(curve.min)} to ${formatInt(curve.max)}.`;
  }, [curve]);

  // ---- pointer ----------------------------------------------------------------------------------

  const instantFor = useCallback((clientX: number): number => {
    const box = plotRef.current?.getBoundingClientRect();
    const { from: a, end: b } = range.current;
    if (!box || box.width <= 0) return b;
    if (clientX >= box.right - LIVE_EDGE_PX) return b;
    return instantAt((clientX - box.left) / box.width, a, b);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ready || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = e.pointerId;
    handleRef.current?.focus({ preventScroll: true });
    hideHover();
    tm.beginDrag();
    tm.scrub(instantFor(e.clientX));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current === e.pointerId) {
      tm.scrub(instantFor(e.clientX));
      return;
    }
    if (e.pointerType === 'mouse' && ready) showHover(e.clientX);
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current !== e.pointerId) return;
    dragging.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    tm.endDrag(instantFor(e.clientX));
  };

  const showHover = (clientX: number) => {
    const hover = hoverRef.current;
    const tip = tipRef.current;
    const box = plotRef.current?.getBoundingClientRect();
    if (!hover || !tip || !box) return;
    const t = instantFor(clientX);
    const reading = curve ? readingAt(curve, t) : null;
    const at = Math.min(box.width, Math.max(0, clientX - box.left));
    hover.style.setProperty('--tm-hx', `${at}px`);
    hover.dataset.on = '';
    tip.textContent =
      reading?.nodes != null
        ? `${formatInstantMinutes(t)}  ${formatInt(reading.nodes)} nodes`
        : formatInstantMinutes(t);
  };
  const hideHover = () => {
    if (hoverRef.current) delete hoverRef.current.dataset.on;
  };

  // ---- keyboard ---------------------------------------------------------------------------------

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!ready || e.altKey || e.ctrlKey || e.metaKey) return;
    const dir = e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown' ? -1 : 1;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowDown':
      case 'ArrowUp':
        tm.step(e.shiftKey ? 'shift' : 'arrow', dir);
        break;
      case 'PageDown':
      case 'PageUp':
        tm.step('page', dir);
        break;
      case 'Home':
        tm.settle(from);
        break;
      case 'End':
        tm.goLive();
        break;
      case 'Enter':
        tm.goLive();
        break;
      case ' ':
        tm.toggle();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  // ---- the handle's words -----------------------------------------------------------------------

  const slow = useThrottledT(tm, 500);
  const now = end;
  const valueText = live ? 'Live' : `${ageLong(now - slow)} ago, ${formatInstantMinutes(slow)}`;

  return (
    <div
      ref={rootRef}
      className="tm-scrub"
      data-mode={state.mode}
      data-dragging={state.dragging || undefined}
      data-playing={state.playing || undefined}
      data-ready={ready || undefined}
      data-loading={state.loading || undefined}
    >
      <div className="tm-yaxis" aria-hidden="true">
        {curve && axis ? (
          <>
            <span style={{ top: `${axis.top * 100}%` }}>{formatInt(curve.max)}</span>
            {curve.max !== curve.min ? (
              <span style={{ top: `${axis.bottom * 100}%` }}>{formatInt(curve.min)}</span>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="tm-scrub__main">
        <HandleChip tm={tm} state={state} now={now} />
        <div
          ref={plotRef}
          className="tm-plot"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
          onPointerLeave={hideHover}
        >
          <figure
            className="tm-curve"
            aria-label={summary}
            data-state={curve ? 'ready' : curveLoading ? 'loading' : 'empty'}
          >
            <svg
              className="tm-curve__layer tm-curve__layer--dim"
              viewBox={`0 0 ${BOX.w} ${BOX.h}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {paths ? (
                <>
                  <path className="tm-curve__area" d={paths.area} />
                  <path className="tm-curve__line" d={paths.line} />
                </>
              ) : null}
            </svg>
            <svg
              className="tm-curve__layer tm-curve__layer--lit"
              viewBox={`0 0 ${BOX.w} ${BOX.h}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {paths ? (
                <>
                  <path className="tm-curve__area" d={paths.area} />
                  <path className="tm-curve__line" d={paths.line} />
                </>
              ) : null}
            </svg>
          </figure>
          <div className="tm-grid" aria-hidden="true">
            {ticks.map((tk) => {
              const at = fractionOf(tk.t, from, end);
              // At rest the handle sits on the right end: a label that close would be under its knob.
              const covered = live && (1 - at) * width < HANDLE_CLEAR_PX;
              return (
                <span
                  key={tk.t}
                  className="tm-tick"
                  data-major={tk.major || undefined}
                  style={{ left: `${at * 100}%` }}
                >
                  <i className="tm-tick__line" />
                  <b className="tm-tick__label" data-covered={covered || undefined}>
                    {tk.label}
                  </b>
                </span>
              );
            })}
          </div>
          <div ref={hoverRef} className="tm-hover" aria-hidden="true">
            <i className="tm-hover__line" />
            <span ref={tipRef} className="tm-hover__tip" />
          </div>
          <div
            ref={handleRef}
            className="tm-handle"
            role="slider"
            tabIndex={ready ? 0 : -1}
            aria-label="Time machine playhead"
            aria-orientation="horizontal"
            aria-valuemin={from}
            aria-valuemax={end}
            aria-valuenow={live ? end : Math.round(slow)}
            aria-valuetext={valueText}
            aria-disabled={!ready || undefined}
            onKeyDown={onKeyDown}
          >
            <span className="tm-handle__line" />
            <span className="tm-handle__knob" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The time chip that rides the handle: the instant, or "Live" at the right end. */
function HandleChip({ tm, state, now }: { tm: TimeMachine; state: TmState; now: number }) {
  const t = useThrottledT(tm, 33);
  const live = state.mode === 'live';
  return (
    <div className="tm-handle-chip" data-mode={state.mode} aria-hidden="true">
      {live ? (
        <>
          <span className="tm-handle-chip__dot" />
          <span>Live</span>
        </>
      ) : (
        <>
          <span>{formatInstantMinutes(t)}</span>
          <span className="tm-handle-chip__ago">{ageShort(now - t)} ago</span>
        </>
      )}
    </div>
  );
}
