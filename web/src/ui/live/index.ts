// Live atoms: the live-first signature pieces. AnimatedNumber ticks like an odometer, FlashOnChange
// is a breath of light when a value changes, Freshness says how old a source is, LiveDot is the
// status dot. All follow the motion setting (full, reduced, off).
export { AnimatedNumber, type AnimatedNumberProps } from './AnimatedNumber';
export { FlashOnChange, type FlashOnChangeProps } from './FlashOnChange';
export { Freshness, type FreshnessProps } from './Freshness';
export type { FlashTone, FlashValue } from './flash';
export {
  type FreshnessState,
  type FreshnessView,
  type FreshnessWord,
  freshnessChipText,
  freshnessInlineText,
  freshnessTitle,
  freshnessView,
} from './freshness';
export { LiveDot, type LiveDotProps } from './LiveDot';
