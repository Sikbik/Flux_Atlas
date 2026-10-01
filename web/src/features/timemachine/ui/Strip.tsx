// The open timeline strip: transport on the left, the scrubber in the middle, and on the right either
// "Return to live" (while the archive shows) or the live state. It lies over the shell's own 22 px
// strip, which grows to 76 px while this is on screen; the label says the recording began when the
// server's did, so nobody mistakes it for a blockchain archive.

import { Radio, X } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { Button, IconButton, StatusChip } from '../../../ui';
import type { TimeMachineData } from '../hooks/useTimeMachine';
import { formatInstantMinutes } from '../lib/time';
import { Scrubber } from './Scrubber';
import { Transport } from './Transport';

export function Strip({ data }: { data: TimeMachineData }) {
  const { tm, state, now, start, ready, curve, curveLoading, speeds, indexError, retryIndex, leave } = data;
  const archive = state.mode === 'archive';

  // Escape inside the strip leaves the time machine. It stops here so the shell's own Escape (which
  // closes the topmost window) does not also fire.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.stopPropagation();
    leave();
  };

  return (
    <section
      className="tm-strip"
      aria-label="Time machine"
      data-mode={state.mode}
      data-ready={ready || undefined}
      onKeyDown={onKeyDown}
    >
      <div className="tm-strip__body">
        <div className="tm-strip__left">
          <Transport tm={tm} state={state} speeds={speeds} ready={ready} />
          {start !== null ? <p className="tm-since">History since {formatInstantMinutes(start)}</p> : null}
        </div>

        <div className="tm-strip__track">
          <Scrubber
            tm={tm}
            state={state}
            start={start}
            end={now}
            curve={curve}
            curveLoading={curveLoading}
            ready={ready}
          />
          {!ready ? (
            <div className="tm-strip__note" role="status">
              {indexError ? (
                <>
                  <span>The recording could not be loaded.</span>
                  <Button size="sm" variant="secondary" onClick={retryIndex}>
                    Try again
                  </Button>
                </>
              ) : start === null ? (
                <span>Waiting for the server's history.</span>
              ) : (
                <span>History has only just started recording. Come back in a few minutes.</span>
              )}
            </div>
          ) : null}
        </div>

        <div className="tm-strip__right">
          {archive ? (
            <Button className="tm-return" variant="primary" icon={Radio} onClick={() => tm.goLive()}>
              Return to live
            </Button>
          ) : (
            <span className="tm-live-state">
              <StatusChip status="live" label="Live" />
            </span>
          )}
          <IconButton
            className="tm-close"
            icon={X}
            label="Close the time machine (Escape)"
            size="sm"
            onClick={leave}
          />
        </div>
      </div>
    </section>
  );
}
