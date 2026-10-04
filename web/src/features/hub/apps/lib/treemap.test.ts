import { describe, expect, it } from 'vitest';
import { type AppRank, rankApps } from './apps';
import { app, enterprise } from './fixtures';
import {
  cellBudget,
  cellFacts,
  estimateWidth,
  fitName,
  footprintText,
  lockedText,
  MAX_CELLS,
  type Measure,
  MIN_CELLS,
  mapCaption,
  mapItems,
  nameLines,
  tailSplit,
  valueText,
} from './treemap';

const NETWORK = { cores: 1000, ram_gb: 2000, ssd_gb: 10_000 };
const apps = [
  app({
    name: 'wide',
    display_name: 'Wide',
    instances_running: 50,
    instances_target: 50,
    per_instance: { cpu: 0.1, ram_mb: 128, hdd_gb: 1 },
  }),
  app({
    name: 'heavy',
    display_name: 'Heavy',
    instances_running: 5,
    instances_target: 8,
    per_instance: { cpu: 8, ram_mb: 16_384, hdd_gb: 500 },
  }),
  enterprise({ name: 'secret', display_name: 'Secret', instances_running: 80, instances_target: 80 }),
];
const byInstances = rankApps(apps, 'instances', NETWORK);
const byFootprint = rankApps(apps, 'footprint', NETWORK);

describe('cellBudget', () => {
  it('draws at most the cap, however big the box', () => {
    expect(cellBudget(2000, 2000)).toBe(MAX_CELLS);
  });

  it('draws at least a handful in a small box', () => {
    expect(cellBudget(200, 120)).toBe(MIN_CELLS);
  });

  it('follows the area in between', () => {
    expect(cellBudget(300, 200)).toBe(Math.floor((300 * 200) / 4800));
  });
});

describe('mapItems', () => {
  it('sizes a cell by the instances, or by the footprint', () => {
    expect(mapItems(byInstances, 'instances', 10).map((i) => [i.id, i.value])).toEqual([
      ['secret', 80],
      ['wide', 50],
      ['heavy', 5],
    ]);
    const f = mapItems(byFootprint, 'footprint', 10);
    expect(f.map((i) => i.id)).toEqual(['heavy', 'wide']);
    expect(f[0]?.value).toBeCloseTo(0.11);
  });

  it('draws the biggest and no more than the limit', () => {
    expect(mapItems(byInstances, 'instances', 2).map((i) => i.id)).toEqual(['secret', 'wide']);
  });
});

describe('tailSplit', () => {
  it('says what the drawn apps hold of the whole, and what the rest hold', () => {
    const t = tailSplit(byInstances, 'instances', 2);
    expect(t.drawn).toBe(130);
    expect(t.rest).toBe(5);
    expect(t.restApps).toBe(1);
    expect(t.share).toBeCloseTo(130 / 135);
  });

  it('has no tail when every app is drawn', () => {
    const t = tailSplit(byInstances, 'instances', 30);
    expect(t.restApps).toBe(0);
    expect(t.rest).toBe(0);
    expect(t.share).toBe(1);
  });

  it('has a share of zero, not a division by zero, for nothing at all', () => {
    expect(tailSplit([], 'instances', 5)).toEqual({ drawn: 0, rest: 0, restApps: 0, share: 0 });
  });
});

describe('footprintText', () => {
  it('keeps the digits that mean something at its size', () => {
    expect(footprintText(0.123)).toBe('12.3%');
    expect(footprintText(0.0031)).toBe('0.31%');
    expect(footprintText(0.00004)).toBe('<0.01%');
    expect(footprintText(0)).toBe('0%');
  });
});

describe('valueText and lockedText', () => {
  const heavy = byInstances.find((r) => r.name === 'heavy') as AppRank;
  const secret = byInstances.find((r) => r.name === 'secret') as AppRank;

  it('shows the instances, or the footprint', () => {
    expect(valueText(heavy, 'instances')).toBe('5');
    expect(valueText(heavy, 'footprint')).toBe('11.0%');
  });

  it('shows Unknown for the footprint of an enterprise app, never 0%', () => {
    expect(valueText(secret, 'footprint')).toBe('Unknown');
    expect(lockedText(secret)).toBeNull();
  });

  it('says what the running instances lock', () => {
    expect(lockedText(heavy)).toBe('40 cores, 80 GB memory, 2.5 TB storage');
  });
});

describe('cellFacts', () => {
  const find = (n: string) => byInstances.find((r) => r.name === n) as AppRank;

  it('says how many are running, of how many the spec asks for, and the share of all', () => {
    expect(cellFacts(find('heavy'), 135)[0]).toBe('5 of 8 instances running (3.7% of all)');
    expect(cellFacts(find('wide'), 135)[0]).toBe('50 instances running (37.0% of all)');
  });

  it('says an enterprise app keeps its size private', () => {
    expect(cellFacts(find('secret'), 135)[1]).toBe('Enterprise app: its size is private');
  });

  it('gives no share when the total is not known', () => {
    expect(cellFacts(find('wide'), 0)[0]).toBe('50 instances running');
  });
});

