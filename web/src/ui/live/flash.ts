// Pure helpers for FlashOnChange: which way a value moved, which light colour that earns, and the
// A/B phase that restarts a CSS animation without remounting the element.

/** Anything FlashOnChange can compare: a primitive. */
export type FlashValue = string | number | bigint | boolean | null | undefined;

/** The colour of the light: the accent (default), white (attention), the direction colours, or `auto`. */
export type FlashTone = 'accent' | 'white' | 'up' | 'down' | 'auto';

export type FlashDirection = 'up' | 'down' | null;

/** `up` or `down` when both values are numbers (or bigints) and they differ; null otherwise. */
export function flashDirection(prev: FlashValue, next: FlashValue): FlashDirection {
  const numeric = (v: FlashValue): v is number | bigint => typeof v === 'number' || typeof v === 'bigint';
  if (!numeric(prev) || !numeric(next)) return null;
  if (typeof prev === 'number' && Number.isNaN(prev)) return null;
  if (typeof next === 'number' && Number.isNaN(next)) return null;
  return next > prev ? 'up' : next < prev ? 'down' : null;
}

/** Resolves `auto` against the direction of the last change; other tones pass through. */
export function resolveFlashTone(tone: FlashTone, dir: FlashDirection): Exclude<FlashTone, 'auto'> {
  if (tone !== 'auto') return tone;
  return dir ?? 'accent';
}

/**
 * Alternates between two keyframe names so the animation restarts on every change (changing
 * `animation-name` restarts it; setting the same name again does not). Nothing before the first change.
 */
export function flashPhase(seq: number): 'a' | 'b' | undefined {
  if (seq <= 0) return undefined;
  return seq % 2 === 1 ? 'a' : 'b';
}
