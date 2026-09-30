import { describe, expect, it } from 'vitest';
import {
  formatAge,
  formatAgo,
  formatBandwidth,
  formatBytes,
  formatCompact,
  formatDuration,
  formatEndpoint,
  formatEta,
  formatFlux,
  formatHeight,
  formatInt,
  formatPercent,
  formatTabular,
  formatUtcTime,
  heightEta,
  middleTruncate,
  parseEndpoint,
  parseFlux,
  shortCollateral,
  UNKNOWN,
} from './format';

describe('FLUX amounts', () => {
  it('parses 8-decimal strings exactly', () => {
    expect(parseFlux('1234.56789012')).toBe(123456789012n);
    expect(parseFlux('-0.5')).toBe(-50_000_000n);
    expect(parseFlux('12')).toBe(1_200_000_000n);
    expect(parseFlux('.25')).toBe(25_000_000n);
    expect(parseFlux('560000000.00000000')).toBe(56_000_000_000_000_000n);
    expect(parseFlux('0.123456789')).toBe(12_345_679n);
    expect(parseFlux(null)).toBeNull();
    expect(parseFlux('abc')).toBeNull();
  });

  it('formats summaries with 2 decimals and details with 8', () => {
    expect(formatFlux('9.00000000')).toBe('9.00 FLUX');
    expect(formatFlux('1234.56789012')).toBe('1,234.57 FLUX');
    expect(formatFlux('1234.56789012', { decimals: 8 })).toBe('1,234.56789012 FLUX');
    expect(formatFlux('0.00500000')).toBe('0.01 FLUX');
    expect(formatFlux('0.00499999')).toBe('0.00 FLUX');
    expect(formatFlux('-3.505', { unit: false })).toBe('-3.51');
    expect(formatFlux('9', { sign: 'always', unit: false })).toBe('+9.00');
    expect(formatFlux('0', { sign: 'always', unit: false })).toBe('0.00');
    expect(formatFlux('430557127.12345678', { decimals: 0 })).toBe('430,557,127 FLUX');
    expect(formatFlux(undefined)).toBe(UNKNOWN);
  });

  it('keeps supply-sized values exact (no float rounding)', () => {
    expect(formatFlux('9007199254.74099999', { decimals: 8 })).toBe('9,007,199,254.74099999 FLUX');
  });
});

describe('numbers', () => {
  it('groups, compacts and pads', () => {
    expect(formatInt(6724)).toBe('6,724');
    expect(formatHeight(2996914)).toBe('2,996,914');
    expect(formatInt(null)).toBe(UNKNOWN);
    expect(formatCompact(6724)).toBe('6,724');
    expect(formatCompact(54451)).toBe('54.5K');
    expect(formatPercent(0.2713)).toBe('27.1%');
    expect(formatTabular(42, 5)).toBe('   42');
  });
});

describe('time', () => {
  it('formats ages', () => {
    expect(formatAge(400)).toBe('now');
    expect(formatAge(4_200)).toBe('4 s');
    expect(formatAge(41_000)).toBe('41 s');
    expect(formatAge(12 * 60_000 + 5)).toBe('12 min');
    expect(formatAge(3 * 3_600_000)).toBe('3 h');
    expect(formatAgo(12_000)).toBe('12 s ago');
    expect(formatAgo(10)).toBe('now');
  });

  it('formats durations with two units', () => {
    expect(formatDuration(41_000)).toBe('41 s');
    expect(formatDuration(12 * 60_000 + 5_000)).toBe('12m 5s');
    expect(formatDuration(3 * 3_600_000 + 12 * 60_000)).toBe('3h 12m');
    expect(formatDuration(5 * 86_400_000 + 3 * 3_600_000)).toBe('5d 3h');
    expect(formatDuration(25 * 86_400_000 + 18 * 3_600_000)).toBe('25d 18h');
  });

  it('formats ETAs by the queue copy rules', () => {
    expect(formatEta(28_000)).toBe('in 28 s');
    expect(formatEta(89_000)).toBe('in 89 s');
    expect(formatEta(12 * 60_000)).toBe('in 12 min');
    expect(formatEta(14.7 * 3_600_000)).toBe('in 14.7 h');
    expect(formatEta(26 * 86_400_000)).toBe('in 26d');
  });

  it('converts heights to ETAs on the 30 s cadence', () => {
    const e = heightEta(3_071_200, { height: 2_996_929, timeMs: 1_000_000 }, 1_010_000);
    expect(e.blocks).toBe(74_271);
    expect(e.atMs).toBe(1_000_000 + 74_271 * 30_000);
    expect(e.etaMs).toBe(74_271 * 30_000 - 10_000);
    expect(formatDuration(e.etaMs)).toBe('25d 18h');
  });

  it('formats UTC times', () => {
    expect(formatUtcTime(Date.UTC(2026, 8, 30, 19, 39, 4))).toBe('19:39:04 UTC');
  });
});

describe('sizes', () => {
  it('formats bytes and bandwidth', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(3_400)).toBe('3.4 KB');
    expect(formatBytes(182e12)).toBe('182 TB');
    expect(formatBytes(3.19e15)).toBe('3.19 PB');
    expect(formatBandwidth(949)).toBe('949 Mbps');
    expect(formatBandwidth(1_234)).toBe('1.23 Gbps');
  });
});

describe('identifiers', () => {
  it('parses and formats endpoints', () => {
    expect(parseEndpoint('65.109.26.93:16147')).toEqual({ host: '65.109.26.93', port: 16147, ipv6: false });
    expect(parseEndpoint('[2001:db8::1]:16137')).toEqual({ host: '2001:db8::1', port: 16137, ipv6: true });
    expect(parseEndpoint('2001:db8::1')).toEqual({ host: '2001:db8::1', port: null, ipv6: true });
    expect(parseEndpoint('')).toBeNull();
    expect(formatEndpoint('65.109.26.93:16127', { hideDefaultPort: true })).toBe('65.109.26.93');
    expect(formatEndpoint({ host: '2001:db8::1', port: 16137, ipv6: true })).toBe('[2001:db8::1]:16137');
    expect(formatEndpoint(null)).toBe(UNKNOWN);
  });

  it('middle-truncates hashes and collateral', () => {
    const txid = '2c9937a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabf7b6b';
    expect(middleTruncate(txid)).toBe('2c9937…f7b6b');
    expect(middleTruncate('short')).toBe('short');
    expect(shortCollateral(`${txid}:1`)).toBe('2c9937…f7b6b:1');
  });
});
