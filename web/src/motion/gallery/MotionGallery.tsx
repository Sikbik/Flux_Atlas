// /dev/motion: every effect of the interaction language on realistic controls, in the three motion
// modes. The mode switch scopes a subtree with data-fx-mode, so "Compare" shows full, reduced and off
// side by side without touching the user's Settings. Values in the live section come from the real
// network (useTip, useChainBlocks); "Fire a block" fakes one so the arrival can be replayed on demand.

import {
  Blocks,
  Check,
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
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChainBlocks, useTip } from '../../app/context';
import { formatHeight } from '../../lib/format';
import { stats as motionStats } from '../engine';
import { type MotionMode, useMotionMode } from '../mode';
import { Current } from '../react/Current';
import { useSpark } from '../react/hooks';
import { useMotionEngine } from '../react/MotionRoot';
import { PowerOn } from '../react/PowerOn';
import { Settle } from '../react/Settle';
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
        <button
          type="button"
          className="fxg-btn fxg-btn--primary"
          data-fx="press charge"
          data-fx-tone="hot"
          data-testid="btn-primary"
          onClick={bump}
        >
          Open explorer
        </button>
        <button
          type="button"
          className="fxg-btn"
          data-fx="press charge"
          data-testid="btn-secondary"
          onClick={bump}
        >
          <Copy size={14} aria-hidden="true" /> Copy address
        </button>
        <button
          type="button"
          className="fxg-btn fxg-btn--ghost"
          data-fx="press charge"
          data-testid="btn-ghost"
          onClick={bump}
        >
          Reset view
        </button>
      </div>
      <div className="fxg-row">
        <button
          type="button"
          className="fxg-icon"
          aria-label="Layers"
          data-fx="press charge"
          data-testid="btn-icon"
          onClick={bump}
        >
          <Layers size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="fxg-icon"
          aria-label="Settings"
          data-fx="press charge"
          onClick={bump}
        >
          <Settings size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="fxg-chip"
          data-fx="press charge"
          data-testid="btn-chip"
          onClick={bump}
        >
          Stratus
        </button>
        <button type="button" className="fxg-btn" disabled data-fx="press charge" style={{ opacity: 0.4 }}>
          Disabled
        </button>
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
  const [copied, setCopied] = useState(false);
  const icon = useRef<HTMLSpanElement>(null);
  useSpark(icon, copied, { delay: 40 });
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <>
      <label className="fxg-switch-row">
        <button
          type="button"
          role="switch"
          aria-checked={peers}
          aria-label="Reveal peers on the globe"
          className="fxg-switch"
          data-fx="toggle charge"
          data-fx-spark="end"
          data-fx-delay="110"
          data-testid="switch"
          onClick={() => setPeers((v) => !v)}
        />
        Reveal peers on the globe
      </label>
      <div className="fxg-row">
        <button
          type="button"
          className="fxg-btn"
          aria-pressed={watch}
          data-fx="toggle charge"
          data-fx-spark="icon"
          data-testid="watch"
          onClick={() => setWatch((v) => !v)}
        >
          <Star size={14} aria-hidden="true" fill={watch ? 'currentColor' : 'none'} />{' '}
          {watch ? 'Watching' : 'Watch node'}
        </button>
        <button
          type="button"
          className="fxg-btn"
          data-fx="charge"
          data-testid="copy"
          onClick={() => setCopied(true)}
        >
          <span ref={icon} style={{ display: 'inline-grid' }}>
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          </span>
          {copied ? 'Copied' : 'Copy txid'}
        </button>
      </div>
      <p className="fxg-hint">A spark only when something turns on or commits. Turning off is quiet.</p>
    </>
  );
}

// ---- Tabs: the selection travels ----------------------------------------------------------------

const TABS = ['Blocks', 'Transactions', 'Addresses', 'Apps'];

