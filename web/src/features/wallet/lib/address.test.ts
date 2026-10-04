import { describe, expect, it } from 'vitest';
import { isWalletAddress } from './address';

describe('isWalletAddress', () => {
  it('accepts a transparent t1 or t3 address', () => {
    expect(isWalletAddress('t1gRaP5qAggMj84X2y8ChKdZfLGYDz6Dhyt')).toBe(true);
    expect(isWalletAddress('t3c4EfxLoXXSRZCRnPRF3RpjPi9mBzF5yoJ')).toBe(true);
  });

  it('refuses a ZelID, which the wallet endpoint answers with a 400', () => {
    expect(isWalletAddress('1cz5PE2QbwzPvqMVohgGqnoaupwzS3k4bx')).toBe(false);
    expect(isWalletAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).toBe(false);
  });

  it('refuses shielded addresses, other prefixes and text that is not base58', () => {
    expect(isWalletAddress(`zs1${'q'.repeat(70)}`)).toBe(false);
    expect(isWalletAddress('t2gRaP5qAggMj84X2y8ChKdZfLGYDz6Dhyt')).toBe(false);
    expect(isWalletAddress('t1gRaP5qAggMj84X2y8ChKdZfLGYDz6Dh0t')).toBe(false);
    expect(isWalletAddress('t1gRaP5qAggMj84X2y8ChKdZfLGYDz6Dhyt ')).toBe(false);
  });

  it('refuses what is too short, too long or missing', () => {
    expect(isWalletAddress('t1')).toBe(false);
    expect(isWalletAddress(`t1${'a'.repeat(40)}`)).toBe(false);
    expect(isWalletAddress('')).toBe(false);
    expect(isWalletAddress(null)).toBe(false);
    expect(isWalletAddress(undefined)).toBe(false);
  });
});
