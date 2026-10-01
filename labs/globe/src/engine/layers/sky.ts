// Backdrop: a baked nebula (equirect, rendered once) on a fullscreen triangle, plus instanced stars.
// Neither uses depth, so they never touch the camera clip planes.

import * as THREE from 'three';
import { GLSL_CONSTANTS, GLSL_GEO, GLSL_HASH, GLSL_NOISE } from '../shaders/chunks';
import { Rng, TAU } from '../math';
import type { SharedUniforms } from '../uniforms';
import type { GlobeTokens } from '../tokens';

const SKY_VERT = /* glsl */ `
uniform vec3 uCamRight; uniform vec3 uCamUp; uniform vec3 uCamBack;
uniform float uTanHalfFov; uniform float uAspect; uniform vec2 uViewShift;
out vec3 vDir;
void main() {
  vec2 p = position.xy;
  vec2 q = p - uViewShift;
  vDir = uCamRight * (q.x * uTanHalfFov * uAspect) + uCamUp * (q.y * uTanHalfFov) - uCamBack;
  gl_Position = vec4(p, 1.0, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
${GLSL_CONSTANTS}
${GLSL_GEO}
uniform sampler2D uNebula;
uniform vec3 uSpace;
uniform float uNebulaAmount;
in vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 neb = textureLod(uNebula, dirToUv(d), 0.0).rgb * uNebulaAmount;
  gl_FragColor = vec4(uSpace + neb, 1.0);
}`;

const NEBULA_BAKE_FRAG = /* glsl */ `
${GLSL_CONSTANTS}
${GLSL_HASH}
${GLSL_NOISE}
uniform vec3 uTint;
in vec2 vUv;
void main() {
  float lon = (vUv.x - 0.5) * TAU;
  float lat = (vUv.y - 0.5) * PI;
  vec3 d = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  vec3 bandN = normalize(vec3(0.35, 0.78, 0.52));
  float b = dot(d, bandN);
  float band = exp(-b * b * 7.0);
  float n = fbm3(d * 2.4 + 3.0);
  float n2 = fbm3(d * 6.0 + n * 2.6);
  float dust = smoothstep(0.42, 0.78, n2);
  vec3 col = uTint * band * (0.12 + 0.9 * n * n) * 0.7;
  col += vec3(0.42, 0.34, 0.75) * pow(band, 2.2) * n2 * 0.085;
  col *= 1.0 - 0.6 * dust * band;
  // A second, much fainter large-scale wash so the whole sky is not one flat color.
  col += uTint * 0.16 * pow(fbm3(d * 1.3 + 7.0), 2.2);
  gl_FragColor = vec4(col * 0.11, 1.0);
}`;

const STAR_VERT = /* glsl */ `
uniform float uTime; uniform vec2 uViewport; uniform float uPxScale;
in vec3 aDir;
in vec3 aStar; // x = brightness, y = size (css px), z = temperature/phase seed
out vec2 vCorner;
out vec3 vColor;
void main() {
  vec3 vd = mat3(viewMatrix) * aDir;
  vec4 clip = projectionMatrix * vec4(vd, 0.0);
  clip.z = clip.w * 0.99995;
  float tw = 1.0 + 0.22 * sin(uTime * (0.7 + aStar.z * 2.3) + aStar.z * 91.7);
  float size = aStar.y * uPxScale;
  clip.xy += position.xy * size * 2.0 / uViewport * clip.w;
  vCorner = position.xy;
  vec3 warm = vec3(1.0, 0.82, 0.62);
  vec3 cool = vec3(0.62, 0.78, 1.0);
  vColor = mix(warm, cool, aStar.z) * aStar.x * tw;
  gl_Position = clip;
}`;

