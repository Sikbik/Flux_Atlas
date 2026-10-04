// Nodes that joined and left, over the last day and week. The server counts them from the node events it has stored; a
// server younger than the window has seen only part of it, so those counts are a floor ("at least"), said so in words
// and not by a symbol. Pure.

import type { ChurnSpan } from '../../../../api/generated/ChurnSpan';
import type { NodeChurn } from '../../../../api/generated/NodeChurn';
import { formatInt } from '../../../../lib/format';
import { formatDelta } from '../../../../ui/readout/delta';

export interface ChurnRow {
  window: ChurnSpan;
  /** `24 hours`, `7 days`. */
  label: string;
  joined: number;
  left: number;
  /** Joined minus left. */
  net: number;
  /** False when the stored events do not reach back over the whole window. */
  complete: boolean;
  /** What a window the server has not lived through was counted over; the 'Counted' line of the definitions. */
  note: string | null;
  /** The row in a sentence for a screen reader. */
  summary: string;
}

const LABEL: Record<ChurnSpan, string> = { '24h': '24 hours', '7d': '7 days' };
const ORDER: readonly ChurnSpan[] = ['24h', '7d'];

/** The sign and size of a change: `+141`, `-38`, `0`. */
export function signed(n: number): string {
  return formatDelta(n).text;
}

export function churnRow(c: NodeChurn): ChurnRow {
  const net = c.joined - c.left;
  const label = LABEL[c.window];
  const floor = c.complete ? '' : 'at least ';
  const joined = `${floor}${formatInt(c.joined)} ${c.joined === 1 ? 'node' : 'nodes'} joined`;
  const left = `${floor}${formatInt(c.left)} left`;
  const balance =
    net === 0 ? 'no net change' : `a net ${net > 0 ? 'gain' : 'loss'} of ${formatInt(Math.abs(net))}`;
  return {
    window: c.window,
    label,
    joined: c.joined,
    left: c.left,
    net,
    complete: c.complete,
    note: c.complete ? null : 'since this server started, so the real figures are at least these',
    summary: c.complete
      ? `In the last ${label}, ${joined} and ${left}, ${balance}.`
      : `In the last ${label}, ${joined} and ${left}. The server has counted only since it started.`,
  };
}

/** The windows the server sent, in order 24 hours then 7 days (a window it did not send is left out). */
export function churnRows(churn: readonly NodeChurn[] | undefined): ChurnRow[] {
  if (!churn) return [];
  return ORDER.map((w) => churn.find((c) => c.window === w))
    .filter((c): c is NodeChurn => c !== undefined)
    .map(churnRow);
}
