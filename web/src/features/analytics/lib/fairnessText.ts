// The words of the minting reading, apart from the view so the sentences can be tested. What the data
// shows is stated as an observation; the possible cause is stated as a hypothesis and never as fact.

import type { FairnessRow } from './stats';

type Verdict = Pick<FairnessRow, 'label' | 'verdict'>;

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

const labelsOf = (rows: readonly Verdict[], verdict: FairnessRow['verdict']) =>
  rows.filter((r) => r.verdict === verdict).map((r) => r.label);

/**
 * What the tiers outside their range did, against their eligible share: "Cumulus produced fewer blocks
 * than its eligible share; Nimbus and Stratus produced more." Empty when every tier is in range.
 */
export function observation(rows: readonly Verdict[]): string {
  const below = labelsOf(rows, 'below');
  const above = labelsOf(rows, 'above');
  const poss = (n: number) => (n > 1 ? 'their' : 'its');
  const parts: string[] = [];
  if (below.length > 0) {
    parts.push(`${joinNames(below)} produced fewer blocks than ${poss(below.length)} eligible share`);
  }
  if (above.length > 0) {
    parts.push(
      below.length > 0
        ? `${joinNames(above)} produced more`
        : `${joinNames(above)} produced more blocks than ${poss(above.length)} eligible share`,
    );
  }
  return parts.length === 0 ? '' : `${parts.join('; ')}.`;
}

/**
 * The likely reason for a shortfall, labelled as a hypothesis by the caller: the nodes of a tier that
 * minted less may be missing their turn more often. Null when no tier is below its share.
 */
export function hypothesis(rows: readonly Verdict[]): string | null {
  const below = labelsOf(rows, 'below');
  if (below.length === 0) return null;
  return `${joinNames(below)} nodes may be missing their turn more often, offline, out of sync or slow when their rank comes up. The blocks alone cannot show it; a per-node liveness record would.`;
}
