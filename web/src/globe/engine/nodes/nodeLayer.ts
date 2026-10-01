// Node layer: every node is one instance of a camera-facing quad, drawn additively.
// Positions come from a float texture written by the layout step, so arcs, rings and packets can
// fetch the very same (fanned, extruded) position by slot index on the GPU.

import * as THREE from 'three';
import { GLSL_CONSTANTS, GLSL_REVEAL, GLSL_WAVES } from '../shaders/chunks';
import type { SharedUniforms } from '../uniforms';
import { NodeStore } from './store';

const VERT = /* glsl */ `
${GLSL_CONSTANTS}
${GLSL_WAVES}
${GLSL_REVEAL}
uniform sampler2D uPosTex;
uniform vec2 uViewport;
uniform float uPxScale;
uniform float uProjScale;
uniform float uNodeScale;
uniform float uNodeWorld;
uniform float uFocus;
uniform float uFocusAlpha;
uniform float uDimAlpha;
uniform float uHaloAlpha;
uniform float uZoomGain;
uniform float uFan;
uniform float uFilterT;
uniform float uReduced;
uniform vec3 uSize;
uniform vec3 uTierColor[4];
uniform vec3 uAccent;
uniform vec3 uWatch;
uniform vec3 uAlert;
uniform vec3 uOff;
uniform vec3 uRisk;
in vec4 aAttr;   // tier, status, flags, state bits
in vec2 aTime;   // birth, death start (engine seconds)
in vec2 aFlash;  // flash start, amplitude
out vec2 vCorner;
out vec4 vColor;   // rgb tint, a = opacity
out vec4 vP;       // x = 1 / quad scale, y = selected, z = watched, w = hovered
out vec4 vF;       // x = arcane, y = hasApps, z = flash amplitude, w = flash age
out vec4 vS;       // x = status, y = tier, z = ring amount (Z2 and up), w = seed
out vec4 vR;       // x = related (focus set), y = paid, z = aimed, w = at risk
out float vPack;

float easeOutBack(float t) {
  const float c1 = 1.70158;
  const float c3 = c1 + 1.0;
  float x = t - 1.0;
  return 1.0 + c3 * x * x * x + c1 * x * x;
}

void main() {
  int slot = gl_InstanceID;
  vec4 pp = texelFetch(uPosTex, ivec2(slot & 255, slot >> 8), 0);
  float stackDim = pp.w;
  if (stackDim <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec4(0.0); return; }

  int tier = int(aAttr.x + 0.5);
  int status = int(aAttr.y + 0.5);
  int flags = int(aAttr.z + 0.5);
  int st = int(aAttr.w + 0.5);
  bool hovered = (st & 1) != 0;
  bool selected = (st & 2) != 0;
  bool watched = (st & 4) != 0;
  bool dimNow = (st & 8) != 0;
  bool dimPrev = (st & 16) != 0;
  bool related = (st & 32) != 0;
  bool paid = (st & 64) != 0;
  bool aimed = (st & 128) != 0;
  float seed = fract(sin(float(slot) * 12.9898) * 43758.5453);

  // Life cycle: spawn with a little overshoot, fade and shrink when leaving.
  float age = uTime - aTime.x;
  float spawn = clamp(age / 0.9, 0.0, 1.0);
  float grow = spawn < 1.0 ? easeOutBack(spawn) : 1.0;
  float ignite = age < 3.0 ? exp(-age * 2.4) : 0.0;
  float dage = uTime - aTime.y;
  float vanish = dage > 0.0 ? 1.0 - smoothstep(0.0, 2.0, dage) : 1.0;
  if (grow <= 0.001 || vanish <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec4(0.0); return; }
  float leaving = dage > 0.0 ? 1.0 : 0.0;

  vec3 P = pp.xyz;
  // Boot reveal: nodes beyond the wave's front are not drawn.
  if (revealMask(normalize(P)) < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec4(0.0); return; }
  vec3 tint = uTierColor[tier];
  bool belt = length(P) > 1.25;
  if (belt) tint = mix(tint, vec3(0.55, 0.65, 0.85), 0.65);
  float bright = 1.0;
  float breathe = 1.0;
  if (status == 2) { bright = 0.7; breathe = 1.0 + 0.04 * (1.0 + sin(uTime * 1.96 + seed * 6.283)) * (1.0 - uReduced); }
  else if (status == 3) { tint = mix(tint, vec3(dot(tint, vec3(0.3333))), 0.4); bright = 0.55; }
  else if (status == 4) { bright = 0.4; }
  else if (status == 5) { bright = 0.75; }
  else if (status == 0) { tint = mix(tint, uOff, 0.7); bright = 0.5; }
  // A node that left dims toward the 'off' grey as it fades.
  tint = mix(tint, uOff, leaving * 0.85);

  float dimAmt = mix(dimPrev ? 1.0 : 0.0, dimNow ? 1.0 : 0.0, uFilterT);
  float focusDim = uFocus * ((related || selected || paid) ? 0.0 : 1.0);
  float vis = mix(1.0, uDimAlpha, dimAmt) * mix(1.0, uFocusAlpha, focusDim);

  // Flash (heartbeats, payouts, pulses) and block shockwave passing over the node.
  float fage = uTime - aFlash.x;
  float flashAmp = (fage >= 0.0 && fage < 3.0) ? aFlash.y * exp(-fage * 2.4) : 0.0;
  float wv = waveLift(normalize(P)) * (1.0 - 0.5 * uReduced);
  float aimPulse = aimed ? 0.22 + 0.12 * sin(uTime * 2.6 + seed * 6.283) * (1.0 - uReduced) : 0.0;
  float pulse = flashAmp + wv * 0.35 + ignite * 0.9 + (paid ? 0.4 : 0.0) + aimPulse;

  float tierSize = 2.5 * (tier == 3 ? uSize.z : (tier == 2 ? uSize.y : uSize.x));
  float base = tierSize * uNodeScale * uPxScale * mix(1.0, 0.6, uFan);
  vec4 clip = projectionMatrix * viewMatrix * vec4(P, 1.0);
  float w = max(clip.w, 1e-4);
  float worldPx = uNodeWorld * (0.9 + 0.2 * float(tier)) * 2.0 * uProjScale / w;
  float core = max(base, min(worldPx, base * 7.0));
  core *= mix(0.7, 1.0, sqrt(stackDim)) * (belt ? 0.6 : 1.0);
  core *= grow * (0.45 + 0.55 * vanish) * breathe;
  core *= 1.0 + 0.55 * flashAmp + 0.45 * ignite + (hovered ? 0.4 : 0.0) + (selected ? 0.6 : 0.0) + wv * 0.35;

  float ringy = (selected || watched || hovered || status == 4 || status == 5) ? 1.0 : 0.0;
  float ringAmt = smoothstep(0.55, 0.85, uFan) * smoothstep(0.35, 0.8, stackDim);
  float quadScale = 1.0 + 1.25 * max(ringy, min(1.0, flashAmp * 1.5 + ignite * 0.6 + (related ? 0.7 : 0.0))) + 0.9 * ringAmt * float(tier >= 2);
  float HALO = 4.0 * quadScale;
  float halfPx = core * 0.5 * HALO;
  vec2 off = position.xy * halfPx * 2.0 / uViewport;
  gl_Position = clip;
  gl_Position.xy += off * clip.w;

  vCorner = position.xy;
  // Stacked nodes are dim on their own; events add absolute light so a blip inside a stack still shows.
  float b = bright * vis * (stackDim * uZoomGain + pulse * (0.55 + 0.45 * stackDim));
  vColor = vec4(tint * b, 1.0);
  vP = vec4(1.0 / HALO, selected ? 1.0 : 0.0, watched ? 1.0 : 0.0, hovered ? 1.0 : 0.0);
  vF = vec4((flags & 16) != 0 ? 1.0 : 0.0, (flags & 1) != 0 ? 1.0 : 0.0, flashAmp, fage);
  vS = vec4(float(status), float(tier), ringAmt * vis, seed);
  vR = vec4((related ? 1.0 : 0.0) * uFocus, paid ? 1.0 : 0.0, aimed ? 1.0 : 0.0, status == 5 ? 1.0 : 0.0);
  vPack = uFan * stackDim;
  // Keep selected/watched markers readable even when everything else is dimmed.
  if (selected || watched) vColor.rgb = max(vColor.rgb, tint * 0.7);
}`;

