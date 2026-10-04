// Political lines: country borders in every look, and state and province lines once the camera is down.
//
// One instanced ribbon layer for both. Each segment is a screen-space ribbon between two points on the
// sphere (the same construction as the neon coastline), but the line is drawn by the look that is on:
//
//   neon   a vector-display line: Flux blue, a hairline with a faint glow, brighter on the night side
//   marble an engraved line: a pale thread with a soft dark groove beside it, like an etching on the stone
//   holo   a thread of dots on the matrix: the same pitch as the planet's lattice, merging into a
//          continuous line when the dots would be closer than a pixel
//
// Country borders (data/countries-*.json) are always there. State and province lines
// (data/admin1-lines.bin, borders.ts) have four detail levels that fade in by zoom; the file is fetched
// the first time the camera comes down and never on the low tier. Lines give way to the node markers as
// the lens closes in (lens.ts), fade at the limb where they would pile up, and are uniformly gentle:
// no flicker, no pulse. The block shockwave runs along them as it does along the coast.

import * as THREE from 'three';
import type { AssetStore } from '../assetstore';
import { ADMIN1_LEVELS, admin1Levels, GLSL_ADMIN1, wantsAdmin1 } from '../borders';
import { GLSL_LENS } from '../lens';
import { damp } from '../math';
import { GLSL_CONSTANTS, GLSL_REVEAL, GLSL_WAVE_GLOW, GLSL_WAVES } from '../shaders/chunks';
import type { GlobeTokens } from '../tokens';
import type { ArtDirection, BordersMode } from '../types';
import type { SharedUniforms } from '../uniforms';

/** The look a line is drawn in: 0 neon, 1 marble, 2 holo. */
const STYLE: Record<ArtDirection, 0 | 1 | 2> = { neon: 0, marble: 1, dotmatrix: 2 };

const VERT = /* glsl */ `
${GLSL_CONSTANTS}
${GLSL_WAVES}
${GLSL_WAVE_GLOW}
${GLSL_REVEAL}
${GLSL_LENS}
${GLSL_ADMIN1}
uniform vec2 uViewport;
uniform float uPxScale;
uniform float uProjScale;
uniform vec3 uSunDir;
uniform float uTerminator;
uniform float uCountries;
uniform float uStates;
in vec4 aGeo;
in vec2 aArc;
in float aLvl;
out vec2 vP;
out vec4 vSeg;
out vec4 vArc;
out vec4 vLook;
out vec3 vWave;

vec3 dirOf(float latDeg, float lonDeg) {
  float la = latDeg * 0.017453293;
  float lo = lonDeg * 0.017453293;
  return vec3(cos(la) * sin(lo), sin(la), cos(la) * cos(lo));
}
void hide() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vP = vec2(0.0); vSeg = vec4(0.0); vArc = vec4(0.0); vLook = vec4(0.0); vWave = vec3(0.0); }

void main() {
  float isState = step(-0.5, aLvl);
  float amt = mix(uCountries, uStates, isState);
  if (amt < 0.004) { hide(); return; }
  vec3 a = dirOf(aGeo.x, aGeo.y);
  vec3 b = dirOf(aGeo.z, aGeo.w);
  vec3 mid = normalize(a + b);
  // Boot reveal: lines beyond the wave's front are not drawn.
  if (revealMask(mid) < 0.02) { hide(); return; }
  // Just above the ground: far away the facets of the sphere need 0.0012 of clearance, up close almost
  // none, so a tilted close view does not float the lines off the land beneath them.
  float lift = 1.0 + clamp(0.0012 * length(cameraPosition - mid), 0.00004, 0.0012);
  vec3 pa = a * lift;
  vec3 pb = b * lift;
  vec3 pm = mid * lift;
  vec3 toCam = cameraPosition - pm;
  float dist = length(toCam);
  float facing = dot(mid, toCam / dist);
  // Behind the horizon, or so grazing that the lines would pile up into a bright hem at the limb.
  float limb = mix(smoothstep(0.02, 0.2, facing), smoothstep(0.07, 0.38, facing), isState);
  if (limb < 0.004) { hide(); return; }
  float pprCss = (uProjScale / max(uPxScale, 1e-4)) / dist;
  float vis = amt * limb;
  if (isState > 0.5) vis *= admin1Fade(aLvl, pprCss) * admin1Gain(aLvl);
  // Give way to the node markers as the camera comes down (the coastline does the same).
  float L = lensZoom(dist, uProjScale / max(uPxScale, 1e-4));
  vis *= 1.0 - mix(0.55, 0.7, isState) * L;
  if (vis < 0.004) { hide(); return; }

  vec4 ca = projectionMatrix * viewMatrix * vec4(pa, 1.0);
  vec4 cb = projectionMatrix * viewMatrix * vec4(pb, 1.0);
  if (ca.w <= 0.01 || cb.w <= 0.01) { hide(); return; }
  vec2 sa = ca.xy / ca.w * uViewport * 0.5;
  vec2 sb = cb.xy / cb.w * uViewport * 0.5;
  vec2 d = sb - sa;
  float len = length(d);
  vec2 t = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 perp = vec2(-t.y, t.x);
  float cap = 1.5 * uPxScale;
  float hw = (isState > 0.5 ? STATE_HALF : COUNTRY_HALF) * uPxScale;
  vec4 c = mix(ca, cb, position.x * 0.5 + 0.5);
  vec2 offPx = perp * position.y * hw + t * position.x * cap;
  c.xy += offPx * 2.0 / uViewport * c.w;
  gl_Position = c;

  vec3 sun = uTerminator > 0.5 ? uSunDir : normalize(cameraPosition);
  float mu = dot(mid, sun);
  float night = 1.0 - smoothstep(-0.05, 0.15, mu);
  vP = vec2((position.x * 0.5 + 0.5) * len + position.x * cap, position.y * hw);
  vSeg = vec4(len, cap, hw, uProjScale / dist);
  vArc = vec4(aArc, isState, aLvl);
  vLook = vec4(vis, night, mu, L);
  vWave = waveGlow(mid);
}`;

