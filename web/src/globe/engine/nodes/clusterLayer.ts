// Cluster layer: one glowing spire per co-location cluster (datacenter hub), drawn as a
// screen-space ribbon standing on the surface, plus a soft ground pad. Height follows the live
// count. As the camera approaches, the column erodes from the bottom (the lowest-ranked nodes peel
// off first) while the pad widens to hold the fanned-out nodes.

import * as THREE from 'three';
import { GLSL_CONSTANTS, GLSL_REVEAL, GLSL_WAVES } from '../shaders/chunks';
import type { SharedUniforms } from '../uniforms';
import type { NodeStore } from './store';

const VERT = /* glsl */ `
${GLSL_CONSTANTS}
${GLSL_WAVES}
${GLSL_REVEAL}
uniform vec2 uViewport;
uniform float uPxScale;
uniform float uProjScale;
uniform float uFan;
uniform float uSpacing;
uniform float uFocus;
uniform float uFocusAlpha;
uniform float uSpireScale;
uniform vec3 uTierColor[4];
in vec4 aDir;    // unit vector, displayed height
in vec4 aMix;    // tier fractions (c, n, s), live count
in vec4 aInfo;   // x = selected (1) / other (0), y = span, z = pass fraction, w = seed
out vec2 vUv;
out vec4 vColor;
out vec4 vP;     // x = part, y = length in px, z = height fraction of the visible segment, w = seed
out vec4 vSeg;   // x = position along the full column (0 base .. 1 top), y = gap in column units, z = stratus share, w = stratus + nimbus share
out vec3 vMixC;  // tier fractions

void main() {
  vec3 B = aDir.xyz;
  // Boot reveal: hubs beyond the wave's front are not drawn.
  if (revealMask(B) < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec4(0.0); vUv = vec2(0.0); return; }
  float H = aDir.w;
  float n = aMix.w;
  float part = position.z;
  float sel = aInfo.x;
  float dimF = uFocus * (1.0 - sel);
  float passF = aInfo.z;
  float fanK = uFan;
  // Column: visible from yb (eroding) to the top.
  float yb = clamp((fanK - 0.225) / 0.55, 0.0, 1.0);
  vec3 tint = aMix.x * uTierColor[1] + aMix.y * uTierColor[2] + aMix.z * uTierColor[3];
  tint = mix(tint, vec3(max(tint.r, max(tint.g, tint.b))), 0.12);
  // Width: 1.6px for small hubs, up to about 4px for the biggest, a little more as the camera comes in.
  float widthPx = (1.35 + 0.27 * log2(max(n, 1.0))) * (1.0 + 0.6 * fanK) * uPxScale;
  float vis = mix(1.0, uFocusAlpha, dimF) * mix(0.35, 1.0, passF);
  float seed = aInfo.w;

  if (part < 0.5) {
    // Column ribbon
    vec3 P0 = B * (1.0 + 0.0012 + H * yb);
    vec3 P1 = B * (1.0 + 0.0012 + H);
    vec4 c0 = projectionMatrix * viewMatrix * vec4(P0, 1.0);
    vec4 c1 = projectionMatrix * viewMatrix * vec4(P1, 1.0);
    if (c0.w <= 0.01 || c1.w <= 0.01 || H * (1.0 - yb) < 0.0008) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec4(0.0); return; }
    vec2 n0 = c0.xy / c0.w;
    vec2 n1 = c1.xy / c1.w;
    vec2 d = (n1 - n0) * uViewport * 0.5;
    float len = length(d);
    vec2 t = len > 0.001 ? d / len : vec2(0.0, 1.0);
    vec2 perp = vec2(-t.y, t.x);
    float y = position.y;
    vec4 c = mix(c0, c1, y);
    float capPx = widthPx * 1.6;
    vec2 offPx = perp * position.x * widthPx + t * (y > 0.5 ? capPx * 0.5 : -capPx * 0.0);
    c.xy += offPx * 2.0 / uViewport * c.w;
    gl_Position = c;
    vUv = vec2(position.x, y);
    float hv = H * (1.0 - yb);
    vColor = vec4(tint * vis * (1.0 + 0.9 * sel), 1.0);
    vP = vec4(0.0, len, hv, seed);
    // Segment lookup happens in the fragment shader along the full (uneroded) column.
    float fullLen = len / max(1.0 - yb, 0.05);
    vSeg = vec4(mix(yb, 1.0, y), min(0.2, 1.1 * uPxScale / max(fullLen, 6.0)), aMix.z, aMix.z + aMix.y);
    vMixC = aMix.xyz;
  } else {
    // Ground pad: a disc on the tangent plane.
    float sp = min(uSpacing, 0.02 / sqrt(max(aInfo.y, 1.0)));
    float discR = sqrt(max(aInfo.y, 1.0)) * sp * 1.15;
    float padStack = (0.0045 + 0.0026 * log2(max(n, 1.0)));
    float R = mix(padStack, max(discR, padStack * 0.8), smoothstep(0.0, 0.9, fanK));
    vec3 E = normalize(vec3(B.z, 0.0, -B.x) + vec3(1e-6, 0.0, 0.0));
    vec3 N = cross(B, E);
    vec3 P = normalize(B + (E * position.x + N * position.y) * R) * (1.0 + 0.0008);
    vec4 clip = projectionMatrix * viewMatrix * vec4(P, 1.0);
    gl_Position = clip;
    vUv = position.xy;
    float padAmt = mix(0.8, 0.2, smoothstep(0.0, 0.8, fanK));
    vColor = vec4(tint * vis * padAmt * (1.0 + 0.8 * sel), 1.0);
    vP = vec4(1.0, 0.0, 0.0, seed);
    vSeg = vec4(0.0);
    vMixC = aMix.xyz;
  }
}`;

