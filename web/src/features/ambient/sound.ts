// Optional generative sound for ambient mode: the engine's own `ambient/sound` score (a drone, a bell for
// each block, a pluck for each payout), off until the visitor turns it on in Settings. The score is loaded
// on demand, so none of it is in the shell or in the ambient view itself. Browsers only start audio after
// a gesture; entering ambient mode from a click or a key is one, and an idle entry is not, so there the
// score stays silent instead of failing.

import type { GlobeEngine } from '../../globe/engine/GlobeEngine';

export interface SoundHandle {
  /** Fades the score out and releases the audio graph. */
  stop(): void;
}

const FADE_OUT_MS = 900;

/** Starts the score on this engine; resolves once it is set up. `cancelled` is polled after the load. */
export async function startAmbientSound(engine: GlobeEngine, cancelled: () => boolean): Promise<SoundHandle> {
  const { AmbientSound } = await import('../../globe/engine/ambient/sound');
  if (cancelled()) return { stop: () => undefined };
  const sound = new AmbientSound(engine);
  sound.setEnabled(true);
  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      sound.setEnabled(false);
      window.setTimeout(() => sound.dispose(), FADE_OUT_MS);
    },
  };
}
