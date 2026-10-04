// When things happened: the activity feed counted into equal slices of time, stacked by what kind of event it was.
// A burst of health events across many nodes at once is an incident (a provider, a network), and it shows here at a
// glance where the list would only show it as a run of rows. The filters above the list dim the groups they leave
// out; the crosshair reads a slice; the same numbers are in a table underneath.

import { type CSSProperties, useMemo } from 'react';
import { formatInt } from '../../../lib/format';
import { ACTIVITY_GROUPS, type ActivityGroup, type Rhythm } from '../lib/activity';
import { dateTimeStamp } from '../lib/csv';
import { axisCount, roundedTop } from '../lib/plotAxis';
import { LegendKey, Plot, type PlotGeo, type PlotTip, type TipRow } from './Plot';

/** Blue, teal and rose are three hues apart; health is the amber of "needs a look", which nothing else here wears. */
const GROUP_COLOR: Record<ActivityGroup, string> = {
  payments: 'var(--viz-1)',
  nodes: 'var(--viz-3)',
  apps: 'var(--viz-5)',
  health: 'var(--status-warn)',
};
/** Bottom to top: the kinds that are good news or neutral first, the trouble on top where it catches the eye. */
const STACK: readonly ActivityGroup[] = ['payments', 'nodes', 'apps', 'health'];

const LABEL = Object.fromEntries(ACTIVITY_GROUPS.map((g) => [g.id, g.label])) as Record<
  ActivityGroup,
  string
>;

/** `15 min`, `3 hours`, `1 day`: how long one slice is. */
export function sliceWords(ms: number): string {
  const min = ms / 60_000;
  if (min < 60) return `${min} min`;
  const h = min / 60;
  if (h < 24) return `${h} ${h === 1 ? 'hour' : 'hours'}`;
  const d = h / 24;
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

const stamp = (ms: number, slice: number): string =>
  slice >= 86_400_000 ? dateTimeStamp(ms).slice(0, 10) : `${dateTimeStamp(ms).slice(0, 16)} UTC`;

export interface RhythmChartProps {
  rhythm: Rhythm;
  /** The groups the filters keep; none means all of them. */
  on: ReadonlySet<ActivityGroup>;
}

export function RhythmChart({ rhythm, on }: RhythmChartProps) {
  const { t, bucketMs, counts, total } = rhythm;
  const n = t.length;
  const present = useMemo(() => STACK.filter((g) => counts[g].some((v) => v > 0)), [counts]);
  // The groups the filters have left out: still drawn, to be compared with, but quiet.
  const quiet = useMemo<ReadonlySet<ActivityGroup>>(
    () => new Set(on.size === 0 ? [] : STACK.filter((g) => !on.has(g))),
    [on],
  );

  const axis = useMemo(() => axisCount(Math.max(0, ...total)), [total]);
  const domain = useMemo<readonly [number, number]>(
    () => [t[0] as number, (t[n - 1] as number) + bucketMs],
    [t, n, bucketMs],
  );
  const centers = useMemo(() => t.map((x) => x + bucketMs / 2), [t, bucketMs]);

  const marks = useMemo(
    () => (geo: PlotGeo) => {
      const slot = geo.plot.w / Math.max(1, n);
      const bw = Math.max(1.5, slot * (n > 60 ? 0.8 : 0.72));
      const r = Math.min(2.5, bw / 3);
      return (
        <>
          {t.map((x, i) => {
            const left = geo.x(x) + (slot - bw) / 2;
            let acc = 0;
            return (
              <g key={x}>
                {present.map((g, k) => {
                  const v = counts[g][i] as number;
                  if (!(v > 0)) return null;
                  const y1 = geo.y(acc + v);
                  const y0 = geo.y(acc);
                  acc += v;
                  const h = Math.max(0, y0 - y1);
                  if (h < 0.4) return null;
                  const top = present.slice(k + 1).every((o) => !((counts[o][i] as number) > 0));
                  const style = { '--c': GROUP_COLOR[g] } as CSSProperties;
                  return top ? (
                    <path
                      key={g}
                      className="wl-bar"
                      d={roundedTop(left, y1, bw, h, r)}
                      style={style}
                      data-dim={quiet.has(g) || undefined}
                    />
                  ) : (
                    <rect
                      key={g}
                      className="wl-bar"
                      x={left}
                      y={y1}
                      width={bw}
                      height={h}
                      style={style}
                      data-dim={quiet.has(g) || undefined}
                    />
                  );
                })}
              </g>
            );
          })}
        </>
      );
    },
    [t, n, present, counts, quiet],
  );

  const track = useMemo(
    () => (geo: PlotGeo) => ({ x: centers.map((x) => geo.x(x)), y: total.map((v) => geo.y(v)) }),
    [centers, total],
  );

  const sum = total.reduce((s, v) => s + v, 0);
  let busiest = 0;
  for (let i = 1; i < n; i++) if ((total[i] as number) > (total[busiest] as number)) busiest = i;
  const summary = `Events by time: ${formatInt(sum)} events in ${formatInt(n)} slices of ${sliceWords(bucketMs)}, from ${stamp(t[0] as number, bucketMs)} to ${stamp(t[n - 1] as number, bucketMs)}. The busiest slice, from ${stamp(t[busiest] as number, bucketMs)}, held ${formatInt(total[busiest] as number)}.`;

  const tipAt = (i: number): PlotTip => {
    const rows: TipRow[] = [...present]
      .reverse()
      .map((g) => ({ label: LABEL[g], value: formatInt(counts[g][i] as number), color: GROUP_COLOR[g] }));
    rows.push({ label: 'Events in all', value: formatInt(total[i] as number) });
    return { head: stamp(t[i] as number, bucketMs), aside: sliceWords(bucketMs), rows };
  };

  return (
    <Plot
      kind="activity-rhythm"
      title="Events by time"
      summary={summary}
      t={centers}
      domain={domain}
      axis={axis}
      formatTick={(v) => formatInt(v)}
      height={176}
      marks={marks}
      track={track}
      anchor={(i) => total[i] ?? null}
      dotColor="var(--text-1)"
      tip={tipAt}
      reading={(i) =>
        `${stamp(t[i] as number, bucketMs)}: ${formatInt(total[i] as number)} ${total[i] === 1 ? 'event' : 'events'}`
      }
      table={{
        head: ['Slice starts (UTC)', ...STACK.map((g) => LABEL[g]), 'Events in all'],
        row: (i) => [
          stamp(t[i] as number, bucketMs),
          ...STACK.map((g) => formatInt(counts[g][i] as number)),
          formatInt(total[i] as number),
        ],
      }}
      revealKey={`${n}:${bucketMs}:${t[0]}`}
      legend={
        <ul className="cp-legend" aria-label="Kinds of event">
          {[...present].reverse().map((g) => (
            <LegendKey key={g} label={LABEL[g]} color={GROUP_COLOR[g]} />
          ))}
        </ul>
      }
      note={`Each bar is ${sliceWords(bucketMs)} of the feed below.`}
    />
  );
}
