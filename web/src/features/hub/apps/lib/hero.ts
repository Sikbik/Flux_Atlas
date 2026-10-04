// The words and the arithmetic of the hero: the sentence under the figure, and the figures that are a ratio of two
// numbers from two different answers (so each says Unknown, not a zero, while either is missing). Pure.

import { formatInt, formatPercent } from '../../../../lib/format';
import type { IndexTotals } from './apps';

const noun = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * The enterprise apps' share of all apps (`51%`), the one figure the hero says in two places: in the sentence under
 * the number of apps and in the note under the Enterprise figure. Null while either count is not known.
 */
export function enterpriseShare(enterpriseApps: number | null, apps: number | null): string | null {
  if (enterpriseApps === null || apps === null || !(apps > 0)) return null;
  return formatPercent(enterpriseApps / apps, 0);
}

/**
 * The sentence under the number of apps: what runs, and how much of the network is enterprise. The enterprise count
 * is the one the Enterprise figure shows (the overview's, or the index's while the overview is not in), so the
 * sentence and the figure's note never give two percentages.
 */
export function heroCaption(t: IndexTotals, enterpriseApps: number | null): string {
  if (t.apps === 0) return 'The index holds no apps yet.';
  const running = `${formatInt(t.instances)} ${noun(t.instances, 'instance is', 'instances are')} running across ${formatInt(t.active)} ${noun(t.active, 'app', 'apps')}.`;
  const share = enterpriseShare(enterpriseApps, t.apps);
  if (share === null || enterpriseApps === null || !(enterpriseApps > 0)) return running;
  return `${running} Enterprise apps are ${share} of all apps and keep their size private.`;
}

/** Apps per owner, to one decimal; null while either count is not known or there are no owners. */
export function appsPerOwner(apps: number | null, owners: number | null): string | null {
  if (apps === null || owners === null || !(owners > 0)) return null;
  return (apps / owners).toFixed(1);
}

/** The note under the instances figure: how many the specs ask for. Null while the totals are not known. */
export function instancesNote(t: IndexTotals | null): string | null {
  if (!t) return null;
  if (t.wanted <= 0) return null;
  return `of ${formatInt(t.wanted)} the specs ask for`;
}

/** The note under the enterprise figure: its share of the apps. */
export function enterpriseShareNote(enterpriseApps: number | null, apps: number | null): string | null {
  const share = enterpriseShare(enterpriseApps, apps);
  return share === null ? null : `${share} of all apps`;
}
