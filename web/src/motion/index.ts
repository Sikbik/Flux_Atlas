// The Flux interaction language. See docs/design/motion-language.md and ./README.md.
//
//   <MotionRoot />          mount once: delegated data-fx input, motion mode, runners on idle
//   data-fx="press charge"  Pulse on press, edge light on hover and focus (no hooks needed)
//   data-fx="toggle"        Spark when the control turns on
//   <Current signal edge />  a light streak along a container edge on a live arrival
//   <PowerOn open />         a window or panel opening and closing
//   <Settle value />         a changed value lands with a short glow
//   <TabIndicator />         the selection line that travels between tabs

export { type BudgetOptions, type BudgetStats, DEFAULT_BUDGET, type FxKind, type Lease } from './budget';
export {
  current as runCurrent,
  loadRunners,
  powerOff,
  powerOn,
  pulse,
  settle,
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
  SettleOptions,
  SparkOptions,
  Tone,
} from './fxRunners';
export { createIndicator } from './indicator';
export { currentMode, type MotionMode, modeOf } from './mode';
export { Current, type CurrentProps } from './react/Current';
export { useCharge, useMotionMode, usePulse, useSettle, useSpark } from './react/hooks';
export { MotionRoot } from './react/MotionRoot';
export { PowerOn, type PowerOnProps } from './react/PowerOn';
export { Settle, type SettleProps } from './react/Settle';
export { TabIndicator } from './react/TabIndicator';
export { DUR, EASE } from './timing';