const FRAG = /* glsl */ `
${GLSL_CONSTANTS}
uniform float uTime;
uniform vec3 uTierColor[4];
in vec2 vUv;
in vec4 vColor;
in vec4 vP;
in vec4 vSeg;
in vec3 vMixC;
void main() {
  vec3 tint = vColor.rgb;
  vec3 col;
  if (vP.x < 0.5) {
    float x = abs(vUv.x);
    float yy = vSeg.x;
    // Tier segments from the base: Stratus, then Nimbus, then Cumulus, 1px gaps between them.
    float b1 = vSeg.z;
    float b2 = vSeg.w;
    vec3 segCol = yy < b1 ? uTierColor[3] : (yy < b2 ? uTierColor[2] : uTierColor[1]);
    float gap = vSeg.y;
    float inGap = 0.0;
    if (b1 > 0.001 && b1 < 0.999) inGap = max(inGap, 1.0 - smoothstep(0.0, gap, abs(yy - b1)));
    if (b2 > b1 + 0.001 && b2 < 0.999) inGap = max(inGap, 1.0 - smoothstep(0.0, gap, abs(yy - b2)));
    // Colour follows the segment but keeps the hub's overall tint so tiny tiers do not flicker.
    vec3 body = mix(tint, segCol * max(tint.r, max(tint.g, tint.b)), 0.85);
    float y = vUv.y;
    float across = 1.0 - smoothstep(0.35, 1.0, x);
    float core = 1.0 - smoothstep(0.0, 0.55, x);
    float along = mix(1.0, 0.45, y);
    float cap = exp(-pow((1.0 - y) * 14.0, 2.0));
    vec3 hot = mix(body, vec3(max(body.r, max(body.g, body.b))), 0.6);
    col = body * across * along * 0.62 * (1.0 - 0.85 * inGap) + hot * core * along * 0.3 * (1.0 - inGap) + hot * cap * across * 1.25;
  } else {
    float r = length(vUv);
    if (r > 1.0) discard;
    float disc = exp(-r * r * 5.0);
    float ring = exp(-pow((r - 0.86) / 0.07, 2.0));
    col = tint * (disc * 0.5 + ring * 0.55);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class ClusterLayer {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private dirBuf!: THREE.InstancedBufferAttribute;
  private mixBuf!: THREE.InstancedBufferAttribute;
  private infoBuf!: THREE.InstancedBufferAttribute;
  private dirData!: Float32Array;
  private mixData!: Float32Array;
  private infoData!: Float32Array;
  private cap = 0;
  readonly spacing = { value: 0.004 };

  constructor(
    private readonly store: NodeStore,
    u: SharedUniforms,
  ) {
    // Part 0: column quad (x across -1..1, y along 0..1, z = 0). Part 1: pad quad (x,y in -1..1, z = 1).
    const pos = new Float32Array([
      -1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
    ]);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: u.uTime,
        uViewport: u.uViewport,
        uPxScale: u.uPxScale,
        uProjScale: u.uProjScale,
        uFan: u.uFan,
        uSpacing: this.spacing,
        uFocus: u.uFocus,
        uFocusAlpha: u.uFocusAlpha,
        uSpireScale: u.uSpireScale,
        uTierColor: u.uTierColor,
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
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 25;
    this.ensure(256);
  }

  private ensure(cap: number): void {
    if (cap <= this.cap) return;
    this.cap = cap;
    this.dirData = new Float32Array(cap * 4);
    this.mixData = new Float32Array(cap * 4);
    this.infoData = new Float32Array(cap * 4);
    this.dirBuf = new THREE.InstancedBufferAttribute(this.dirData, 4);
    this.mixBuf = new THREE.InstancedBufferAttribute(this.mixData, 4);
    this.infoBuf = new THREE.InstancedBufferAttribute(this.infoData, 4);
    for (const b of [this.dirBuf, this.mixBuf, this.infoBuf]) b.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aDir', this.dirBuf);
    this.geometry.setAttribute('aMix', this.mixBuf);
    this.geometry.setAttribute('aInfo', this.infoBuf);
  }

  /** Rebuilds per-cluster instance data from the store. Cheap: a few hundred to a few thousand clusters. */
  sync(selectedCluster: number, lit: ReadonlySet<number> | null = null): void {
    const s = this.store;
    if (s.clusterCount > this.cap) this.ensure(Math.max(this.cap * 2, s.clusterCount));
    let n = 0;
    for (let c = 0; c < s.clusterCount; c++) {
      const live = s.cLive[c]!;
      if (live < 2 || (s.cHeight[c]! < 0.002 && s.cPass[c]! < 2)) continue;
      const o = n * 4;
      this.dirData[o] = s.cDir[c * 3]!;
      this.dirData[o + 1] = s.cDir[c * 3 + 1]!;
      this.dirData[o + 2] = s.cDir[c * 3 + 2]!;
      this.dirData[o + 3] = s.cHeight[c]!;
      const tc = s.cTier[c * 3]! + s.cTier[c * 3 + 1]! + s.cTier[c * 3 + 2]! || 1;
      this.mixData[o] = s.cTier[c * 3]! / tc;
      this.mixData[o + 1] = s.cTier[c * 3 + 1]! / tc;
      this.mixData[o + 2] = s.cTier[c * 3 + 2]! / tc;
      this.mixData[o + 3] = live;
      // Hubs that hold a member of the active app constellation stand out almost like the selected one.
      this.infoData[o] = c === selectedCluster ? 1 : lit?.has(c) ? 0.8 : 0;
      this.infoData[o + 1] = s.cNext[c]!;
      this.infoData[o + 2] = s.cPass[c]! / live;
      this.infoData[o + 3] = (c * 0.61803) % 1;
      n++;
    }
    this.dirBuf.clearUpdateRanges();
    this.dirBuf.addUpdateRange(0, n * 4);
    this.dirBuf.needsUpdate = true;
    this.mixBuf.clearUpdateRanges();
    this.mixBuf.addUpdateRange(0, n * 4);
    this.mixBuf.needsUpdate = true;
    this.infoBuf.clearUpdateRanges();
    this.infoBuf.addUpdateRange(0, n * 4);
    this.infoBuf.needsUpdate = true;
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
