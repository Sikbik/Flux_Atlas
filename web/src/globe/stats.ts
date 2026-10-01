// `window.__atlasGlobeStats`: live engine numbers for end-to-end tests and perf checks (dev builds
// and builds made with VITE_ATLAS_TEST=1 only). Getters read the engine's live stats object, so
// reading costs nothing per frame.
//
//   nodes      nodes drawn (alive in the engine)
//   fps        frames per second (engine, 0.5 s window)
//   frameMs    the last frame's wall time; cpuMs the engine's CPU time per frame (smoothed)
//   beats      Beats played through the effect sink (one per block landing)
//   payouts, downlinks, uplinks  relay commands drawn
//   quality, renderScale, dpr, drawCalls, art   the governor's state and the look
//   frames     frames rendered since the engine started

import type { GlobeEngine } from './engine/GlobeEngine';

export interface GlobeStats {
  readonly ready: boolean;
  readonly nodes: number;
  readonly fps: number;
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly beats: number;
  readonly payouts: number;
  readonly downlinks: number;
  readonly uplinks: number;
  readonly quality: string;
  readonly renderScale: number;
  readonly dpr: number;
  readonly drawCalls: number;
  readonly art: string;
  readonly frames: number;
  readonly generation: number;
}

declare global {
  interface Window {
    __atlasGlobeStats?: GlobeStats;
    /** Test hooks (same builds): the engine, and a way to drop the WebGL context. */
    __atlasGlobe?: { engine: GlobeEngine; loseContext(): boolean; restoreContext(): boolean };
  }
}

export const STATS_ENABLED: boolean = import.meta.env.DEV || import.meta.env.VITE_ATLAS_TEST === '1';

export function exposeGlobeStats(
  engine: GlobeEngine,
  extra: () => { generation: number; art: string },
): () => void {
  if (!STATS_ENABLED || typeof window === 'undefined') return () => {};
  let frames = 0;
  const off = engine.on('frame', () => {
    frames++;
  });
  const counts = (engine.sink as unknown as { counts: Record<string, number> }).counts;
  const st = engine.stats;
  const stats: GlobeStats = {
    get ready() {
      return frames > 0;
    },
    get nodes() {
      return st.nodes;
    },
    get fps() {
      return st.fps;
    },
    get frameMs() {
      return st.frameMs;
    },
    get cpuMs() {
      return st.cpuMs;
    },
    get beats() {
      return counts.beat ?? 0;
    },
    get payouts() {
      return counts.payoutLanded ?? 0;
    },
    get downlinks() {
      return counts.downlink ?? 0;
    },
    get uplinks() {
      return counts.uplink ?? 0;
    },
    get quality() {
      return st.quality;
    },
    get renderScale() {
      return st.renderScale;
    },
    get dpr() {
      return st.dpr;
    },
    get drawCalls() {
      return st.drawCalls;
    },
    get art() {
      return extra().art;
    },
    get frames() {
      return frames;
    },
    get generation() {
      return extra().generation;
    },
  };
  // Kept from the start: a lost context returns null from getExtension.
  const loseExt = engine.renderer.getContext().getExtension('WEBGL_lose_context');
  const lose = () => loseExt;
  window.__atlasGlobeStats = stats;
  window.__atlasGlobe = {
    engine,
    loseContext: () => {
      const ext = lose();
      ext?.loseContext();
      return !!ext;
    },
    restoreContext: () => {
      const ext = lose();
      ext?.restoreContext();
      return !!ext;
    },
  };
  return () => {
    off();
    if (window.__atlasGlobeStats === stats) delete window.__atlasGlobeStats;
    if (window.__atlasGlobe?.engine === engine) delete window.__atlasGlobe;
  };
}
