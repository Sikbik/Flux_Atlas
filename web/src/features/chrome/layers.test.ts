import { describe, expect, it } from 'vitest';
import { layerOn, layerStates, layersWithMesh, meshModeOf, withLayer } from './layers';

describe('layerStates', () => {
  it('reads explicit on and off tokens and ignores the rest', () => {
    expect(layerStates('nodes,mesh.sel,-labels,clouds')).toEqual({ labels: false, clouds: true });
    expect(layerStates(undefined)).toEqual({});
    expect(layerStates('  ,  -towers ')).toEqual({ towers: false });
  });
});

describe('layerOn', () => {
  it('treats a layer that is not mentioned as on', () => {
    expect(layerOn(undefined, 'labels')).toBe(true);
    expect(layerOn('-labels', 'labels')).toBe(false);
    expect(layerOn('labels', 'labels')).toBe(true);
    expect(layerOn('-clouds', 'labels')).toBe(true);
  });
});

describe('withLayer', () => {
  it('writes an explicit token and keeps the others', () => {
    expect(withLayer('nodes,mesh.flow', 'labels', false)).toBe('nodes,mesh.flow,-labels');
    expect(withLayer(undefined, 'clouds', false)).toBe('-clouds');
  });

  it('replaces the previous token of the same layer', () => {
    expect(withLayer('-labels,nodes', 'labels', true)).toBe('nodes,labels');
    expect(withLayer('labels', 'labels', false)).toBe('-labels');
  });
});

describe('layersWithMesh', () => {
  it('sets the mesh token and keeps layer tokens', () => {
    expect(layersWithMesh('-labels', 'flow')).toBe('-labels,mesh.flow');
    expect(layersWithMesh('-labels,mesh.flow', 'off')).toBe('-labels,mesh.off');
  });

  it('drops the token for the default (the selection peers)', () => {
    expect(layersWithMesh('mesh.flow', 'selection')).toBeUndefined();
    expect(layersWithMesh('-labels,mesh.flow', 'selection')).toBe('-labels');
  });

  it('round-trips with meshModeOf', () => {
    for (const mode of ['off', 'selection', 'flow'] as const)
      expect(meshModeOf(layersWithMesh(undefined, mode))).toBe(mode);
  });
});
