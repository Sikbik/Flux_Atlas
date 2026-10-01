// A ranked list for concentration questions: the biggest first, each row a click-through filter, and
// a rule where the running share crosses one half (the Nakamoto line). Long tails fold behind one
// button so the list answers the question before it shows every entity.

import { useMemo, useState } from 'react';
import { formatInt, formatPercent } from '../../../lib/format';
import { Button } from '../../explorer/parts';
import { type BarItem, BarList } from './BarList';

export interface RankedItem {
  key: string;
  label: string;
  /** Quiet text after the label (a country code, an AS number). */
  sub?: string;
  count: number;
  /** Fraction of the whole, 0..1. */
  share: number;
  color?: string;
  title?: string;
}

export function RankedBars({
  items,
  label,
  nakamoto,
  selected,
  onSelect,
  initial = 10,
  ruleLabel = 'More than half of all nodes sit above this line',
}: {
  items: readonly RankedItem[];
  label: string;
  /** Rows above the rule; the rule is drawn only when this many rows are on screen. */
  nakamoto?: number;
  selected?: string | null;
  onSelect?: (key: string) => void;
  /** Rows shown before "Show all". */
  initial?: number;
  ruleLabel?: string;
}) {
  const [all, setAll] = useState(false);
  const visible = Math.max(initial, (nakamoto ?? 0) + 2);
  const folded = items.length > visible + 2;
  const shown = all || !folded ? items : items.slice(0, visible);
  const bars = useMemo<BarItem[]>(
    () =>
      shown.map((it) => ({
        key: it.key,
        label: it.label,
        sub: it.sub,
        value: it.count,
        valueLabel: formatInt(it.count),
        extra: it.share > 0 && it.share < 0.001 ? '<0.1%' : formatPercent(it.share, 1),
        color: it.color,
        title: it.title,
      })),
    [shown],
  );
  const rule = nakamoto !== undefined && nakamoto > 0 && nakamoto <= shown.length;
  return (
    <div className="an-plain">
      <BarList
        items={bars}
        label={label}
        selected={selected}
        onSelect={onSelect}
        ruleAfter={rule ? nakamoto : undefined}
        ruleLabel={rule ? ruleLabel : undefined}
      />
      {folded ? (
        <div className="an-more">
          <Button onClick={() => setAll((a) => !a)}>
            {all ? 'Show fewer' : `Show all ${formatInt(items.length)}`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
