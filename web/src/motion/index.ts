// The Flux interaction language. See docs/design/motion-language.md and ./README.md.
//
//   <MotionRoot />          mount once: the attribute-driven engine, the motion mode mirror, runners on idle
//
// The kit's components join the language without any code (the engine answers the attributes they
// write: data-pressed, data-state, data-fresh; see attach.ts). Everything below is for what the kit
// does not draw:
//
//   data-fx="press charge"  Pulse on press and the edge light on hover, for an element outside the kit
//   data-fx="toggle"        Spark when the control turns on
//   data-fx="current"       Current along the top edge when it gets data-fresh
//   <Current signal edge />  a light streak along a container edge on a live arrival
//   <PowerOn open />         a window or panel opening and closing
//   <TabIndicator />         a stretching selection line, for tab-like lists that have none of their own
//
// A changed value landing (Settle) is the kit's FlashOnChange, AnimatedNumber and fresh table rows.

export { type AttachKind, attach, ON_STATES, QUIET, rules as attachRules } from './attach';
export { type BudgetOptions, type BudgetStats, DEFAULT_BUDGET, type FxKind, type Lease } from './budget';
export {
  current as runCurrent,
  loadRunners,
  powerOff,
  powerOn,
  pulse,
  spark,
  stats as motionStats,
} from './engine';
export type {
  CurrentOptions,
  Edge,
  FxHandle,
  Origin,
  PowerOptions,
  PulseOptions,
  SparkOptions,
  Tone,
} from './fxRunners';
export { createIndicator } from './indicator';
export { currentMode, documentMode, type MotionMode, modeOf } from './mode';
export { Current, type CurrentProps } from './react/Current';
export { useCharge, usePulse, useSpark } from './react/hooks';
export { MotionRoot } from './react/MotionRoot';
export { PowerOn, type PowerOnProps } from './react/PowerOn';
export { TabIndicator } from './react/TabIndicator';
export { DUR, EASE } from './timing';
