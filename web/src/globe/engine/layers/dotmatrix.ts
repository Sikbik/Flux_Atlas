// Art direction "dotmatrix": holographic dot-matrix continents.
//
// The planet is a dark glass sphere with a faint graticule. Land is a Fibonacci lattice of small
// discs lying on the surface (so they foreshorten toward the limb like printed dots), kept only
// where the land mask says land. Each dot carries a night-light value sampled from the NASA night
// map, so cities glow on the dark side; the lit side is a cool cyan-white that dims through the
// terminator. A slow scan band and travelling shimmer keep the surface alive.

import * as THREE from 'three';
import { readPixels } from '../assets';
import type { AssetStore } from '../assetstore';
import { GOLDEN_ANGLE, hash01, TAU } from '../math';
import {
  GLSL_CONSTANTS,
  GLSL_GEO,
  GLSL_HASH,
  GLSL_REVEAL,
  GLSL_WAVE_GLOW,
  GLSL_WAVES,
} from '../shaders/chunks';
import type { GlobeTokens } from '../tokens';
import type { SharedUniforms } from '../uniforms';
import type { GlobeBody } from './body';

const BODY_VERT = /* glsl */ `
out vec3 vN;
out vec3 vWorld;
void main() {
  vN = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const BODY_FRAG = /* glsl */ `
${GLSL_CONSTANTS}
${GLSL_GEO}
${GLSL_WAVES}
${GLSL_WAVE_GLOW}
${GLSL_REVEAL}
uniform vec3 uOcean;
uniform vec3 uOceanLit;
uniform vec3 uGrat;
uniform float uGratAlpha;
uniform float uTermW;
uniform float uFan;
uniform vec3 uSunDir;
uniform float uTerminator;
in vec3 vN;
in vec3 vWorld;

// One-pixel-wide grid line at every 'cell' units, anti-aliased with the distance function's own
// derivative (continuous across the longitude seam, unlike a derivative of the raw angle).
float gridAA(float x, float cell) {
  float g = abs(fract(x / cell - 0.5) - 0.5);
  float d = fwidth(g);
  return 1.0 - smoothstep(0.0, d * 1.25 + 1e-5, g);
}