describe('mapCaption', () => {
  it('says what area is and how many apps are drawn against the rest', () => {
    const text = mapCaption(byInstances, 'instances', 2, 0);
    expect(text).toContain('Area is the number of instances running.');
    expect(text).toContain('The 2 biggest apps are drawn to scale against each other.');
  });

  it('does not say some are left undrawn when all are drawn', () => {
    expect(mapCaption(byInstances, 'instances', 3, 0)).not.toContain('biggest apps');
  });

  it('says what footprint is, and how many enterprise apps it leaves out', () => {
    const text = mapCaption(byFootprint, 'footprint', 1, 996);
    expect(text).toContain("average of the app's share of the network's CPU, memory and storage");
    expect(text).toContain('996 enterprise apps keep their size private and are left out.');
  });

  it('uses the singular for one app left out', () => {
    expect(mapCaption(byFootprint, 'footprint', 2, 1)).toContain(
      '1 enterprise app keeps its size private and is left out.',
    );
  });
});

describe('fitName', () => {
  it('leaves a name that fits alone', () => {
    expect(fitName('explorer', 120)).toBe('explorer');
  });

  it('cuts a long name in the middle and keeps its end, where the names of a family differ', () => {
    const fitted = fitName('FoldingAtRunOnFlux29', 80);
    expect(fitted.length).toBeLessThanOrEqual(12);
    expect(fitted.startsWith('Folding')).toBe(true);
    expect(fitted.endsWith('ux29')).toBe(true);
    expect(fitted).toContain('…');
  });

  it('keeps at least a few letters of a name in a very narrow cell', () => {
    expect(fitName('FoldingAtRunOnFlux29', 10).length).toBeGreaterThanOrEqual(4);
  });
});

describe('nameLines', () => {
  it('leaves a name that fits on one line on one line', () => {
    expect(nameLines('explorer', 120)).toEqual(['explorer']);
    expect(nameLines('fluxapp2', 60)).toEqual(['fluxapp2']);
  });

  it('splits an unbroken name in the middle instead of leaving its last character on a line of its own', () => {
    expect(nameLines('fluxapp2', 40)).toEqual(['flux', 'app2']);
    expect(nameLines('fluxapp58', 40)).toEqual(['fluxa', 'pp58']);
    expect(nameLines('abcdefghijk', 60)).toEqual(['abcdef', 'ghijk']);
  });

  it('breaks at a natural place close to the middle: letters from digits, a hyphen, a space', () => {
    expect(nameLines('fluxapp1186', 70)).toEqual(['fluxapp', '1186']);
    expect(nameLines('globalping-probe', 80)).toEqual(['globalping-', 'probe']);
    expect(nameLines('Folding At Home App', 80)).toEqual(['Folding At', 'Home App']);
  });

  it('passes over a natural break that would leave a stub', () => {
    // `fluxapp` over `2` is a natural break, but a line of one character is not a line.
    expect(nameLines('fluxapp2', 40)[1]).toBe('app2');
    expect(nameLines('abcd12', 30)).toEqual(['abc', 'd12']);
  });

  it('never leaves a stub of one or two characters when the name could be split evenly', () => {
    const names = [
      'fluxapp1186',
      'fluxapp118',
      'fluxapp58',
      'fluxapp75',
      'fluxapp2',
      'abcd12',
      'FoldingAtRunOnFlux29',
      'dragonwilds1791118860064',
      'sproxyh1791106705600',
      'globalping-probe',
      'probeamericas',
      'softethervpn-test',
    ];
    for (const name of names) {
      for (let width = 40; width <= 200; width += 4) {
        const lines = nameLines(name, width);
        if (lines.length === 2) {
          for (const line of lines) expect(line.replace('…', '').length).toBeGreaterThanOrEqual(3);
        }
        // Every line fits what it is given, and the whole name is kept when it fits in two.
        for (const line of lines) expect(estimateWidth(line)).toBeLessThanOrEqual(width);
        if (name.length <= Math.floor(width / 6.7) * 2) expect(lines.join('')).toBe(name);
      }
    }
  });

  it('keeps the start and the end of a name too long for two lines, where a family of names differs', () => {
    expect(nameLines('FoldingAtRunOnFlux29', 64)).toEqual(['FoldingAt', '…nFlux29']);
    const [first, second] = nameLines('dragonwilds1791118860064', 64);
    expect(first.startsWith('dragon')).toBe(true);
    expect(second?.endsWith('860064')).toBe(true);
  });

  it('fits the lines to the width as the measure sees it, not as a character count does', () => {
    // A face in which every letter is 10 px wide and the ellipsis 20: a 64 px line holds 6 letters.
    const wide: Measure = (text) => [...text].reduce((w, ch) => w + (ch === '…' ? 20 : 10), 0);
    expect(nameLines('abcdefghijklmn', 64)).toEqual(['abcdefg', 'hijklmn']);
    expect(nameLines('abcdefghijklmn', 64, wide)).toEqual(['abcdef', '…klmn']);
  });
});

describe('fitName with a measure', () => {
  it('cuts until the text fits as measured, keeping the end', () => {
    const wide: Measure = (text) => [...text].reduce((w, ch) => w + (ch === '…' ? 20 : 10), 0);
    const cut = fitName('FoldingAtRunOnFlux29', 90, wide);
    expect(wide(cut)).toBeLessThanOrEqual(90);
    expect(cut.endsWith('29')).toBe(true);
    expect(cut).toContain('…');
    expect(fitName('explorer', 90, wide)).toBe('explorer');
  });
});
