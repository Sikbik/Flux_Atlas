// Settings (design 9, window "Settings"): the few choices that change how Atlas looks and behaves, with
// the quiet ones in front and the advanced ones (data freshness, achievements) behind a fold. Every
// change applies at once and is remembered in this browser; nothing is sent anywhere. Built from the UI
// kit (Section, SegmentedControl, Select, Switch, Button, Freshness, StatusChip); the globe art cards and
// the setting row are the only pieces of its own.

import { useRouter, useRouterState } from '@tanstack/react-router';
import { Bell, BellOff, Play } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useConnection, useRuntime } from '../../app/context';
import { useGlobeEngine } from '../../globe';
import { formatUtcTime } from '../../lib/format';
import { useNow } from '../../lib/useClock';
import {
  effectiveMotion,
  GLOBE_ARTS,
  type GlobeArtPref,
  type GlobeBordersPref,
  type MotionPref,
  type PerfPref,
  useUi,
} from '../../store/ui';
import { Button, Freshness, Section, SegmentedControl, Select, StatusChip, Switch } from '../../ui';
import { AchievementCount, AchievementList } from '../achievements/AchievementList';
import { track } from '../achievements/events';
import { enterAmbient } from '../ambient/enter';
import artHolo from './assets/art-holo.webp';
import artMarble from './assets/art-marble.webp';
import artNeon from './assets/art-neon.webp';
import { Field, Sr } from './controls';
import { FRESH_SOURCES, lastSignOf } from './freshness';
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

const BORDER_OPTIONS: readonly { value: GlobeBordersPref; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'countries', label: 'Countries' },
  { value: 'states', label: 'Countries and states' },
];

const BORDER_HINT: Record<GlobeBordersPref, string> = {
  off: 'The planet with no political lines.',
  countries: 'Country borders, drawn in the style of the look you chose.',
  states: 'Country borders, and state and province lines as you zoom in.',
};

function GlobeBorders() {
  const borders = useUi((s) => s.globeBorders);
  const setBorders = useUi((s) => s.setGlobeBorders);
  const perf = useUi((s) => s.perf);
  // The Lite level never loads or draws state lines (it is the level for weak graphics).
  const hint =
    borders === 'states' && perf === 'lite'
      ? 'State and province lines need the Balanced level or higher; Lite draws country borders only.'
      : BORDER_HINT[borders];
  return (
    <Field stacked title="Borders" hint={hint}>
      <SegmentedControl
        aria-label="Borders on the globe"
        fullWidth
        value={borders}
        options={BORDER_OPTIONS}
        onChange={setBorders}
      />
    </Field>
  );
}

/** Whether the governor has stepped the globe down to its lite look (auto performance, a device that fell behind). */
function useForcedLite(): boolean {
  const engine = useGlobeEngine();
  const [forced, setForced] = useState(() => engine?.forcedLite ?? false);
  useEffect(() => {
    if (!engine) return;
    setForced(engine.forcedLite);
    return engine.on('quality', (q) => setForced(q.forcedLite));
  }, [engine]);
  return forced;
}

