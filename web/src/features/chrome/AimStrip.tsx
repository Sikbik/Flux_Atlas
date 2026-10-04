// The aim strip (design 4.3, 8.13): "Next payout in 18 s" and the three winners of the next block, one chip
// per tier, Stratus first. A glass pill under the top bar, centred in the free area the windows leave. The
// payees swap 2.6 s after each block, once the relay on the globe has finished (usePayoutLines holds the old
// ones until then). A watched payee's chip is ringed in white. It steps aside in the time machine,
// ambient, the weather layer, analytics and About Flux. The countdown is a visual; a polite status line
// announces only when the three payees change, never the ticking. On the phone (`inline`) it is the third row
// of the header instead: no pill, always there, and the row scrolls sideways when the chips do not fit.

import { useEffect, useRef, useState } from 'react';
import { useRuntime } from '../../app/context';
import { UNKNOWN } from '../../lib/format';
import { useBeat } from '../../lib/useClock';
import { ShellLink } from '../../shell/frame/ShellLink';
import { globeInset } from '../../shell/wm/machine';
import { useWm } from '../../shell/wm/react';
import type { WindowType } from '../../shell/wm/types';
import { useUi } from '../../store/ui';
import { TierGlyph } from '../../ui';
import { useNodeKey, usePayoutLines } from './data';
import { TIER_LABEL, TIER_ORDER } from './glyphs';
import { amountLabel, amountWords, type PayoutLine } from './payouts';
import './aimstrip.css';

/** Where the strip is not shown (design 8.13). */
const HIDDEN_FOR: readonly WindowType[] = ['analytics', 'about', 'time', 'weather'];

function useAimVisible(): boolean {
  return useWm((s) => !Object.values(s.windows).some((w) => HIDDEN_FOR.includes(w.type)), Object.is);
}

/** The free area (the viewport less the dock, the windows and the rail): its centre and its width. */
function useFreeArea(): { centre: number; width: number } {
  const key = useWm((s) => {
    const i = globeInset(s);
    const width = s.viewport.w - i.left - i.right;
    return `${Math.round(i.left + width / 2)}:${Math.round(width)}`;
  }, Object.is);
  const [centre, width] = key.split(':').map(Number);
  return { centre: centre ?? 0, width: width ?? 0 };
}

/** Room the strip needs (its lead, three chips and its padding) plus a little air; under it, it steps aside. */
const STRIP_ROOM = { wide: 650, narrow: 584 };

/**
 * Where the desktop strip sits and whether it shows: the free area's centre, and whether the strip is allowed
 * here and has the room. The globe focus pill (GlobeFocus.tsx) lines up under it with the same answer.
 */
export function useAimPlacement(): { centre: number; allowed: boolean; shown: boolean } {
  const allowed = useAimVisible();
  const { centre, width } = useFreeArea();
  const compact = useWm((s) => s.viewport.w < 1280, Object.is);
  return { centre, allowed, shown: allowed && width >= (compact ? STRIP_ROOM.narrow : STRIP_ROOM.wide) };
}

const key = (l: PayoutLine) => `${l.tier}:${l.node ?? l.address}`;

export function AimStrip({ inline = false }: { inline?: boolean }) {
  const { clock } = useRuntime();
  const place = useAimPlacement();
  const allowed = inline || place.allowed;
  const centre = place.centre;
  const visible = inline || place.shown;
  const beat = useBeat(clock);
  const lines = usePayoutLines();
  const keyOf = useNodeKey();
  const watched = useUi((s) => s.watched);
  const secs = Math.max(0, Math.ceil(beat.remainingMs / 1000));
  const sentence = useChangeAnnouncement(lines, secs);
  const soon = beat.remainingMs <= 5_000 && beat.phase !== 'late' && beat.phase !== 'quiet';
  const late = beat.phase === 'late' || beat.phase === 'quiet';
  if (!allowed) return null;
  return (
    <fieldset
      className="aimstrip"
      style={inline ? undefined : ({ '--aim-x': `${centre}px` } as React.CSSProperties)}
      data-inline={inline || undefined}
      data-soon={soon || undefined}
      data-late={late || undefined}
      data-hidden={visible ? undefined : ''}
      inert={visible ? undefined : true}
    >
      <legend className="sr-only">Next payout</legend>
      <span className="aim-lead">
        {beat.height === null ? (
          'Waiting for the next block'
        ) : late ? (
          'Block late'
        ) : (
          <>
            Next payout in <b>{secs} s</b>
          </>
        )}
      </span>
      {lines.map((l, i) => {
        const nodeKey = keyOf(l.node);
        const mine = l.node !== null && watched.includes(l.node);
        const body = (
          <>
            <TierGlyph tier={l.tier} size={13} label={`${TIER_LABEL[l.tier]} tier`} />
            <span className="aim-place">{l.place ?? UNKNOWN}</span>
            <i>{amountLabel(l.amount)}</i>
          </>
        );
        return nodeKey ? (
          <ShellLink
            key={key(l)}
            to={{ type: 'node', key: nodeKey }}
            className="aimchip"
            data-tier={l.tier}
            data-mine={mine || undefined}
            style={{ '--i': i } as React.CSSProperties}
          >
            {body}
          </ShellLink>
        ) : (
          <span
            key={key(l)}
            className="aimchip"
            data-tier={l.tier}
            data-mine={mine || undefined}
            style={{ '--i': i } as React.CSSProperties}
          >
            {body}
          </span>
        );
      })}
      {lines.length === 0 && beat.height !== null
        ? TIER_ORDER.map((tier, i) => (
            <span
              key={tier}
              className="aimchip"
              data-pending=""
              data-tier={tier}
              aria-hidden="true"
              style={{ '--i': i } as React.CSSProperties}
            >
              <TierGlyph tier={tier} size={13} />
              <span className="aim-place" />
              <i />
            </span>
          ))
        : null}
      <p className="sr-only" role="status">
        {sentence}
      </p>
    </fieldset>
  );
}

/** The sentence a screen reader gets when the three payees change ("Next payout in 18 s: Helsinki 9.0, ..."). */
function useChangeAnnouncement(lines: readonly PayoutLine[], secs: number): string {
  const sig = lines.map(key).join('|');
  const [text, setText] = useState('');
  const last = useRef('');
  const secsRef = useRef(secs);
  secsRef.current = secs;
  useEffect(() => {
    if (sig === '' || sig === last.current) return;
    last.current = sig;
    setText(
      `Next payout in ${secsRef.current} s: ${lines.map((l) => `${l.place ?? UNKNOWN} ${amountWords(l.amount)}`).join(', ')}`,
    );
  }, [sig, lines]);
  return text;
}
