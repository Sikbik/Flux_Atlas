import { describe, expect, it } from 'vitest';
import { railRows } from './capacity';
import { capacityTileText, countriesTileText, economyTileText, ownersTileText, pendingText } from './tiles';

describe('pendingText', () => {
  it('says what is waiting and what is installing', () => {
    expect(pendingText(2, 0)).toBe('2 waiting');
    expect(pendingText(0, 5)).toBe('5 installing');
    expect(pendingText(3, 12)).toBe('3 waiting, 12 installing');
  });

  it('says there is nothing, which is a true zero from the live feed', () => {
    expect(pendingText(0, 0)).toBe('Nothing waiting');
  });
});

describe('capacityTileText', () => {
  it('names the resource apps lock the largest share of', () => {
    const rows = railRows({
      used: { cores: 6934, ram_gb: 12_129, ssd_gb: 125_304 },
      network: { cores: 56_223, ram_gb: 188_267, ssd_gb: 3_282_734 },
    });
    expect(capacityTileText(rows)).toBe('12.3% of CPU locked');
  });

  it('says nothing while the network capacity is not known', () => {
    const rows = railRows({
      used: { cores: 1, ram_gb: 1, ssd_gb: 1 },
      network: { cores: 0, ram_gb: 0, ssd_gb: 0 },
    });
    expect(capacityTileText(rows)).toBeUndefined();
  });
});

describe('the other tile lines', () => {
  it('says what apps paid, and nothing while it is not known', () => {
    expect(economyTileText(259_431.78)).toBe('259K FLUX, 30 days');
    expect(economyTileText(null)).toBeUndefined();
  });

  it('counts owners and countries, and nothing before the overview is in', () => {
    expect(ownersTileText(1396)).toBe('1,396 owners');
    expect(ownersTileText(1)).toBe('1 owner');
    expect(ownersTileText(null)).toBeUndefined();
    expect(countriesTileText(82)).toBe('82 countries');
    expect(countriesTileText(1)).toBe('1 country');
    expect(countriesTileText(null)).toBeUndefined();
  });
});
