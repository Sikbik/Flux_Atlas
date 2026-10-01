// Settings (design 9, window "Settings"): the few choices that change how Atlas looks and behaves, with
// the quiet ones in front and the advanced ones (data freshness, achievements) behind a disclosure. Every
// change applies at once and is remembered in this browser; nothing is sent anywhere.

import { useRouter, useRouterState } from '@tanstack/react-router';
import { Bell, BellOff, Play } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnection, useRuntime } from '../../app/context';
import { formatUtcTime } from '../../lib/format';
import { useNow } from '../../lib/useClock';
import {
  effectiveMotion,
  GLOBE_ARTS,
  type GlobeArtPref,
  type MotionPref,
  type PerfPref,
  useUi,
} from '../../store/ui';
import { AchievementCount, AchievementList } from '../achievements/AchievementList';
import { track } from '../achievements/events';
import { enterAmbient } from '../ambient/enter';
import artHolo from './assets/art-holo.webp';
import artMarble from './assets/art-marble.webp';
import artNeon from './assets/art-neon.webp';
import { Disclosure, Field, Section, Segmented, type SegOption, SelectBox, Switch } from './controls';
import { ageLabel, FRESH_SOURCES, freshnessState, lastSignOf } from './freshness';
import {
  IDLE_OPTIONS_MIN,
  notificationSupport,
  notify,
  requestNotificationPermission,
  usePrefs,
} from './prefs';
import './settings.css';

// ---------------------------------------------------------------------------------------------
// Globe art
// ---------------------------------------------------------------------------------------------

const ARTS: Record<GlobeArtPref, { name: string; says: string; src: string }> = {
  marble: { name: 'Marble', says: 'Satellite imagery, graded to the night', src: artMarble },
  holo: { name: 'Holo', says: 'A planet of dots, like a hologram', src: artHolo },
  neon: { name: 'Neon', says: 'Coastlines and borders that glow', src: artNeon },
};

function GlobeArt() {
  const art = useUi((s) => s.globeArt);
  const setArt = useUi((s) => s.setGlobeArt);
  const choose = useCallback(
    (a: GlobeArtPref) => {
      setArt(a);
      track({ type: 'ui', what: 'art', value: a });
    },
    [setArt],
  );
  return (
    <Section title="Globe" aside="Changes the planet behind this window, live">
      <fieldset className="set-art-grid" data-value={art}>
        <legend className="set-sr">Globe art style</legend>
        {GLOBE_ARTS.map((a) => (
          <label key={a} className="set-art" data-art={a}>
            <input type="radio" name="globe-art" value={a} checked={art === a} onChange={() => choose(a)} />
            <span className="set-art-frame">
              <img src={ARTS[a].src} alt="" width={176} height={110} loading="lazy" draggable={false} />
            </span>
            <span className="set-art-name">{ARTS[a].name}</span>
            <span className="set-art-says">{ARTS[a].says}</span>
          </label>
        ))}
      </fieldset>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Motion and performance
// ---------------------------------------------------------------------------------------------

const MOTION_OPTIONS: readonly SegOption<MotionPref>[] = [
  { value: 'system', label: 'System' },
  { value: 'full', label: 'Full' },
  { value: 'reduced', label: 'Reduced' },
  { value: 'off', label: 'Off' },
];

const MOTION_HINT: Record<MotionPref, string> = {
  system: 'Follows your operating system.',
  full: 'Everything moves: blocks travel to the moon and back, the moon orbits.',
  reduced: 'Fades only. No travel, springs or looping effects.',
  off: 'Nothing animates. The globe still updates.',
};

const PERF_OPTIONS: readonly SegOption<PerfPref>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'high', label: 'High' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'lite', label: 'Lite' },
];

const PERF_HINT: Record<PerfPref, string> = {
  auto: 'Atlas picks a level from how smoothly your device draws.',
  high: 'Windows blur the planet behind them. Best on a recent graphics card.',
  balanced: 'The default look at the default cost.',
  lite: 'No blur, grain or depth on the moon. Every feature stays.',
};

