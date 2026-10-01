// Shared GLSL chunks. three.js ShaderMaterial runs these as GLSL ES 3.00 (it prepends the version
// line and maps `gl_FragColor`), so `in`/`out`, `texelFetch` and `gl_InstanceID` are all available.

export const GLSL_CONSTANTS = /* glsl */ `
#define PI 3.14159265359
#define TAU 6.28318530718
`;

export const GLSL_HASH = /* glsl */ `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float hashU(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return float(x) * (1.0 / 4294967296.0);
}
`;

export const GLSL_NOISE = /* glsl */ `
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm3(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
`;

/** Equirectangular lookup from a unit direction. lon 0 is the +Z axis, +X is 90 degrees east. */
export const GLSL_GEO = /* glsl */ `
vec2 dirToUv(vec3 n) {
  float lon = atan(n.x, n.z);
  float lat = asin(clamp(n.y, -1.0, 1.0));
  return vec2(lon / TAU + 0.5, lat / PI + 0.5);
}
// Seam-free derivative for the longitude coordinate.
vec2 dirToUvGrad(vec3 n, out vec2 dx, out vec2 dy) {
  vec2 uv = dirToUv(n);
  vec2 dUvx = dFdx(uv);
  vec2 dUvy = dFdy(uv);
  // Choose the wrapped derivative when the seam crosses this pixel.
  if (abs(dUvx.x) > 0.5) dUvx.x -= sign(dUvx.x);
  if (abs(dUvy.x) > 0.5) dUvy.x -= sign(dUvy.x);
  dx = dUvx; dy = dUvy;
  return uv;
}
`;

/** Khronos PBR Neutral tone mapper (keeps hue and saturation of mid tones, rolls highlights to white). */
export const GLSL_TONEMAP = /* glsl */ `
vec3 tonemapNeutral(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  const float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
// The design asks that a dense field never clip to flat white ("clamp the additive sum per pixel at
// 0.92 before bloom"). This curve keeps neutral mid-tones like the Khronos mapper, then rolls the
// peak channel off toward 0.94 while scaling the others with it, so a saturated cluster keeps its
// hue and only its very core goes pale.
vec3 tonemapFlux(vec3 color) {
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  const float knee = 0.66;
  if (peak < knee) return color;
  const float d = 0.94 - knee;
  float newPeak = knee + d * (1.0 - exp(-(peak - knee) / d));
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (0.05 * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
`;

/** Fetch a node display position from the position texture (RGBA32F, 256 wide). */
export const GLSL_POS_TEX = /* glsl */ `
uniform sampler2D uPosTex;
vec4 fetchPos(float slot) {
  int s = int(slot + 0.5);
  return texelFetch(uPosTex, ivec2(s & 255, s >> 8), 0);
}
`;

/**
 * Block shockwaves. Up to four rings expand over the surface from a center with an ease-out-expo
 * front (fast start, slow finish), like the design's Beat: a great-circle ring that reaches about 70
 * degrees in 1.6 s. Nodes use `waveLift` (a +35% lift for 300 ms as the front passes); the planet
 * bodies use `waveGlow` (a luminous front with a trailing wash, cooling from shock-hot to shock).
 */
export const GLSL_WAVES = /* glsl */ `
uniform vec4 uWave[4];      // xyz = center (unit), w = start time (negative = inactive)
uniform vec4 uWaveP[4];     // x = reach (rad), y = duration (s), z = strength, w = radians per CSS pixel at the near surface
uniform float uTime;
// easeOutCubic (the design's shockwave easing): the front's angle over its reach.
float waveEase(float u) { float v = 1.0 - clamp(u, 0.0, 1.0); return 1.0 - v * v * v; }
float waveLift(vec3 n) {
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    float t0 = uWave[i].w;
    if (t0 < 0.0) continue;
    float age = uTime - t0;
    if (age < 0.0) continue;
    float reach = uWaveP[i].x;
    float ang = acos(clamp(dot(n, uWave[i].xyz), -1.0, 1.0));
    if (ang > reach) continue;
    float q = clamp(ang / reach, 0.0, 0.999);
    float up = 1.0 - pow(1.0 - q, 1.0 / 3.0);          // inverse of waveEase
    float dtp = age - up * uWaveP[i].y;
    // Nodes lift +35% for 300 ms as the front passes.
    float lift = dtp > 0.0 ? exp(-dtp / 0.3) : exp(-dtp * dtp / 0.004);
    s += lift * uWaveP[i].z * (1.0 - 0.5 * smoothstep(0.6, 1.0, q));
  }
  return s;
}
`;

