// About Flux (design 8.19, window "About Flux", also the page /about): what Atlas is, in a few quiet
// sections that all read live numbers. Hero, the chain right now, the moon as the chain (how a block pays
// out), capacity, the next reward cut and the Flux mission; the sources, status, version and credits wait
// behind one disclosure. Nothing here blanks when the stream drops: values keep their last number.

import { Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useNetworkCapacity, useNetworkVersions } from '../../../api/queries';
import { useConnection, useNetwork, useRuntime, useSummary, useTip } from '../../../app/context';
import { formatInt, formatPercent, heightEta } from '../../../lib/format';
import { useBeat, useNow } from '../../../lib/useClock';
import { TierMeter } from '../../command/icons';
import { Disclosure, Section } from '../controls';
import { ATLAS_VERSION } from '../version';
import { FluxPieces } from './FluxPieces';
import { LockupL2 } from './Lockup';
import { capacityRows, legendRows, roughSpan, TIER_NAME, type TierKey } from './model';
import '../settings.css';
import './about.css';

const BLOCK_SECONDS = 30;

// ---------------------------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------------------------

function Hero() {
  return (
    <header className="ab-hero">
      <div className="ab-hero-wash" aria-hidden="true" />
      <div className="ab-hero-lattice" aria-hidden="true">
        <i />
      </div>
      <LockupL2 className="ab-lockup" height={70} />
      <p className="ab-tagline">The live Flux network, as a place you can open.</p>
    </header>
  );
}

// ---------------------------------------------------------------------------------------------
// The chain, right now
// ---------------------------------------------------------------------------------------------

const RING_R = 28;
const RING_C = 2 * Math.PI * RING_R;

/** The Beat clock as a ring: it fills across the block interval and shows the seconds left. */
function BlockRing({ progress, label, phase }: { progress: number; label: string; phase: string }) {
  // When a block lands the ring restarts: jump back instead of sweeping the whole circle in reverse.
  const last = useRef(progress);
  const reset = progress < last.current - 0.2;
  useEffect(() => {
    last.current = progress;
  }, [progress]);
  return (
    <span className="ab-ring" data-phase={phase} data-reset={reset ? '' : undefined} aria-hidden="true">
      <svg viewBox="0 0 64 64" focusable="false" aria-hidden="true">
        <circle className="ab-ring-track" cx="32" cy="32" r={RING_R} />
        <circle
          className="ab-ring-arc"
          cx="32"
          cy="32"
          r={RING_R}
          transform="rotate(-90 32 32)"
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - progress)}
        />
      </svg>
      <span className="ab-ring-n">{label}</span>
    </span>
  );
}

function Tile({ label, value, sub }: { label: string; value: string | null; sub: string | null }) {
  return (
    <div className="ab-tile">
      <span className="ab-eyebrow">{label}</span>
      <b className="ab-tile-n" data-pending={value === null ? '' : undefined}>
        {value ?? ' '}
      </b>
      <span className="ab-tile-sub" data-pending={sub === null ? '' : undefined}>
        {sub ?? ' '}
      </span>
    </div>
  );
}

const TIER_ORDER: readonly TierKey[] = ['cumulus', 'nimbus', 'stratus'];