function MotionAndPerformance() {
  const motion = useUi((s) => s.motion);
  const setMotion = useUi((s) => s.setMotion);
  const perf = useUi((s) => s.perf);
  const setPerf = useUi((s) => s.setPerf);
  const following = motion === 'system' ? effectiveMotion('system') : null;
  return (
    <Section title="Motion and performance">
      <Field
        stacked
        title="Motion"
        hint={
          following
            ? `${MOTION_HINT.system} Right now that means ${following === 'full' ? 'full motion' : 'reduced motion'}.`
            : MOTION_HINT[motion]
        }
      >
        <Segmented
          legend="Motion"
          value={motion}
          options={MOTION_OPTIONS}
          onChange={(m) => {
            setMotion(m);
            track({ type: 'ui', what: 'motion', value: m });
          }}
        />
      </Field>
      <Field stacked title="Performance" hint={PERF_HINT[perf]}>
        <Segmented
          legend="Performance level"
          value={perf}
          options={PERF_OPTIONS}
          onChange={(p) => {
            setPerf(p);
            track({ type: 'ui', what: 'perf', value: p });
          }}
        />
      </Field>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Ambient mode
// ---------------------------------------------------------------------------------------------

const IDLE_CHOICES = IDLE_OPTIONS_MIN.map((m) => ({
  value: m,
  label: m === 0 ? 'Never' : m === 1 ? '1 minute' : `${m} minutes`,
}));

function AmbientSettings() {
  const router = useRouter();
  const idle = usePrefs((s) => s.ambientIdleMin);
  const setIdle = usePrefs((s) => s.setAmbientIdleMin);
  const sound = usePrefs((s) => s.ambientSound);
  const setSound = usePrefs((s) => s.setAmbientSound);
  return (
    <Section title="Ambient mode" aside="The planet and the moon, with nothing in front">
      <Field title="Start by itself after" hint="Only when nothing has been touched for this long.">
        <SelectBox
          label="Start ambient mode after"
          value={idle}
          options={IDLE_CHOICES}
          onChange={(m) => {
            setIdle(m);
            track({ type: 'ui', what: 'idle', value: String(m) });
          }}
        />
      </Field>
      <Field
        title="Sound"
        hint="A quiet generative pad that plays only in ambient mode. Off until you turn it on."
      >
        <Switch
          label="Ambient sound"
          checked={sound}
          onChange={(on) => {
            setSound(on);
            track({ type: 'ui', what: 'sound', value: on ? 'on' : 'off' });
          }}
        />
      </Field>
      <div className="set-actions">
        <button type="button" className="set-btn" onClick={() => enterAmbient(router, 'manual')}>
          <Play size={13} strokeWidth={2.2} aria-hidden="true" />
          Try ambient mode
        </button>
        <span className="set-note">Any key or movement brings you back.</span>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------------------------

function Notifications() {
  const on = usePrefs((s) => s.notifications);
  const setOn = usePrefs((s) => s.setNotifications);
  const [, bump] = useState(0);
  // The browser's permission can change outside the page (site settings): read it again on return.
  useEffect(() => {
    const again = () => bump((n) => n + 1);
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, []);
  const support = notificationSupport();

  const ask = useCallback(async () => {
    await requestNotificationPermission();
    track({ type: 'ui', what: 'notifications', value: 'ask' });
    bump((n) => n + 1);
  }, []);

  let body: ReactNode;
  if (support === 'unsupported') {
    body = (
      <Field title="Browser notifications" hint="This browser cannot show them.">
        {null}
      </Field>
    );
  } else if (support === 'denied') {
    body = (
      <Field
        title="Browser notifications"
        hint="They are blocked for this site. Allow them in your browser's site settings, then come back."
      >
        <BellOff size={16} aria-hidden="true" className="set-ic-off" />
      </Field>
    );
  } else if (support === 'default') {
    body = (
      <Field title="Browser notifications" hint="Hear about watched nodes without keeping this tab in front.">
        <button type="button" className="set-btn" onClick={ask}>
          <Bell size={13} strokeWidth={2.2} aria-hidden="true" />
          Allow
        </button>
      </Field>
    );
  } else {
    body = (
      <>
        <Field title="Watched nodes" hint="A notification when a node you watch is paid or stops answering.">
          <Switch label="Notify me about watched nodes" checked={on} onChange={setOn} />
        </Field>
        <div className="set-actions">
          <button
            type="button"
            className="set-btn"
            disabled={!on}
            onClick={() =>
              notify('Notifications are on', 'This is how a watched node will reach you.', {
                tag: 'atlas-test',
              })
            }
          >
            <Bell size={13} strokeWidth={2.2} aria-hidden="true" />
            Send a test
          </button>
          <span className="set-note">
            Notifications come from this browser; Atlas sends nothing to a server.
          </span>
        </div>
      </>
    );
  }
  return <Section title="Notifications">{body}</Section>;
}

// ---------------------------------------------------------------------------------------------
// Disclosures: data freshness and achievements
// ---------------------------------------------------------------------------------------------

const STATUS_WORD: Record<string, string> = {
  live: 'Live',
  syncing: 'Catching up',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
  closed: 'Closed',
  idle: 'Idle',
};

function DataFreshness() {
  const { store, clock } = useRuntime();
  const now = useNow(clock);
  const conn = useConnection();
  const status = STATUS_WORD[conn.status] ?? conn.status;
  // Both clocks are server time: the store stamps messages with the event clock's corrected now.
  const connectedMs = conn.sinceMs + conn.clockOffsetMs;
  const rows = useMemo(
    () =>
      FRESH_SOURCES.map((s) => {
        const { at, heard } = lastSignOf(s, store.lastMessageMs, connectedMs);
        const age = Math.max(0, now - at);
        const judged = freshnessState(age, s.cadenceMs);
        // Nothing yet, and not long enough to matter: neutral, not green and not an alarm.
        const state = !heard && judged === 'fresh' ? 'quiet' : judged;
        return { s, age, heard, state };
      }),
    // `now` ticks once a second: the ages are recomputed from the store's own timestamps each time.
    [store, now, connectedMs],
  );
  return (
    <div className="set-data">
      <p className="set-data-conn" data-status={conn.status}>
        <span className="set-dot" aria-hidden="true" />
        <b>{status}</b>
        {conn.status === 'live' && conn.transitMs !== null ? (
          <span>{Math.round(conn.transitMs)} ms from the server</span>
        ) : null}
        {conn.status !== 'live' ? (
          <span>Showing data from {formatUtcTime(store.tip?.time_ms ?? null)}</span>
        ) : null}
      </p>
      <ul className="set-fresh">
        {rows.map(({ s, age, heard, state }) => (
          <li key={s.id} className="set-fresh-row" data-state={state}>
            <span className="set-dot" aria-hidden="true" />
            <span className="set-fresh-name">
              {s.label}
              <span className="set-fresh-every">{s.every}</span>
            </span>
            <span className="set-fresh-age">{heard ? ageLabel(age) : 'none yet'}</span>
            <span className="set-fresh-word">{state === 'stale' || state === 'dead' ? 'stale' : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function SettingsView() {
  const hash = useRouterState({ select: (s) => s.location.hash ?? '' });
  const wantAchievements = hash.replace(/^#/, '') === 'achievements';
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!wantAchievements) return;
    const t = window.setTimeout(() => target.current?.scrollIntoView({ block: 'start' }), 60);
    return () => window.clearTimeout(t);
  }, [wantAchievements]);

  return (
    <div className="set" data-testid="settings">
      <GlobeArt />
      <MotionAndPerformance />
      <AmbientSettings />
      <Notifications />
      <div className="set-more">
        <Disclosure id="data" title="Data freshness" aside="How current each live source is">
          <DataFreshness />
        </Disclosure>
        <div ref={target}>
          <Disclosure
            id="achievements"
            title="Achievements"
            aside={<AchievementCount />}
            open={wantAchievements}
          >
            <p className="set-note set-note-top">
              Local to this browser. They teach the product; none of them reward grinding.
            </p>
            <AchievementList />
          </Disclosure>
        </div>
      </div>
    </div>
  );
}

export { SettingsView };