const FRAG = /* glsl */ `
uniform vec3 uCol;
uniform vec3 uCase;
uniform float uPxScale;
in vec2 vP;
in vec4 vSeg;
in vec4 vArc;
in vec4 vLook;
in vec3 vWave;

// How much of the segment this pixel owes: each end has a ramp one cap wide on both sides of it, so two
// segments that meet add up to exactly one along a straight run and a joint never shows as a bright dab.
float along(float x, float len, float cap) {
  float r0 = clamp((x + cap) / (2.0 * cap), 0.0, 1.0);
  float r1 = clamp((x - len + cap) / (2.0 * cap), 0.0, 1.0);
  return r0 - r1;
}
// Box-filtered hairline: coverage of a line of width w (px) at distance d from its centre.
float hair(float d, float w) { return clamp(0.5 + 0.5 * w - abs(d), 0.0, 1.0); }

// A pattern fixed to the world whose pitch on screen stays within [lo, 2 lo) pixels: as the camera comes
// closer the pitch halves, and the two octaves are cross-faded like a mip chain, so nothing pops or crawls.
// Returns the pitch of the coarser octave in world units (radians); t is how far the finer one has come in.
float octavePitch(float pprDev, float base, float lo, out float t) {
  float u = log2(base * pprDev / lo);
  float k = floor(u);
  t = smoothstep(0.0, 1.0, u - k);
  return base * exp2(-k);
}
float dashAt(float s, float p, float pitchPx, float duty, float px) {
  float e = clamp(px / pitchPx, 0.002, 0.25);
  float f = fract(s / p);
  return smoothstep(0.0, e, f) * (1.0 - smoothstep(duty, duty + e, f));
}
float beadAt(float s, float p, float pitchPx, float d, float rPx, float px) {
  float x = (fract(s / p) - 0.5) * pitchPx;
  return 1.0 - smoothstep(rPx - 0.6 * px, rPx + 0.6 * px, length(vec2(x, d)));
}

void main() {
  float cov = along(vP.x, vSeg.x, vSeg.y);
  if (cov <= 0.002) discard;
  float state = vArc.z;
  float vis = vLook.x;
  float night = vLook.y;
  float px = uPxScale;
  float d = vP.y;
  // The line's length along its way, here: what a pattern fixed to the planet reads.
  float s = mix(vArc.x, vArc.y, clamp(vP.x / max(vSeg.x, 1e-3), 0.0, 1.0));
  // vSeg.w: device pixels per radian at this segment.
#if STYLE == 0
  // Neon, a vector display: a country border is a solid hairline in Flux blue with a faint glow; a state
  // line is the same hairline broken into dashes, the way a map breaks its inner boundaries. The dashes are
  // fixed to the planet and keep a pitch of 14 to 28 pixels at every zoom. Both brighten on the night side
  // like the coastline.
  float w = mix(1.05, 0.8, state) * px;
  float core = hair(d, w);
  float glow = exp(-d * d / (px * px * mix(5.0, 3.0, state)));
  float line = core + glow * mix(0.28, 0.14, state);
  if (state > 0.5) {
    float t;
    float p = octavePitch(vSeg.w, 0.02, 14.0 * px, t);
    float d0 = dashAt(s, p, p * vSeg.w, 0.62, px);
    float d1 = dashAt(s, p * 0.5, p * 0.5 * vSeg.w, 0.62, px);
    line *= mix(d0, d1, t) * 1.25;
  }
  float i = line * cov * vis * mix(0.75, 1.25, night);
  vec3 col = uCol * i + vWave * (core + glow * 0.3) * cov * vis * 0.6;
  gl_FragColor = vec4(col, 0.0);
#elif STYLE == 1
  // Marble, an engraving: a pale thread laid in a soft dark groove, so it shows on bright cloud and snow as
  // well as on dark land. State lines are the same cut, finer and shallower.
  float w = mix(1.2, 0.9, state) * px;
  float core = hair(d, w);
  float groove = exp(-pow((d - 0.65 * px) / (px * mix(1.7, 1.3, state)), 2.0));
  float day = 1.0 - 0.4 * night;
  float aCore = core * mix(0.92, 0.66, state) * day * cov * vis;
  float aGroove = groove * mix(0.66, 0.46, state) * cov * vis;
  float a = aCore + aGroove * (1.0 - aCore);
  gl_FragColor = vec4(uCol * aCore + uCase * aGroove * (1.0 - aCore), a);
#else
  // Holo, a dot matrix: a country border is a thin thread of light strung with beads; a state line is the
  // beads alone. The beads are fixed to the planet like the lattice dots, and their pitch on screen stays
  // between 7 and 14 pixels at every zoom.
  float w = mix(0.9, 0.75, state) * px;
  float core = hair(d, w);
  float t;
  float p = octavePitch(vSeg.w, 0.0045, 7.0 * px, t);
  float pp0 = p * vSeg.w;
  float pp1 = pp0 * 0.5;
  float r0 = clamp(0.24 * pp0, 0.6 * px, 3.2 * px) * mix(1.0, 0.85, state);
  float r1 = clamp(0.24 * pp1, 0.6 * px, 3.2 * px) * mix(1.0, 0.85, state);
  float beads = mix(beadAt(s, p, pp0, d, r0, px), beadAt(s, p * 0.5, pp1, d, r1, px), t);
  float line = mix(core * 0.5, 0.0, state) + beads;
  float i = line * cov * vis * mix(1.0, 0.85, night);
  vec3 col = uCol * i + vWave * core * cov * vis * 0.5;
  gl_FragColor = vec4(col, 0.0);
#endif
}`;

