// The ambient features need three things the globe's `GlobeTarget` interface (globe/bindings.ts) does not
// list: the place-name resolver for captions, the screensaver controls and the easter egg. The object
// behind the interface is the real `GlobeEngine`, so this narrows it with a type-only import (nothing of
// the engine is bundled with the shell).

import type { GlobeTarget } from '../../globe';
import type { GlobeEngine } from '../../globe/engine/GlobeEngine';

export type AmbientEngine = Pick<GlobeEngine, 'nameOf' | 'ambient' | 'playEgg' | 'mode' | 'on'>;

export function asAmbientEngine(t: GlobeTarget | null): AmbientEngine | null {
  return t as unknown as AmbientEngine | null;
}

/** The whole engine, for the sound score, which is built on it. */
export function asGlobeEngine(t: GlobeTarget | null): GlobeEngine | null {
  return t as unknown as GlobeEngine | null;
}
