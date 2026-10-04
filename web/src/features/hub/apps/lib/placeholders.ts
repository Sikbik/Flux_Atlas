// Made-up numbers for the loading states of the Apps hub. A loading panel draws its real markup with these (see
// `Ghost`), so it has the geometry of the loaded one at every width and nothing under it moves when the answer lands.
// None of it is ever read as a figure: the markup is hidden from assistive technology and every glyph in it is drawn
// as a block of the loading gray. The shapes are those of the live network (ten owners, two in five of them with
// enterprise apps, a long tail of countries, ninety days), the digits are not. Pure.

import type { AppDeployDay } from '../../../../api/generated/AppDeployDay';
import type { AppsResources } from '../../../../api/generated/AppsResources';
import type { AppRank, IndexTotals } from './apps';
import { DAY_MS, type DeployTotals } from './deploy';
import type { EconomyGlance } from './economy';
import type { Locked, OwnerRow } from './owners';
import type { ExpiringRow, NewRow } from './rows';

/** What the rails read while the overview is on its way: a few percent of a network of this size. */
export const GHOST_RESOURCES: AppsResources = {
  used: { cores: 3_600, ram_gb: 7_000, ssd_gb: 72_000 },
  network: { cores: 57_800, ram_gb: 203_000, ssd_gb: 3_178_000 },
};

/** Enough enterprise apps for the long form of the rails' note, which is two lines in a narrow hero. */
export const GHOST_ENTERPRISE_APPS = 1_000;

/** The totals the hero's sentence is made of while the index is on its way. */
export const GHOST_TOTALS: IndexTotals = {
  apps: 1_900,
  active: 1_500,
  instances: 8_400,
  wanted: 9_000,
  enterpriseApps: GHOST_ENTERPRISE_APPS,
  enterpriseInstances: 3_000,
};

// ---- the owners ---------------------------------------------------------------------------------------------

const exact = (value: number): Locked => ({ kind: 'exact', value });
const floor = (value: number): Locked => ({ kind: 'atLeast', value });

/** Which of the ten owners also run enterprise apps: two in five, as on the network (a folded row has a second line). */
const WITH_ENTERPRISE = new Set([0, 1, 2, 9]);

/** The owners as the leaderboard draws them. */
export function ghostOwners(n: number): OwnerRow[] {
  return Array.from({ length: n }, (_, i) => {
    const enterprise = WITH_ENTERPRISE.has(i);
    const instances = 720 - i * 52;
    const lock = enterprise ? floor : exact;
    return {
      owner: `1${'x'.repeat(32)}${i}`,
      apps: 180 - i * 11,
      instances,
      share: instances / 8_400,
      cores: lock(instances / 2),
      ramGb: lock(instances * 0.98),
      ssdGb: lock(instances * 10),
      enterpriseApps: enterprise ? 3 : 0,
    };
  });
}

// ---- the countries ------------------------------------------------------------------------------------------

/** The sentence over the bars: three countries that together host half. */
export const GHOST_HEADLINE = 'United States, Germany and France together host 52% of the running instances.';

const COUNTRIES = [
  'United States',
  'Germany',
  'France',
  'United Kingdom',
  'Canada',
  'Finland',
  'Netherlands',
  'Singapore',
  'Poland',
  'Japan',
  'Australia',
  'Switzerland',
  'Lithuania',
  'Ireland',
  'Sweden',
  'Brazil',
];

export interface GhostCountry {
  id: string;
  label: string;
  value: number;
  display: string;
  detail: string;
}

/** The ranked countries, the way the bars draw them: more than the panel shows at first, as the network has. */
export function ghostCountries(n: number): GhostCountry[] {
  return Array.from({ length: n }, (_, i) => {
    const value = Math.max(1, 640 - i * 38);
    return {
      id: `ghost-${i}`,
      label: COUNTRIES[i % COUNTRIES.length] as string,
      value,
      display: value.toLocaleString('en-US'),
      detail: `${(value / 80).toFixed(1)}%`,
    };
  });
}

// ---- the deployments ----------------------------------------------------------------------------------------

/** Ninety UTC days ending today, with a few registrations and updates each. */
export function ghostDeployDays(nowMs: number, days = 90): AppDeployDay[] {
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS;
  return Array.from({ length: days }, (_, i) => ({
    day_ms: today - (days - 1 - i) * DAY_MS,
    registered: 2 + (i % 5),
    updated: 3 + ((i * 3) % 7),
  }));
}

/** The three figures above the chart. */
export function ghostDeployTotals(nowMs: number): DeployTotals {
  return {
    registered: 1_234,
    updated: 5_678,
    days: 90,
    busiest: { t: Math.floor(nowMs / DAY_MS) * DAY_MS - 12 * DAY_MS, total: 321 },
  };
}

// ---- the economy --------------------------------------------------------------------------------------------

/** What apps pay, complete: every window a figure, thirty whole days of a sparkline, and a change against the month before. */
export function ghostEconomy(nowMs: number): EconomyGlance {
  const daily = Array.from({ length: 89 }, (_, i) => 90 + ((i * 7) % 40));
  return {
    complete: true,
    paid24h: 1_234,
    paid7d: 8_765,
    paid30d: 31_234,
    registrations30d: 139,
    updates30d: 640,
    paidAllTime: 212_345,
    messages: 4_530,
    daily,
    dailyFromMs: Math.floor(nowMs / DAY_MS) * DAY_MS - 89 * DAY_MS,
    change: 0.123,
  };
}

/** The app that paid the most, as its row reads. */
export const GHOST_PAYER = { name: 'ghost', display_name: 'xxxxxxxxxx', paid: '1234.00000000' };

// ---- the short lists ----------------------------------------------------------------------------------------

/** Ten new apps, newest first. */
export function ghostNewRows(n: number): NewRow[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `ghost-${i}`,
    label: 'xxxxxxxxxxxx',
    instances: 3,
    running: '12 running',
    when: 'Registered about 3 hours ago',
    whenTitle: undefined,
  }));
}

/** Ten apps about to expire, soonest first. */
export function ghostExpiringRows(n: number): ExpiringRow[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `ghost-${i}`,
    label: 'xxxxxxxxxxxx',
    instances: 3,
    running: '12 running',
    when: 'Expires in about 2 days',
    blocks: '12,345 blocks left',
    whenTitle: undefined,
    soon: false,
  }));
}

// ---- the biggest apps ---------------------------------------------------------------------------------------

/** The apps of the ranked list beside the picture. */
export function ghostRanked(n: number): AppRank[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `ghost-${i}`,
    label: 'xxxxxxxxxxxxxx',
    owner: 'ghost',
    enterprise: false,
    instances: 240 - i * 17,
    target: 240 - i * 17,
    locked: null,
    footprint: null,
  }));
}

/** The sentence under the picture. */
export const GHOST_MAP_CAPTION =
  'Area is the number of instances running. The 30 biggest apps are drawn to scale against each other.';