function TabsDemo() {
  const [tab, setTab] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = (tab + d + TABS.length) % TABS.length;
    setTab(next);
    refs.current[next]?.focus();
  };
  return (
    <>
      <div className="fxg-tabs" role="tablist" aria-label="Explorer" onKeyDown={onKey} data-testid="tabs">
        {TABS.map((t, i) => (
          <button
            key={t}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`fxg-tab-${i}`}
            aria-selected={tab === i}
            tabIndex={tab === i ? 0 : -1}
            className="fxg-tab"
            data-fx="charge"
            data-testid={`tab-${i}`}
            onClick={() => setTab(i)}
          >
            {t}
          </button>
        ))}
        <TabIndicator />
      </div>
      <div className="fxg-pane" role="tabpanel" aria-labelledby={`fxg-tab-${tab}`}>
        {
          [
            'Newest blocks first, with their producers and payouts.',
            'Mempool and confirmed transactions.',
            'Watch an address and every node it pays.',
            'Deployed apps and their instances.',
          ][tab]
        }
      </div>
      <p className="fxg-hint">
        Click, or focus a tab and use <kbd>Left</kbd> and <kbd>Right</kbd>. The line stretches to the new tab
        and relaxes.
      </p>
    </>
  );
}

// ---- Dense lists and values: settle -------------------------------------------------------------

interface Row {
  id: number;
  name: string;
  a: number;
  b: number;
  fresh: boolean;
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
    NAMES.slice(0, 5).map((name, id) => ({ id, name, a: 1000 + id * 311, b: 40 + id * 7, fresh: false })),
  );
  const add = () =>
    setRows((r) => {
      const id = seq.current++;
      const name = NAMES[id % NAMES.length] ?? 'Node';
      return [
        { id, name, a: 900 + ((id * 137) % 700), b: 30 + ((id * 11) % 50), fresh: true },
        ...r.map((x) => ({ ...x, fresh: false })),
      ].slice(0, 6);
    });
  const tick = () =>
    setRows((r) =>
      r.map((x, i) =>
        i % 2 === 0
          ? { ...x, fresh: false, a: x.a + (i % 4 === 0 ? 17 : -9), b: x.b + 1 }
          : { ...x, fresh: false },
      ),
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
          <div key={r.id} className={r.fresh ? 'fxg-list-row fx-fresh' : 'fxg-list-row'}>
            <span>{r.name}</span>
            <Settle as="span" className="num" value={r.a} tint epsilon={0}>
              {r.a.toLocaleString('en-US')}
            </Settle>
            <Settle as="span" className="num" value={r.b} tint>
              {r.b}
            </Settle>
          </div>
        ))}
      </div>
      <div className="fxg-row">
        <button type="button" className="fxg-btn" data-fx="press charge" data-testid="row-add" onClick={add}>
          <Plus size={14} aria-hidden="true" /> New row
        </button>
        <button
          type="button"
          className="fxg-btn"
          data-fx="press charge"
          data-testid="row-tick"
          onClick={tick}
        >
          <RotateCw size={14} aria-hidden="true" /> Update values
        </button>
      </div>
      <p className="fxg-hint">
        Rows stay calm: no pulse, no hover light. A new row is a wash; a changed value glows once.
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
                <button
                  type="button"
                  className="fxg-icon"
                  aria-label="Close"
                  data-fx="press charge"
                  onClick={() => setOpen(false)}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </header>
              <div className="fxg-win-body">
                <p style={{ margin: 0 }}>
                  A window opens out of the launcher it came from and closes back into it.
                </p>
                <button
                  type="button"
                  className="fxg-btn fxg-btn--primary"
                  data-fx="press charge"
                  data-fx-tone="hot"
                >
                  View block
                </button>
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
        <button
          type="button"
          className="fxg-btn"
          ref={toastBtn}
          data-fx="press charge"
          data-testid="toast-btn"
          onClick={() => setToast(true)}
        >
          Show a toast
        </button>
        <span className="fxg-hint">
          The launcher gets no pulse of its own: the window opening is the effect.
        </span>
      </div>
    </>
  );
}

// ---- Current and Settle: a block arrives --------------------------------------------------------

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
        <Settle as="span" className="fxg-tip-value" value={height}>
          {tip ? formatHeight(height) : 'No block yet'}
        </Settle>
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
        <button
          type="button"
          className="fxg-btn"
          data-fx="charge"
          data-testid="fire"
          onClick={() => setExtra((v) => v + 1)}
        >
          <Zap size={14} aria-hidden="true" /> Fire a block
        </button>
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

export function MotionGallery() {
  useMotionEngine();
  const [pick, setPick] = useState<Pick>('settings');
  const [compare, setCompare] = useState(false);
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
            event.
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
