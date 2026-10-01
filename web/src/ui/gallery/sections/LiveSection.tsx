import { useEffect, useRef } from 'react';
import { type MotionPref, useUi } from '../../../store/ui';
import { Button } from '../../controls/Button';
import { FlashRows, FlashWash, LiveDots } from '../../live/gallery/FlashSpecimens';
import {
  FreshnessIngest,
  FreshnessInline,
  FreshnessStates,
  FreshnessTick,
} from '../../live/gallery/FreshnessSpecimens';
import {
  OdometerBurst,
  OdometerDemo,
  OdometerLive,
  OdometerVariants,
} from '../../live/gallery/OdometerSpecimens';
import {
  EventLog,
  FeedLog,
  NodeLifecycle,
  SpecHistory,
  SpecHistoryToggle,
} from '../../timeline/gallery/TimelineSpecimens';
import { GallerySection, SpecGrid, Specimen } from '../primitives';
import './LiveSection.css';

const MODES: ReadonlyArray<readonly [MotionPref, string]> = [
  ['system', 'System'],
  ['full', 'Full'],
  ['reduced', 'Reduced'],
  ['off', 'Off'],
];

/**
 * Previews the motion setting for this page only: it sets the in-memory preference and the root
 * `data-motion` attribute (which the tokens switch on), and restores both when the gallery closes.
 * Nothing is written to the persisted preference.
 */
function MotionPreview() {
  const motion = useUi((s) => s.motion);
  const initial = useRef<{ pref: MotionPref; attr: string | undefined } | null>(null);
  if (initial.current === null) {
    initial.current = { pref: useUi.getState().motion, attr: document.documentElement.dataset.motion };
  }
  useEffect(() => {
    const start = initial.current;
    return () => {
      if (!start) return;
      useUi.setState({ motion: start.pref });
      if (start.attr === undefined) delete document.documentElement.dataset.motion;
      else document.documentElement.dataset.motion = start.attr;
    };
  }, []);
  const choose = (m: MotionPref) => {
    useUi.setState({ motion: m });
    if (m === 'system') delete document.documentElement.dataset.motion;
    else document.documentElement.dataset.motion = m;
  };
  return (
    <div className="kg-live-preview" role="toolbar" aria-label="Motion preview">
      <span className="kg-live-preview__label">
        <b>Motion preview</b> for this page only
      </span>
      {MODES.map(([m, label]) => (
        <Button
          key={m}
          size="sm"
          variant={motion === m ? 'secondary' : 'ghost'}
          aria-pressed={motion === m}
          data-motion-preview={m}
          onClick={() => choose(m)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

/** Gallery section: AnimatedNumber, FlashOnChange, LiveDot, Freshness, Timeline. */
export function LiveSection() {
  return (
    <GallerySection
      id="live"
      title="Live atoms and timeline"
      lead="The live-first signature: numbers that tick like an odometer, a changed value that glows for a breath and decays, ages that count on one clock, and events hung on a thread of light. Everything follows the motion setting: Full rolls and blooms, Reduced swaps instantly and holds a 1 s tint, Off just swaps. Specimens marked live use real data from the server; anything synthetic says so."
    >
      <MotionPreview />

      <h3 className="kg-live-subhead">Number ticker</h3>
      <SpecGrid min={380}>
        <Specimen
          title="Odometer, live."
          caption="Real values from the store, in real Stat tiles. Only the digits that changed roll."
          layout="stack"
        >
          <OdometerLive />
        </Specimen>
        <Specimen
          title="Odometer, demo."
          caption="A small step rolls, a jump of over 5% counts. Tinted by direction."
          layout="stack"
        >
          <OdometerDemo />
        </Specimen>
        <Specimen
          title="Coalescing."
          caption="At most one visual update a second by default, driven by the render path, never a polling timer."
          layout="stack"
        >
          <OdometerBurst />
        </Specimen>
        <Specimen
          title="Faces and formats."
          caption="Mono for tables, an instant seconds counter, custom formats and Unknown. Montserrat digits are tabular, so the width never moves."
          layout="stack"
          span={2}
        >
          <OdometerVariants />
        </Specimen>
      </SpecGrid>

      <h3 className="kg-live-subhead">A breath of light</h3>
      <SpecGrid min={380}>
        <Specimen
          title="Flash on change."
          caption="A soft wash that blooms and decays over 1.6 s. Compositor only, 12% at most, restarts instead of stacking."
          layout="stack"
        >
          <FlashWash />
        </Specimen>
        <Specimen
          title="Rows."
          caption="The same light on a list row and on a real table row: a 2 px bar and a wash that fades to the right."
          layout="stack"
          span={2}
        >
          <FlashRows />
        </Specimen>
        <Specimen
          title="Live dot."
          caption="Seven pixels, five statuses, a slow ping while healthy."
          layout="stack"
        >
          <LiveDots />
        </Specimen>
      </SpecGrid>

      <h3 className="kg-live-subhead">Freshness</h3>
      <SpecGrid min={380}>
        <Specimen
          title="Freshness chips."
          caption="Judged against the source's own cadence, counting up on the shared clock."
          layout="stack"
        >
          <FreshnessStates />
        </Specimen>
        <Specimen
          title="Real ingest ages."
          caption="The server's own ingest jobs, live."
          layout="stack"
          span={2}
        >
          <FreshnessIngest />
        </Specimen>
        <Specimen title="Refresh and stable width." caption="In a mock status bar." layout="stack">
          <FreshnessTick />
        </Specimen>
        <Specimen
          title="Inline and in a title bar."
          caption="Where a window shows the freshness of its own data."
          layout="stack"
          span={2}
        >
          <FreshnessInline />
        </Specimen>
      </SpecGrid>

      <h3 className="kg-live-subhead">Timeline</h3>
      <SpecGrid min={420}>
        <Specimen
          title="Node lifecycle, real."
          caption="A real node from its heights, in a 420 px inspector. Times are estimated at 30 s per block; the two thresholds ahead are dashed."
          layout="stack"
          width={420}
        >
          <NodeLifecycle />
        </Specimen>
        <Specimen
          title="App spec history, synthetic."
          caption="An update with a diff, renewals grouped into one row that expands, the registration."
          layout="stack"
          width={420}
        >
          <SpecHistoryToggle />
        </Specimen>
        <Specimen
          title="Event log, insertion."
          caption="Synthetic events on the live option: the row grows in over 280 ms and glows for 1.6 s."
          layout="stack"
          width={420}
        >
          <EventLog />
        </Specimen>
        <Specimen
          title="Live activity, real."
          caption="The server's own activity feed, newest first."
          layout="stack"
          width={420}
        >
          <FeedLog />
        </Specimen>
        <Specimen
          title="Narrow window."
          caption="Under 360 px the gutter moves above each title (a container query, not a viewport one)."
          layout="stack"
          width={330}
        >
          <SpecHistory />
        </Specimen>
        <Specimen
          title="Explorer window, absolute times."
          caption="The same history at 820 px with UTC dates."
          layout="stack"
          width={820}
          span={2}
        >
          <SpecHistory mode="absolute" />
        </Specimen>
      </SpecGrid>
    </GallerySection>
  );
}
