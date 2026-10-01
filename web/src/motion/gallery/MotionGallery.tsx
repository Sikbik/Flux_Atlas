// /dev/motion: every effect of the interaction language on the real UI kit, in the three motion
// modes. Nothing in the specimens opts in with a data-fx attribute except the dock launchers (custom
// controls the kit does not have): the kit's own attributes (data-pressed, data-state, data-fresh) are
// what the engine answers. The mode switch forces <html data-motion> for the page (the kit's tokens and
// components follow it too) and restores it on leave; "Compare" scopes three frames with data-fx-mode
// instead, so the effects of this folder can be seen side by side (the kit's own CSS follows the page).
// Values in the live section come from the real network (useTip, useChainBlocks); "Fire a block" fakes
// one so the arrival can be replayed on demand.

import {
  Blocks,
  Copy,
  Layers,
  ListOrdered,
  Plus,
  RotateCw,
  Server,
  Settings,
  Star,
  X,
  Zap,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChainBlocks, useTip } from '../../app/context';
import { formatHeight } from '../../lib/format';
import {
  AnimatedNumber,
  Button,
  Chip,
  CopyButton,
  FlashOnChange,
  IconButton,
  Switch,
  type TabItem,
  Tabs,
} from '../../ui';
import { stats as motionStats } from '../engine';
import { type MotionMode, ROOT_ATTR, useMotionMode } from '../mode';
import { Current } from '../react/Current';
import { useMotionEngine } from '../react/MotionRoot';
import { PowerOn } from '../react/PowerOn';
import { TabIndicator } from '../react/TabIndicator';
import './gallery.css';

type Pick = 'settings' | MotionMode;
const PICKS: { id: Pick; label: string }[] = [
  { id: 'settings', label: 'Settings' },
  { id: 'full', label: 'Full' },
  { id: 'reduced', label: 'Reduced' },
  { id: 'off', label: 'Off' },
];
const COMPARE: MotionMode[] = ['full', 'reduced', 'off'];

