// The boot's offline state (design 8.8): what the veil says when Atlas has not answered for long enough to be a
// failure and not a hiccup. Plain words for what is wrong and what happens next, what the connection is doing right
// now, and two ways forward: try again, or go on without (the shell then shows its own empty and offline states).
// The full boot and the quick path share it; the quick path's veil has nothing else on screen, so it stands in the
// middle (veil.css), the full boot's by the log (boot.css).

import { LiveDot } from '../../../ui';
import { useLiveView } from '../live';
import type { StageId } from './model';

export interface BootFailProps {
  /** The stage that failed: `stream` when the snapshot is in but the stream did not open, else the connection. */
  failed: StageId;
  /** There is a snapshot to go on with. */
  hasSnapshot: boolean;
  onRetry: () => void;
  onContinue: () => void;
}

export function BootFail({ failed, hasSnapshot, onRetry, onContinue }: BootFailProps) {
  const stream = failed === 'stream';
  const live = useLiveView();
  const now = [live.label, live.detail].filter(Boolean).join(' ');
  return (
    <div className="boot-fail" role="alert">
      <b>{stream ? 'The live stream did not open' : 'Atlas did not answer'}</b>
      <p>
        {stream
          ? 'The map is the last snapshot and may be out of date. Atlas keeps trying in the background.'
          : 'Check the connection. Atlas keeps trying in the background.'}
      </p>
      <p className="boot-fail-now" aria-hidden="true">
        <LiveDot status={live.tone} ping={false} />
        {now}
      </p>
      <div className="boot-fail-actions">
        <button type="button" className="boot-btn" onClick={onRetry}>
          Retry
        </button>
        <button type="button" className="boot-btn" data-quiet="" onClick={onContinue}>
          {hasSnapshot ? 'Continue with the last snapshot' : 'Continue without data'}
        </button>
      </div>
    </div>
  );
}
