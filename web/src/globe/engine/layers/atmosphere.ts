// Atmosphere: a fullscreen pass that ray-marches a thin exponential shell around the planet.
//
// For every pixel the view ray is intersected analytically with the shell and the planet, then a
// handful of samples accumulate single-scattered sunlight: Rayleigh (blue, reddened by the long
// slant path at dusk) plus a forward-peaked Mie lobe for the rim light when the sun is behind the
// planet. The planet's shadow cuts the light, so the night limb falls away naturally.
// Because it is analytic the same pass works from orbit and from near the ground.

import * as THREE from 'three';
import { GLSL_CONSTANTS } from '../shaders/chunks';
import type { GlobeTokens } from '../tokens';
import type { SharedUniforms } from '../uniforms';

const VERT = /* glsl */ `
out vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.5, 1.0);
}`;

const frag = (steps: number): string => /* glsl */ `
${GLSL_CONSTANTS}
#define STEPS ${steps}
uniform vec3 uCamPos; uniform vec3 uCamRight; uniform vec3 uCamUp; uniform vec3 uCamBack;
uniform float uTanHalfFov; uniform float uAspect; uniform vec2 uViewShift;
uniform vec3 uSunDir;
uniform vec3 uBeta;      // Rayleigh extinction per unit density (per channel)
uniform vec3 uDusk;
uniform vec3 uNight;
uniform float uAmount;
uniform float uGain;
uniform float uTerminator;
uniform vec3 uRimHot;
uniform float uRimGain;
in vec2 vNdc;

const float R_PLANET = 1.0;
const float R_ATMO = 1.042;
const float H_SCALE = 0.0085;

vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(-1.0, -1.0);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}

float density(float r) { return exp(-(r - R_PLANET) / H_SCALE); }

void main() {
  vec2 q = vNdc - uViewShift;
  vec3 rd = normalize(uCamRight * (q.x * uTanHalfFov * uAspect) + uCamUp * (q.y * uTanHalfFov) - uCamBack);
  vec3 ro = uCamPos;
  vec2 ta = raySphere(ro, rd, R_ATMO);
  if (ta.y < 0.0) { gl_FragColor = vec4(0.0); return; }
  float t0 = max(ta.x, 0.0);
  float t1 = ta.y;
  vec2 tp = raySphere(ro, rd, R_PLANET);
  if (tp.x > 0.0) t1 = min(t1, tp.x);
  float len = t1 - t0;
  if (len <= 0.0) { gl_FragColor = vec4(0.0); return; }

  vec3 sun = uTerminator > 0.5 ? uSunDir : normalize(ro);
  float mu = dot(rd, sun);
  float phaseR = (3.0 / (16.0 * PI)) * (1.0 + mu * mu);
  float g = 0.76;
  float phaseM = (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * mu, 1.5));

  vec3 sum = vec3(0.0);
  vec3 od = vec3(0.0);
  float odScalar = 0.0;
  // Non-uniform steps: denser where the air is (the near end of a planet-hitting ray is the far end of the segment).
  for (int i = 0; i < STEPS; i++) {
    float f0 = float(i) / float(STEPS);
    float f1 = float(i + 1) / float(STEPS);
    // Bias samples toward the lower atmosphere: for a planet-hit ray that is the far end.
    float a = f0 * f0 * 0.35 + f0 * 0.65;
    float b = f1 * f1 * 0.35 + f1 * 0.65;
    float ts = t0 + len * (tp.x > 0.0 ? 1.0 - 0.5 * (a + b) : 0.5 * (a + b));
    float ds = len * (b - a);
    vec3 p = ro + rd * ts;
    float r = length(p);
    float dens = density(r);
    od += uBeta * dens * ds;
    odScalar += dens * ds;
    vec3 n = p / r;
    float x = dot(n, sun);
    // Planet shadow on the sun ray.
    float perp = length(p - sun * dot(p, sun));
    float lit = dot(p, sun) > 0.0 ? 1.0 : smoothstep(0.93, 1.07, perp);
    float slant = 1.0 / (max(x, 0.0) + 0.09);
    vec3 odSun = uBeta * dens * H_SCALE * min(slant, 13.0);
    vec3 tSun = exp(-odSun) * lit;
    vec3 tView = exp(-od);
    vec3 scatter = uBeta * phaseR + vec3(3.2) * phaseM;
    sum += dens * ds * scatter * tSun * tView;
    // Dusk glow: warm light where the sun grazes the horizon, strongest on the terminator side.
    float dusk = exp(-pow((x + 0.02) / 0.07, 2.0)) * lit;
    sum += uDusk * dens * ds * dusk * 2.2 * tView;
    // Night-side air glow (earthshine / airglow): only a hint, mostly at the limb.
    sum += uNight * dens * ds * (1.0 - lit) * 1.1 * tView;
  }
  // The glow seen edge-on at the limb carries the look; the veil over the disc stays subtle.
  float onDisc = tp.x > 0.0 ? 1.0 : 0.0;
  sum *= uGain * uAmount * mix(1.9, 0.36, onDisc);
  float T = exp(-dot(od, vec3(0.3333)));
  float alpha = (1.0 - T) * uAmount * mix(1.0, 0.5, onDisc);
  // The sun-facing limb: a hot cream specular arc about 30 degrees wide, hugging the surface.
  float tc = max(-dot(ro, rd), 0.0);
  vec3 pc = ro + rd * tc;
  float bImp = length(pc);
  float facing = dot(pc / max(bImp, 1e-4), sun);
  float arc = smoothstep(0.86, 0.985, facing);
  float band = exp(-pow((bImp - 1.004) / 0.0075, 2.0));
  vec3 hotRim = uRimHot * (band * arc * uRimGain * uAmount);
  sum += hotRim;
  alpha = min(1.0, alpha + 0.35 * max(hotRim.r, max(hotRim.g, hotRim.b)));
  gl_FragColor = vec4(sum, alpha);
}`;

