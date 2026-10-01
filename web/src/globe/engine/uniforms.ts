// One shared block of uniforms. Every material references the same `{ value }` objects, so a single
// write per frame updates all of them. Colors are stored linear (three converts from sRGB hex).

import * as THREE from 'three';
import type { GlobeTokens } from './tokens';

export interface SharedUniforms {
  uTime: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uViewport: { value: THREE.Vector2 };
  /** Device pixels per CSS pixel times render scale. Sizes in shaders are CSS px times this. */
  uPxScale: { value: number };
  /** Perspective scale: pixels per world unit at distance 1 from the camera. */
  uProjScale: { value: number };
  uCamPos: { value: THREE.Vector3 };
  uCamRight: { value: THREE.Vector3 };
  uCamUp: { value: THREE.Vector3 };
  uCamBack: { value: THREE.Vector3 };
  uTanHalfFov: { value: number };
  uAspect: { value: number };
  /** The boot reveal wave: xyz = origin (unit), w = angular radius in radians (negative = off). */
  uReveal: { value: THREE.Vector4 };
  /** Radians per CSS pixel at the near surface (keeps the reveal front a constant screen width). */
  uRevealPx: { value: number };
  /** The planet's shift on screen, in NDC: the globe is centered in the free area, not the viewport (setInset). */
  uViewShift: { value: THREE.Vector2 };
  uFan: { value: number };
  uFocus: { value: number };
  uFilterT: { value: number };
  uPosTex: { value: THREE.Texture | null };
  uWave: { value: THREE.Vector4[] };
  uWaveP: { value: THREE.Vector4[] };
  /** The Flux moon's anchors in world space (xyz; w = 1 when valid). Rays read these by slot id 1000000 + k. */
  uAnchor: { value: THREE.Vector4[] };
  uTierColor: { value: THREE.Color[] };
  uAccent: { value: THREE.Color };
  uBlock: { value: THREE.Color };
  uConstellation: { value: THREE.Color };
  uMesh: { value: THREE.Color };
  uWatch: { value: THREE.Color };
  uAlert: { value: THREE.Color };
  uShock: { value: THREE.Color };
  uShockHot: { value: THREE.Color };
  uHover: { value: THREE.Color };
  uMine: { value: THREE.Color };
  uAim: { value: THREE.Color };
  uRisk: { value: THREE.Color };
  uInstall: { value: THREE.Color };
  uOff: { value: THREE.Color };
  uRimHot: { value: THREE.Color };
  uEmission: { value: THREE.Color };
  /** Tier marker sizes (cumulus, nimbus, stratus), 1.0 = base. */
  uSize: { value: THREE.Vector3 };
  /** Design `dim-alpha`: node alpha when something else is in hard focus. */
  uDimAlpha: { value: number };
  /** Alpha everything else drops to right now (0.55 for a plain selection, dim-alpha for a focus set). */
  uFocusAlpha: { value: number };
  uHaloAlpha: { value: number };
  /** Node brightness by zoom: the design draws far-zoom points at about 55%. */
  uZoomGain: { value: number };
  uAimAlpha: { value: number };
  uMeshAlpha: { value: number };
  uMeshFlow: { value: number };
  uNodeScale: { value: number };
  uSpireScale: { value: number };
  uReduced: { value: number };
  uNightLights: { value: number };
  uClouds: { value: number };
  uTerminator: { value: number };
  uAtmo: { value: number };
}

