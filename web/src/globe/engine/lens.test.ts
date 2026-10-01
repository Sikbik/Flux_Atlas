import { describe, expect, it } from 'vitest';
import { GLSL_LENS, LENS_PPR_FAR, LENS_PPR_NEAR, lensAtDistance, lensZoom } from './lens';

describe('lens ramp', () => {
  it('is off at the global and regional views and on up close', () => {
    expect(lensZoom(LENS_PPR_FAR)).toBe(0);
    expect(lensZoom(LENS_PPR_FAR * 0.2)).toBe(0);
    expect(lensZoom(LENS_PPR_NEAR)).toBe(1);
    expect(lensZoom(LENS_PPR_NEAR * 10)).toBe(1);
    expect(lensZoom(0)).toBe(0);
    expect(lensZoom(Number.NaN)).toBe(0);
  });

  it('rises smoothly and monotonically with zoom (no threshold)', () => {
    let prev = -1;
    let maxStep = 0;
    for (let ppr = LENS_PPR_FAR; ppr <= LENS_PPR_NEAR; ppr *= 1.01) {
      const l = lensZoom(ppr);
      expect(l).toBeGreaterThanOrEqual(prev);
      if (prev >= 0) maxStep = Math.max(maxStep, l - prev);
      prev = l;
    }
    // A 1% change in distance never moves the lens by more than a few hundredths.
    expect(maxStep).toBeLessThan(0.03);
  });

  it('leaves the global view alone and keeps the fly-to view modest', () => {
    const proj = 1472; // 1600x900 viewport, 34 degree lens
    expect(lensAtDistance(proj, 3.6)).toBe(0);
    expect(lensAtDistance(proj, 1.0)).toBe(0);
    // The node fly-to altitude (range 0.3): a gentle start, not the full treatment.
    const fly = lensAtDistance(proj, 0.3);
    expect(fly).toBeGreaterThan(0.15);
    expect(fly).toBeLessThan(0.4);
    // The closest zoom is fully in.
    expect(lensAtDistance(proj, 0.0125)).toBe(1);
  });

  it('a bigger screen starts earlier (its texels are bigger in pixels)', () => {
    expect(lensAtDistance(2355, 0.3)).toBeGreaterThan(lensAtDistance(1472, 0.3));
  });

  it('the GLSL carries the same constants', () => {
    expect(GLSL_LENS).toContain(String((1 / LENS_PPR_FAR).toFixed(8)));
    expect(GLSL_LENS).toContain('float lensZoom(float camDist, float pprScale)');
    expect(GLSL_LENS).toContain('float lensVignette(vec2 ndc, float aspect, float edge)');
  });
});