export class Atmosphere {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private readonly u: SharedUniforms;
  private steps: number;

  constructor(u: SharedUniforms, tokens: GlobeTokens, steps: number) {
    this.u = u;
    this.steps = steps;
    const tri = new THREE.BufferGeometry();
    tri.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    this.mat = this.makeMaterial(steps);
    this.mesh = new THREE.Mesh(tri, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.setTokens(tokens);
  }

  private makeMaterial(steps: number): THREE.ShaderMaterial {
    const u = this.u;
    return new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: frag(steps),
      uniforms: {
        uCamPos: u.uCamPos,
        uCamRight: u.uCamRight,
        uCamUp: u.uCamUp,
        uCamBack: u.uCamBack,
        uTanHalfFov: u.uTanHalfFov,
        uAspect: u.uAspect,
        uViewShift: u.uViewShift,
        uSunDir: u.uSunDir,
        uBeta: { value: new THREE.Vector3(5, 11, 23) },
        uDusk: { value: new THREE.Color() },
        uNight: { value: new THREE.Color() },
        uAmount: u.uAtmo,
        uGain: { value: 2.2 },
        uTerminator: u.uTerminator,
        uRimHot: u.uRimHot,
        uRimGain: { value: 1.6 },
      },
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      depthTest: false,
      depthWrite: false,
    });
  }

  setTokens(t: GlobeTokens): void {
    const c = new THREE.Color(t.atmoDay);
    const m = Math.max(c.r, c.g, c.b, 1e-4);
    // Extinction color from the token: bluer token, stronger blue scattering (and redder dusks).
    const k = 31;
    (this.mat.uniforms.uBeta!.value as THREE.Vector3).set(
      k * Math.max(c.r / m, 0.02) ** 0.6,
      k * Math.max(c.g / m, 0.02) ** 0.6,
      k,
    );
    (this.mat.uniforms.uDusk!.value as THREE.Color).set(t.atmoDusk);
    (this.mat.uniforms.uNight!.value as THREE.Color).set(t.atmoNight);
  }

  setGain(g: number): void {
    this.mat.uniforms.uGain!.value = g;
  }

  setSteps(steps: number): void {
    if (steps === this.steps) return;
    this.steps = steps;
    const old = this.mat;
    this.mat = this.makeMaterial(steps);
    // carry over colors
    (this.mat.uniforms.uBeta!.value as THREE.Vector3).copy(old.uniforms.uBeta!.value as THREE.Vector3);
    (this.mat.uniforms.uDusk!.value as THREE.Color).copy(old.uniforms.uDusk!.value as THREE.Color);
    (this.mat.uniforms.uNight!.value as THREE.Color).copy(old.uniforms.uNight!.value as THREE.Color);
    this.mat.uniforms.uGain!.value = old.uniforms.uGain!.value;
    this.mesh.material = this.mat;
    old.dispose();
  }

  dispose(): void {
    this.mat.dispose();
    this.mesh.geometry.dispose();
  }
}
