// About Flux (design 8.19, window "About Flux", also the page /about): what Atlas is, in a few quiet
// sections that all read live numbers. Hero, the chain right now, the moon as the chain (how a block pays
// out), capacity, the next reward cut and the Flux mission; the sources, status, version and credits wait
// behind one fold. Built from the UI kit (Section, Stat, ShareBar, Meter, KeyValue, AnimatedNumber); the
// hero, the Beat ring, the moon's anatomy and the mission are the view's own. Nothing here blanks when
// the stream drops: values keep their last number.

import { Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useNetworkCapacity, useNetworkVersions } from '../../../api/queries';
import { useConnection, useNetwork, useRuntime, useSummary, useTip } from '../../../app/context';
import { formatInt, formatPercent, heightEta } from '../../../lib/format';
import { useBeat, useNow } from '../../../lib/useClock';
import {
  AnimatedNumber,
  KeyValue,
  LiveDot,
  Meter,
  Section,
  ShareBar,
  Stat,
  StatGrid,
  TierGlyph,
} from '../../../ui';
import { ATLAS_VERSION } from '../version';
import { FluxPieces } from './FluxPieces';
import { LockupL2 } from './Lockup';
import { capacityRows, creditLines, legendRows, roughSpan, TIER_NAME, type TierKey } from './model';
import { useAttributions } from './useAttributions';
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

  return (
    <Section title="The chain, right now" level={3} aside="Updates every block">
      <div className="ab-now">
        <BlockRing progress={beat.progress} label={ringLabel} phase={beat.phase} />
        <div className="ab-tip">
          <span className="ab-eyebrow">Block tip</span>
          <AnimatedNumber className="ab-tip-n" value={height} />
          <p className="ab-tip-line">
            <span className="tabular">{line}</span>
            <span className="ab-tip-sub">One block every {BLOCK_SECONDS} seconds.</span>
          </p>
        </div>
      </div>

      <StatGrid className="ab-tiles" columns={3} min={110}>
        <Stat
          label="Nodes"
          loading={!summary}
          value={summary ? <AnimatedNumber value={summary.node_count} /> : null}
          caption={summary ? `${formatInt(summary.host_count)} IP addresses` : null}
        />
        <Stat
          label="Apps"
          loading={!summary}
          value={summary ? <AnimatedNumber value={summary.app_count} /> : null}
          caption={summary ? `${formatInt(summary.instance_count)} instances` : null}
        />
        <Stat
          label="Countries"
          loading={!summary}
          value={summary ? <AnimatedNumber value={summary.country_count} /> : null}
          caption={summary ? `${formatInt(summary.provider_count)} networks` : null}
        />
      </StatGrid>

      <ShareBar
        className="ab-tiers"
        label="Nodes by tier"
        legend="list"
        loading={!summary}
        segments={TIER_ORDER.map((t) => ({
          id: t,
          label: TIER_NAME[t],
          value: summary?.tiers[t] ?? null,
          tier: t,
        }))}
      />
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
    <Section title="The moon is the chain" level={3} aside="How a block pays out">
      <div className="ab-anat">
        <div className="ab-anat-card">
          <FluxPieces height={112} className="ab-anat-sym" />
        </div>
        <ol className="ab-leg">
          {rows.map((r) => (
            <li key={r.piece} className="ab-leg-row" data-piece={r.piece}>
              <FluxPieces height={26} lit={r.piece} className="ab-leg-sym" />
              <span className="ab-leg-text">
                <span className="ab-leg-name">
                  {r.tier ? <TierGlyph tier={r.tier} size={14} /> : null}
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
    <Section title="Capacity" level={3} aside="Across every node">
      <div className="ab-cap">
        {(rows ?? [null, null, null]).map((r, i) => (
          <Meter
            key={r?.id ?? i}
            label={r?.label ?? 'Capacity'}
            loading={!r}
            value={r ? r.share : null}
            showLabel
            showValue
            format={() => (r ? `${r.locked} of ${r.total} held by apps` : '')}
          />
        ))}
      </div>
      <KeyValue
        className="ab-kv"
        ruled
        items={[
          { label: 'Running ArcaneOS', value: arcane === null ? null : formatPercent(arcane, 0), mono: true },
          {
            label: os ? `FluxOS ${os.label}` : 'FluxOS',
            value: os ? `on ${formatPercent(os.share)}` : null,
            mono: true,
          },
        ]}
      />
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
    <Section
      title="Next reward cut"
      level={3}
      aside={target === null ? undefined : `Block ${formatInt(target)}`}
    >
      <Stat
        className="ab-cut"
        label="Blocks to go"
        loading={eta === null}
        value={eta ? <AnimatedNumber value={Math.max(0, eta.blocks)} /> : null}
        caption={eta ? `About ${roughSpan(Math.max(0, eta.etaMs))} from now` : null}
      />
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

const DOT: Record<string, 'ok' | 'pending' | 'warn' | 'crit' | 'off'> = {
  live: 'ok',
  syncing: 'pending',
  connecting: 'pending',
  reconnecting: 'warn',
  offline: 'crit',
  closed: 'crit',
};

function Hood() {
  const conn = useConnection();
  const server = conn.server;
  const word = STATUS_WORD[conn.status] ?? conn.status;
  const connection: ReactNode = (
    <span className="ab-conn">
      <LiveDot status={DOT[conn.status] ?? 'off'} />
      {word}
      {conn.status === 'live' && conn.transitMs !== null ? `, ${Math.round(conn.transitMs)} ms` : ''}
    </span>
  );
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
      <KeyValue
        ruled
        items={[
          { label: 'Connection', value: connection },
          {
            label: 'Server',
            value: server ? `${server.name} ${server.version}, API v${server.api_version}` : null,
            mono: true,
            unknown: 'Not connected yet',
          },
          { label: 'Atlas', value: `Version ${ATLAS_VERSION}, preview`, mono: true },
        ]}
      />

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

function UnderTheHood() {
  const [open, setOpen] = useState(false);
  const [everOpen, setEverOpen] = useState(false);
  useEffect(() => {
    if (open) setEverOpen(true);
  }, [open]);
  return (
    <Section
      title="Under the hood"
      level={3}
      aside="Sources, status and credits"
      collapsible
      open={open}
      onOpenChange={setOpen}
    >
      {everOpen ? <Hood /> : null}
    </Section>
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

/** A link that leaves Atlas, in the text's own colour until it is pointed at. */
function Out({ href, children }: { href: string | null; children: ReactNode }): ReactNode {
  if (!href) return children;
  return (
    <a className="ab-credit-link" href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

/**
 * The third-party data credits the server asks the UI to show (a licence term: DB-IP's city data is CC BY
 * 4.0). Always on the page, never behind a fold, and quiet: the credit line links to its source, the licence
 * to its terms, and the dataset version and what it is used for sit beside them.
 */
function Credits() {
  const lines = creditLines(useAttributions());
  if (lines.length === 0) return null;
  return (
    <section className="ab-credits" aria-label="Data credits" data-testid="credits">
      <ul>
        {lines.map((c) => (
          <li key={c.key}>
            <span className="ab-credit-main">
              <Out href={c.href}>{c.text}</Out>
              <span className="ab-credit-sep" aria-hidden="true">
                {' · '}
              </span>
              <Out href={c.licenseHref}>{c.license}</Out>
              {c.version ? (
                <>
                  <span className="ab-credit-sep" aria-hidden="true">
                    {' · '}
                  </span>
                  <span className="ab-credit-ver" title="Dataset version">
                    {c.version}
                  </span>
                </>
              ) : null}
            </span>
            <span className="ab-credit-scope">{c.scope}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Footer() {
  return (
    <footer className="ab-foot">
      <ul className="ab-links">
        {LINKS.map((l) => (
          <li key={l.href}>
            <a className="ab-chip" href={l.href} target="_blank" rel="noreferrer noopener">
              {l.label}
              <ArrowUpRight size={13} strokeWidth={1.5} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
      <Credits />
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
      <UnderTheHood />
      <Footer />
    </div>
  );
}

export { AboutView };