function Section({
  id,
  title,
  note,
  frames,
  children,
}: {
  id: string;
  title: string;
  note: string;
  frames: (MotionMode | null)[];
  children: () => ReactNode;
}) {
  return (
    <section className="fxg-sec" data-testid={`sec-${id}`}>
      <div className="fxg-sec-head">
        <h2>{title}</h2>
        <span className="fxg-sec-note">{note}</span>
      </div>
      <div className="fxg-cols">
        {frames.map((m) => (
          <div
            key={m ?? 'settings'}
            className="fxg-frame"
            data-fx-mode={m ?? undefined}
            data-testid={`frame-${id}-${m ?? 'settings'}`}
          >
            {m && frames.length > 1 ? <span className="fxg-frame-label">{m}</span> : null}
            {children()}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---- Pulse and Charge: press, hover, focus ------------------------------------------------------

function PressDemo() {
  const [n, setN] = useState(0);
  const bump = () => setN((v) => v + 1);
  return (
    <>
      <div className="fxg-row">
        <Button variant="primary" data-testid="btn-primary" onClick={bump}>
          Open explorer
        </Button>
        <Button icon={Copy} data-testid="btn-secondary" onClick={bump}>
          Copy address
        </Button>
        <Button variant="ghost" data-testid="btn-ghost" onClick={bump}>
          Reset view
        </Button>
        <Button variant="danger" data-testid="btn-danger" onClick={bump}>
          Remove node
        </Button>
      </div>
      <div className="fxg-row">
        <IconButton icon={Layers} label="Layers" data-testid="btn-icon" onClick={bump} />
        <IconButton icon={Settings} label="Settings" variant="secondary" onClick={bump} />
        <Button size="sm" onClick={bump} data-testid="btn-sm">
          Small
        </Button>
        <Button disabled>Disabled</Button>
      </div>
      <div className="fxg-dense" data-fx-density="dense">
        <span className="fxg-hint">A dense zone stays quiet:</span>
        <IconButton icon={Plus} label="Add" size="sm" data-testid="btn-dense" onClick={bump} />
        <IconButton icon={RotateCw} label="Refresh" size="sm" onClick={bump} />
      </div>
      <p className="fxg-hint">
        {n} presses. Click, or Tab to a control and press <kbd>Enter</kbd> or <kbd>Space</kbd>.
      </p>
    </>
  );
}

// ---- Spark: commit and toggle-on ----------------------------------------------------------------

function SparkDemo() {
  const [peers, setPeers] = useState(false);
  const [watch, setWatch] = useState(false);
  return (
    <>
      <div className="fxg-row">
        <Switch label="Reveal peers on the globe" checked={peers} onChange={setPeers} data-testid="switch" />
      </div>
      <div className="fxg-row">
        <Chip icon={Star} selected={watch} onClick={() => setWatch((v) => !v)} data-testid="watch">
          {watch ? 'Watching' : 'Watch node'}
        </Chip>
        <span className="fxg-copy">
          <span className="fxg-hint">txid</span>
          <span className="fxg-mono">9f3a...c01d</span>
          <CopyButton
            value="9f3a4b6c7d8e9f001122334455667788aabbccddeeff00112233445566c01d"
            what="transaction id"
            size="md"
          />
        </span>
      </div>
      <p className="fxg-hint">A spark only when something turns on or commits. Turning off is quiet.</p>
    </>
  );
}

// ---- Selection: the line that travels -----------------------------------------------------------

const KIT_TABS: TabItem[] = [
  { id: 'blocks', label: 'Blocks' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'addresses', label: 'Addresses' },
  { id: 'apps', label: 'Apps' },
];

const PANES: Record<string, string> = {
  blocks: 'Newest blocks first, with their producers and payouts.',
  transactions: 'Mempool and confirmed transactions.',
  addresses: 'Watch an address and every node it pays.',
  apps: 'Deployed apps and their instances.',
};

function TabsDemo() {
  const [kit, setKit] = useState('blocks');
  const [own, setOwn] = useState(0);
  return (
    <>
      <div data-testid="tabs-kit">
        <Tabs aria-label="Explorer" items={KIT_TABS} value={kit} onChange={setKit} />
      </div>
      <div className="fxg-pane">{PANES[kit]}</div>
      <p className="fxg-hint">The kit's tabs glide their own line. For a tab-like list that has none:</p>
      <div className="fxg-tabs" role="tablist" aria-label="Explorer, stretching line" data-testid="tabs">
        {KIT_TABS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={own === i}
            tabIndex={own === i ? 0 : -1}
            className="fxg-tab"
            data-testid={`tab-${i}`}
            onClick={() => setOwn(i)}
          >
            {t.label}
          </button>
        ))}
        <TabIndicator />
      </div>
    </>
  );
}

// ---- Lists and values: a changed value lands (the kit's flash) ---------------------------------

interface Row {
  id: number;
  name: string;
  a: number;
  b: number;
}

const NAMES = [
  'Helsinki',
  'Raleigh',
  'Taganrog',
  'Falkenstein',
  'Ashburn',
  'Singapore',
  'Sao Paulo',
  'Mumbai',
];

function ListDemo() {
  const seq = useRef(5);
  const [rows, setRows] = useState<Row[]>(() =>
    NAMES.slice(0, 5).map((name, id) => ({ id, name, a: 1000 + id * 311, b: 40 + id * 7 })),
  );
  const add = () =>
    setRows((r) => {
      const id = seq.current++;
      const name = NAMES[id % NAMES.length] ?? 'Node';
      return [{ id, name, a: 900 + ((id * 137) % 700), b: 30 + ((id * 11) % 50) }, ...r].slice(0, 6);
    });
  const tick = () =>
    setRows((r) =>
      r.map((x, i) => (i % 2 === 0 ? { ...x, a: x.a + (i % 4 === 0 ? 17 : -9), b: x.b + 1 } : x)),
    );
  return (
    <>
      <div className="fxg-list" data-fx-density="dense" data-testid="list">
        <div className="fxg-list-row fxg-list-head">
          <span>Site</span>
          <span className="num">Nodes</span>
          <span className="num">Queue</span>
        </div>
        {rows.map((r) => (
          <FlashOnChange as="div" variant="bar" key={r.id} value={r.id} className="fxg-list-row">
            <span>{r.name}</span>
            <FlashOnChange className="num" value={r.a} tone="auto">
              {r.a.toLocaleString('en-US')}
            </FlashOnChange>
            <FlashOnChange className="num" value={r.b} tone="auto">
              {r.b}
            </FlashOnChange>
          </FlashOnChange>
        ))}
      </div>
      <div className="fxg-row">
        <Button icon={Plus} data-testid="row-add" onClick={add}>
          New row
        </Button>
        <Button icon={RotateCw} data-testid="row-tick" onClick={tick}>
          Update values
        </Button>
      </div>
      <p className="fxg-hint">
        This is the kit's own flash: a wash that decays, never a second effect on top. Rows stay calm.
      </p>
    </>
  );
}

// ---- Power-on: windows and panels ---------------------------------------------------------------

function WindowDemo() {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(false);
  const launch = useRef<HTMLButtonElement>(null);
  const toastBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(false), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <>
      <div className="fxg-stage" data-testid="stage">
        <div className="fxg-dock" role="toolbar" aria-label="Dock">
          <button
            ref={launch}
            type="button"
            className="fxg-launch"
            aria-label="Explorer"
            aria-pressed={open}
            data-open={open || undefined}
            data-fx="charge"
            data-testid="launch"
            onClick={() => setOpen((v) => !v)}
          >
            <Blocks size={18} aria-hidden="true" />
          </button>
          <button type="button" className="fxg-launch" aria-label="Nodes" data-fx="charge">
            <Server size={18} aria-hidden="true" />
          </button>
          <button type="button" className="fxg-launch" aria-label="Queue" data-fx="charge">
            <ListOrdered size={18} aria-hidden="true" />
          </button>
        </div>
        <PowerOn open={open} origin={() => launch.current} className="fxg-win-wrap">
          <div className="fxg-win-shadow">
            <section className="fxg-win" aria-label="Explorer" data-testid="window">
              <header className="fxg-win-title">
                <Blocks size={16} aria-hidden="true" />
                <span>Explorer</span>
                <IconButton icon={X} label="Close" size="sm" onClick={() => setOpen(false)} />
              </header>
              <div className="fxg-win-body">
                <p style={{ margin: 0 }}>
                  A window opens out of the launcher it came from and closes back into it.
                </p>
                <Button variant="primary" size="sm">
                  View block
                </Button>
              </div>
            </section>
          </div>
        </PowerOn>
        <div className="fxg-toast-wrap">
          <PowerOn open={toast} variant="panel" origin={() => toastBtn.current}>
            <div className="fxg-toast" role="status">
              <span className="fxg-toast-icon">
                <Zap size={16} aria-hidden="true" />
              </span>
              <div>
                <strong>Payment received</strong>
                <span>Plus 9.00 FLUX, Helsinki</span>
              </div>
            </div>
          </PowerOn>
        </div>
      </div>
      <div className="fxg-row">
        <Button ref={toastBtn} data-testid="toast-btn" onClick={() => setToast(true)}>
          Show a toast
        </Button>
        <span className="fxg-hint">
          The launcher gets no pulse of its own: the window opening is the effect.
        </span>
      </div>
    </>
  );
}

// ---- Current: a block arrives -------------------------------------------------------------------

function LiveDemo() {
  const tip = useTip();
  const blocks = useChainBlocks();
  const [extra, setExtra] = useState(0);
  const height = (tip?.height ?? 0) + extra;
  const recent = blocks.slice(0, 5).reverse();
  // Cards that were already on the rail at first paint do not circle; blocks that land later do.
  const firstHeight = useRef<number | null>(null);
  if (firstHeight.current === null && recent.length > 0) firstHeight.current = recent.at(-1)?.height ?? null;
  return (
    <div className="fxg-live">
      <div className="fxg-tip">
        <FlashOnChange value={height} tone="white" className="fxg-tip-value">
          {tip ? <AnimatedNumber value={height} /> : 'No block yet'}
        </FlashOnChange>
        <span className="fxg-hint">chain tip, from the live network</span>
      </div>
      <div className="fxg-rail" data-testid="rail">
        <Current signal={height} edge="top" tail={120} />
        {recent.map((b) => (
          <div key={b.height} className="fxg-card">
            <Current
              signal="landed"
              edge="perimeter"
              fireOnMount={b.height > (firstHeight.current ?? Number.POSITIVE_INFINITY)}
            />
            <strong>{formatHeight(b.height)}</strong>
            <span>{b.producer === null ? 'producer unknown' : `producer ${b.producer}`}</span>
          </div>
        ))}
        {extra > 0 ? (
          <div key={`fake-${extra}`} className="fxg-card" data-testid="fake-card">
            <Current signal="landed" edge="perimeter" fireOnMount />
            <strong>{formatHeight(height)}</strong>
            <span>simulated</span>
          </div>
        ) : null}
      </div>
      <div className="fxg-row">
        <Button icon={Zap} data-testid="fire" onClick={() => setExtra((v) => v + 1)}>
          Fire a block
        </Button>
        <span className="fxg-hint">
          A real block does the same: one streak along the rail, the new card circled once, the number lands.
        </span>
      </div>
    </div>
  );
}

// ---- the page -----------------------------------------------------------------------------------

function Meter() {
  const [s, setS] = useState(() => motionStats());
  useEffect(() => {
    const t = setInterval(() => setS(motionStats()), 250);
    return () => clearInterval(t);
  }, []);
  const mode = useMotionMode();
  return (
    <span className="fxg-meter" data-testid="meter">
      <span>mode {mode}</span>
      <span>active {s?.active ?? 0}</span>
      <span>granted {s?.granted ?? 0}</span>
      <span>dropped {s?.dropped ?? 0}</span>
      <span>preempted {s?.preempted ?? 0}</span>
    </span>
  );
}

/** Forces <html data-motion> while a mode is picked, and puts back whatever was there when it is not. */
function useForcedMode(pick: Pick): void {
  useEffect(() => {
    if (pick === 'settings') return;
    const root = document.documentElement;
    const before = root.getAttribute(ROOT_ATTR);
    root.setAttribute(ROOT_ATTR, pick);
    return () => {
      if (before === null) root.removeAttribute(ROOT_ATTR);
      else root.setAttribute(ROOT_ATTR, before);
    };
  }, [pick]);
}

export function MotionGallery() {
  useMotionEngine();
  const [pick, setPick] = useState<Pick>('settings');
  const [compare, setCompare] = useState(false);
  useForcedMode(compare ? 'settings' : pick);
  const frames: (MotionMode | null)[] = compare ? COMPARE : [pick === 'settings' ? null : pick];
  // Portalled to <body>: the shell's stage is a stacking context below the globe's labels, and a
  // gallery that sits under them is not a fair place to judge light.
  return createPortal(
    <div className="fxg" data-testid="motion-gallery">
      <header className="fxg-head">
        <div>
          <h1 className="fxg-title">Motion language</h1>
          <p className="fxg-sub">
            Pulse, Charge, Spark, Current, Power-on, Settle. Energy and current, only on input or a real
            event. Specimens are the real UI kit: the engine answers its attributes.
          </p>
        </div>
        <div className="fxg-tools">
          <Meter />
          <fieldset className="fxg-seg" aria-label="Motion mode">
            {PICKS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={!compare && pick === p.id}
                data-testid={`mode-${p.id}`}
                onClick={() => {
                  setCompare(false);
                  setPick(p.id);
                }}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={compare}
              data-testid="mode-compare"
              onClick={() => setCompare((v) => !v)}
            >
              Compare
            </button>
          </fieldset>
        </div>
      </header>
      <div className="fxg-body" data-compare={compare || undefined}>
        <Section id="press" title="Pulse and Charge" note="press, hover, focus" frames={frames}>
          {() => <PressDemo />}
        </Section>
        <Section id="spark" title="Spark" note="commit, toggle on" frames={frames}>
          {() => <SparkDemo />}
        </Section>
        <Section id="tabs" title="Selection" note="a line that travels" frames={frames}>
          {() => <TabsDemo />}
        </Section>
        <Section id="list" title="Lists and values" note="dense views stay quiet" frames={frames}>
          {() => <ListDemo />}
        </Section>
        <Section id="window" title="Power-on" note="windows and panels" frames={frames}>
          {() => <WindowDemo />}
        </Section>
        <Section id="live" title="A block arrives" note="current and settle" frames={frames}>
          {() => <LiveDemo />}
        </Section>
      </div>
    </div>,
    document.body,
  );
}
