// Ambient mode (design 6.4 K, 9.6): the globe and the moon are the presentation, and everything written on
// top of them is small, set at the edges and mostly absent. Top left, the Atlas mark. Bottom left, one
// short caption that comes and goes (a landing is the view's one Lora sentence, any other shot a small
// label) over a tiny clock line. Bottom right, a quiet ticker of what the network just did. Top right, a
// hint for the first seconds, or the honest state of a dropped stream. Nothing is large, nothing is
// centred, nothing sits on the planet.
//
// The director that moves the camera is the engine's own; this view only listens to its captions. Any
// input leaves (see wake.ts) for the exact place the visitor was, the screen is kept awake, a dropped
// stream is nudged back (kiosk.ts) and the optional score is the engine's own, off until Settings turns
// it on. This view is also the kiosk at /ambient: no chrome, and it looks after itself.

import { useRouter } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useConnection, useRuntime, useSummary, useTip } from '../../app/context';
import { useGlobeEngine } from '../../globe';
import { formatAgo, formatInt, formatUtcTime } from '../../lib/format';
import { useBeat, useNow } from '../../lib/useClock';
import { effectiveMotion, useUi } from '../../store/ui';
import { track } from '../achievements/events';
import { FLUX_SYMBOL_BLUE_WHITE } from '../command/brand';
import { usePrefs } from '../settings/prefs';
import { type AmbientEngine, asAmbientEngine, asGlobeEngine } from './engineAccess';
import { adoptAmbientEntry, ambientVia, exitAmbient } from './enter';
import { startWatchdog } from './kiosk';
import { type CaptionText, captionHoldMs, captionText } from './sentences';
import { type SoundHandle, startAmbientSound } from './sound';
import { Ticker } from './Ticker';
import { installWake } from './wake';
import { keepScreenAwake } from './wakeLock';
import './ambient.css';

/** The overlay leaves in 160 ms, then the route changes (design 9.6). */
const LEAVE_MS = 160;
/** How long a caption takes to fade out before the next one comes in. */
const CAPTION_SWAP_MS = 300;
const CAPTION_FADE_MS = 700;
/** The wake hint shows for the first few seconds only. */
const HINT_MS = 7_000;
const SECONDS_EVERY_MS = 30_000;

// ---------------------------------------------------------------------------------------------
// Hints: how to leave, or what is wrong with the stream
// ---------------------------------------------------------------------------------------------

const coarse = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

function Hint() {
  const conn = useConnection();
  const tip = useTip();
  const [early, setEarly] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setEarly(false), HINT_MS);
    return () => window.clearTimeout(id);
  }, []);

  let text: string | null = null;
  let tone: 'info' | 'warn' = 'info';
  switch (conn.status) {
    case 'live':
      text = early ? (coarse() ? 'Touch to wake' : 'Move the mouse to wake') : null;
      break;
    case 'syncing':
    case 'connecting':
      text = 'Catching up';
      break;
    case 'reconnecting':
      text = 'Reconnecting';
      tone = 'warn';
      break;
    default:
      text = `Offline, showing data from ${formatUtcTime(tip?.time_ms ?? null)}`;
      tone = 'warn';
  }
  return (
    <p className="amb-hint" data-tone={tone} data-shown={text ? '' : undefined} aria-live="polite">
      {text ?? ' '}
    </p>
  );
}

// ---------------------------------------------------------------------------------------------
// The caption
// ---------------------------------------------------------------------------------------------

interface Shown {
  id: number;
  text: CaptionText;
  leaving: boolean;
}

