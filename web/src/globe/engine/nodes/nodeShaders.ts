// Node marker shaders. One vertex source serves two passes (NODE_KNOCK selects the second):
//
//   knock  (renderOrder 29, multiply)   a soft dark halo behind every marker, so a bright background
//                                       (a city's light, a coastline, a cloud) cannot swallow it.
//                                       Zero at the global view; ramps in with the lens (lens.ts).
//   marker (renderOrder 30, additive)   the marker itself. Far away it is the familiar glowing point.
//                                       Up close it becomes a luminous bead: a crisp, antialiased
//                                       tier-coloured rim, a translucent body and a white-hot pearl,
//                                       with the loose glow pulled in so a dense hub does not haze.
//
// The selected marker adds a lock ring in the block shockwave's own light (a crisp white edge in
// Flux blue falloff) with a restrained pulse every 2.4 s; reduced motion keeps the ring and drops
// the motion. Sizes are CSS pixels times uPxScale (device pixels), edges are antialiased analytically.

import { GLSL_LENS } from '../lens';
import { GLSL_CONSTANTS, GLSL_REVEAL, GLSL_WAVES } from '../shaders/chunks';

export const NODE_VERT = /* glsl */ `
${GLSL_CONSTANTS}
${GLSL_WAVES}
${GLSL_REVEAL}
${GLSL_LENS}
uniform sampler2D uPosTex;
uniform vec2 uViewport;
uniform float uPxScale;
uniform float uProjScale;
uniform float uNodeScale;
uniform float uNodeWorld;
uniform float uFocus;
uniform float uFocusAlpha;
uniform float uDimAlpha;
uniform float uZoomGain;
uniform float uFan;
uniform float uFilterT;
uniform float uReduced;
uniform vec3 uSize;
uniform vec3 uTierColor[4];
uniform vec3 uOff;
in vec4 aAttr;   // tier, status, flags, state bits
in vec2 aTime;   // birth, death start (engine seconds)
in vec2 aFlash;  // flash start, amplitude
out vec2 vCorner;
out vec4 vColor;   // rgb tint, a = opacity
out vec4 vP;       // x = core radius / quad half size, y = selected, z = watched, w = hovered
out vec4 vF;       // x = arcane, y = hasApps, z = flash amplitude, w = flash age
out vec4 vS;       // x = status, y = tier, z = ring amount (Z2 and up), w = seed
out vec4 vR;       // x = related (focus set), y = paid, z = aimed, w = at risk
out float vPack;
out vec4 vL;       // x = lens, y = core diameter (device px), z = quad half size (device px), w = knock strength
out vec4 vSel;     // x = lock ring radius (device px), y = pulse end radius (device px)

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
  float coreRest = max(base, min(worldPx, base * 7.0));
  coreRest *= mix(0.7, 1.0, sqrt(stackDim)) * (belt ? 0.6 : 1.0);

  // The lens: 0 at the global and regional views, 1 once the ground is magnified past the markers.
  float lz = lensZoom(length(P - cameraPosition), uProjScale / max(uPxScale, 1e-4));

  // The selected marker is drawn bigger from far away; up close the lock ring does that work and
  // the marker keeps its size, so a fanned-out hub stays clear of overlaps.
  float selScale = selected ? 1.0 + 0.6 * (1.0 - 0.58 * lz) : 1.0;
  float core = coreRest * grow * (0.45 + 0.55 * vanish) * breathe;
  core *= 1.0 + 0.55 * flashAmp + 0.45 * ignite + (hovered ? 0.4 : 0.0) + (selScale - 1.0) + wv * 0.35;

  // Lock ring and pulse radii (device px): steady, never twitching with a flash.
  float lockR = max(0.9 * coreRest * grow * selScale, 10.0 * uPxScale);
  float pulseR = max(lockR * 1.8, 27.0 * uPxScale);

  float ringy = (selected || watched || hovered || status == 4 || status == 5) ? 1.0 : 0.0;
  float ringAmt = smoothstep(0.55, 0.85, uFan) * smoothstep(0.35, 0.8, stackDim);
  float quadScale = 1.0 + 1.25 * max(ringy, min(1.0, flashAmp * 1.5 + ignite * 0.6 + (related ? 0.7 : 0.0))) + 0.9 * ringAmt * float(tier >= 2);
  float HALO = 4.0 * quadScale;
  float halfPx = core * 0.5 * HALO;
  if (selected) halfPx = max(halfPx, pulseR * 1.75 + 34.0 * uPxScale);

#ifdef NODE_KNOCK
  // The dark halo: a quad 2.8 core radii wide (more for the selected marker's stage), strength by lens.
  float kHalf = core * 0.5 * 2.8;
  if (selected) kHalf = max(kHalf, lockR * 1.7);
  float stackK = smoothstep(0.3, 0.8, stackDim);
  float kStr = 0.8 * lz * vis * stackK * grow * vanish * mix(0.55, 1.0, bright);
  vec2 offK = position.xy * kHalf * 2.0 / uViewport;
  gl_Position = clip;
  gl_Position.xy += offK * clip.w;
  vCorner = position.xy;
  vP = vec4(core * 0.5 / kHalf, selected ? 1.0 : 0.0, 0.0, 0.0);
  vL = vec4(lz, core, kHalf, kStr);
  vSel = vec4(lockR, pulseR, 0.0, 0.0);
  vColor = vec4(0.0);
  return;
#endif

  vec2 off = position.xy * halfPx * 2.0 / uViewport;
  gl_Position = clip;
  gl_Position.xy += off * clip.w;

  vCorner = position.xy;
  // Stacked nodes are dim on their own; events add absolute light so a blip inside a stack still shows.
  float b = bright * vis * (stackDim * uZoomGain + pulse * (0.55 + 0.45 * stackDim));
  vColor = vec4(tint * b, 1.0);
  vP = vec4(core * 0.5 / halfPx, selected ? 1.0 : 0.0, watched ? 1.0 : 0.0, hovered ? 1.0 : 0.0);
  vF = vec4((flags & 16) != 0 ? 1.0 : 0.0, (flags & 1) != 0 ? 1.0 : 0.0, flashAmp, fage);
  vS = vec4(float(status), float(tier), ringAmt * vis, seed);
  vR = vec4((related ? 1.0 : 0.0) * uFocus, paid ? 1.0 : 0.0, aimed ? 1.0 : 0.0, status == 5 ? 1.0 : 0.0);
  vPack = uFan * stackDim;
  vL = vec4(lz, core, halfPx, 0.0);
  vSel = vec4(lockR, pulseR, 0.0, 0.0);
  // Keep selected/watched markers readable even when everything else is dimmed.
  if (selected || watched) vColor.rgb = max(vColor.rgb, tint * 0.7);
}`;