export function createSharedUniforms(): SharedUniforms {
  return {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(1, 0.2, 0.6).normalize() },
    uViewport: { value: new THREE.Vector2(1280, 720) },
    uPxScale: { value: 1 },
    uProjScale: { value: 1200 },
    uCamPos: { value: new THREE.Vector3(0, 0, 4) },
    uCamRight: { value: new THREE.Vector3(1, 0, 0) },
    uCamUp: { value: new THREE.Vector3(0, 1, 0) },
    uCamBack: { value: new THREE.Vector3(0, 0, 1) },
    uTanHalfFov: { value: 0.3 },
    uAspect: { value: 1.6 },
    uViewShift: { value: new THREE.Vector2(0, 0) },
    uReveal: { value: new THREE.Vector4(0, 0, 1, -1) },
    uRevealPx: { value: 0.001 },
    uFan: { value: 0 },
    uFocus: { value: 0 },
    uFilterT: { value: 1 },
    uPosTex: { value: null },
    uWave: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 1, 0, -1)) },
    uWaveP: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(1.2, 0.05, 1, 0.25)) },
    uAnchor: { value: [0, 1, 2, 3, 4, 5, 6, 7].map(() => new THREE.Vector4(0, 0, 0, 0)) },
    uTierColor: { value: [0, 1, 2, 3].map(() => new THREE.Color()) },
    uAccent: { value: new THREE.Color() },
    uBlock: { value: new THREE.Color() },
    uConstellation: { value: new THREE.Color() },
    uMesh: { value: new THREE.Color() },
    uWatch: { value: new THREE.Color() },
    uAlert: { value: new THREE.Color() },
    uShock: { value: new THREE.Color() },
    uShockHot: { value: new THREE.Color() },
    uHover: { value: new THREE.Color() },
    uMine: { value: new THREE.Color() },
    uAim: { value: new THREE.Color() },
    uRisk: { value: new THREE.Color() },
    uInstall: { value: new THREE.Color() },
    uOff: { value: new THREE.Color() },
    uRimHot: { value: new THREE.Color() },
    uEmission: { value: new THREE.Color() },
    uSize: { value: new THREE.Vector3(1, 1.35, 1.75) },
    uDimAlpha: { value: 0.14 },
    uFocusAlpha: { value: 0.55 },
    uHaloAlpha: { value: 0.32 },
    uZoomGain: { value: 0.6 },
    uAimAlpha: { value: 0.85 },
    uMeshAlpha: { value: 0.22 },
    uMeshFlow: { value: 0.05 },
    uNodeScale: { value: 1 },
    uSpireScale: { value: 1 },
    uReduced: { value: 0 },
    uNightLights: { value: 1 },
    uClouds: { value: 1 },
    uTerminator: { value: 1 },
    uAtmo: { value: 1 },
  };
}

/** Pushes token colors into the shared block. */
export function applyTokens(u: SharedUniforms, t: GlobeTokens): void {
  u.uTierColor.value[0]!.set(t.off);
  u.uTierColor.value[1]!.set(t.cumulus);
  u.uTierColor.value[2]!.set(t.nimbus);
  u.uTierColor.value[3]!.set(t.stratus);
  u.uAccent.value.set(t.accent);
  u.uBlock.value.set(t.block);
  u.uConstellation.value.set(t.constellation);
  u.uMesh.value.set(t.mesh);
  u.uWatch.value.set(t.watch);
  u.uAlert.value.set(t.alert);
  u.uShock.value.set(t.shock);
  u.uShockHot.value.set(t.shockHot);
  u.uHover.value.set(t.hover);
  u.uMine.value.set(t.mine);
  u.uAim.value.set(t.aim);
  u.uRisk.value.set(t.risk);
  u.uInstall.value.set(t.install);
  u.uOff.value.set(t.off);
  u.uRimHot.value.set(t.rimHot);
  u.uEmission.value.set(t.emission);
  u.uSize.value.set(t.sizeCumulus, t.sizeNimbus, t.sizeStratus);
  u.uDimAlpha.value = t.dimAlpha;
  u.uHaloAlpha.value = t.haloAlpha;
  u.uAimAlpha.value = t.aimAlpha;
  u.uMeshAlpha.value = t.meshAlpha;
  u.uMeshFlow.value = t.meshFlowAlpha;
  u.uNodeScale.value = t.nodeScale;
  u.uSpireScale.value = t.spireScale;
}
