// The Flux Atlas UI kit: the shared components every view composes from. One import path:
//
//   import { ViewHeader, Section, StatGrid, Stat, KeyValue, EntityLink, DataTable } from '../../ui';
//
// Class names are `ui-*`, every value comes from the design tokens, and the kit has no runtime
// styling dependency. `TimeSeries` loads its charting library lazily (its own chunk), so importing
// the kit never pulls uplot into the shell. See README.md for when to use which component.

import './base.css';

export * from './charts';
export * from './chips';
export * from './controls';
export * from './data';
export * from './forms';
export * from './identity';
// Utilities for views that build their own surfaces on the same foundations.
export { clamp } from './internal/clamp';
export { cx } from './internal/cx';
export { Portal, useDismiss, useFloatingPosition } from './internal/floating';
export { navigateIndex, typeaheadIndex } from './internal/keys';
export { computePosition, type Placement } from './internal/position';
export { type StatusTone, TIER_NAMES, type TierName, tierLabel } from './internal/status';
export { type MotionMode, useAnimate, useMotionMode } from './internal/useMotion';
export * from './layout';
export * from './live';
export * from './nav';
export * from './overlay';
export * from './popover';
export * from './states';
export * from './table';
export * from './timeline';