export const NODE_FRAG = /* glsl */ `
${GLSL_CONSTANTS}
uniform float uTime;
uniform float uHaloAlpha;
uniform float uReduced;
uniform float uPxScale;
uniform float uSelAt;
uniform vec3 uAccent;
uniform vec3 uWatch;
uniform vec3 uHover;
uniform vec3 uAlert;
uniform vec3 uRisk;
uniform vec3 uShock;
uniform vec3 uShockHot;
in vec2 vCorner;
in vec4 vColor;
in vec4 vP;
in vec4 vF;
in vec4 vS;
in vec4 vR;
in float vPack;
in vec4 vL;
in vec4 vSel;

float ringAt(float q, float radius, float width) {
  float d = (q - radius) / width;
  return exp(-d * d);
}

// The shockwave's own front, scaled down to a marker: a crisp 1.4 px white edge in 3.6, 10 and 24 px
// falloffs of Flux blue (the same four passes as the block pulse, at their alphas .62, .30, .12, .05).
vec3 frontLight(float dpx, float edgeW) {
  float d2 = dpx * dpx;
  float edge = 1.0 - smoothstep(0.7 - edgeW, 0.7 + edgeW, abs(dpx));
  float blue = exp(-d2 / 3.24) * 0.30 + exp(-d2 / 25.0) * 0.12 + exp(-d2 / 144.0) * 0.05;
  return uShockHot * edge * 0.95 + uShock * blue * 2.6;
}

// The selected marker's lock ring and its pulse. px is the distance from the centre in device px.
vec3 selectionLight(float px, float lockR, float pulseR, vec2 corner) {
  float cs = uPxScale;
  float age = uTime - uSelAt;
  float calm = uReduced;
  float edgeW = 0.5 / cs;
  // Lock on: the ring closes in from 1.9x its radius over 0.4 s, fading in as it lands.
  float land = calm > 0.5 ? 1.0 : clamp(age / 0.4, 0.0, 1.0);
  float landE = 1.0 - pow(1.0 - land, 3.0);
  float ringR = mix(lockR * 1.9, lockR, landE);
  vec3 c = frontLight((px - ringR) / cs, edgeW) * (1.0 + 1.0 * landE) * landE;
  // A soft highlight drifts around the ring: energised, never busy.
  float a = atan(corner.y, corner.x);
  float sweep = 0.8 + 0.2 * cos(a - uTime * 1.25 * (1.0 - calm));
  c *= sweep;
  // One pulse per 2.4 s, easing out like the block's shockwave and fading as (1 - t)^1.7. The first one
  // is the lock-on's ping: wider and brighter; the ones after it are restrained.
  if (calm < 0.5) {
    float n = (age - 0.35) / 2.4;
    float t = fract(n);
    float live = step(0.0, n);
    float first = 1.0 - step(1.0, n);
    float e = 1.0 - pow(1.0 - t, 3.0);
    float pr = mix(lockR, pulseR * mix(1.0, 1.7, first), e);
    float amp = pow(1.0 - t, 1.7) * live * mix(0.6, 1.0, first);
    c += frontLight((px - pr) / cs, edgeW) * amp * 0.85;
  }
  return c;
}

void main() {
  float r = length(vCorner);
  if (r >= 1.0) discard;
  float q = r / vP.x;                      // distance in core radii
  float lz = vL.x;
  float aa = 2.0 / max(vL.y, 3.0);          // one device pixel, in core radii
  float edge = 1.0 - smoothstep(0.55, 1.0, r);
  float status = vS.x;
  bool started = status > 1.5 && status < 2.5;
  bool unreachable = status > 2.5 && status < 3.5;
  bool dos = status > 3.5 && status < 4.5;

  // Far away the edge is the soft legacy one; up close it is a crisp, analytically antialiased disc.
  float disc = 1.0 - smoothstep(mix(0.86, 1.0 - aa, lz), mix(1.08, 1.0 + aa, lz), q);
  // Started nodes are a hollow ring, not a solid core.
  float core = started ? disc * smoothstep(0.42, 0.62, q) : disc;
  float packed = vPack;
  float inner = exp(-q * q * 0.32) * mix(1.0, 0.7, packed) * (started ? 0.5 : 1.0) * mix(1.0, 0.5, lz);
  float halo = exp(-q * 0.7) * (uHaloAlpha * 0.27) * edge * mix(1.0, 0.25, packed) * ((unreachable || dos) ? 0.0 : (started ? 0.5 : 1.0)) * mix(1.0, 0.35, lz);

  vec3 tint = vColor.rgb;
  float lum = max(tint.r, max(tint.g, tint.b));
  vec3 hot = mix(tint, vec3(lum), vF.y > 0.5 ? 0.6 : 0.4);
  vec3 body = hot * core * (started ? 1.3 : 1.7);
  if (lz > 0.002) {
    // A luminous bead: a bright tier rim hugging the edge, a saturated translucent body, a white-hot pearl.
    float rim = smoothstep(1.0 - 3.4 * aa, 1.0 - 1.1 * aa, q) * core;
    float pearl = exp(-q * q * 10.0) * core;
    vec3 bead = tint * 0.9 * core + mix(tint, vec3(lum), started ? 0.12 : 0.4) * 1.6 * rim + vec3(lum) * 0.8 * pearl;
    body = mix(body, bead * (started ? 0.62 : 1.0), lz);
  }
  vec3 col = body + tint * inner * 0.46 + tint * halo;

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
  if (status > 3.5 && status < 4.5) {
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
  // Hover is a quiet ring up close: the selection is always the brightest thing on a marker.
  if (vP.w > 0.5) ringCol += uHover * ringAt(q, 2.0, 0.14) * mix(0.9, 0.7, lz);
  if (vP.y > 0.5) {
    // Selection: a white-hot, energised centre ...
    ringCol += uAccent * exp(-q * q * 0.6) * 0.3;
  }
  if (vP.z > 0.5) {
    float a = atan(vCorner.y + 1e-5, vCorner.x + 1e-5);
    float dash = smoothstep(0.1, 0.45, sin(a * 6.0 + uTime * 0.9 * (1.0 - uReduced)));
    ringCol += uWatch * ringAt(q, 2.6, 0.14) * dash * 1.2;
  }
  col += ringCol * edge;
  // ... and the lock ring with its pulse, which fade out only at the quad's own border.
  if (vP.y > 0.5) col += selectionLight(r * vL.z, vSel.x, vSel.y, vCorner) * (1.0 - smoothstep(0.8, 1.0, r));

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

// The knock pass: darkens what is behind a marker. Output alpha is the amount; the blend is
// dst * (1 - alpha), so a dark background stays dark and a blinding one is brought down.
export const KNOCK_FRAG = /* glsl */ `
uniform float uTime;
uniform float uReduced;
uniform float uSelAt;
in vec2 vCorner;
in vec4 vP;
in vec4 vL;
in vec4 vSel;
void main() {
  float r = length(vCorner);
  if (r >= 1.0) discard;
  float q = r / vP.x;                                // core radii
  float a = vL.w * exp(-pow(q * 0.66, 3.0));         // 0.8 at the rim, 0.15 at two radii, nothing past three
  if (vP.y > 0.5) {
    // The selected marker sits on a darker stage: everything inside its lock ring gives way.
    float px = r * vL.z;
    float stage = 1.0 - smoothstep(vSel.x * 0.8, vSel.x * 1.5, px);
    float seen = uReduced > 0.5 ? 1.0 : smoothstep(0.0, 0.3, uTime - uSelAt);
    a = max(a, 0.74 * stage * seen);
  }
  a *= 1.0 - smoothstep(0.78, 1.0, r);
  gl_FragColor = vec4(0.0, 0.0, 0.0, clamp(a, 0.0, 1.0));
}`;
