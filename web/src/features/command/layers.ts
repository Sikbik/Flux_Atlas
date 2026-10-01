// The `l` URL param (design 2.6): layers on or off as a comma list, `nodes,mesh.sel,-labels`. The globe
// follows it (`globe/bindings.ts` reads the mesh tokens: `mesh.off`, `mesh.sel`, `mesh.flow`); the other
// tokens are carried through unchanged so a layers popover and the command surfaces never clobber each
// other. This file is the one place the palette and the terminal edit it.

export type MeshMode = 'off' | 'sel' | 'flow';

export const MESH_MODES: readonly { mode: MeshMode; label: string; token: string }[] = [
  { mode: 'sel', label: 'Peers of the selection', token: 'mesh.sel' },
  { mode: 'flow', label: 'Network flow', token: 'mesh.flow' },
  { mode: 'off', label: 'Off', token: 'mesh.off' },
];

const MESH_TOKENS = new Set(['mesh', 'mesh.sel', 'mesh.flow', 'mesh.off', '-mesh']);

export interface ParsedLayers {
  /** The mesh mode the tokens ask for (the design's default, the selection's peers, when absent). */
  mesh: MeshMode;
  /** Every other token, in order. */
  others: string[];
}

/** Reads the mesh mode and keeps every other token. */
export function parseLayers(l: string | undefined): ParsedLayers {
  let mesh: MeshMode = 'sel';
  const others: string[] = [];
  for (const raw of (l ?? '').split(',')) {
    const tok = raw.trim();
    if (!tok) continue;
    if (!MESH_TOKENS.has(tok)) {
      others.push(tok);
      continue;
    }
    if (tok === '-mesh' || tok === 'mesh.off') mesh = 'off';
    else if (tok === 'mesh.flow') mesh = 'flow';
    else mesh = 'sel';
  }
  return { mesh, others };
}

/** The `l` value with the mesh mode set; the default mode writes no token. Undefined when empty. */
export function withMeshMode(l: string | undefined, mode: MeshMode): string | undefined {
  const { others } = parseLayers(l);
  const tokens = mode === 'sel' ? others : [...others, `mesh.${mode}`];
  return tokens.length ? tokens.join(',') : undefined;
}

/** True when `token` is present (a layer other than the mesh) and not negated. */
export function layerOn(l: string | undefined, name: string): boolean {
  const { others } = parseLayers(l);
  if (others.includes(`-${name}`)) return false;
  return others.includes(name);
}

/** True when a layer that is on by default (place labels) has been switched off with `-name`. */
export function layerHidden(l: string | undefined, name: string): boolean {
  return parseLayers(l).others.includes(`-${name}`);
}

/** Turns a plain layer on or off: on removes both forms, off writes `-name`. */
export function withLayer(l: string | undefined, name: string, on: boolean): string | undefined {
  const { mesh, others } = parseLayers(l);
  const rest = others.filter((t) => t !== name && t !== `-${name}`);
  const tokens = [...rest, ...(on ? [] : [`-${name}`])];
  if (mesh !== 'sel') tokens.push(`mesh.${mesh}`);
  return tokens.length ? tokens.join(',') : undefined;
}

export function meshLabel(mode: MeshMode): string {
  return MESH_MODES.find((m) => m.mode === mode)?.label ?? mode;
}
