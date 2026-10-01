// The nodes the headline count leaves out. "N nodes" everywhere is the summary's `node_count`: confirmed nodes, the
// ones fluxd lists. The server also counts the others it tracks, under names of their own, and the totals card
// names them so the headline never has to explain itself.

const NOT_CONFIRMED = [
  ['started_count', 'Started, not confirmed'],
  ['dos_count', 'On the DOS list'],
  ['expired_count', 'Predicted expired'],
] as const;

/**
 * Label and count of each group the summary names. A server that does not send them yields none, so the card
 * says nothing rather than a zero (unknown is never shown as zero).
 */
export function notConfirmed(summary: object): [string, number][] {
  const s = summary as Record<string, unknown>;
  const rows: [string, number][] = [];
  for (const [key, label] of NOT_CONFIRMED) {
    const n = s[key];
    if (typeof n === 'number' && Number.isFinite(n)) rows.push([label, n]);
  }
  return rows;
}