function ChainNow() {
  const { clock } = useRuntime();
  const beat = useBeat(clock);
  const tip = useTip();
  const summary = useSummary();
  const height = tip?.height ?? beat.height;
  const secs = Math.ceil(beat.remainingMs / 1000);
  const waiting = beat.phase === 'waiting' || beat.phase === 'soon';
  const next = height === null ? null : formatInt(height + 1);
  let line: string;
  if (height === null) line = 'Waiting for the chain.';
  else if (waiting && secs > 0) line = `Block ${next} lands in ${secs} s.`;
  else if (beat.phase === 'quiet')
    line = `No block for ${Math.max(1, Math.round(beat.sinceMs / 60_000))} min. The stream may be behind.`;
  else line = `Block ${next} is due.`;
  const ringLabel = height === null ? '' : waiting ? String(secs) : beat.phase === 'quiet' ? '' : 'late';
  const total = summary?.tiers.total ?? 0;

  return (
    <Section title="The chain, right now" aside="Updates every block">
      <div className="ab-now">
        <BlockRing progress={beat.progress} label={ringLabel} phase={beat.phase} />
        <div className="ab-tip">
          <span className="ab-eyebrow">Block tip</span>
          {/* Keyed by height: a new block remounts the number, which plays the landing flash once. */}
          <b
            className="ab-tip-n tabular"
            key={height ?? 'none'}
            data-pending={height === null ? '' : undefined}
          >
            {height === null ? ' ' : formatInt(height)}
          </b>
          <p className="ab-tip-line">
            <span className="tabular">{line}</span>
            <span className="ab-tip-sub">One block every {BLOCK_SECONDS} seconds.</span>
          </p>
        </div>
      </div>

      <div className="ab-tiles">
        <Tile
          label="Nodes"
          value={summary ? formatInt(summary.node_count) : null}
          sub={summary ? `${formatInt(summary.host_count)} IP addresses` : null}
        />
        <Tile
          label="Apps"
          value={summary ? formatInt(summary.app_count) : null}
          sub={summary ? `${formatInt(summary.instance_count)} instances` : null}
        />
        <Tile
          label="Countries"
          value={summary ? formatInt(summary.country_count) : null}
          sub={summary ? `${formatInt(summary.provider_count)} networks` : null}
        />
      </div>

      <ul className="ab-tiers">
        {TIER_ORDER.map((t) => {
          const n = summary?.tiers[t] ?? null;
          return (
            <li key={t} className="ab-tier" data-tier={t}>
              <span className="ab-tier-glyph">
                <TierMeter tier={t} size={16} />
              </span>
              <span className="ab-tier-name">{TIER_NAME[t]}</span>
              <span className="ab-bar" style={{ ['--f' as string]: n !== null && total > 0 ? n / total : 0 }}>
                <i />
              </span>
              <span className="ab-tier-n tabular">{n === null ? '' : formatInt(n)}</span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// The moon is the chain
// ---------------------------------------------------------------------------------------------

function Anatomy() {
  const tiers = useNetwork((s) => s.tierStats);
  const summary = useSummary();
  const rows = legendRows(tiers, summary?.reward);
  return (
    <Section title="The moon is the chain" aside="How a block pays out">
      <div className="ab-anat">
        <div className="ab-anat-card">
          <FluxPieces height={112} className="ab-anat-sym" />
        </div>
        <ol className="ab-leg">
          {rows.map((r) => (
            <li key={r.piece} className="ab-leg-row" data-piece={r.piece} data-tier={r.tier ?? undefined}>
              <FluxPieces height={26} lit={r.piece} className="ab-leg-sym" />
              <span className="ab-leg-text">
                <span className="ab-leg-name">
                  {r.tier ? <TierMeter tier={r.tier} size={13} /> : null}
                  {r.name}
                </span>
                <span className="ab-leg-piece">{r.pieceName}</span>
              </span>
              <span className="ab-leg-vals">
                <span className="ab-leg-pay tabular" data-pending={r.payout === null ? '' : undefined}>
                  {r.payout ?? ' '}
                </span>
                <span className="ab-leg-cycle" data-pending={r.cycle === null ? '' : undefined}>
                  {r.cycle ?? ' '}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <p className="ab-caption">
        A producer node finds the block and sends it up to the moon. The moon sets aside{' '}
        {rows.find((r) => r.piece === 'bar')?.payout ?? 'a little'} for the development fund, then pays a
        Cumulus, a Nimbus and a Stratus node, small to large, in the order the chain lists them.
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------------------------

function Capacity() {
  const cap = useNetworkCapacity();
  const versions = useNetworkVersions();
  const summary = useSummary();
  const rows = cap.data ? capacityRows(cap.data) : null;
  const os = versions.data?.flux_os.find((b) => b.key !== 'unknown') ?? null;
  const arcane = summary && summary.node_count > 0 ? summary.arcane_count / summary.node_count : null;
  return (
    <Section title="Capacity" aside="Across every node">
      <ul className="ab-cap">
        {(rows ?? [null, null, null]).map((r, i) => (
          // The three rows are fixed, so a skeleton and a real row share the same slot.
          <li key={r?.id ?? i} className="ab-cap-row" data-pending={r ? undefined : ''}>
            <span className="ab-cap-label">{r?.label ?? ' '}</span>
            <span className="ab-cap-total tabular">{r?.total ?? ' '}</span>
            <span className="ab-bar ab-cap-bar" style={{ ['--f' as string]: r?.share ?? 0 }}>
              <i />
            </span>
            <span className="ab-cap-locked tabular">{r ? `${r.locked} held by apps` : ' '}</span>
          </li>
        ))}
      </ul>
      <dl className="ab-kv">
        <div>
          <dt>Running ArcaneOS</dt>
          <dd className="tabular">{arcane === null ? ' ' : formatPercent(arcane, 0)}</dd>
        </div>
        <div>
          <dt>FluxOS {os ? os.label : ''}</dt>
          <dd className="tabular">{os ? `on ${formatPercent(os.share)}` : ' '}</dd>
        </div>
      </dl>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// The next reward cut
// ---------------------------------------------------------------------------------------------

function RewardCut() {
  const { clock } = useRuntime();
  const now = useNow(clock);
  const tip = useTip();
  const summary = useSummary();
  const target = summary?.next_reduction_height ?? null;
  const eta =
    target !== null && tip ? heightEta(target, { height: tip.height, timeMs: tip.time_ms }, now) : null;
  return (
    <Section title="Next reward cut" aside={target === null ? undefined : `Block ${formatInt(target)}`}>
      <div className="ab-cut">
        <b className="ab-cut-n tabular" data-pending={eta === null ? '' : undefined}>
          {eta === null ? ' ' : formatInt(Math.max(0, eta.blocks))}
        </b>
        <span className="ab-cut-text">
          <span className="ab-cut-unit">blocks to go</span>
          <span className="ab-cut-eta" data-pending={eta === null ? '' : undefined}>
            {eta === null ? ' ' : `About ${roughSpan(Math.max(0, eta.etaMs))} from now`}
          </span>
        </span>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Mission
// ---------------------------------------------------------------------------------------------

function Mission() {
  return (
    <figure className="ab-mission">
      <blockquote>
        To build a scalable, decentralized network of computing power for the people, by the people.
      </blockquote>
      <figcaption>The Flux mission</figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------------------------
// Under the hood: sources, status, version, credits
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

function Hood() {
  const conn = useConnection();
  const server = conn.server;
  const word = STATUS_WORD[conn.status] ?? conn.status;
  return (
    <div className="ab-hood">
      <h4 className="ab-h4">Where the numbers come from</h4>
      <ul className="ab-src">
        <li>
          <span className="ab-when">Within 3 s</span>
          <span>Blocks, who made them and who was paid, node confirmations and the mempool.</span>
        </li>
        <li>
          <span className="ab-when">Within a minute</span>
          <span>App deployments and updates, where instances run, and the node list.</span>
        </li>
        <li>
          <span className="ab-when">Rolling crawl</span>
          <span>
            Peers, reachability, hardware and what each node runs. Every host is revisited at least every 20
            minutes, and results arrive one host at a time.
          </span>
        </li>
      </ul>
      <p className="ab-note">
        Atlas reads the public Flux explorer, API and stats service, and keeps its own index on top. How
        current each feed is right now lives in <Link to="/settings">Settings</Link>.
      </p>

      <h4 className="ab-h4">This page</h4>
      <dl className="ab-kv ab-kv-quiet">
        <div>
          <dt>Connection</dt>
          <dd data-status={conn.status}>
            <span className="ab-dot" aria-hidden="true" />
            {word}
            {conn.status === 'live' && conn.transitMs !== null ? `, ${Math.round(conn.transitMs)} ms` : ''}
          </dd>
        </div>
        <div>
          <dt>Server</dt>
          <dd>
            {server ? `${server.name} ${server.version}, API v${server.api_version}` : 'Not connected yet'}
          </dd>
        </div>
        <div>
          <dt>Atlas</dt>
          <dd>Version {ATLAS_VERSION}, preview</dd>
        </div>
      </dl>

      <h4 className="ab-h4">Credits</h4>
      <p className="ab-note">
        Earth imagery from NASA Visible Earth and Earth Observatory. Coastlines from Natural Earth, in the
        public domain. Type in Montserrat, Open Sans, Lora and IBM Plex Mono, under the SIL Open Font License.
        Icons from Lucide.{' '}
        <a
          href={`${import.meta.env.BASE_URL}licenses/ATTRIBUTION.txt`}
          target="_blank"
          rel="noreferrer noopener"
        >
          Every attribution and licence
        </a>
        .
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Links and the notice
// ---------------------------------------------------------------------------------------------

const LINKS = [
  { label: 'runonflux.io', href: 'https://runonflux.io' },
  { label: 'Documentation', href: 'https://docs.runonflux.io' },
  { label: 'Explorer API', href: 'https://explorer.runonflux.io' },
] as const;

function Footer() {
  return (
    <footer className="ab-foot">
      <ul className="ab-links">
        {LINKS.map((l) => (
          <li key={l.href}>
            <a className="ab-chip" href={l.href} target="_blank" rel="noreferrer noopener">
              {l.label}
              <ArrowUpRight size={13} strokeWidth={2} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
      <p className="ab-fine">
        Flux Atlas {ATLAS_VERSION} preview, data from the Flux network, open to everyone. Flux and the Flux
        symbol are trademarks of their owners. Flux Atlas is an ecosystem tool for the Flux network.
      </p>
    </footer>
  );
}

export default function AboutView() {
  return (
    <div className="set ab" data-testid="about">
      <Hero />
      <ChainNow />
      <Anatomy />
      <Capacity />
      <RewardCut />
      <Mission />
      <div className="set-more">
        <Disclosure id="hood" title="Under the hood" aside="Sources, status and credits">
          <Hood />
        </Disclosure>
      </div>
      <Footer />
    </div>
  );
}

export { AboutView };
