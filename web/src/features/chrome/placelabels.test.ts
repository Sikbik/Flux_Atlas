import { describe, expect, it } from 'vitest';
import { spireHeight } from '../../globe/engine/nodes/layout';
import { NetworkStore } from '../../store/network';
import { bootstrap, syntheticNodesBin } from '../../testing/fixtures';
import {
  COUNTRY_MIN_NODES,
  computePlaces,
  LABEL_FADE_PX,
  LABEL_LIMIT,
  labelAltitude,
  labelOpacity,
  labelWidth,
  towerHeight,
} from './placelabels';

function loaded(count: number) {
  const s = new NetworkStore({ now: () => 5_000_000 });
  s.loadSnapshot({ bootstrap: bootstrap(100), nodes: syntheticNodesBin(count, 100) });
  return s;
}

describe('towerHeight', () => {
  it('mirrors the engine so a label floats above the tower it names', () => {
    for (const n of [0, 1, 2, 3, 5, 9, 50, 170, 531, 2_000, 6_724, 100_000]) {
      expect(towerHeight(n)).toBeCloseTo(spireHeight(n), 12);
    }
  });
});

describe('labelAltitude', () => {
  it('sits above the tallest tower, with more air above a real tower than above a lone node', () => {
    expect(labelAltitude(0)).toBeCloseTo(0.012, 12);
    expect(labelAltitude(1)).toBeCloseTo(0.012, 12);
    expect(labelAltitude(531)).toBeGreaterThan(towerHeight(531) + 0.012);
    expect(labelAltitude(2)).toBeCloseTo(0.012 + towerHeight(2) + 0.014, 12);
  });

  it('grows with the hub', () => {
    expect(labelAltitude(100)).toBeGreaterThan(labelAltitude(10));
  });
});

describe('LABEL_LIMIT', () => {
  it('shows few labels at a distance and more as the planet fills the screen', () => {
    expect(LABEL_LIMIT[0]).toBeLessThan(LABEL_LIMIT[1]);
    expect(LABEL_LIMIT[1]).toBeLessThan(LABEL_LIMIT[2]);
    expect(LABEL_LIMIT[3]).toBe(LABEL_LIMIT[2]);
  });
});

describe('computePlaces', () => {
  it('names the countries with enough nodes, biggest first, and skips unlocated nodes', () => {
    const { countries } = computePlaces(loaded(2_000));
    expect(countries.map((c) => c.id).sort()).toEqual(['cc:DE', 'cc:FI', 'cc:US']);
    for (let k = 1; k < countries.length; k++) {
      expect(countries[k - 1]!.count).toBeGreaterThanOrEqual(countries[k]!.count);
    }
    // 1 in 50 nodes has no location; they belong to no country.
    expect(countries.reduce((a, c) => a + c.count, 0)).toBe(2_000 - 2_000 / 50);
    expect(countries.every((c) => c.kind === 'country' && c.count >= COUNTRY_MIN_NODES)).toBe(true);
  });

  it('reads country names in their short form', () => {
    const { countries } = computePlaces(loaded(2_000));
    const names = new Map(countries.map((c) => [c.id, c.text]));
    expect(names.get('cc:DE')).toBe('Germany');
    expect(names.get('cc:US')).toBe('US');
  });

  it('drops a country below the threshold', () => {
    const { countries } = computePlaces(loaded(60));
    expect(countries.every((c) => c.count >= COUNTRY_MIN_NODES)).toBe(true);
  });

  it('gives each country the size of its biggest site, for the height of its label', () => {
    const { countries } = computePlaces(loaded(2_000));
    for (const c of countries) expect(c.hub).toBeGreaterThan(0);
    // Each of the ten synthetic sites holds about a tenth of the nodes.
    expect(Math.max(...countries.map((c) => c.hub))).toBeLessThanOrEqual(2_000 / 9);
  });

  it('lists the biggest sites by name, biggest first, at their own position', () => {
    const { cities } = computePlaces(loaded(2_000));
    expect(cities.length).toBe(10);
    for (let k = 1; k < cities.length; k++)
      expect(cities[k - 1]!.count).toBeGreaterThanOrEqual(cities[k]!.count);
    const c1 = cities.find((c) => c.text === 'City 1');
    expect(c1?.lat).toBe(11);
    expect(c1?.lon).toBe(21);
    expect(c1?.hub).toBe(c1?.count);
  });

  it('places a country at the mean position of its nodes on the sphere', () => {
    const { countries } = computePlaces(loaded(2_000));
    const de = countries.find((c) => c.id === 'cc:DE');
    // Sites 3, 6 and 9 hold the German nodes: latitudes 13, 16 and 19.
    expect(de?.lat).toBeGreaterThan(13);
    expect(de?.lat).toBeLessThan(19);
    expect(de?.lon).toBeGreaterThan(23);
    expect(de?.lon).toBeLessThan(29);
  });

  it('is empty for an empty store', () => {
    const s = new NetworkStore();
    const p = computePlaces(s);
    expect(p.countries).toEqual([]);
    expect(p.cities).toEqual([]);
  });
});

describe('labelWidth', () => {
  it('estimates a width when there is no canvas, wider for tracked capitals', () => {
    const country = labelWidth('Germany', 'country');
    const city = labelWidth('Germany', 'city');
    expect(country).toBeGreaterThan(city);
    expect(labelWidth('Helsinki', 'city')).toBe(Math.round(8 * 6.3));
    expect(labelWidth('UK', 'country')).toBeLessThan(country);
  });
});

describe('labelOpacity', () => {
  const top = 114;

  it('is fully shown well clear of the chrome and facing the camera', () => {
    expect(labelOpacity(1, 400, top)).toBe(1);
    expect(labelOpacity(0.25, 400, top)).toBe(1);
  });

  it('fades out toward the limb', () => {
    expect(labelOpacity(0, 400, top)).toBe(0);
    expect(labelOpacity(0.125, 400, top)).toBe(0.5);
    expect(labelOpacity(-0.2, 400, top)).toBe(0);
  });

  it('is hidden above the clearance line and fades in over the next stretch', () => {
    expect(labelOpacity(1, top - 10, top)).toBe(0);
    expect(labelOpacity(1, top, top)).toBe(0);
    expect(labelOpacity(1, top + LABEL_FADE_PX / 2, top)).toBe(0.5);
    expect(labelOpacity(1, top + LABEL_FADE_PX, top)).toBe(1);
  });

  it('multiplies the two fades and steps in twentieths', () => {
    expect(labelOpacity(0.125, top + LABEL_FADE_PX / 2, top)).toBe(0.25);
    for (let f = 0; f <= 1; f += 0.037) {
      const o = labelOpacity(f, top + 7, top);
      expect(Math.abs(o * 20 - Math.round(o * 20))).toBeLessThan(1e-9);
    }
  });
});
