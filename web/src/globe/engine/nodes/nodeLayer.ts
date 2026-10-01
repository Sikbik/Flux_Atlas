// Node layer: every node is one instance of a camera-facing quad, drawn additively.
// Positions come from a float texture written by the layout step, so arcs, rings and packets can
// fetch the very same (fanned, extruded) position by slot index on the GPU.

import * as THREE from 'three';
import type { SharedUniforms } from '../uniforms';
import { KNOCK_FRAG, NODE_FRAG, NODE_VERT } from './nodeShaders';
import { NodeStore } from './store';

const POS_W = 256;

export class NodeLayer {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly geometry: THREE.InstancedBufferGeometry;
  /** The dark halo behind every marker (multiply). A child of `mesh`, so it follows its visibility. */
  readonly knock: THREE.Mesh;
  readonly knockMaterial: THREE.ShaderMaterial;
  /** Engine time the current selection started: the selected marker's ring locks on from here. */
  readonly selectedAt = { value: -1e9 };
  private selSeen = 0;
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
    const uniforms: Record<string, THREE.IUniform> = {
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
      uShock: u.uShock,
      uShockHot: u.uShockHot,
      uSelAt: this.selectedAt,
      uWave: u.uWave,
      uWaveP: u.uWaveP,
      uReveal: u.uReveal,
      uRevealPx: u.uRevealPx,
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: NODE_VERT,
      fragmentShader: NODE_FRAG,
      uniforms,
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
    // The knock pass shares the geometry (so the instance buffers upload once) and every uniform.
    this.knockMaterial = new THREE.ShaderMaterial({
      vertexShader: NODE_VERT,
      fragmentShader: KNOCK_FRAG,
      defines: { NODE_KNOCK: '' },
      uniforms,
      transparent: true,
      // dst * (1 - alpha): darkens what is behind the marker; alpha channel untouched (see above).
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      depthTest: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.knock = new THREE.Mesh(this.geometry, this.knockMaterial);
    this.knock.frustumCulled = false;
    // Just before the markers (and after the cluster pads at 25): darken the basemap, then add light.
    this.knock.renderOrder = 29;
    this.mesh.add(this.knock);
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
    // A new selection restarts the lock-on of its ring (the engine time is already this frame's).
    if (s.selectionSerial !== this.selSeen) {
      this.selSeen = s.selectionSerial;
      this.selectedAt.value = this.u.uTime.value;
    }
  }

  dispose(): void {
    this.posTex.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.knockMaterial.dispose();
  }
}
