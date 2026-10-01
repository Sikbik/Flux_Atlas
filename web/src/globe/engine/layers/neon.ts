// Art direction "neon": wireframe. A near-black body with a hatched land fill, a 15 degree
// graticule, glowing coastlines and borders drawn as screen-space ribbons, and the terminator as a
// bright seam. The night side lights up brighter than the day side, as a vector display would.

import * as THREE from 'three';
import type { AssetStore } from '../assetstore';
import { GLSL_LENS } from '../lens';
import { DEG } from '../math';
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
${GLSL_LENS}
uniform sampler2D uMask;
uniform float uProjScale;
uniform float uPxScale;
uniform vec3 uOcean;
uniform vec3 uGrat;
uniform vec3 uLand;
uniform vec3 uTermCol;
uniform vec3 uSunDir;
uniform float uTerminator;
in vec3 vN;
in vec3 vWorld;

float gridAA(float x, float cell) {
  float g = abs(fract(x / cell - 0.5) - 0.5);
  float d = fwidth(g);
  return 1.0 - smoothstep(0.0, d * 1.25 + 1e-5, g);
}

void main() {
  vec3 n = normalize(vN);
  vec2 dx, dy;
  vec2 uv = dirToUvGrad(n, dx, dy);
  float land = textureGrad(uMask, uv, dx, dy).r;
  vec3 sun = uTerminator > 0.5 ? uSunDir : normalize(cameraPosition);
  float mu = dot(n, sun);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 2.4);
  float night = 1.0 - smoothstep(-0.05, 0.12, mu);

  // Up close the vector backdrop (hatch, graticule) steps back so it never crosses a marker (lens.ts).
  float L = lensZoom(length(cameraPosition - vWorld), uProjScale / max(uPxScale, 1e-4));
  vec3 col = uOcean;
  // Hatched land fill: diagonal scan lines in screen-stable spherical coordinates. Beyond the boot
  // reveal's front there is no land yet.
  float lat = asin(clamp(n.y, -1.0, 1.0)) * 57.29578;
  float lon = atan(n.x, n.z) * 57.29578;
  float hatch = gridAA(lat * 0.7 + lon * 0.7, 2.2);
  col += uLand * land * (0.035 + 0.05 * hatch) * (0.7 + 0.6 * night) * revealMask(n) * (1.0 - 0.6 * L);
  // Graticule
  float poleFade = smoothstep(0.0, 0.3, cos(lat * 0.01745));
  float g = gridAA(lat, 15.0) + gridAA(lon, 15.0) * poleFade;
  col += uGrat * g * (0.35 + 0.35 * night) * (1.0 - 0.6 * L);
  col += uGrat * gridAA(lat, 90.0) * 0.5 * (1.0 - 0.6 * L);
  // Terminator seam
  float seam = exp(-pow(mu / 0.012, 2.0)) * uTerminator;
  col += uTermCol * seam * 1.2;
  col += uTermCol * exp(-pow(mu / 0.06, 2.0)) * 0.06 * uTerminator;
  col += uGrat * fres * 0.9;
  col *= mix(1.0, 0.72, night * 0.0);
  col += waveGlow(n) * 0.8;
  col += uShockHot * revealRing(n) * 0.8;
  gl_FragColor = vec4(col, 1.0);
}`;

const LINE_VERT = /* glsl */ `
${GLSL_CONSTANTS}
${GLSL_HASH}
${GLSL_WAVES}
${GLSL_WAVE_GLOW}
${GLSL_REVEAL}
${GLSL_LENS}
uniform vec2 uViewport;
uniform float uPxScale;
uniform float uProjScale;
uniform vec3 uSunDir;
uniform float uTerminator;
uniform vec3 uCoast;
uniform vec3 uBorder;
in vec3 aA;
in vec3 aB;
in float aKind;
out vec2 vUv;
out vec3 vCol;
void main() {
  float y = position.y;
  vec3 a = aA * 1.0012;
  vec3 b = aB * 1.0012;
  // Boot reveal: coastlines and borders beyond the wave's front are not drawn.
  if (revealMask(normalize(a + b)) < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec3(0.0); vUv = vec2(0.0); return; }
  vec4 ca = projectionMatrix * viewMatrix * vec4(a, 1.0);
  vec4 cb = projectionMatrix * viewMatrix * vec4(b, 1.0);
  if (ca.w <= 0.01 || cb.w <= 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec3(0.0); return; }
  vec2 sa = ca.xy / ca.w * uViewport * 0.5;
  vec2 sb = cb.xy / cb.w * uViewport * 0.5;
  vec2 d = sb - sa;
  float len = length(d);
  vec2 t = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 perp = vec2(-t.y, t.x);
  float width = (aKind < 0.5 ? 1.25 : 0.8) * uPxScale;
  vec4 c = mix(ca, cb, position.x * 0.5 + 0.5);
  float cap = width * 0.5;
  vec2 offPx = perp * position.y * width * 0.5 + t * position.x * (len * 0.0 + cap);
  c.xy += offPx * 2.0 / uViewport * c.w;
  gl_Position = c;
  vUv = position.xy;
  vec3 mid = normalize(a + b);
  vec3 sun = uTerminator > 0.5 ? uSunDir : normalize(cameraPosition);
  float mu = dot(mid, sun);
  float night = 1.0 - smoothstep(-0.05, 0.15, mu);
  vec3 base = aKind < 0.5 ? uCoast : uBorder;
  float tw = 0.85 + 0.15 * sin(uTime * 1.3 + dot(mid, vec3(31.7, 17.3, 53.1)));
  // Coastlines and borders keep their line but give way to the markers as the camera comes down (a
  // cyan coastline is the very colour of a Cumulus marker), most of all at the focus point.
  float L = lensZoom(length(cameraPosition - mid), uProjScale / max(uPxScale, 1e-4));
  vCol = base * mix(0.55, 1.35, night) * tw * (1.0 - 0.6 * L) + waveGlow(mid) * 1.6;
}`;

const LINE_FRAG = /* glsl */ `
in vec2 vUv;
in vec3 vCol;
void main() {
  float a = 1.0 - smoothstep(0.35, 1.0, abs(vUv.y));
  gl_FragColor = vec4(vCol * a, 1.0);
}`;

export class NeonBody implements GlobeBody {
  readonly group = new THREE.Group();
  private readonly bodyMat: THREE.ShaderMaterial;
  private readonly bodyMesh: THREE.Mesh;
  private readonly lineMat: THREE.ShaderMaterial;
  private lineGeo: THREE.InstancedBufferGeometry | null = null;
  private lineMesh: THREE.Mesh | null = null;
  private boundVersion = -1;
  private built = false;

  constructor(
    private readonly assets: AssetStore,
    u: SharedUniforms,
    tokens: GlobeTokens,
    segments: number,
  ) {
    this.bodyMat = new THREE.ShaderMaterial({
      vertexShader: BODY_VERT,
      fragmentShader: BODY_FRAG,
      uniforms: {
        uMask: { value: assets.mask },
        uOcean: { value: new THREE.Color() },
        uGrat: { value: new THREE.Color() },
        uLand: { value: new THREE.Color() },
        uTermCol: { value: new THREE.Color() },
        uShock: u.uShock,
        uShockHot: u.uShockHot,
        uSunDir: u.uSunDir,
        uTime: u.uTime,
        uWave: u.uWave,
        uWaveP: u.uWaveP,
        uReveal: u.uReveal,
        uRevealPx: u.uRevealPx,
        uTerminator: u.uTerminator,
        uProjScale: u.uProjScale,
        uPxScale: u.uPxScale,
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

    this.lineMat = new THREE.ShaderMaterial({
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG,
      uniforms: {
        uTime: u.uTime,
        uViewport: u.uViewport,
        uPxScale: u.uPxScale,
        uSunDir: u.uSunDir,
        uTerminator: u.uTerminator,
        uCoast: { value: new THREE.Color() },
        uBorder: { value: new THREE.Color() },
        uProjScale: u.uProjScale,
        uShock: u.uShock,
        uShockHot: u.uShockHot,
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
      side: THREE.DoubleSide,
    });
    this.setTokens(tokens);
  }

  setTokens(t: GlobeTokens): void {
    const b = this.bodyMat.uniforms;
    b.uOcean!.value.set(t.ocean);
    b.uGrat!.value.set(t.graticule);
    b.uLand!.value.set(t.land);
    b.uTermCol!.value.set(t.terminator);
    const l = this.lineMat.uniforms;
    l.uCoast!.value.set(t.coast).multiplyScalar(1.5);
    l.uBorder!.value.set(t.land).multiplyScalar(0.55);
  }

  private build(): void {
    const br = this.assets.borders;
    if (!br) return;
    const coastN = br.coast.length / 4;
    const borderN = br.border.length / 4;
    const total = coastN + borderN;
    const a = new Float32Array(total * 3);
    const b = new Float32Array(total * 3);
    const kind = new Float32Array(total);
    const put = (src: Float32Array, n: number, off: number, k: number): void => {
      for (let i = 0; i < n; i++) {
        const la0 = src[i * 4]! * DEG;
        const lo0 = src[i * 4 + 1]! * DEG;
        const la1 = src[i * 4 + 2]! * DEG;
        const lo1 = src[i * 4 + 3]! * DEG;
        const o = (off + i) * 3;
        a[o] = Math.cos(la0) * Math.sin(lo0);
        a[o + 1] = Math.sin(la0);
        a[o + 2] = Math.cos(la0) * Math.cos(lo0);
        b[o] = Math.cos(la1) * Math.sin(lo1);
        b[o + 1] = Math.sin(la1);
        b[o + 2] = Math.cos(la1) * Math.cos(lo1);
        kind[off + i] = k;
      }
    };
    put(br.coast, coastN, 0, 0);
    put(br.border, borderN, coastN, 1);
    const geo = new THREE.InstancedBufferGeometry();
    // Quad: x along the segment (-1 = start, +1 = end), y across (-1..1).
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
    );
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('aA', new THREE.InstancedBufferAttribute(a, 3));
    geo.setAttribute('aB', new THREE.InstancedBufferAttribute(b, 3));
    geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 1));
    geo.instanceCount = total;
    this.lineGeo?.dispose();
    this.lineGeo = geo;
    if (!this.lineMesh) {
      this.lineMesh = new THREE.Mesh(geo, this.lineMat);
      this.lineMesh.frustumCulled = false;
      this.lineMesh.renderOrder = 3;
      this.group.add(this.lineMesh);
    } else this.lineMesh.geometry = geo;
    this.built = true;
  }

  update(_time: number): void {
    if (this.boundVersion !== this.assets.version) {
      this.boundVersion = this.assets.version;
      this.bodyMat.uniforms.uMask!.value = this.assets.mask;
      if (!this.built && this.assets.borders) this.build();
    }
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  dispose(): void {
    this.bodyMat.dispose();
    this.bodyMesh.geometry.dispose();
    this.lineMat.dispose();
    this.lineGeo?.dispose();
  }
}
