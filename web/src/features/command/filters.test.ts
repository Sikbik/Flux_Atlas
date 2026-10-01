import { describe, expect, it } from 'vitest';
import {
  activeFilters,
  applyFilterPatch,
  describeFilters,
  type FilterLookup,
  parseFilterExpr,
} from './filters';
import { layerHidden, layerOn, meshLabel, parseLayers, withLayer, withMeshMode } from './layers';

const lookup: FilterLookup = {
  countries: [
    { code: 'FI', name: 'Finland', lower: 'finland' },
    { code: 'DE', name: 'Germany', lower: 'germany' },
    { code: 'US', name: 'United States', lower: 'united states' },
  ],
  providers: [
    { name: 'Hetzner Online GmbH', lower: 'hetzner online gmbh' },
    { name: 'OVH SAS', lower: 'ovh sas' },
  ],
  versions: [{ version: '8.20.0' }, { version: '8.19.2' }],
};

describe('parseFilterExpr', () => {
  it('reads tiers, countries, providers and versions from bare words', () => {
    const r = parseFilterExpr('stratus nimbus fi hetzner 8.20.0', lookup);
    expect(r.patch.set).toEqual({
      tier: 'stratus,nimbus',
      cc: 'FI',
      org: 'hetzner online gmbh',
      ver: '8.20.0',
    });
    expect(r.unknown).toEqual([]);
    expect(r.clearAll).toBe(false);
  });

  it('reads explicit key=value pairs and aliases', () => {
    const r = parseFilterExpr('tier=cumulus,stratus country:germany provider=ovh version=8.19', lookup);
    expect(r.patch.set).toEqual({ tier: 'cumulus,stratus', cc: 'DE', org: 'ovh', ver: '8.19' });
  });

  it('reads the boolean filters', () => {
    expect(parseFilterExpr('arcane', lookup).patch.set).toEqual({ arcane: true });
    expect(parseFilterExpr('!arcane', lookup).patch.set).toEqual({ arcane: false });
    expect(parseFilterExpr('arcane=false watched', lookup).patch.set).toEqual({
      arcane: false,
      watched: true,
    });
    expect(parseFilterExpr('watched=off', lookup).patch.clear).toEqual(['watched']);
  });

  it('clears everything on its own', () => {
    for (const w of ['clear', 'none', 'reset', 'off', 'all']) {
      expect(parseFilterExpr(w, lookup).clearAll).toBe(true);
    }
  });

  it('keeps what it cannot resolve', () => {
    const r = parseFilterExpr('stratus zzzzz tier=bogus', lookup);
    expect(r.patch.set.tier).toBe('stratus');
    expect(r.unknown).toEqual(['zzzzz', 'bogus']);
  });
});

describe('applying a patch', () => {
  it('merges over the search, clears keys and can clear all', () => {
    const search = { tier: 'stratus', cc: 'FI', w: 'queue' };
    expect(applyFilterPatch(search, { set: { org: 'ovh' }, clear: ['cc'] })).toEqual({
      tier: 'stratus',
      org: 'ovh',
      w: 'queue',
    });
    expect(applyFilterPatch(search, { set: { tier: 'nimbus' }, clear: [] }, true)).toEqual({
      tier: 'nimbus',
      w: 'queue',
    });
  });

  it('reads and describes the filters in force', () => {
    const f = activeFilters({ tier: 'stratus,nimbus', cc: 'fi', arcane: true, w: 'x', ver: 8 });
    expect(f).toEqual({ tier: 'stratus,nimbus', cc: 'fi', arcane: true, ver: '8' });
    expect(describeFilters(f)).toEqual(['tier Stratus, Nimbus', 'country FI', 'FluxOS 8', 'ArcaneOS only']);
  });
});

describe('layers', () => {
  it('defaults the mesh to the selection and keeps other tokens', () => {
    expect(parseLayers(undefined)).toEqual({ mesh: 'sel', others: [] });
    expect(parseLayers('nodes,mesh.flow,-labels')).toEqual({ mesh: 'flow', others: ['nodes', '-labels'] });
    expect(parseLayers('-mesh').mesh).toBe('off');
    expect(parseLayers('mesh').mesh).toBe('sel');
  });

  it('writes the mesh mode without losing the rest, and nothing for the default', () => {
    expect(withMeshMode('nodes,-labels', 'flow')).toBe('nodes,-labels,mesh.flow');
    expect(withMeshMode('nodes,mesh.flow', 'sel')).toBe('nodes');
    expect(withMeshMode('mesh.flow', 'sel')).toBeUndefined();
    expect(withMeshMode(undefined, 'off')).toBe('mesh.off');
  });

  it('turns plain layers on and off', () => {
    expect(withLayer(undefined, 'labels', false)).toBe('-labels');
    expect(layerOn('-labels', 'labels')).toBe(false);
    expect(layerOn('labels', 'labels')).toBe(true);
    expect(withLayer('-labels,mesh.flow', 'labels', true)).toBe('mesh.flow');
    expect(meshLabel('flow')).toBe('Network flow');
  });

  it('reads a default-on layer as hidden only when it is negated', () => {
    expect(layerHidden(undefined, 'labels')).toBe(false);
    expect(layerHidden('mesh.flow', 'labels')).toBe(false);
    expect(layerHidden('mesh.flow,-labels', 'labels')).toBe(true);
  });
});