export const GLSL_WAVE_GLOW = /* glsl */ `
uniform vec3 uShock;
uniform vec3 uShockHot;
// The front of a block's shockwave. Styled so it reads as a wave sweeping the surface, never as a line drawn on it
// (seen from far away the design's 1.4 px white hairline looked like an orbit guide): a wide soft swell (about 40 px),
// a 16 px shoulder, a wash that trails behind the front and dies away, and a sharp 5 px band with a hot core that
// only the young wave has: it starts as a crisp front and ends as a soft glow. Overall it fades as (1 - t)^1.7.
// (The design's passes, for the record: 24, 10, 3.6 and 1.4 px at alpha .05, .12, .3, .62.)
vec3 waveGlow(vec3 n) {
  vec3 s = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float t0 = uWave[i].w;
    if (t0 < 0.0) continue;
    float age = uTime - t0;
    float dur = uWaveP[i].y;
    if (age < 0.0 || age > dur) continue;
    float u = age / dur;
    float r = uWaveP[i].x * waveEase(u);
    float ang = acos(clamp(dot(n, uWave[i].xyz), -1.0, 1.0));
    float px = (ang - r) / max(uWaveP[i].w, 1e-6);
    float g40 = exp(-px * px / 450.0);
    float g14 = exp(-px * px / 150.0);
    float g5 = exp(-px * px / 14.0);
    float g1 = exp(-px * px / 1.2);
    // The wash behind the front: smooth across the front itself (no step), then a few degrees of fading light.
    float bpx = -px;
    float wash = smoothstep(-10.0, 10.0, bpx) * exp(-max(bpx, 0.0) * uWaveP[i].w * 6.0) * 0.2;
    float fade = pow(1.0 - u, 1.7);
    float crisp = (1.0 - u) * (1.0 - u);
    vec3 soft = uShock * (0.1 * g40 + 0.14 * g14 + wash);
    vec3 hard = uShock * 0.26 * g5 + mix(uShock, uShockHot, 0.85) * 0.34 * g1;
    s += (soft + hard * crisp) * uWaveP[i].z * fade * 1.7;
  }
  return s;
}
`;

/** The boot reveal wave (design 7.12 `setReveal`): only land and nodes within theta of the origin are drawn, and a thin ring marks the front. */
export const GLSL_REVEAL = /* glsl */ `
uniform vec4 uReveal;       // xyz = origin (unit), w = angular radius theta (rad); negative = off
uniform float uRevealPx;    // radians per CSS pixel at the near surface
float revealMask(vec3 n) {
  if (uReveal.w < 0.0) return 1.0;
  float ang = acos(clamp(dot(n, uReveal.xyz), -1.0, 1.0));
  return 1.0 - smoothstep(uReveal.w - 0.004, uReveal.w + 0.004, ang);
}
float revealRing(vec3 n) {
  if (uReveal.w < 0.0 || uReveal.w > 3.05) return 0.0;
  float ang = acos(clamp(dot(n, uReveal.xyz), -1.0, 1.0));
  float px = (ang - uReveal.w) / max(uRevealPx, 1e-6);
  // Light, not a line: a soft crest at the front and a glow that trails back over the lit side.
  float crest = exp(-px * px / 18.0);
  float wake = px < 0.0 ? exp(px / 30.0) : 0.0;
  return crest * 0.42 + wake * 0.2;
}
`;
