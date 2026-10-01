// Art direction "marble": black-marble photoreal earth. NASA Blue Marble graded down to a moody
// dark planet, the Black Marble night map for city lights, a drifting cloud deck, ocean glint,
// and a soft day/night terminator placed from the real UTC sun position.

import * as THREE from 'three';
import type { AssetStore } from '../assetstore';
import { GLSL_LENS } from '../lens';
import { GLSL_CONSTANTS, GLSL_GEO, GLSL_REVEAL, GLSL_WAVE_GLOW, GLSL_WAVES } from '../shaders/chunks';
import type { GlobeTokens } from '../tokens';
import type { SharedUniforms } from '../uniforms';
import type { GlobeBody } from './body';

const VERT = /* glsl */ `
out vec3 vN;
out vec3 vWorld;
void main() {
  vN = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
${GLSL_CONSTANTS}
${GLSL_GEO}
${GLSL_WAVES}
${GLSL_WAVE_GLOW}
${GLSL_REVEAL}
${GLSL_LENS}
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uClouds;
uniform sampler2D uMask;
uniform vec3 uSunDir;
uniform vec3 uLights;
uniform vec3 uOcean;
uniform vec3 uOceanLit;
uniform vec3 uLand;
uniform float uLightsAlpha;
uniform vec3 uDusk;
uniform float uNightLights;
uniform float uCloudAmt;
uniform float uTerminator;
uniform float uHasClouds;
uniform float uProjScale;
uniform float uPxScale;
uniform vec2 uViewport;
uniform vec2 uViewShift;
in vec3 vN;
in vec3 vWorld;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec3 n = normalize(vN);
  vec2 dx, dy;
  vec2 uv = dirToUvGrad(n, dx, dy);
  vec3 day = textureGrad(uDay, uv, dx, dy).rgb;
  vec3 nt = textureGrad(uNight, uv, dx, dy).rgb;
  float land = textureGrad(uMask, uv, dx, dy).r;
  vec2 cuv = uv + vec2(uTime * 0.00028, 0.0);
  float cl = textureGrad(uClouds, cuv, dx, dy).r * uHasClouds * uCloudAmt;

  vec3 sun = uTerminator > 0.5 ? uSunDir : normalize(cameraPosition);
  float mu = dot(n, sun);

  // The lens (lens.ts): up close the planet's own light (a magnified city-lights texture, the day
  // side's haze and cloud, the sun's glint) is brighter and bigger than the nodes it sits under, so it
  // gives way, most of all around the focus point (a soft vignette, never a mask).
  vec2 focusNdc = gl_FragCoord.xy / uViewport * 2.0 - 1.0 - uViewShift;
  float lz = lensZoom(length(cameraPosition - vWorld), uProjScale / max(uPxScale, 1e-4));
  float edgeK = 1.0 - lensVignette(focusNdc, uViewport.x / uViewport.y, 0.0);   // 0 at the focus, 1 in the corners
  float L = lz * (1.0 - 0.25 * edgeK);

  // Grade the day map into a darker, cooler planet so the data layer owns the brightness. The photo
  // is blended with a duotone painted from the design's navy ramp (ocean, ocean-lit, land), so the
  // planet belongs to the same palette as the interface around it.
  vec3 g = pow(day, vec3(1.25));
  float gl = luma(g);
  vec3 photo = mix(vec3(gl), g, 0.78) * vec3(0.96, 0.99, 1.04);
  vec3 duo = gl < 0.1 ? mix(uOcean, uOceanLit, gl / 0.1) : mix(uOceanLit, uLand * 1.5, clamp((gl - 0.1) / 0.45, 0.0, 1.0));
  vec3 seaCol = mix(photo, duo * 1.3, 0.7) * 0.82;
  // Land is the photograph's light and shade through a light slate ramp, keeping about two fifths of
  // its own color: even its darkest forest sits well above the sea, so the continents read at a glance.
  vec3 slate = mix(vec3(0.13, 0.15, 0.17), vec3(0.66, 0.69, 0.72), smoothstep(0.04, 0.6, gl));
  vec3 landCol = mix(slate, mix(vec3(gl), g, 0.75), 0.42) * 1.15;
  g = mix(seaCol, landCol, land);
  float diff = smoothstep(-0.02, 0.32, mu);
  float wrap = 0.12 + 0.88 * pow(max(mu, 0.0), 0.72);
  vec3 dayCol = g * 0.74 * mix(1.0, wrap, 0.6) * diff;
  // Up close the day side keeps its daylight as a dim, desaturated stage: the brightest haze is compressed
  // to about 0.11, far under a marker's body, so the tier colours read on it.
  dayCol = mix(vec3(luma(dayCol)), dayCol, 1.0 - 0.5 * L);
  dayCol = dayCol / (1.0 + dayCol * (8.0 * L * L * L)) * (1.0 - 0.1 * L);

  // Earthshine keeps the geography readable on the night side.
  vec3 shine = g * vec3(0.05, 0.075, 0.15) * 0.3;
  float nightF = 1.0 - smoothstep(-0.12, 0.10, mu);
  float lights = smoothstep(0.10, 0.55, luma(nt));
  vec3 cityCol = nt * (0.35 + 2.3 * lights) * uLights * 1.05;
  cityCol *= (1.0 - cl * 0.75);
  // City lights: from a blinding wall to a cool, quiet glow. The brightest texel is compressed hardest
  // (a soft ceiling that drops from unbounded to about 0.03 as L rises, so a metropolis cannot swallow
  // the markers whatever its texel value), the rest eases down in step, and the colour goes cool grey.
  cityCol = mix(cityCol, vec3(luma(cityCol)) * vec3(0.78, 0.9, 1.0), 0.6 * L);
  cityCol = cityCol / (1.0 + cityCol * (20.0 * L * L * L)) * (1.0 - 0.5 * L);
  vec3 col = dayCol + shine * (1.0 - diff * 0.6);
  col += cityCol * nightF * uNightLights * 1.15 * (uLightsAlpha / 0.3);

  // Clouds: lit from the sun, nearly invisible at night.
  float cloud = smoothstep(0.28, 0.95, cl) * (1.0 - 0.7 * L);
  vec3 cloudLit = vec3(0.74, 0.84, 1.0) * (0.03 + 0.62 * diff);
  col = mix(col, cloudLit * 0.85 + shine * 0.3, cloud * 0.42);

  // Ocean glint.
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 H = normalize(sun + V);
  float nh = max(dot(n, H), 0.0);
  // A broad, soft lobe (real sun glint is a wide patch, not a dot): it should read as light on water.
  float spec = pow(nh, 420.0) * (1.0 - land) * diff * (1.0 - cloud * 0.9) * (1.0 - 0.85 * L);
  float sheen = pow(nh, 70.0) * (1.0 - land) * diff * 0.03 * (1.0 - 0.85 * L);
  col += vec3(0.65, 0.82, 1.0) * (spec * 0.14 + sheen);

  // Terminator glow: a thin warm band on the ground where the sun grazes.
  float tw = exp(-pow(mu / 0.09, 2.0));
  col += uDusk * tw * (0.005 + 0.011 * land) * uTerminator;

  // Block shockwave riding over the surface.
  col += waveGlow(n) * (0.55 + 0.45 * land) * 1.25;

  // Boot reveal: beyond the wave's front the planet is an unlit disc.
  float rv = revealMask(n);
  col = mix(uOcean * 0.5, col, rv);
  col += uShockHot * revealRing(n);

  gl_FragColor = vec4(col, 1.0);
}`;

