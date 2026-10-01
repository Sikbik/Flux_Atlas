import { describe, expect, it } from 'vitest';
import { hypothesis, joinNames, observation } from './fairnessText';

const row = (label: string, verdict: 'within' | 'above' | 'below') => ({ label, verdict });

describe('joinNames', () => {
  it('reads as a list', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Cumulus'])).toBe('Cumulus');
    expect(joinNames(['Cumulus', 'Nimbus'])).toBe('Cumulus and Nimbus');
    expect(joinNames(['Cumulus', 'Nimbus', 'Stratus'])).toBe('Cumulus, Nimbus and Stratus');
  });
});

describe('observation', () => {
  it('says what a tier below its share did, and what the others did', () => {
    expect(observation([row('Stratus', 'above'), row('Nimbus', 'above'), row('Cumulus', 'below')])).toBe(
      'Cumulus produced fewer blocks than its eligible share; Stratus and Nimbus produced more.',
    );
  });

  it('says it once for a tier above its share and no tier below', () => {
    expect(observation([row('Stratus', 'above'), row('Nimbus', 'within'), row('Cumulus', 'within')])).toBe(
      'Stratus produced more blocks than its eligible share.',
    );
  });

  it('uses the plural for two tiers below', () => {
    expect(observation([row('Nimbus', 'below'), row('Cumulus', 'below'), row('Stratus', 'above')])).toBe(
      'Nimbus and Cumulus produced fewer blocks than their eligible share; Stratus produced more.',
    );
  });

  it('is empty when every tier is in range', () => {
    expect(observation([row('Stratus', 'within'), row('Nimbus', 'within')])).toBe('');
  });
});

describe('hypothesis', () => {
  it('offers missed turns as a cause for a tier below its share, as something that may be so', () => {
    const h = hypothesis([row('Cumulus', 'below'), row('Nimbus', 'above')]);
    expect(h).toMatch(/^Cumulus nodes may be missing their turn more often/);
    expect(h).toMatch(/cannot show it/);
  });

  it('offers nothing when no tier is below its share', () => {
    expect(hypothesis([row('Cumulus', 'above'), row('Nimbus', 'within')])).toBeNull();
  });
});
