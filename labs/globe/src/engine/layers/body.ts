import type * as THREE from 'three';
import type { GlobeTokens } from '../tokens';

/** A globe body is one art direction's planet: sphere, land, lines, whatever it needs. */
export interface GlobeBody {
  readonly group: THREE.Group;
  setTokens(t: GlobeTokens): void;
  update(time: number): void;
  setVisible(v: boolean): void;
  dispose(): void;
}
