// The Live tab's sheet (design 3.6): a bottom sheet of the window chrome's own make hosting the Live panel. It is a
// chunk of its own (livegate.tsx loads it): the phone is the only place it exists, and the Pulse it carries is
// the same code the desktop's card runs.

import { Activity } from 'lucide-react';
import { LivePanel } from '../../features/chrome/LivePanel';
import { useLiveView } from '../../features/chrome/live';
import { usePhone } from '../../features/chrome/phone';
import { LiveDot } from '../../ui';
import { PhoneSheet } from '../wm/PhoneSheet';

export function LiveSheet() {
  const setLive = usePhone((s) => s.setLive);
  const view = useLiveView();
  return (
    <PhoneSheet
      type="live"
      title="Live"
      subtitle="Everything happening now"
      glyph={<Activity size={20} strokeWidth={1.6} />}
      accent="pulse"
      meta={
        <span className="lp-meta" data-tone={view.tone}>
          <LiveDot status={view.tone} className="live-blink" />
          {view.detail ?? 'now'}
        </span>
      }
      onClose={() => setLive(false)}
    >
      <LivePanel />
    </PhoneSheet>
  );
}