/** Listens to the director's captions and shows one at a time, briefly. */
function Caption({ engine }: { engine: AmbientEngine | null }) {
  const summary = useSummary();
  const summaryRef = useRef(summary);
  summaryRef.current = summary;
  const [shown, setShown] = useState<Shown | null>(null);
  const shownRef = useRef<Shown | null>(null);
  shownRef.current = shown;

  useEffect(() => {
    if (!engine) return;
    let id = 0;
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const t = window.setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    };
    const clear = () => {
      for (const t of timers) window.clearTimeout(t);
      timers.clear();
    };
    const show = (text: CaptionText, holdMs: number) => {
      const mine = ++id;
      setShown({ id: mine, text, leaving: false });
      later(() => setShown((s) => (s && s.id === mine ? { ...s, leaving: true } : s)), holdMs);
      later(() => setShown((s) => (s && s.id === mine ? null : s)), holdMs + CAPTION_FADE_MS);
    };
    const off = engine.on('caption', (c) => {
      const text = captionText(c, summaryRef.current);
      const hold = captionHoldMs(c);
      clear();
      if (shownRef.current && !shownRef.current.leaving) {
        // One caption gives way to the next: the old one fades, then the new one comes in.
        setShown((s) => (s ? { ...s, leaving: true } : s));
        later(() => show(text, hold), CAPTION_SWAP_MS);
      } else show(text, hold);
    });
    return () => {
      off();
      clear();
    };
  }, [engine]);

  const sentence = shown?.text.kind === 'sentence' ? shown.text : null;
  return (
    <>
      <div className="amb-cap-slot">
        {shown ? (
          <div
            className="amb-cap"
            key={shown.id}
            data-kind={shown.text.kind}
            data-state={shown.leaving ? 'out' : 'in'}
          >
            <p className={shown.text.kind === 'sentence' ? 'amb-lead' : 'amb-label'}>{shown.text.lead}</p>
            {shown.text.sub ? <p className="amb-sub">{shown.text.sub}</p> : null}
          </div>
        ) : null}
      </div>
      {/* The landing sentence, for assistive technology; scene labels are not announced. */}
      <p className="amb-sr" aria-live="polite">
        {sentence ? `${sentence.lead} ${sentence.sub ?? ''}` : ''}
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The clock line
// ---------------------------------------------------------------------------------------------

function ClockLine() {
  const { clock } = useRuntime();
  const now = useNow(clock);
  const beat = useBeat(clock);
  const tip = useTip();
  const height = tip?.height ?? beat.height;
  const next =
    beat.phase === 'unknown'
      ? null
      : beat.remainingMs > 0
        ? `next in ${Math.ceil(beat.remainingMs / 1000)} s`
        : beat.phase === 'late' || beat.phase === 'quiet'
          ? 'block late'
          : 'due now';
  return (
    <p className="amb-clock tabular">
      <span className="amb-clock-t">{formatUtcTime(now)}</span>
      <span className="amb-clock-b">
        {height === null
          ? ' '
          : `Block ${formatInt(height)} · ${formatAgo(beat.sinceMs)}${next ? ` · ${next}` : ''}`}
      </span>
    </p>
  );
}

// ---------------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------------

export default function AmbientView() {
  const router = useRouter();
  const runtime = useRuntime();
  const target = useGlobeEngine();
  const engine = useMemo(() => asAmbientEngine(target), [target]);
  const [leaving, setLeaving] = useState(false);

  // On screen: tell the entry module (so a direct visit can still go back), count a kiosk visit, and
  // take focus off whatever the shell left focused so a key cannot reach it.
  useEffect(() => {
    adoptAmbientEntry(router);
    if (ambientVia() === 'kiosk') track({ type: 'ambient', action: 'enter', via: 'kiosk' });
    (document.activeElement as HTMLElement | null)?.blur?.();
  }, [router]);

  // Any input leaves: the overlay fades, then the route goes back to where the visitor was.
  useEffect(() => {
    const slow = effectiveMotion(useUi.getState().motion) === 'full';
    let timer: number | undefined;
    const stop = installWake({
      onWake: () => {
        setLeaving(true);
        timer = window.setTimeout(() => exitAmbient(router), slow ? LEAVE_MS : 0);
      },
    });
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, [router]);

  useEffect(() => keepScreenAwake(), []);

  useEffect(
    () =>
      startWatchdog({
        status: () => runtime.store.connection.status,
        nudge: () => runtime.live.reconnectNow(),
        reload: () => window.location.reload(),
      }),
    [runtime],
  );

  // Achievements: time spent here (every half minute) and the engine's moustache.
  useEffect(() => {
    const t0 = Date.now();
    const id = window.setInterval(
      () => track({ type: 'ambient.seconds', seconds: Math.round((Date.now() - t0) / 1000) }),
      SECONDS_EVERY_MS,
    );
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => (engine ? engine.on('egg', () => track({ type: 'egg' })) : undefined), [engine]);

  // The optional score: only when Settings turned it on, and only once the engine is up.
  const soundOn = usePrefs((s) => s.ambientSound);
  useEffect(() => {
    const whole = asGlobeEngine(target);
    if (!whole || !soundOn) return;
    let cancelled = false;
    let handle: SoundHandle | null = null;
    startAmbientSound(whole, () => cancelled)
      .then((h) => {
        if (cancelled) h.stop();
        else handle = h;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      handle?.stop();
    };
  }, [target, soundOn]);

  return (
    <div className="amb" data-testid="ambient" data-leaving={leaving ? '' : undefined}>
      <header className="amb-corner">
        <img src={FLUX_SYMBOL_BLUE_WHITE} alt="" draggable={false} />
        <span>Atlas</span>
      </header>
      <Hint />
      <section className="amb-stack" aria-label="Ambient mode. Press any key to leave.">
        <Caption engine={engine} />
        <ClockLine />
      </section>
      <Ticker />
    </div>
  );
}
