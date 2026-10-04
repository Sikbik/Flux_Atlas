import { describe, expect, it } from 'vitest';
import type { IndexTotals } from './apps';
import { appsPerOwner, enterpriseShare, enterpriseShareNote, heroCaption, instancesNote } from './hero';

const totals: IndexTotals = {
  apps: 1963,
  active: 1798,
  instances: 8412,
  wanted: 8715,
  enterpriseApps: 996,
  enterpriseInstances: 3369,
};

describe('heroCaption', () => {
  it('says how many instances run across how many apps, and how much of it is enterprise', () => {
    expect(heroCaption(totals, 996)).toBe(
      '8,412 instances are running across 1,798 apps. Enterprise apps are 51% of all apps and keep their size private.',
    );
  });

  it('leaves the enterprise sentence out when there are none', () => {
    expect(heroCaption(totals, 0)).toBe('8,412 instances are running across 1,798 apps.');
    expect(heroCaption(totals, null)).toBe('8,412 instances are running across 1,798 apps.');
  });

  it('uses the singular', () => {
    expect(heroCaption({ ...totals, apps: 1, active: 1, instances: 1 }, 0)).toBe(
      '1 instance is running across 1 app.',
    );
  });

  it("reads the enterprise count it is given, not the index's, so it agrees with the figure under it", () => {
    // The index counts 520 enterprise apps of 1,000 (52%); the overview, which the figure shows, counts 500 (50%).
    const t: IndexTotals = { ...totals, apps: 1000, active: 900, enterpriseApps: 520 };
    const sentence = heroCaption(t, 500);
    const note = enterpriseShareNote(500, t.apps);
    expect(sentence).toContain('Enterprise apps are 50% of all apps');
    expect(note).toBe('50% of all apps');
    expect(sentence).not.toContain('52%');
    // The percentage in the sentence is the one in the note, whatever the counts.
    const percent = (text: string) => /(\d+%)/.exec(text)?.[1];
    expect(percent(sentence.split('Enterprise')[1] ?? '')).toBe(percent(note ?? ''));
    expect(enterpriseShare(500, 1000)).toBe('50%');
  });

  it('says the index is empty when it is', () => {
    expect(heroCaption({ ...totals, apps: 0, active: 0, instances: 0 }, 0)).toBe(
      'The index holds no apps yet.',
    );
  });
});

describe('appsPerOwner', () => {
  it('is one decimal', () => {
    expect(appsPerOwner(1963, 1396)).toBe('1.4');
  });

  it('is unknown, not zero, while either count is missing or there are no owners', () => {
    expect(appsPerOwner(null, 1396)).toBeNull();
    expect(appsPerOwner(1963, null)).toBeNull();
    expect(appsPerOwner(1963, 0)).toBeNull();
  });
});

describe('the notes under the figures', () => {
  it('puts the instances against the ones the specs ask for', () => {
    expect(instancesNote(totals)).toBe('of 8,715 the specs ask for');
    expect(instancesNote(null)).toBeNull();
    expect(instancesNote({ ...totals, wanted: 0 })).toBeNull();
  });

  it('gives the enterprise share of the apps', () => {
    expect(enterpriseShareNote(996, 1963)).toBe('51% of all apps');
    expect(enterpriseShareNote(996, null)).toBeNull();
    expect(enterpriseShareNote(null, 1963)).toBeNull();
  });
});
