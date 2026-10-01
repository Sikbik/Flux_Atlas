// Type-level proof of the port contract: `engine.sink` can be handed to the web app's
// `runtime.setEffectSink(...)`, and the web's EffectSink fits the engine's vocabulary the other way round.
// Run with `npm run check:sink` (it needs the web app in the tree: ../../web/src/choreo/effects.ts).
import type { EffectSink as WebSink } from '../../../../web/src/choreo/effects';
import type { Effects, EffectSink as LabSink } from '../../src/engine/effects';

declare const sink: Effects;
export const toWeb: WebSink = sink;

declare const web: WebSink;
export const toLab: LabSink = web;
