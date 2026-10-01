// Post-processing: multisampled HDR scene target, a progressive downsample/upsample bloom
// pyramid, and a single composite pass (tone map, chromatic aberration, vignette, grain, dither).
//
// Everything is preallocated; `render` allocates nothing.

import * as THREE from 'three';
import { GLSL_CONSTANTS, GLSL_TONEMAP } from './shaders/chunks';

const FS_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uFirst;
uniform float uThreshold;
uniform float uKnee;
in vec2 vUv;
// A single NaN or Inf pixel would smear into a black square through the whole pyramid, so every
// tap is sanitized. (The shaders avoid producing them; this is the safety net.)
vec3 s(vec2 o) {
  vec3 c = texture(tSrc, vUv + o * uTexel).rgb;
  return (any(isnan(c)) || any(isinf(c))) ? vec3(0.0) : min(c, vec3(64.0));
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 prefilter(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  return c * contrib;
}
void main() {
  vec3 a = s(vec2(-2.0,  2.0)), b = s(vec2(0.0,  2.0)), c = s(vec2(2.0,  2.0));
  vec3 d = s(vec2(-2.0,  0.0)), e = s(vec2(0.0,  0.0)), f = s(vec2(2.0,  0.0));
  vec3 g = s(vec2(-2.0, -2.0)), h = s(vec2(0.0, -2.0)), i = s(vec2(2.0, -2.0));
  vec3 j = s(vec2(-1.0,  1.0)), k = s(vec2(1.0,  1.0));
  vec3 l = s(vec2(-1.0, -1.0)), m = s(vec2(1.0, -1.0));
  vec3 outc;
  if (uFirst > 0.5) {
    // Karis average: weight each group by 1/(1+luma) so a single hot pixel cannot flicker.
    vec3 g0 = (a + b + d + e) * 0.25;
    vec3 g1 = (b + c + e + f) * 0.25;
    vec3 g2 = (d + e + g + h) * 0.25;
    vec3 g3 = (e + f + h + i) * 0.25;
    vec3 g4 = (j + k + l + m) * 0.25;
    g0 = prefilter(g0); g1 = prefilter(g1); g2 = prefilter(g2); g3 = prefilter(g3); g4 = prefilter(g4);
    float w0 = 0.125 / (1.0 + luma(g0));
    float w1 = 0.125 / (1.0 + luma(g1));
    float w2 = 0.125 / (1.0 + luma(g2));
    float w3 = 0.125 / (1.0 + luma(g3));
    float w4 = 0.5 / (1.0 + luma(g4));
    outc = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    outc = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(outc, 1.0);
}`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uWeight;
in vec2 vUv;
vec3 s(vec2 o) { return texture(tSrc, vUv + o * uTexel).rgb; }
void main() {
  vec3 col = s(vec2(0.0)) * 4.0
    + (s(vec2(-1.0, 0.0)) + s(vec2(1.0, 0.0)) + s(vec2(0.0, -1.0)) + s(vec2(0.0, 1.0))) * 2.0
    + (s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0)));
  gl_FragColor = vec4(col * (uWeight / 16.0), 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */ `
${GLSL_CONSTANTS}
${GLSL_TONEMAP}
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 uRes;
uniform float uTime;
uniform float uExposure;
uniform float uBloom;
uniform float uChroma;
uniform float uGrain;
uniform float uVignette;
uniform float uFade;
in vec2 vUv;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  d.x *= uRes.x / uRes.y;
  float r2 = dot(d, d);
  // Chromatic aberration grows with the square of the distance from the center.
  vec2 off = (uv - 0.5) * r2 * uChroma * 12.0;
  vec3 col;
  vec4 c0 = texture(tScene, uv);
  col.r = texture(tScene, uv + off).r;
  col.g = c0.g;
  col.b = texture(tScene, uv - off).b;
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  // The moon writes alpha 0 and colors that are already final (the brand's tonal faces must reach
  // the screen exactly): those pixels skip exposure, vignette, tone mapping and fringing.
  float ex = clamp(1.0 - c0.a, 0.0, 1.0);
  vec3 rawCol = (any(isnan(c0.rgb)) || any(isinf(c0.rgb))) ? vec3(0.0) : min(c0.rgb, vec3(1.0));
  vec3 bloom = texture(tBloom, uv).rgb;
  if (any(isnan(bloom)) || any(isinf(bloom))) bloom = vec3(0.0);
  col += bloom * uBloom;
  col *= uExposure;
  // Vignette, gentle and slightly blue so the corners stay inky instead of grey.
  float v = smoothstep(0.25, 1.05, sqrt(r2));
  col *= 1.0 - uVignette * v * v;
  col = mix(tonemapFlux(col), rawCol, ex);
  col = linearToSrgb(col);
  // Triangular-PDF dither plus animated grain (both tiny; the dither kills banding in the dark gradients).
  float n1 = hash12(gl_FragCoord.xy + fract(uTime * 7.13) * 91.7);
  float n2 = hash12(gl_FragCoord.xy * 1.37 + fract(uTime * 3.71) * 53.1);
  float tri = n1 + n2 - 1.0;
  col += tri * (uGrain * 0.5 + 1.0 / 255.0);
  col *= uFade;
  gl_FragColor = vec4(col, 1.0);
}`;

export interface PostParams {
  exposure: number;
  bloom: number;
  chroma: number;
  grain: number;
  vignette: number;
  bloomEnabled: boolean;
  time: number;
  fade: number;
}

export class Post {
  private readonly renderer: THREE.WebGLRenderer;
  private sceneRT: THREE.WebGLRenderTarget | null = null;
  private mips: THREE.WebGLRenderTarget[] = [];
  private readonly tri: THREE.Mesh;
  private readonly fsScene = new THREE.Scene();
  private readonly fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly downMat: THREE.ShaderMaterial;
  private readonly upMat: THREE.ShaderMaterial;
  private readonly compMat: THREE.ShaderMaterial;
  private width = 2;
  private height = 2;
  samples = 4;
  levels = 5;
  /** Weight of each successive bloom level (lower = tighter glow, less total energy). */
  bloomDecay = 0.62;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    const common = { depthTest: false, depthWrite: false, toneMapped: false } as const;
    this.downMat = new THREE.ShaderMaterial({
      ...common,
      vertexShader: FS_VERT,
      fragmentShader: DOWN_FRAG,
      uniforms: {
        tSrc: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uFirst: { value: 0 },
        uThreshold: { value: 0.9 },
        uKnee: { value: 0.6 },
      },
    });
    this.upMat = new THREE.ShaderMaterial({
      ...common,
      vertexShader: FS_VERT,
      fragmentShader: UP_FRAG,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } },
    });
    this.compMat = new THREE.ShaderMaterial({
      ...common,
      vertexShader: FS_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uExposure: { value: 1 },
        uBloom: { value: 0.8 },
        uChroma: { value: 0.001 },
        uGrain: { value: 0.02 },
        uVignette: { value: 0.5 },
        uFade: { value: 1 },
      },
    });
    this.tri = new THREE.Mesh(geo, this.downMat);
    this.tri.frustumCulled = false;
    this.fsScene.add(this.tri);
  }

  get sceneTarget(): THREE.WebGLRenderTarget {
    return this.sceneRT as THREE.WebGLRenderTarget;
  }

  /** (Re)allocates targets. `w`,`h` are the scene resolution; output resolution is the canvas. */
  resize(w: number, h: number, samples: number, levels: number): void {
    w = Math.max(2, Math.floor(w));
    h = Math.max(2, Math.floor(h));
    if (
      this.sceneRT &&
      w === this.width &&
      h === this.height &&
      samples === this.samples &&
      levels === this.levels
    )
      return;
    this.width = w;
    this.height = h;
    this.samples = samples;
    this.levels = levels;
    this.disposeTargets();
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false,
      samples,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    this.sceneRT.texture.name = 'scene-hdr';
    let mw = w;
    let mh = h;
    for (let i = 0; i < levels; i++) {
      mw = Math.max(2, mw >> 1);
      mh = Math.max(2, mh >> 1);
      const rt = new THREE.WebGLRenderTarget(mw, mh, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
      });
      rt.texture.name = `bloom-${i}`;
      this.mips.push(rt);
    }
  }

  private disposeTargets(): void {
    this.sceneRT?.dispose();
    this.sceneRT = null;
    for (const m of this.mips) m.dispose();
    this.mips.length = 0;
  }

  /** Renders the scene into the HDR target, builds bloom, and composites to `output` (null = canvas). */
  render(
    scene: THREE.Scene,
    camera: THREE.Camera,
    p: PostParams,
    outW: number,
    outH: number,
    overlay?: THREE.Scene,
  ): void {
    const r = this.renderer;
    const rt = this.sceneRT as THREE.WebGLRenderTarget;
    r.setRenderTarget(rt);
    r.clear(true, true, false);
    r.render(scene, camera);
    if (overlay) {
      // Drawn last, with a fresh depth buffer: nothing in the scene can cover it (design 7.3: "the moon is last").
      r.clearDepth();
      r.render(overlay, camera);
    }

    const comp = this.compMat.uniforms;
    if (p.bloomEnabled && this.mips.length > 0) {
      this.tri.material = this.downMat;
      const du = this.downMat.uniforms;
      let src: THREE.Texture = rt.texture;
      let sw = this.width;
      let sh = this.height;
      for (let i = 0; i < this.mips.length; i++) {
        const dst = this.mips[i]!;
        du.tSrc!.value = src;
        du.uTexel!.value.set(1 / sw, 1 / sh);
        du.uFirst!.value = i === 0 ? 1 : 0;
        r.setRenderTarget(dst);
        r.render(this.fsScene, this.fsCam);
        src = dst.texture;
        sw = dst.width;
        sh = dst.height;
      }
      this.tri.material = this.upMat;
      const uu = this.upMat.uniforms;
      for (let i = this.mips.length - 2; i >= 0; i--) {
        const from = this.mips[i + 1]!;
        uu.tSrc!.value = from.texture;
        uu.uTexel!.value.set(1 / from.width, 1 / from.height);
        uu.uWeight!.value = this.bloomDecay;
        r.setRenderTarget(this.mips[i]!);
        r.render(this.fsScene, this.fsCam);
      }
      comp.tBloom!.value = this.mips[0]!.texture;
      comp.uBloom!.value = p.bloom;
    } else {
      comp.tBloom!.value = this.mips[0]?.texture ?? rt.texture;
      comp.uBloom!.value = 0;
    }

    this.tri.material = this.compMat;
    comp.tScene!.value = rt.texture;
    comp.uRes!.value.set(outW, outH);
    comp.uTime!.value = p.time;
    comp.uExposure!.value = p.exposure;
    comp.uChroma!.value = p.chroma;
    comp.uGrain!.value = p.grain;
    comp.uVignette!.value = p.vignette;
    comp.uFade!.value = p.fade;
    r.setRenderTarget(null);
    r.render(this.fsScene, this.fsCam);
  }

  dispose(): void {
    this.disposeTargets();
    this.downMat.dispose();
    this.upMat.dispose();
    this.compMat.dispose();
    this.tri.geometry.dispose();
  }
}
