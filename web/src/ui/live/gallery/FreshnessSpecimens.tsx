import { useMemo, useState } from 'react';
import { useNetwork } from '../../../app/context';
import { Button } from '../../controls/Button';
import { useKitClock } from '../../internal/clock';
import { Freshness } from '../Freshness';
import { DemoTag } from './parts';
import './specimens.css';

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;

/** The four states and Unknown, on synthetic ages that keep counting up. */
export function FreshnessStates() {
  const clock = useKitClock();
  const t0 = useMemo(() => clock.now(), [clock]);
  const rows: ReadonlyArray<readonly [label: string, age: number, cadence: number]> = [
    ['nodes', 4 * S, 90 * S],
    ['stats', 12 * MIN, 7 * MIN],
    ['apps', 11 * MIN, 90 * S],
    ['mesh', 6 * HOUR, 30 * MIN],
  ];
  return (
    <div className="kg-live-stack">
      <div className="kg-live-row">
        <DemoTag>Synthetic ages</DemoTag>
      </div>
      <div className="kg-live-row">
        {rows.map(([label, age, cadence]) => (
          <Freshness key={label} label={label} ts={t0 - age} cadenceMs={cadence} />
        ))}
        <Freshness label="tip" ts={null} cadenceMs={4 * S} />
      </div>
      <p className="kg-live-label">
        <b>Fresh</b> is under 1.5x the source cadence, <b>aging</b> to 3x, <b>stale</b> to 10x (with the
        word), then <b>lost</b>. Hover a chip for the absolute UTC time. Unknown is a hollow dot, never a
        zero.
      </p>
    </div>
  );
}

const JOBS: ReadonlyArray<readonly [job: string, label: string, cadenceMs: number]> = [
  ['chain_stream', 'chain', 30 * S],
  ['mempool_stream', 'mempool', 30 * S],
  ['next_payees', 'payees', 30 * S],
  ['node_count', 'nodes', 60 * S],
  ['price', 'price', 45 * S],
  ['app_placement', 'placement', 90 * S],
  ['node_registry', 'registry', 10 * MIN],
  ['stats_round', 'stats', 15 * MIN],
];

/** The server's real ingest jobs: the ages are real, the cadences are each job's own schedule. */
export function FreshnessIngest() {
  const jobs = useNetwork((s) => s.freshness);
  return (
    <div className="kg-live-stack">
      <div className="kg-live-row">
        {JOBS.map(([job, label, cadence]) => (
          <Freshness key={job} label={label} ts={jobs.get(job)?.last_ok_ms ?? null} cadenceMs={cadence} />
        ))}
      </div>
      <p className="kg-live-label">
        Live: the server&apos;s ingest jobs from the store. Cadences are the jobs&apos; own schedules, so a
        chip turns stale when its job falls behind, not at a fixed age.
      </p>
    </div>
  );
}

/** A chip that can be refreshed, in a mock status bar, to see the ping, the states and a stable width. */
export function FreshnessTick() {
  const clock = useKitClock();
  const [t0] = useState(() => clock.now());
  const [tip, setTip] = useState(() => t0 - 6500);
  return (
    <div className="kg-live-stack">
      <div className="kg-live-row">
        <DemoTag>Synthetic, demo control</DemoTag>
        <Button size="sm" onClick={() => setTip(clock.now())}>
          The source updates now
        </Button>
      </div>
      <div className="kg-live-statusbar">
        <Freshness label="tip" ts={tip} cadenceMs={90 * S} />
        <Freshness label="nodes" ts={t0 - 12 * S} cadenceMs={90 * S} />
        <Freshness label="apps" ts={t0 - 41 * S} cadenceMs={90 * S} />
        <Freshness label="stats" ts={t0 - 5 * MIN} cadenceMs={7 * MIN} />
      </div>
      <p className="kg-live-label">
        Watch the first chip pass 9 s to 10 s: its age sits in a fixed-width box, so nothing next to it moves.
        Press the button and the dot pings once.
      </p>
    </div>
  );
}

/** The inline variant, in a window title bar and in a sentence. */
export function FreshnessInline() {
  const clock = useKitClock();
  const t0 = useMemo(() => clock.now(), [clock]);
  return (
    <div className="kg-live-stack">
      <div className="kg-live-titlebar">
        <span className="kg-live-titlebar__title">Node inspector</span>
        <span className="kg-live-titlebar__spacer" />
        <Freshness label="nodes" ts={t0 - 4 * S} cadenceMs={90 * S} />
      </div>
      <p className="kg-live-label">
        In a sentence: <Freshness variant="inline" ts={t0 - 3 * S} cadenceMs={90 * S} /> (fresh), then{' '}
        <Freshness variant="inline" label="stats" ts={t0 - 25 * MIN} cadenceMs={7 * MIN} /> (stale, with the
        word), and <Freshness variant="inline" ts={null} cadenceMs={90 * S} />.
      </p>
    </div>
  );
}
