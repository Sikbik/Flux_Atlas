// Durations and easing for the effect runners (Web Animations API takes numbers and strings, not
// CSS variables). These mirror the --fx-dur-* and --fx-ease-* tokens in motion.css; timing.test.ts
// reads the stylesheet and fails if the two drift apart.

export const DUR = {
  pulse: 240,
  seed: 180,
  charge: 140,
  spark: 360,
  current: 640,
  lap: 900,
  powerOn: 420,
  surge: 480,
  powerOff: 180,
  slide: 300,
} as const;

export const EASE = {
  /** Light along a wire and the front of a surge: brisk off the mark, steady, a short settle. */
  run: 'cubic-bezier(0.33, 0.4, 0.5, 1)',
  /** Things that arrive: a window or panel scaling and fading in. */
  arrive: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  /** A burst that blooms and is gone (tokens.css --ease-out-expo). */
  burst: 'cubic-bezier(0.16, 1, 0.3, 1)',
  /** The selection indicator: the leading edge, then the trailing edge catching up. */
  lead: 'cubic-bezier(0.16, 1, 0.3, 1)',
  trail: 'cubic-bezier(0.4, 0, 0.2, 1)',
  /** Once around a card: nearly even, so the head reads as one steady lap. */
  lap: 'cubic-bezier(0.4, 0.25, 0.3, 1)',
  /** tokens.css --ease-in, for things that leave */
  in: 'cubic-bezier(0.55, 0, 1, 0.45)',
  /** tokens.css --ease-out */
  out: 'cubic-bezier(0.22, 1, 0.36, 1)',
} as const;

/** The most simultaneous flashes the language allows per second (WCAG 2.3.1: three). */
export const FLASH_PER_SECOND = 3;

/** Reduced motion: every cross-fade is this long (tokens.css --dur-base under reduced motion). */
export const REDUCED_MS = 160;
