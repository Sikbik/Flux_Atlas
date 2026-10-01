// The easing curves of `timing.ts` as JS functions, for keyframes that bake their easing in (the
// trail of a comet: every link of the chain samples the same curve). Built from the same strings the
// CSS tokens mirror, so there is one source of truth. Lives in the lazy half of the module: the core
// never needs the geometry code.

import { parseBezier } from '../geometry';
import { EASE } from '../timing';

function curve(css: string) {
  const b = parseBezier(css);
  if (!b) throw new Error(`motion: ${css} is not a cubic-bezier()`);
  return b;
}

export const BEZ = {
  run: curve(EASE.run),
  lap: curve(EASE.lap),
} as const;
