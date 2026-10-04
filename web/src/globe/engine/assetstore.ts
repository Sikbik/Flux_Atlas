// Loads and owns every texture and geography asset. Consumers read `version` each frame and rebind
// their uniforms when it changes, so the globe renders immediately with placeholders and upgrades
// itself as the files arrive.

import * as THREE from 'three';
import {
  type BorderSegments,
  buildLandMask,
  joinUrl,
  type LandMask,
  loadAdmin1,
  loadBorders,
  loadImage,
  textureFromImage,
} from './assets';
import type { Admin1Lines } from './borders';

function placeholder(r: number, g: number, b: number, srgb = true): THREE.DataTexture {
  const t = new THREE.DataTexture(
    new Uint8Array([r, g, b, 255]),
    1,
    1,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export class AssetStore {
  version = 0;
  day: THREE.Texture = placeholder(6, 12, 28);
  night: THREE.Texture = placeholder(2, 3, 8);
  clouds: THREE.Texture = placeholder(0, 0, 0, false);
  mask: THREE.Texture = placeholder(0, 0, 0, false);
  maskData: Uint8Array | null = null;
  maskW = 0;
  maskH = 0;
  dayImg: HTMLImageElement | null = null;
  nightImg: HTMLImageElement | null = null;
  borders: BorderSegments | null = null;
  /** The state and province lines: fetched only when the camera comes down (`requestAdmin1`). */
  admin1: Admin1Lines | null = null;
  ready: Promise<void>;
  loaded = { day: false, night: false, clouds: false, mask: false, borders: false, admin1: false };
  private admin1Started = false;
  private disposed = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly base: string,
    private readonly hiRes: boolean,
    private readonly wantClouds: boolean,
  ) {
    this.ready = this.loadAll();
  }

  private async loadAll(): Promise<void> {
    const size = this.hiRes ? 4096 : 2048;
    const tasks: Promise<void>[] = [
      this.loadMask(),
      this.loadImageTex(`textures/earth_day_${size}.jpg`, 'day'),
      this.loadImageTex(`textures/earth_night_${size}.jpg`, 'night'),
      this.loadBorderData(),
    ];
    if (this.wantClouds) tasks.push(this.loadImageTex('textures/earth_clouds_2048.jpg', 'clouds'));
    await Promise.all(tasks.map((p) => p.catch((e) => console.warn('[globe] asset failed:', e))));
  }

  private async loadMask(): Promise<void> {
    const m: LandMask = await buildLandMask(this.base, this.hiRes ? 2048 : 1024);
    if (this.disposed) return;
    this.mask.dispose();
    this.mask = m.texture;
    this.maskData = m.data;
    this.maskW = m.width;
    this.maskH = m.height;
    this.loaded.mask = true;
    this.version++;
  }

  private async loadImageTex(path: string, which: 'day' | 'night' | 'clouds'): Promise<void> {
    const img = await loadImage(joinUrl(this.base, path));
    if (this.disposed) return;
    const tex = textureFromImage(img, which !== 'clouds', this.renderer, which);
    if (which === 'day') {
      this.day.dispose();
      this.day = tex;
      this.dayImg = img;
    } else if (which === 'night') {
      this.night.dispose();
      this.night = tex;
      this.nightImg = img;
    } else {
      this.clouds.dispose();
      this.clouds = tex;
    }
    this.loaded[which] = true;
    this.version++;
  }

  private async loadBorderData(): Promise<void> {
    const b = await loadBorders(this.base, this.hiRes);
    if (this.disposed) return;
    this.borders = b;
    this.loaded.borders = true;
    this.version++;
  }

  /**
   * Starts fetching the state and province lines, once. Called when the camera first comes down far
   * enough to want them; never on the low tier. A failure is logged and not retried until the next load.
   */
  requestAdmin1(): void {
    if (this.admin1Started || this.disposed) return;
    this.admin1Started = true;
    loadAdmin1(this.base).then(
      (lines) => {
        if (this.disposed) return;
        this.admin1 = lines;
        this.loaded.admin1 = true;
        this.version++;
      },
      (e) => console.warn('[globe] state lines failed:', e),
    );
  }

  /** Nearest-sample land coverage (0..255) at lat/lon degrees. Returns 255 if the mask is missing. */
  landAt(lat: number, lon: number): number {
    if (!this.maskData) return 255;
    const x = Math.min(this.maskW - 1, Math.max(0, Math.floor(((lon + 180) / 360) * this.maskW)));
    const y = Math.min(this.maskH - 1, Math.max(0, Math.floor(((90 - lat) / 180) * this.maskH)));
    return this.maskData[y * this.maskW + x]!;
  }

  /** Releases everything; `gpu` false skips the GL deletes (the context is gone). */
  dispose(gpu = true): void {
    this.disposed = true;
    if (gpu) {
      this.day.dispose();
      this.night.dispose();
      this.clouds.dispose();
      this.mask.dispose();
    }
    this.maskData = null;
    this.dayImg = null;
    this.nightImg = null;
    this.borders = null;
    this.admin1 = null;
  }
}