const STAR_FRAG = /* glsl */ `
in vec2 vCorner;
in vec3 vColor;
void main() {
  float r = length(vCorner);
  float a = exp(-r * r * 3.2) * (1.0 - smoothstep(0.85, 1.0, r));
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

export class Sky {
  readonly group = new THREE.Group();
  private readonly nebulaRT: THREE.WebGLRenderTarget;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly starMat: THREE.ShaderMaterial;
  private readonly starGeo: THREE.InstancedBufferGeometry;
  private readonly skyMesh: THREE.Mesh;
  private readonly starMesh: THREE.Mesh;
  private readonly bakeMat: THREE.ShaderMaterial;
  private readonly bakeScene = new THREE.Scene();
  private readonly bakeMesh: THREE.Mesh;
  private readonly bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private starCount = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    u: SharedUniforms,
    seed: number,
    starCount: number,
    tokens: GlobeTokens,
  ) {
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));

    this.nebulaRT = new THREE.WebGLRenderTarget(1024, 512, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    this.nebulaRT.texture.wrapS = THREE.RepeatWrapping;

    this.bakeMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `out vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy,0.,1.); }`,
      fragmentShader: NEBULA_BAKE_FRAG,
      uniforms: { uTint: { value: new THREE.Color() } },
      depthTest: false,
      depthWrite: false,
    });
    this.bakeMesh = new THREE.Mesh(tri, this.bakeMat);
    this.bakeMesh.frustumCulled = false;
    this.bakeScene.add(this.bakeMesh);

    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uCamRight: u.uCamRight,
        uCamUp: u.uCamUp,
        uCamBack: u.uCamBack,
        uTanHalfFov: u.uTanHalfFov,
        uAspect: u.uAspect,
        uViewShift: u.uViewShift,
        uNebula: { value: this.nebulaRT.texture },
        uSpace: { value: new THREE.Color() },
        uNebulaAmount: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.skyMesh = new THREE.Mesh(tri, this.skyMat);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -100;
    this.group.add(this.skyMesh);

    // Stars
    this.starGeo = new THREE.InstancedBufferGeometry();
    this.starGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    this.starGeo.setIndex([0, 1, 2, 0, 2, 3]);
    this.buildStars(seed, starCount);
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: { uTime: u.uTime, uViewport: u.uViewport, uPxScale: u.uPxScale },
      // Not `transparent`: that would move it into the transparent list, after the planet.
      transparent: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      // Additive light never touches alpha: the moon's exempt mask (see post.ts) lives there.
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
    });
    this.starMesh = new THREE.Mesh(this.starGeo, this.starMat);
    this.starMesh.frustumCulled = false;
    this.starMesh.renderOrder = -90;
    this.group.add(this.starMesh);

    this.setTokens(tokens);
  }

  private buildStars(seed: number, count: number): void {
    const rng = new Rng(seed ^ 0x51ed);
    const dir = new Float32Array(count * 3);
    const info = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Uniform on the sphere
      const z = rng.range(-1, 1);
      const a = rng.range(0, TAU);
      const s = Math.sqrt(1 - z * z);
      dir[i * 3] = s * Math.cos(a);
      dir[i * 3 + 1] = z;
      dir[i * 3 + 2] = s * Math.sin(a);
      // Power-law brightness: a few bright stars, many faint ones.
      const m = Math.pow(rng.next(), 6.5);
      info[i * 3] = 0.12 + m * 2.4;
      info[i * 3 + 1] = 1.0 + m * 2.6;
      info[i * 3 + 2] = rng.next();
    }
    this.starGeo.setAttribute('aDir', new THREE.InstancedBufferAttribute(dir, 3));
    this.starGeo.setAttribute('aStar', new THREE.InstancedBufferAttribute(info, 3));
    this.starGeo.instanceCount = count;
    this.starCount = count;
  }

  setTokens(t: GlobeTokens): void {
    this.skyMat.uniforms.uSpace.value.set(t.space);
    this.bakeMat.uniforms.uTint.value.set(t.nebula);
    // Bake the nebula once per token change.
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.nebulaRT);
    this.renderer.render(this.bakeScene, this.bakeCam);
    this.renderer.setRenderTarget(prev);
  }

  setVisible(stars: boolean, nebula: boolean): void {
    this.starMesh.visible = stars;
    this.skyMat.uniforms.uNebulaAmount.value = nebula ? 1 : 0;
  }

  dispose(): void {
    this.nebulaRT.dispose();
    this.skyMat.dispose();
    this.starMat.dispose();
    this.starGeo.dispose();
    this.bakeMat.dispose();
    (this.skyMesh.geometry as THREE.BufferGeometry).dispose();
  }

  get stars(): number {
    return this.starCount;
  }
}