export class MarbleBody implements GlobeBody {
  readonly group = new THREE.Group();
  private readonly mat: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private boundVersion = -1;

  constructor(
    private readonly assets: AssetStore,
    u: SharedUniforms,
    tokens: GlobeTokens,
    segments: number,
  ) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uDay: { value: assets.day },
        uNight: { value: assets.night },
        uClouds: { value: assets.clouds },
        uMask: { value: assets.mask },
        uSunDir: u.uSunDir,
        uTime: u.uTime,
        uWave: u.uWave,
        uWaveP: u.uWaveP,
        uReveal: u.uReveal,
        uRevealPx: u.uRevealPx,
        uLights: { value: new THREE.Color() },
        uOcean: { value: new THREE.Color() },
        uOceanLit: { value: new THREE.Color() },
        uLand: { value: new THREE.Color() },
        uLightsAlpha: { value: 0.3 },
        uDusk: { value: new THREE.Color() },
        uShock: u.uShock,
        uShockHot: u.uShockHot,
        uNightLights: u.uNightLights,
        uCloudAmt: u.uClouds,
        uTerminator: u.uTerminator,
        uHasClouds: { value: 0 },
        uProjScale: u.uProjScale,
        uPxScale: u.uPxScale,
        uViewport: u.uViewport,
        uViewShift: u.uViewShift,
      },
      depthWrite: true,
      depthTest: true,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, segments, Math.round(segments * 0.75)), this.mat);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.setTokens(tokens);
  }

  setTokens(t: GlobeTokens): void {
    this.mat.uniforms.uLights!.value.set(t.lights);
    this.mat.uniforms.uOcean!.value.set(t.ocean);
    this.mat.uniforms.uOceanLit!.value.set(t.oceanLit);
    this.mat.uniforms.uLand!.value.set(t.land);
    this.mat.uniforms.uLightsAlpha!.value = t.lightsAlpha;
    this.mat.uniforms.uDusk!.value.set(t.atmoDusk);
  }

  update(_time: number): void {
    if (this.boundVersion !== this.assets.version) {
      this.boundVersion = this.assets.version;
      const u = this.mat.uniforms;
      u.uDay!.value = this.assets.day;
      u.uNight!.value = this.assets.night;
      u.uClouds!.value = this.assets.clouds;
      u.uMask!.value = this.assets.mask;
      u.uHasClouds!.value = this.assets.loaded.clouds ? 1 : 0;
    }
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  dispose(): void {
    this.mat.dispose();
    this.mesh.geometry.dispose();
  }
}