const COUNTRY_HALF = 4.5;
const STATE_HALF = 3.5;

export class BorderLayer {
  readonly group = new THREE.Group();
  private readonly materials = new Map<0 | 1 | 2, THREE.ShaderMaterial>();
  private readonly uniforms: Record<string, THREE.IUniform>;
  private countries: THREE.Mesh | null = null;
  private states: THREE.Mesh | null = null;
  private stateGeo: THREE.InstancedBufferGeometry | null = null;
  private stateEnds: Uint32Array | null = null;
  private art: ArtDirection;
  private mode: BordersMode;
  private statesAllowed = true;
  private boundVersion = -1;
  private countriesAmt = 0;
  private statesAmt = 0;
  private statesBuiltFrom: object | null = null;
  private tokens: GlobeTokens;

  constructor(
    private readonly assets: AssetStore,
    u: SharedUniforms,
    tokens: GlobeTokens,
    art: ArtDirection,
    mode: BordersMode,
    statesAllowed: boolean,
  ) {
    this.art = art;
    this.mode = mode;
    this.statesAllowed = statesAllowed;
    this.tokens = tokens;
    this.uniforms = {
      uTime: u.uTime,
      uViewport: u.uViewport,
      uPxScale: u.uPxScale,
      uProjScale: u.uProjScale,
      uSunDir: u.uSunDir,
      uTerminator: u.uTerminator,
      uShock: u.uShock,
      uShockHot: u.uShockHot,
      uWave: u.uWave,
      uWaveP: u.uWaveP,
      uReveal: u.uReveal,
      uRevealPx: u.uRevealPx,
      uCountries: { value: 0 },
      uStates: { value: 0 },
      uCol: { value: new THREE.Color() },
      uCase: { value: new THREE.Color() },
    };
    this.setTokens(tokens);
  }

