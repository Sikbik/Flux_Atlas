// Transport controls: back an hour, play or pause, forward an hour, and the playback speed. Wide strips
// show the speeds as a segmented control; narrow ones fold it into a single button that steps through them.

import { FastForward, Pause, Play, Rewind } from 'lucide-react';
import { Button, IconButton, SegmentedControl } from '../../../ui';
import type { TimeMachine, TmState } from '../lib/controller';

export interface TransportProps {
  tm: TimeMachine;
  state: TmState;
  speeds: readonly number[];
  /** Enough history to move through. */
  ready: boolean;
}

/** `x60`; the very fast speeds read `x3.6k` and `x21.6k` so the control stays narrow. */
export function speedLabel(speed: number): string {
  return speed >= 1000 ? `x${Number((speed / 1000).toFixed(1))}k` : `x${speed}`;
}

export function Transport({ tm, state, speeds, ready }: TransportProps) {
  const archive = state.mode === 'archive';
  const options = speeds.map((s) => ({ value: String(s), label: speedLabel(s) }));
  const next = () => {
    const i = speeds.indexOf(state.speed);
    const n = speeds[(i + 1) % speeds.length];
    if (n !== undefined) tm.setSpeed(n);
  };
  return (
    <fieldset className="tm-transport">
      <legend className="ui-sr-only">Playback</legend>
      <IconButton
        className="tm-transport__btn"
        icon={Rewind}
        label="Back one hour (Shift and left arrow)"
        size="sm"
        disabled={!ready}
        onClick={() => tm.step('shift', -1)}
      />
      <IconButton
        className="tm-transport__btn tm-transport__play"
        icon={state.playing ? Pause : Play}
        label={state.playing ? 'Pause (Space)' : archive ? 'Play (Space)' : 'Replay the history (Space)'}
        variant="secondary"
        disabled={!ready}
        data-playing={state.playing || undefined}
        onClick={() => tm.toggle()}
      />
      <IconButton
        className="tm-transport__btn"
        icon={FastForward}
        label="Forward one hour (Shift and right arrow)"
        size="sm"
        disabled={!ready || !archive}
        onClick={() => tm.step('shift', 1)}
      />
      <div className="tm-speed tm-speed--segments">
        <SegmentedControl
          aria-label="Playback speed"
          size="sm"
          options={options}
          value={String(state.speed)}
          onChange={(v) => tm.setSpeed(Number(v))}
          disabled={!ready}
        />
      </div>
      <Button
        className="tm-speed tm-speed--cycle"
        size="sm"
        variant="ghost"
        aria-label={`Playback speed ${speedLabel(state.speed)}, change`}
        disabled={!ready}
        onClick={next}
      >
        {speedLabel(state.speed)}
      </Button>
    </fieldset>
  );
}
