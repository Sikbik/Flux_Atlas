// A coarse, decaying heat map of where on the globe things have been happening (heartbeats,
// payouts, joins, deploys). The ambient director reads it to drift toward the busiest region; it
// is 10 degree cells, so a hit costs a few arithmetic operations and nothing is allocated.

const ROWS = 18;
const COLS = 36;

export class Activity {
  private readonly cells = new Float32Array(ROWS * COLS);
  /** Seconds for activity to fall to 1/e. */
  halfLife = 18;

  /** Records activity at a unit direction. */
  hit(x: number, y: number, z: number, amp: number): void {
    const lat = Math.asin(y > 1 ? 1 : y < -1 ? -1 : y);
    const lon = Math.atan2(x, z);
    const r = Math.min(ROWS - 1, Math.max(0, Math.floor(((lat + Math.PI / 2) / Math.PI) * ROWS)));
    const c = Math.min(COLS - 1, Math.max(0, Math.floor(((lon + Math.PI) / (Math.PI * 2)) * COLS)));
    this.cells[r * COLS + c]! += amp;
  }

  update(dt: number): void {
    const k = Math.exp(-dt / this.halfLife);
    const a = this.cells;
    for (let i = 0; i < a.length; i++) a[i]! *= k;
  }

  /** Sum of all cells: a rough measure of how busy the network has been lately. */
  total(): number {
    let t = 0;
    const a = this.cells;
    for (let i = 0; i < a.length; i++) t += a[i]!;
    return t;
  }

  clear(): void {
    this.cells.fill(0);
  }

  /**
   * The hottest 3x3 block of cells. Writes its weighted center (degrees) and score to `out`.
   * Returns false when nothing has happened yet.
   */
  hottest(
    out: { lat: number; lon: number; score: number },
    skipLat = 999,
    skipLon = 999,
    skipRadiusDeg = 0,
  ): boolean {
    let best = 0;
    let br = -1;
    let bc = -1;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        let s = 0;
        for (let dr = -1; dr <= 1; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= ROWS) continue;
          for (let dc = -1; dc <= 1; dc++) s += this.cells[rr * COLS + ((c + dc + COLS) % COLS)]!;
        }
        if (skipRadiusDeg > 0) {
          const lat = (r + 0.5) * 10 - 90;
          const lon = (c + 0.5) * 10 - 180;
          if (
            Math.abs(lat - skipLat) < skipRadiusDeg &&
            Math.abs(((lon - skipLon + 540) % 360) - 180) < skipRadiusDeg
          )
            continue;
        }
        if (s > best) {
          best = s;
          br = r;
          bc = c;
        }
      }
    }
    if (br < 0 || best < 0.5) return false;
    let sw = 0;
    let sl = 0;
    let sn = 0;
    let sx = 0;
    let sz = 0;
    for (let dr = -1; dr <= 1; dr++) {
      const rr = br + dr;
      if (rr < 0 || rr >= ROWS) continue;
      for (let dc = -1; dc <= 1; dc++) {
        const cc = (bc + dc + COLS) % COLS;
        const w = this.cells[rr * COLS + cc]!;
        const lat = ((rr + 0.5) / ROWS) * 180 - 90;
        const lon = ((cc + 0.5) / COLS) * 360 - 180;
        sw += w;
        sl += lat * w;
        sx += Math.sin((lon * Math.PI) / 180) * w;
        sz += Math.cos((lon * Math.PI) / 180) * w;
        sn++;
      }
    }
    void sn;
    out.lat = sl / sw;
    out.lon = (Math.atan2(sx, sz) * 180) / Math.PI;
    out.score = best;
    return true;
  }
}