  private material(): THREE.ShaderMaterial {
    const style = STYLE[this.art];
    let m = this.materials.get(style);
    if (m) return m;
    const marble = style === 1;
    m = new THREE.ShaderMaterial({
      vertexShader: `#define COUNTRY_HALF ${COUNTRY_HALF.toFixed(1)}\n#define STATE_HALF ${STATE_HALF.toFixed(1)}\n${VERT}`,
      fragmentShader: `#define STYLE ${style}\n${FRAG}`,
      uniforms: this.uniforms,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      // Neon and holo are light added to the picture; marble is ink laid on it (premultiplied).
      blendSrc: THREE.OneFactor,
      blendDst: marble ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor,
      // Never touches alpha: the moon's exempt mask (see post.ts) lives there.
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    this.materials.set(style, m);
    return m;
  }

  setArt(art: ArtDirection): void {
    this.art = art;
    const m = this.material();
    if (this.countries) this.countries.material = m;
    if (this.states) this.states.material = m;
    this.setTokens(this.tokens);
  }

  setTokens(t: GlobeTokens): void {
    this.tokens = t;
    const col = this.uniforms.uCol!.value as THREE.Color;
    const cas = this.uniforms.uCase!.value as THREE.Color;
    col.set(t.border);
    if (STYLE[this.art] === 1) {
      // Pale thread, dark groove: the thread leans toward white, the groove toward the planet's own ocean.
      col.lerp(new THREE.Color('#ffffff'), 0.35);
      cas.set(t.ocean).multiplyScalar(0.5);
    } else if (STYLE[this.art] === 0) {
      col.multiplyScalar(1.5);
    } else {
      col.multiplyScalar(1.6);
    }
  }

  setMode(mode: BordersMode): void {
    this.mode = mode;
  }

  /** The low tier never draws or loads state lines; the governor may take a tier away at any time. */
  setStatesAllowed(allowed: boolean): void {
    this.statesAllowed = allowed;
  }

  private quad(): THREE.InstancedBufferGeometry {
    const geo = new THREE.InstancedBufferGeometry();
    // Quad: x along the segment (-1 = start, +1 = end), y across (-1..1).
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
    );
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    return geo;
  }

  private mesh(geo: THREE.InstancedBufferGeometry): THREE.Mesh {
    const m = new THREE.Mesh(geo, this.material());
    m.frustumCulled = false;
    m.renderOrder = 3;
    this.group.add(m);
    return m;
  }

  /** Builds what the loaded assets allow: the country lines once, the state lines when they arrive. */
  private sync(): void {
    const br = this.assets.borders;
    if (br && !this.countries) {
      const geo = this.quad();
      const n = br.border.length / 4;
      geo.setAttribute('aGeo', new THREE.InstancedBufferAttribute(br.border, 4));
      geo.setAttribute('aArc', new THREE.InstancedBufferAttribute(br.borderArc, 2));
      geo.setAttribute('aLvl', new THREE.InstancedBufferAttribute(new Float32Array(n).fill(-1), 1));
      geo.instanceCount = n;
      this.countries = this.mesh(geo);
    }
    const ad = this.assets.admin1;
    if (ad && this.statesAllowed && this.statesBuiltFrom !== ad) {
      this.stateGeo?.dispose();
      const geo = this.quad();
      const n = ad.seg.length / 4;
      const lvl = new Float32Array(n);
      let from = 0;
      for (let l = 0; l < ADMIN1_LEVELS; l++) {
        const to = ad.levelEnds[l] ?? from;
        lvl.fill(l, from, to);
        from = to;
      }
      geo.setAttribute('aGeo', new THREE.InstancedBufferAttribute(ad.seg, 4));
      geo.setAttribute('aArc', new THREE.InstancedBufferAttribute(ad.arc, 2));
      geo.setAttribute('aLvl', new THREE.InstancedBufferAttribute(lvl, 1));
      geo.instanceCount = n;
      this.stateGeo = geo;
      this.stateEnds = ad.levelEnds;
      this.statesBuiltFrom = ad;
      if (this.states) this.states.geometry = geo;
      else this.states = this.mesh(geo);
    }
  }

  /**
   * Once per frame. `ppr` is the camera's pixels per radian at the nearest ground (CSS px), which decides
   * when the state file is fetched and how many of its levels are worth drawing.
   */
  update(dt: number, ppr: number, reduced: boolean): void {
    if (this.boundVersion !== this.assets.version) {
      this.boundVersion = this.assets.version;
      this.sync();
    }
    const wantStates = this.mode === 'states' && this.statesAllowed;
    if (wantStates && wantsAdmin1(ppr)) this.assets.requestAdmin1();
    if (!this.statesAllowed && this.stateGeo) {
      // The tier went away from under the lines: they fade with the rest and their buffers go.
      if (this.statesAmt < 0.004) {
        if (this.states) this.group.remove(this.states);
        this.states = null;
        this.stateGeo.dispose();
        this.stateGeo = null;
        this.stateEnds = null;
        this.statesBuiltFrom = null;
      }
    }
    const rate = reduced ? 1000 : 4;
    this.countriesAmt = damp(this.countriesAmt, this.mode === 'off' ? 0 : 1, rate, dt);
    this.statesAmt = damp(this.statesAmt, wantStates && this.stateGeo ? 1 : 0, rate * 0.6, dt);
    if (this.countriesAmt < 0.002) this.countriesAmt = 0;
    if (this.statesAmt < 0.002) this.statesAmt = 0;
    this.uniforms.uCountries!.value = this.countriesAmt;
    this.uniforms.uStates!.value = this.statesAmt;
    if (this.countries) this.countries.visible = this.countriesAmt > 0;
    if (this.states && this.stateGeo && this.stateEnds) {
      const levels = admin1Levels(ppr);
      const count = levels > 0 ? (this.stateEnds[Math.min(levels, this.stateEnds.length) - 1] ?? 0) : 0;
      this.stateGeo.instanceCount = count;
      this.states.visible = this.statesAmt > 0 && count > 0;
    }
  }

  /** Segments the layer would draw right now (stats, tests). */
  get segments(): { countries: number; states: number } {
    const c = this.countries?.visible
      ? (this.countries.geometry as THREE.InstancedBufferGeometry).instanceCount
      : 0;
    const s = this.states?.visible ? (this.stateGeo?.instanceCount ?? 0) : 0;
    return { countries: c, states: s };
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  dispose(): void {
    for (const m of this.materials.values()) m.dispose();
    this.countries?.geometry.dispose();
    this.stateGeo?.dispose();
  }
}
