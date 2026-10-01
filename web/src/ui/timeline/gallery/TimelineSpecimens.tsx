import {
  Blocks,
  CircleCheck,
  Coins,
  FilePen,
  type LucideIcon,
  OctagonX,
  Pause,
  Play,
  Plus,
  Rocket,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNodes } from '../../../api/queries';
import { useFeed, useTip } from '../../../app/context';
import { formatHeight, formatInt } from '../../../lib/format';
import { Button } from '../../controls/Button';
import { useKitClock } from '../../internal/clock';
import { DemoTag } from '../../live/gallery/parts';
import { EmptyState } from '../../states/EmptyState';
import { Skeleton } from '../../states/Skeleton';
import { DiffBlock, type DiffLine } from '../DiffBlock';
import { Timeline, type TimelineItem } from '../Timeline';
import type { TimelineTone } from '../timeline';
import { feedItem, lifecycleItems } from './lifecycle';
import './timeline-specimens.css';

const DAY = 86_400_000;

/** A real node's lifecycle from its heights, with the two thresholds that lie ahead of it. */
export function NodeLifecycle() {
  const tip = useTip();
  const nodes = useNodes({ limit: 1 });
  const node = nodes.data?.items[0];
  if (nodes.isError) {
    return (
      <EmptyState compact tone="warn" title="Could not load a node">
        The lifecycle is built from a real node row.
      </EmptyState>
    );
  }
  if (!node || !tip) {
    return (
      <div className="kg-tl-skeleton" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="kg-tl-skeleton__row">
            <Skeleton w={56} h={10} />
            <Skeleton circle w={12} />
            <Skeleton w={`${70 - i * 8}%`} h={12} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="kg-tl-stack">
      <div className="kg-tl-head">
        <span className="ui-mono">{node.endpoint ?? 'Unknown'}</span>
        <span className="kg-live-label">
          {node.tier}, block {formatHeight(tip.height)}
        </span>
      </div>
      <Timeline key={node.id} label="Node lifecycle" items={lifecycleItems(node, tip)} />
    </div>
  );
}

const SPEC_DIFF: readonly DiffLine[] = [
  { kind: 'ctx', text: '{ "name": "BitcoinWhitepaper",' },
  { kind: 'del', text: '  "version": 2,' },
  { kind: 'add', text: '  "version": 3,' },
  { kind: 'del', text: '  "repotag": "runonflux/bitcoin-whitepaper:2.0.4",' },
  { kind: 'add', text: '  "repotag": "runonflux/bitcoin-whitepaper:2.1.0",' },
  { kind: 'ctx', text: '  "cpu": 0.1 }' },
];

const RENEWALS: ReadonlyArray<readonly [block: number, date: string]> = [
  [2941022, '2026-08-14'],
  [2897810, '2026-07-15'],
  [2854604, '2026-06-15'],
  [2811398, '2026-05-16'],
  [2768192, '2026-04-16'],
  [2724986, '2026-03-17'],
  [2681780, '2026-02-15'],
  [2638574, '2026-01-16'],
  [2595368, '2025-12-17'],
];

function historyItems(now: number): TimelineItem[] {
  return [
    {
      id: 'updated',
      time: now - 28 * DAY,
      tone: 'hot',
      icon: FilePen,
      title: 'Spec updated',
      block: 2950118,
      meta: (
        <>
          paid <span className="ui-mono">3.61 FLUX</span>
        </>
      ),
      defaultOpen: true,
      children: <DiffBlock label="Changes in spec version 3" lines={SPEC_DIFF} />,
    },
    {
      id: 'renewed',
      time: '2025-09 to 2026-08',
      tone: 'neutral',
      title: 'Renewed',
      count: RENEWALS.length,
      meta: 'Same spec each time',
      children: (
        <ul className="kg-tl-renewals">
          {RENEWALS.map(([block, date]) => (
            <li key={block}>
              <span className="ui-mono">{formatHeight(block)}</span>
              <span className="ui-mono">{date}</span>
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: 'registered',
      time: now - 2160 * DAY,
      tone: 'ok',
      icon: Rocket,
      title: 'Registered',
      block: 1161000,
      meta: 'spec v1',
    },
  ];
}

/** A synthetic app spec history: an update with a diff, a grouped run of renewals, the registration. */
export function SpecHistory({ mode = 'relative' }: { mode?: 'relative' | 'absolute' }) {
  const clock = useKitClock();
  const now = useMemo(() => clock.now(), [clock]);
  return <Timeline label="App spec history" timeMode={mode} items={historyItems(now)} />;
}

/** The same history with a switch between relative and absolute times. */
export function SpecHistoryToggle() {
  const [mode, setMode] = useState<'relative' | 'absolute'>('relative');
  return (
    <div className="kg-tl-stack">
      <div className="kg-live-row">
        <DemoTag>Synthetic history</DemoTag>
        <Button
          size="sm"
          variant={mode === 'relative' ? 'secondary' : 'ghost'}
          onClick={() => setMode('relative')}
        >
          Relative
        </Button>
        <Button
          size="sm"
          variant={mode === 'absolute' ? 'secondary' : 'ghost'}
          onClick={() => setMode('absolute')}
        >
          Absolute
        </Button>
      </div>
      <SpecHistory mode={mode} />
    </div>
  );
}

interface Kind {
  title: string;
  tone: TimelineTone;
  icon: LucideIcon;
  meta: string;
}

const KINDS: readonly Kind[] = [
  { title: 'Block produced', tone: 'accent', icon: Blocks, meta: '17 transactions, 3.6 KB' },
  { title: 'Node joined', tone: 'ok', icon: Rocket, meta: 'Stratus node in Falkenstein' },
  { title: 'App updated', tone: 'hot', icon: FilePen, meta: 'Fluxtracker, spec v6' },
  { title: 'Node at risk', tone: 'warn', icon: TriangleAlert, meta: '561 blocks since the last check-in' },
  { title: 'Payment received', tone: 'ok', icon: Coins, meta: '9.00 FLUX to a watched node' },
  { title: 'Node expired', tone: 'crit', icon: OctagonX, meta: 'No check-in for 640 blocks' },
];

/** An event log on the live option: add an event, or let it add one every 2.5 s, and watch it arrive. */
export function EventLog() {
  const clock = useKitClock();
  const nextId = useRef(100);
  const [auto, setAuto] = useState(false);
  const [confirmed, setConfirmed] = useState(14);
  const [events, setEvents] = useState<readonly TimelineItem[]>(() => {
    const t = clock.now();
    return [
      { id: 3, time: t - 41_000, ...pick(0), block: 2997701 },
      { id: 2, time: t - 95_000, ...pick(1) },
      { id: 1, time: t - 4 * 60_000, ...pick(2) },
    ];
  });

  const add = () => {
    const k = nextId.current++;
    setEvents((es) => [{ id: k, time: clock.now(), ...pick(k) }, ...es].slice(0, 7));
  };
  const addRef = useRef(add);
  addRef.current = add;
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => addRef.current(), 2500);
    return () => clearInterval(id);
  }, [auto]);

  const items: TimelineItem[] = [
    {
      id: 'confirmed',
      time: 'This block',
      tone: 'neutral',
      title: 'Nodes confirmed',
      count: confirmed,
      meta: 'Aggregated for this block',
    },
    ...events,
  ];

  return (
    <div className="kg-tl-stack">
      <div className="kg-live-row">
        <DemoTag>Synthetic events, demo controls</DemoTag>
      </div>
      <div className="kg-live-row">
        <Button size="sm" icon={Plus} onClick={add}>
          Add an event
        </Button>
        <Button size="sm" icon={Plus} onClick={() => setConfirmed((c) => c + 1)}>
          Add to the group
        </Button>
        <Button size="sm" icon={auto ? Pause : Play} onClick={() => setAuto((a) => !a)}>
          {auto ? 'Stop adding' : 'Add one every 2.5 s'}
        </Button>
      </div>
      <Timeline live label="Event log" items={items} />
    </div>
  );
}

function pick(i: number): Pick<TimelineItem, 'title' | 'tone' | 'icon' | 'meta'> {
  const k = KINDS[i % KINDS.length] as Kind;
  return { title: k.title, tone: k.tone, icon: k.icon, meta: k.meta };
}

/** The real activity feed from the live stream, newest first; new events arrive with the live treatment. */
export function FeedLog() {
  const feed = useFeed();
  const items = useMemo(
    () =>
      [...feed]
        .sort((a, b) => b.observedMs - a.observedMs || b.seq - a.seq)
        .slice(0, 7)
        .map(feedItem),
    [feed],
  );
  if (items.length === 0) {
    return (
      <EmptyState compact icon={CircleCheck} title="Waiting for the next event">
        Events from the live stream appear here as they happen.
      </EmptyState>
    );
  }
  return (
    <div className="kg-tl-stack">
      <Timeline live label="Live activity" items={items} />
      <p className="kg-live-label">
        Live: the last {formatInt(items.length)} events of the stream. Hold this page open and a new one grows
        in.
      </p>
    </div>
  );
}
