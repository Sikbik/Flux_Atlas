// Globe layers the View menu toggles (design 2.6, 7.9): the `l` search param carries them as tokens,
// `l=nodes,mesh.sel,-labels` ("layers on or off"). Bare `clouds` turns a layer on explicitly, `-clouds`
// turns it off, and a layer not mentioned keeps the engine's own default (so its lite tier stays in
// charge). The mesh mode is the `mesh.*` token (read by globe/bindings.ts); the layers below are the
// day and night terminator, night lights, clouds, the stack towers (engine effects) and the place
// labels (DOM, drawn by globe/overlays.tsx).

import { useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { GlobeTarget } from '../../globe';
import { meshModeFor } from '../../globe/bindings';
import { useGlobeEngine } from '../../globe/context';

export type LayerKey = 'labels' | 'terminator' | 'lights' | 'clouds' | 'towers';
export type MeshMode = 'off' | 'selection' | 'flow';

export const LAYER_KEYS: readonly LayerKey[] = ['terminator', 'lights', 'clouds', 'towers', 'labels'];

const tokens = (l: string | undefined): string[] =>
  (l ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

/** The layers `l` mentions: true = explicitly on, false = explicitly off. Others are absent. */
export function layerStates(l: string | undefined): Partial<Record<LayerKey, boolean>> {
  const out: Partial<Record<LayerKey, boolean>> = {};
  for (const t of tokens(l)) {
    const off = t.startsWith('-');
    const name = (off ? t.slice(1) : t) as LayerKey;
    if ((LAYER_KEYS as readonly string[]).includes(name)) out[name] = !off;
  }
  return out;
}

/** Whether a layer reads as on (a layer not mentioned is on). */
export const layerOn = (l: string | undefined, key: LayerKey): boolean => layerStates(l)[key] ?? true;

/** The `l` param with `key` set explicitly; other tokens are kept. */
export function withLayer(l: string | undefined, key: LayerKey, on: boolean): string | undefined {
  const rest = tokens(l).filter((t) => t !== key && t !== `-${key}`);
  rest.push(on ? key : `-${key}`);
  return rest.join(',');
}

/** The `l` param with its mesh token replaced (other layer tokens are kept). */
export function layersWithMesh(l: string | undefined, mode: MeshMode): string | undefined {
  const rest = tokens(l).filter((t) => t !== '-mesh' && t !== 'mesh' && !t.startsWith('mesh.'));
  // The default (the selection's peers) needs no token.
  if (mode !== 'selection') rest.push(mode === 'off' ? 'mesh.off' : 'mesh.flow');
  return rest.length ? rest.join(',') : undefined;
}

export const meshModeOf = (l: string | undefined): MeshMode => meshModeFor(l);

/** The raw `l` param. */
export function useLayerParam(): string | undefined {
  return useRouterState({ select: (s) => (s.location.search as { l?: string }).l });
}

/** Whether the place labels are on. */
export function useLabelsOn(): boolean {
  return layerOn(useLayerParam(), 'labels');
}

const ENGINE_EFFECT = {
  terminator: 'terminator',
  lights: 'nightLights',
  clouds: 'clouds',
  towers: 'spires',
} as const;

type Effects = Parameters<GlobeTarget['setEffects']>[0];

/** Applies the layers the URL mentions to the engine whenever it (re)loads or they change. */
export function useApplyLayers(): void {
  const engine = useGlobeEngine();
  const l = useLayerParam();
  useEffect(() => {
    if (!engine) return;
    const states = layerStates(l);
    const partial: Effects = {};
    for (const k of Object.keys(ENGINE_EFFECT) as (keyof typeof ENGINE_EFFECT)[]) {
      const v = states[k];
      if (v !== undefined) partial[ENGINE_EFFECT[k]] = v;
    }
    if (Object.keys(partial).length > 0) engine.setEffects(partial);
  }, [engine, l]);
}