function GlobeArt() {
  const art = useUi((s) => s.globeArt);
  const setArt = useUi((s) => s.setGlobeArt);
  const engine = useGlobeEngine();
  const forcedLite = useForcedLite();
  const choose = useCallback(
    (a: GlobeArtPref) => {
      setArt(a);
      track({ type: 'ui', what: 'art', value: a });
    },
    [setArt],
  );
  return (
    <Section title="Globe" level={3} aside="Changes the planet behind this window, live">
      <fieldset className="set-art-grid" data-value={art}>
        <legend className="set-sr">Globe art style</legend>
        {GLOBE_ARTS.map((a) => (
          <label key={a} className="set-art" data-art={a}>
            {/* The picture lights its edge under the pointer (the motion language's Charge); the radio sits
                inside it, so a hover and the keyboard land on the same thing. */}
            <span className="set-art-frame" data-fx="charge">
              {/* A click on the look already chosen still counts: it brings that look back from the lite one. */}
              <input
                type="radio"
                name="globe-art"
                value={a}
                checked={art === a}
                onChange={() => choose(a)}
                onClick={() => engine?.resetGovernor()}
              />
              <img src={ARTS[a].src} alt="" width={176} height={110} loading="lazy" draggable={false} />
            </span>
            <span className="set-art-name">{ARTS[a].name}</span>
            <span className="set-art-says">{ARTS[a].says}</span>
          </label>
        ))}
      </fieldset>
      {forcedLite && art !== 'holo' ? (
        <p className="set-field-hint set-art-note" role="status">
          Holo for now: the globe stepped down to keep up with this device. {ARTS[art].name} comes back once
          frames are steady, or pick a look to switch now.
        </p>
      ) : null}
      <GlobeBorders />
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Motion and performance
// ---------------------------------------------------------------------------------------------

const MOTION_OPTIONS: readonly { value: MotionPref; label: string }[] = [
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

const PERF_OPTIONS: readonly { value: PerfPref; label: string }[] = [
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
    <Section title="Motion and performance" level={3}>
      <Field
        stacked
        title="Motion"
        hint={
          following
            ? `${MOTION_HINT.system} Right now that means ${following === 'full' ? 'full motion' : 'reduced motion'}.`
            : MOTION_HINT[motion]
        }
      >
        <SegmentedControl
          aria-label="Motion"
          fullWidth
          value={motion}
          options={MOTION_OPTIONS}
          onChange={(m) => {
            setMotion(m);
            track({ type: 'ui', what: 'motion', value: m });
          }}
        />
      </Field>
      <Field stacked title="Performance" hint={PERF_HINT[perf]}>
        <SegmentedControl
          aria-label="Performance level"
          fullWidth
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
  value: String(m),
  label: m === 0 ? 'Never' : m === 1 ? '1 minute' : `${m} minutes`,
}));

const coarsePointer = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

function AmbientSettings() {
  const router = useRouter();
  const idle = usePrefs((s) => s.ambientIdleMin);
  const setIdle = usePrefs((s) => s.setAmbientIdleMin);
  const sound = usePrefs((s) => s.ambientSound);
  const setSound = usePrefs((s) => s.setAmbientSound);
  return (
    <Section title="Ambient mode" level={3} aside="The planet and the moon, with nothing in front">
      <Field title="Start by itself after" hint="Only when nothing has been touched for this long.">
        <Select
          aria-label="Start ambient mode after"
          size="sm"
          native={coarsePointer()}
          value={String(idle)}
          options={IDLE_CHOICES}
          onChange={(v) => {
            setIdle(Number(v));
            track({ type: 'ui', what: 'idle', value: v });
          }}
        />
      </Field>
      <Switch
        layout="row"
        label="Sound"
        description="A quiet generative pad that plays only in ambient mode. Off until you turn it on."
        checked={sound}
        onChange={(on) => {
          setSound(on);
          track({ type: 'ui', what: 'sound', value: on ? 'on' : 'off' });
        }}
      />
      <div className="set-actions">
        {/* The whole screen dissolving into the scene is the answer; a light on the button would be a second one. */}
        <Button size="sm" icon={Play} data-fx="off" onClick={() => enterAmbient(router, 'manual')}>
          Try ambient mode
        </Button>
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
        <BellOff size={16} strokeWidth={1.5} aria-hidden="true" className="set-ic-off" />
      </Field>
    );
  } else if (support === 'default') {
    body = (
      <Field title="Browser notifications" hint="Hear about watched nodes without keeping this tab in front.">
        <Button size="sm" icon={Bell} onClick={ask}>
          Allow
        </Button>
      </Field>
    );
  } else {
    body = (
      <>
        <Switch
          layout="row"
          label="Watched nodes"
          description="A notification when a node you watch is paid or stops answering."
          checked={on}
          onChange={setOn}
        />
        <div className="set-actions">
          <Button
            size="sm"
            icon={Bell}
            disabled={!on}
            onClick={() =>
              notify('Notifications are on', 'This is how a watched node will reach you.', {
                tag: 'atlas-test',
              })
            }
          >
            Send a test
          </Button>
          <span className="set-note">
            Notifications come from this browser; Atlas sends nothing to a server.
          </span>
        </div>
      </>
    );
  }
  return (
    <Section title="Notifications" level={3}>
      {body}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Folds: data freshness and achievements
// ---------------------------------------------------------------------------------------------

/** The connection states as the kit's status words. */
const CONNECTION_STATUS: Record<string, string> = {
  live: 'live',
  syncing: 'syncing',
  connecting: 'syncing',
  reconnecting: 'degraded',
  offline: 'offline',
  closed: 'offline',
};

function DataFreshness() {
  const { store, clock } = useRuntime();
  // Once a second, so the rows read the store's own timestamps again (the chips tick by themselves).
  const now = useNow(clock);
  const conn = useConnection();
  // Both clocks are server time: the store stamps messages with the event clock's corrected now.
  const connectedMs = conn.sinceMs + conn.clockOffsetMs;
  return (
    <div className="set-data" data-now={now}>
      <p className="set-data-conn">
        <StatusChip status={CONNECTION_STATUS[conn.status]} size="sm" />
        {conn.status === 'live' && conn.transitMs !== null ? (
          <span>{Math.round(conn.transitMs)} ms from the server</span>
        ) : null}
        {conn.status !== 'live' ? (
          <span>Showing data from {formatUtcTime(store.tip?.time_ms ?? null)}</span>
        ) : null}
      </p>
      <ul className="set-fresh">
        {FRESH_SOURCES.map((s) => {
          // A feed that has said nothing since this page connected is judged from the moment it connected.
          const { at } = lastSignOf(s, store.lastMessageMs, connectedMs);
          return (
            <li key={s.id} className="set-fresh-row">
              <span className="set-fresh-name">
                {s.label}
                <span className="set-fresh-every">{s.every}</span>
              </span>
              <Freshness ts={at} cadenceMs={s.cadenceMs} label={s.id} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A collapsible kit section whose body is only built once it has been opened. */
function Fold({
  title,
  aside,
  open,
  onOpenChange,
  id,
  children,
}: {
  title: string;
  aside?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  id: string;
  children: ReactNode;
}) {
  const [everOpen, setEverOpen] = useState(open);
  useEffect(() => {
    if (open) setEverOpen(true);
  }, [open]);
  return (
    <Section
      id={id}
      title={title}
      level={3}
      aside={aside}
      collapsible
      open={open}
      onOpenChange={onOpenChange}
    >
      {everOpen ? children : null}
    </Section>
  );
}

export default function SettingsView() {
  const hash = useRouterState({ select: (s) => s.location.hash ?? '' });
  const wantAchievements = hash.replace(/^#/, '') === 'achievements';
  const target = useRef<HTMLDivElement>(null);
  const [dataOpen, setDataOpen] = useState(false);
  const [achOpen, setAchOpen] = useState(wantAchievements);
  useEffect(() => {
    if (!wantAchievements) return;
    setAchOpen(true);
    const t = window.setTimeout(() => target.current?.scrollIntoView({ block: 'start' }), 60);
    return () => window.clearTimeout(t);
  }, [wantAchievements]);

  return (
    <div className="set" data-testid="settings">
      <Sr>Settings apply at once and stay in this browser.</Sr>
      <GlobeArt />
      <MotionAndPerformance />
      <AmbientSettings />
      <Notifications />
      <Fold
        id="data"
        title="Data freshness"
        aside="How current each live source is"
        open={dataOpen}
        onOpenChange={setDataOpen}
      >
        <DataFreshness />
      </Fold>
      <div ref={target}>
        <Fold
          id="achievements"
          title="Achievements"
          aside={<AchievementCount />}
          open={achOpen}
          onOpenChange={setAchOpen}
        >
          <p className="set-note set-note-top">
            Local to this browser. They teach the product; none of them reward grinding.
          </p>
          <AchievementList />
        </Fold>
      </div>
    </div>
  );
}

export { SettingsView };
