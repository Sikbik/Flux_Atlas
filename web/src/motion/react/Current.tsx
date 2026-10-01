// <Current signal={height} edge="top" />: a live arrival. Renders a zero-size, aria-hidden track along
// one edge of its parent (the parent must be positioned) and runs one comet along it whenever
// `signal` changes. Never on mount. The parent is not touched; the track is its only footprint.

import { useEffect, useRef } from 'react';
import { current, installEngine } from '../engine';
import type { Edge } from '../fxRunners';
import '../motion.css';

export interface CurrentProps {
  /** Any value; the comet fires when it changes (a block height, a counter). */
  signal: unknown;
  edge?: Edge;
  /** Run against the natural direction. */
  reverse?: boolean;
  tone?: 'accent' | 'hot';
  /** Milliseconds; defaults to a length-scaled value. */
  duration?: number;
  tail?: number;
  /** Milliseconds to wait before the light starts (a card that lands a beat after it mounts). */
  delay?: number;
  disabled?: boolean;
  /** Also run once when the component mounts (a card that has just landed). */
  fireOnMount?: boolean;
}

export function Current({
  signal,
  edge = 'top',
  reverse,
  tone,
  duration,
  tail,
  delay,
  disabled,
  fireOnMount,
}: CurrentProps) {
  const track = useRef<HTMLSpanElement>(null);
  const prev = useRef(signal);
  const props = useRef({ edge, reverse, tone, duration, tail, delay });
  props.current = { edge, reverse, tone, duration, tail, delay };
  useEffect(() => installEngine(), []);

  // A card that has just landed: one run at mount. The flag resets in the cleanup so React's
  // development double-mount (mount, unmount, mount) still ends with one effect playing.
  const landed = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount only; props are read from the ref
  useEffect(() => {
    if (!fireOnMount || disabled || landed.current) return;
    landed.current = true;
    const el = track.current;
    const host = el?.parentElement;
    const h = el && host ? current(host, { ...props.current, track: el }) : null;
    return () => {
      landed.current = false;
      h?.cancel();
    };
  }, []);

  useEffect(() => {
    if (Object.is(prev.current, signal)) return;
    prev.current = signal;
    const el = track.current;
    const host = el?.parentElement;
    if (!el || !host || disabled) return;
    const h = current(host, { ...props.current, track: el });
    return () => h?.cancel();
  }, [signal, disabled]);
  return <span ref={track} className="fx-current" data-edge={edge} aria-hidden="true" />;
}
