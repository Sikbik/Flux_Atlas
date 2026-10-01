// The globe: the persistent living wallpaper (GlobeCanvas), its bindings to the live runtime and the
// URL, the anchor system for labels and tethers, and the overlays that ride it. The engine itself
// (./engine, three.js) is a lazily loaded chunk; nothing here imports it at runtime.

import './globe.css';

export { type Anchor, type AnchorPoint, AnchorSystem, type PlaceOptions } from './anchors';
export {
  type GlobeBinding,
  type GlobeHover,
  type GlobeIntent,
  type GlobeView,
  globeViewFromLocation,
} from './bindings';
export {
  createGlobeHandles,
  GlobeLabel,
  GlobeProvider,
  type GlobeStatus,
  Tether,
  useGlobeAnchor,
  useGlobeBinding,
  useGlobeEngine,
  useGlobeHandles,
  useGlobeHover,
  useGlobeStatus,
} from './context';
export { effectiveArt, GlobeCanvas, loadEngine } from './GlobeCanvas';
export { GlobeOverlay, GlobeTooltip, MoonProxy, PlaceLabels } from './overlays';
export type {
  GlobeFraming,
  GlobeTarget,
  HubInfo,
  MoonBoot,
  MoonPark,
  MoonState,
  NodeDensity,
  RevealOrigin,
  ScreenPoint,
} from './target';