const FRAG = /* glsl */ `
${GLSL_CONSTANTS}
uniform float uTime;
uniform float uHaloAlpha;
uniform float uReduced;
uniform vec3 uAccent;
uniform vec3 uWatch;
uniform vec3 uHover;
uniform vec3 uAlert;
uniform vec3 uRisk;
in vec2 vCorner;
in vec4 vColor;
in vec4 vP;
in vec4 vF;
in vec4 vS;
in vec4 vR;
in float vPack;

float ringAt(float q, float radius, float width) {
  float d = (q - radius) / width;
  return exp(-d * d);
}

void main() {
  float r = length(vCorner);
  if (r >= 1.0) discard;
  float q = r / vP.x;                      // distance in core radii
  float edge = 1.0 - smoothstep(0.55, 1.0, r);
  float status = vS.x;
  bool started = status > 1.5 && status < 2.5;
  bool unreachable = status > 2.5 && status < 3.5;
  bool dos = status > 3.5 && status < 4.5;

  float disc = 1.0 - smoothstep(0.86, 1.08, q);
  // Started nodes are a hollow ring, not a solid core.
  float core = started ? disc * smoothstep(0.42, 0.62, q) : disc;
  float packed = vPack;
  float inner = exp(-q * q * 0.32) * mix(1.0, 0.7, packed) * (started ? 0.5 : 1.0);
  float halo = exp(-q * 0.7) * (uHaloAlpha * 0.27) * edge * mix(1.0, 0.25, packed) * ((unreachable || dos) ? 0.0 : (started ? 0.5 : 1.0));

  vec3 tint = vColor.rgb;
  float lum = max(tint.r, max(tint.g, tint.b));
  vec3 hot = mix(tint, vec3(lum), vF.y > 0.5 ? 0.6 : 0.4);
  vec3 col = hot * core * (started ? 1.3 : 1.7) + tint * inner * 0.46 + tint * halo;

  // Tier rings for colour-blind readers (Z2 and up): Nimbus one ring, Stratus two.
  float tier = vS.y;
  if (vS.z > 0.01 && tier > 1.5) {
    float ra = ringAt(q, 1.9, 0.09) * 0.55;
    if (tier > 2.5) ra += ringAt(q, 2.7, 0.09) * 0.30;
    col += tint * ra * vS.z * 1.0;
  }

  // Flash ring: an expanding echo when something just happened at this node.
  if (vF.z > 0.01) {
    float fr = 1.2 + vF.w * 3.4;
    col += tint * ringAt(q, fr, 0.22) * vF.z * 1.6 * max(0.0, 1.0 - vF.w * 0.9);
  }
  // ArcaneOS: a thin second orbit.
  if (vF.x > 0.5) col += tint * ringAt(q, 1.5, 0.085) * 0.5;

  // DoS listed: a crit cross at 1.4x core.
  if (dos) {
    vec2 p = vCorner / vP.x;
    float arm = max(exp(-abs(p.x + p.y) * 7.0), exp(-abs(p.x - p.y) * 7.0));
    col += uAlert * arm * (1.0 - smoothstep(1.2, 1.5, q)) * 1.5;
  }
  // At risk: a hollow ring in the risk color at 1.7x core, breathing over 1.6 s.
  if (vR.w > 0.5) {
    float br = 1.0 + 0.08 * sin(uTime * 3.93) * (1.0 - uReduced);
    col += uRisk * ringAt(q, 1.7 * br, 0.1) * 1.4;
  }

  vec3 ringCol = vec3(0.0);
  if (vP.w > 0.5) ringCol += uHover * ringAt(q, 2.0, 0.14) * 0.9;
  if (vP.y > 0.5) {
    // Selection: white-hot centre and a crisp rim in the selection color.
    ringCol += uAccent * (ringAt(q, 1.6, 0.11) * 1.6 + exp(-q * q * 0.5) * 0.35);
  }
  if (vP.z > 0.5) {
    float a = atan(vCorner.y + 1e-5, vCorner.x + 1e-5);
    float dash = smoothstep(0.1, 0.45, sin(a * 6.0 + uTime * 0.9 * (1.0 - uReduced)));
    ringCol += uWatch * ringAt(q, 2.6, 0.14) * dash * 1.2;
  }
  col += ringCol * edge;

  // Focus-set members (app constellation, peers): a slow four-point glint.
  if (vR.x > 0.05) {
    vec2 p = vCorner / vP.x;
    float tw = 0.7 + 0.3 * sin(uTime * 1.3 + vS.w * 6.283) * (1.0 - uReduced);
    float g = exp(-abs(p.x) * 1.2 - abs(p.y) * 9.0) + exp(-abs(p.y) * 1.2 - abs(p.x) * 9.0);
    col += mix(tint, vec3(lum), 0.5) * g * vR.x * tw * 0.9;
    col += tint * vR.x * 0.25 * inner;
  }
  gl_FragColor = vec4(col * vColor.a, 1.0);
}`;