void main() {
  vec3 n = normalize(vN);
  vec3 sun = uTerminator > 0.5 ? uSunDir : normalize(cameraPosition);
  float mu = dot(n, sun);
  // Radial shading from ocean-lit (toward the sun) to ocean (away), with a soft penumbra of
  // terminator-width radians on each side of the terminator.
  float lit = smoothstep(-sin(uTermW), sin(uTermW), mu);
  vec3 col = mix(uOcean, uOceanLit, lit);
  // Graticule: every 30 degrees, every 10 once the camera is regional. Pixel-wide lines.
  float lat = asin(clamp(n.y, -1.0, 1.0)) * 57.29578;
  float lon = atan(n.x, n.z) * 57.29578;
  float poleFade = smoothstep(0.0, 0.3, cos(lat * 0.01745));
  float near = smoothstep(0.35, 0.7, uFan);
  float g30 = gridAA(lat, 30.0) + gridAA(lon, 30.0) * poleFade;
  float g10 = (gridAA(lat, 10.0) + gridAA(lon, 10.0) * poleFade) * near;
  col += uGrat * (g30 * 1.0 + g10 * 0.45) * uGratAlpha * (0.6 + 0.8 * lit) * 3.2;
  col += waveGlow(n) * 0.45;
  col += uShockHot * revealRing(n) * 0.8;
  gl_FragColor = vec4(col, 1.0);
}`;

const DOT_VERT = /* glsl */ `
${GLSL_CONSTANTS}
${GLSL_HASH}
${GLSL_WAVES}
${GLSL_WAVE_GLOW}
${GLSL_REVEAL}
uniform float uDotR;
uniform float uPxScale;
uniform float uProjScale;
uniform vec3 uSunDir;
uniform vec3 uLand;
uniform vec3 uLandNight;
uniform vec3 uLights;
uniform float uLandA;      // land alpha on the day side
uniform float uLandNightA; // and on the night side
uniform float uLightsA;
uniform float uTermW;
uniform float uNightLights;
uniform float uTerminator;
uniform float uReduced;
in vec3 aDir;
in vec3 aInfo;   // x = land coverage (0 ocean, 1 land), y = city light, z = tone
out vec2 vUv;
out vec4 vCol;
void main() {
  vec3 B = aDir;
  // Boot reveal: dots beyond the wave's front are not drawn.
  if (revealMask(B) < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); vUv = vec2(0.0); return; }
  vec3 sun = uTerminator > 0.5 ? uSunDir : normalize(cameraPosition);
  float mu = dot(B, sun);
  float day = smoothstep(-sin(uTermW), sin(uTermW), mu);
  float land = aInfo.x;
  float tone = aInfo.z;
  vec3 E = normalize(vec3(B.z, 0.0, -B.x) + vec3(1e-6, 0.0, 0.0));
  vec3 N = cross(B, E);
  // Radius: land dots fill the lattice, ocean dots are tiny specks. Light makes dots swell a little.
  float lightBoost = aInfo.y * (1.0 - day) * uNightLights;
  float r = uDotR * mix(0.22, 1.0, land) * (0.85 + 0.3 * tone * land) * (1.0 + 0.55 * lightBoost);
  // Keep dots at least ~0.9 px radius when far away.
  float camD = max(length(cameraPosition - B), 1e-3);
  float minR = 0.9 * uPxScale * camD / uProjScale;
  r = max(r, minR * (0.4 + 0.6 * land));
  vec3 P = normalize(B + (E * position.x + N * position.y) * r) * 1.0014;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
  vUv = position.xy;

  // Travelling shimmer and a scan band sweeping from south to north.
  float shim = 0.82 + 0.18 * sin(uTime * 0.7 + dot(B, vec3(23.1, 41.7, 17.3)));
  float scanLat = mod(uTime * 0.045, 1.0) * 3.4 - 1.7;
  float scan = exp(-pow((B.y - scanLat) / 0.05, 2.0)) * 0.55 * (1.0 - 0.6 * uReduced);
  vec3 lit = mix(uLandNight * uLandNightA, uLand * uLandA, day) * (0.82 + 0.36 * tone) * 2.1;
  vec3 col = lit * shim * mix(0.1, 1.0, land);
  col += uLand * scan * land * (0.3 + 0.5 * day);
  col += uLights * aInfo.y * (1.0 - day) * 4.2 * uNightLights * land * (uLightsA / 0.3);
  col += waveGlow(B) * 2.4 * land;
  vCol = vec4(col, 1.0);
}`;

const DOT_FRAG = /* glsl */ `
in vec2 vUv;
in vec4 vCol;
void main() {
  float d = length(vUv);
  float w = fwidth(d) * 1.1;
  float a = 1.0 - smoothstep(1.0 - w - 0.12, 1.0, d);
  if (a <= 0.004) discard;
  float core = 1.0 + 0.35 * (1.0 - smoothstep(0.0, 0.6, d));
  gl_FragColor = vec4(vCol.rgb * a * core, 1.0);
}`;

export class DotMatrixBody implements GlobeBody {
  readonly group = new THREE.Group();
  private readonly bodyMat: THREE.ShaderMaterial;
  private readonly bodyMesh: THREE.Mesh;
  private dotMat: THREE.ShaderMaterial;
  private dotGeo: THREE.InstancedBufferGeometry | null = null;
  private dotMesh: THREE.Mesh | null = null;
  private built = false;
  private boundVersion = -1;
  private readonly lattice: number;

  constructor(
    private readonly assets: AssetStore,
    u: SharedUniforms,
    tokens: GlobeTokens,
    lattice: number,
    segments: number,
  ) {
    this.lattice = lattice;
    this.bodyMat = new THREE.ShaderMaterial({
      vertexShader: BODY_VERT,
      fragmentShader: BODY_FRAG,
      uniforms: {
        uOcean: { value: new THREE.Color() },
        uOceanLit: { value: new THREE.Color() },
        uGrat: { value: new THREE.Color() },
        uGratAlpha: { value: 0.055 },
        uTermW: { value: 0.22 },
        uFan: u.uFan,
        uShock: u.uShock,
        uShockHot: u.uShockHot,
        uSunDir: u.uSunDir,
        uTime: u.uTime,
        uWave: u.uWave,
        uWaveP: u.uWaveP,
        uReveal: u.uReveal,
        uRevealPx: u.uRevealPx,
        uTerminator: u.uTerminator,
      },
      depthWrite: true,
    });
    this.bodyMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, segments, Math.round(segments * 0.75)),
      this.bodyMat,
    );
    this.bodyMesh.renderOrder = 1;
    this.bodyMesh.frustumCulled = false;
    this.group.add(this.bodyMesh);

    this.dotMat = new THREE.ShaderMaterial({
      vertexShader: DOT_VERT,
      fragmentShader: DOT_FRAG,
      uniforms: {
        uTime: u.uTime,
        uDotR: { value: 0.0032 },
        uPxScale: u.uPxScale,
        uProjScale: u.uProjScale,
        uSunDir: u.uSunDir,
        uLand: { value: new THREE.Color() },
        uLandNight: { value: new THREE.Color() },
        uLights: { value: new THREE.Color() },
        uLandA: { value: 0.78 },
        uLandNightA: { value: 0.46 },
        uLightsA: { value: 0.3 },
        uTermW: { value: 0.22 },
        uShock: u.uShock,
        uShockHot: u.uShockHot,
        uNightLights: u.uNightLights,
        uTerminator: u.uTerminator,
        uReduced: u.uReduced,
        uWave: u.uWave,
        uWaveP: u.uWaveP,
        uReveal: u.uReveal,
        uRevealPx: u.uRevealPx,
      },
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      // Additive light never touches alpha: the moon's exempt mask (see post.ts) lives there.
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      depthWrite: false,
      depthTest: true,
    });
    this.setTokens(tokens);
  }

  setTokens(t: GlobeTokens): void {
    const b = this.bodyMat.uniforms;
    b.uOcean!.value.set(t.ocean);
    b.uOceanLit!.value.set(t.oceanLit);
    b.uGrat!.value.set(t.graticule);
    b.uGratAlpha!.value = t.graticuleAlpha;
    b.uTermW!.value = t.terminatorWidth;
    const d = this.dotMat.uniforms;
    d.uLand!.value.set(t.land);
    d.uLandNight!.value.set(t.landNight);
    d.uLights!.value.set(t.lights);
    d.uLandA!.value = t.landAlphaDay;
    d.uLandNightA!.value = t.landAlphaNight;
    d.uLightsA!.value = t.lightsAlpha;
    d.uTermW!.value = t.terminatorWidth;
  }

  /** Builds the dot lattice once the land mask (and night map) are available. */
  private build(): void {
    const a = this.assets;
    if (!a.maskData) return;
    const N = this.lattice;
    const night = a.nightImg ? readPixels(a.nightImg, 2048, 1024) : null;
    const day = a.dayImg ? readPixels(a.dayImg, 1024, 512) : null;
    const dirs: number[] = [];
    const infos: number[] = [];
    const spacing = Math.sqrt((4 * Math.PI) / N);
    for (let i = 0; i < N; i++) {
      const y = 1 - (2 * (i + 0.5)) / N;
      const r = Math.sqrt(1 - y * y);
      const th = i * GOLDEN_ANGLE;
      const x = Math.sin(th) * r;
      const z = Math.cos(th) * r;
      const lat = Math.asin(y) * 57.29578;
      const lon = Math.atan2(x, z) * 57.29578;
      const cov = a.landAt(lat, lon) / 255;
      const isLand = cov > 0.45;
      if (!isLand && hash01(i * 7919 + 13) > 0.16) continue; // sparse ocean specks
      let light = 0;
      let tone = 0.5;
      if (night) {
        const px = Math.min(2047, Math.max(0, Math.floor(((lon + 180) / 360) * 2048)));
        const py = Math.min(1023, Math.max(0, Math.floor(((90 - lat) / 180) * 1024)));
        const o = (py * 2048 + px) * 4;
        const lum = (night[o]! * 0.2126 + night[o + 1]! * 0.7152 + night[o + 2]! * 0.0722) / 255;
        light = Math.min(1, Math.max(0, (lum - 0.1) * 2.4));
      }
      if (day && isLand) {
        const px = Math.min(1023, Math.max(0, Math.floor(((lon + 180) / 360) * 1024)));
        const py = Math.min(511, Math.max(0, Math.floor(((90 - lat) / 180) * 512)));
        const o = (py * 1024 + px) * 4;
        const lum = (day[o]! * 0.2126 + day[o + 1]! * 0.7152 + day[o + 2]! * 0.0722) / 255;
        tone = Math.min(1, Math.max(0, lum * 1.5));
      }
      dirs.push(x, y, z);
      infos.push(isLand ? 1 : 0, light, tone);
    }
    const count = dirs.length / 3;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
    );
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('aDir', new THREE.InstancedBufferAttribute(new Float32Array(dirs), 3));
    geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(new Float32Array(infos), 3));
    geo.instanceCount = count;
    this.dotGeo?.dispose();
    this.dotGeo = geo;
    this.dotMat.uniforms.uDotR!.value = spacing * 0.36;
    if (!this.dotMesh) {
      this.dotMesh = new THREE.Mesh(geo, this.dotMat);
      this.dotMesh.frustumCulled = false;
      this.dotMesh.renderOrder = 2;
      this.group.add(this.dotMesh);
    } else {
      this.dotMesh.geometry = geo;
    }
    this.built = true;
  }

  update(_time: number): void {
    if (this.boundVersion !== this.assets.version) {
      this.boundVersion = this.assets.version;
      // Rebuild when the mask arrives, and again when the night map arrives (city lights).
      if (this.assets.maskData && (!this.built || (this.assets.loaded.night && !this.nightBuilt))) {
        this.build();
        this.nightBuilt = this.assets.loaded.night;
      }
    }
  }
  private nightBuilt = false;

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  dispose(): void {
    this.bodyMat.dispose();
    this.bodyMesh.geometry.dispose();
    this.dotMat.dispose();
    this.dotGeo?.dispose();
  }
}

export { TAU };