const POS_W = 256;

export class NodeLayer {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly geometry: THREE.InstancedBufferGeometry;
  private posTex!: THREE.DataTexture;
  private attrBuf!: THREE.InstancedBufferAttribute;
  private timeBuf!: THREE.InstancedBufferAttribute;
  private flashBuf!: THREE.InstancedBufferAttribute;
  private attrData!: Uint8Array;
  private timeData!: Float32Array;
  private capVersion = -1;
  readonly nodeWorld = { value: 0.002 };

  constructor(
    private readonly store: NodeStore,
    private readonly u: SharedUniforms,
  ) {
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
    );
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uPosTex: { value: null },
        uTime: u.uTime,
        uViewport: u.uViewport,
        uPxScale: u.uPxScale,
        uProjScale: u.uProjScale,
        uNodeScale: u.uNodeScale,
        uNodeWorld: this.nodeWorld,
        uFocus: u.uFocus,
        uFocusAlpha: u.uFocusAlpha,
        uDimAlpha: u.uDimAlpha,
        uHaloAlpha: u.uHaloAlpha,
        uZoomGain: u.uZoomGain,
        uSize: u.uSize,
        uHover: u.uHover,
        uOff: u.uOff,
        uRisk: u.uRisk,
        uFan: u.uFan,
        uFilterT: u.uFilterT,
        uReduced: u.uReduced,
        uTierColor: u.uTierColor,
        uAccent: u.uAccent,
        uWatch: u.uWatch,
        uAlert: u.uAlert,
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
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.allocateGpu();
  }

  get positionTexture(): THREE.DataTexture {
    return this.posTex;
  }

  /** (Re)allocates GPU-side arrays to match the store's capacity. */
  private allocateGpu(): void {
    const cap = this.store.capacity;
    this.capVersion = this.store.capacityVersion;
    const rows = Math.ceil(cap / POS_W);
    this.posTex?.dispose();
    this.posTex = new THREE.DataTexture(this.store.pos, POS_W, rows, THREE.RGBAFormat, THREE.FloatType);
    this.posTex.minFilter = THREE.NearestFilter;
    this.posTex.magFilter = THREE.NearestFilter;
    this.posTex.generateMipmaps = false;
    this.posTex.needsUpdate = true;
    this.posTex.name = 'node-pos';
    this.material.uniforms.uPosTex!.value = this.posTex;
    this.u.uPosTex.value = this.posTex;

    this.attrData = new Uint8Array(cap * 4);
    this.timeData = new Float32Array(cap * 2);
    this.attrBuf = new THREE.InstancedBufferAttribute(this.attrData, 4, false);
    this.timeBuf = new THREE.InstancedBufferAttribute(this.timeData, 2);
    this.flashBuf = new THREE.InstancedBufferAttribute(this.store.flash, 2);
    this.attrBuf.setUsage(THREE.DynamicDrawUsage);
    this.timeBuf.setUsage(THREE.DynamicDrawUsage);
    this.flashBuf.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aAttr', this.attrBuf);
    this.geometry.setAttribute('aTime', this.timeBuf);
    this.geometry.setAttribute('aFlash', this.flashBuf);
    // Everything is dirty after a reallocation.
    this.store.markAttr(0);
    this.store.markAttr(cap - 1);
    this.store.markTime(0);
    this.store.markTime(cap - 1);
    this.store.markFlash(0);
    this.store.markFlash(cap - 1);
    this.store.posDirty = true;
  }

  /** Copies dirty CPU state into the GPU attributes and uploads the position texture. */
  sync(): void {
    const s = this.store;
    if (this.capVersion !== s.capacityVersion) this.allocateGpu();

    let r = s.attrDirty;
    if (r.hi >= r.lo) {
      const hi = Math.min(r.hi, s.capacity - 1);
      for (let i = Math.max(0, r.lo); i <= hi; i++) {
        const o = i * 4;
        this.attrData[o] = s.tier[i]!;
        this.attrData[o + 1] = s.status[i]!;
        this.attrData[o + 2] = s.flags[i]!;
        this.attrData[o + 3] = s.state[i]!;
      }
      this.attrBuf.clearUpdateRanges();
      this.attrBuf.addUpdateRange(Math.max(0, r.lo) * 4, (hi - Math.max(0, r.lo) + 1) * 4);
      this.attrBuf.needsUpdate = true;
      NodeStore.clear(r);
    }
    r = s.timeDirty;
    if (r.hi >= r.lo) {
      const hi = Math.min(r.hi, s.capacity - 1);
      for (let i = Math.max(0, r.lo); i <= hi; i++) {
        this.timeData[i * 2] = s.birth[i]!;
        this.timeData[i * 2 + 1] = s.death[i]!;
      }
      this.timeBuf.clearUpdateRanges();
      this.timeBuf.addUpdateRange(Math.max(0, r.lo) * 2, (hi - Math.max(0, r.lo) + 1) * 2);
      this.timeBuf.needsUpdate = true;
      NodeStore.clear(r);
    }
    r = s.flashDirty;
    if (r.hi >= r.lo) {
      const hi = Math.min(r.hi, s.capacity - 1);
      this.flashBuf.clearUpdateRanges();
      this.flashBuf.addUpdateRange(Math.max(0, r.lo) * 2, (hi - Math.max(0, r.lo) + 1) * 2);
      this.flashBuf.needsUpdate = true;
      NodeStore.clear(r);
    }
    if (s.posDirty) {
      this.posTex.needsUpdate = true;
      s.posDirty = false;
    }
    this.geometry.instanceCount = s.high;
    this.mesh.visible = s.high > 0;
  }

  dispose(): void {
    this.posTex.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
