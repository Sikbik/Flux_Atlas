// The globe's hover cards and the first-visit hint's card (design 7.7, 6.4 P, 8.17, 9.1), a chunk of their own:
// nobody needs one until the pointer has rested on a node, a site or the moon, so the shell chunk carries only
// the gates (globe/overlays.tsx), which start fetching this as soon as the pointer is over something.
//
// Placement: a node's or site's card opens up and to the right of its point and flips (an attribute the CSS
// reads) to the left or below when that would leave the screen or run under the top chrome; the moon's card sits
// beside the moon and is nudged down clear of the chrome. All of it is written from the anchor loop with the
// card's measured size, so nothing renders per frame and a card moves to the other side as the globe turns its
// point toward an edge.

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useNetwork, useRuntime } from '../../../app/context';
import { type Anchor, type GlobeHover, GlobeLabel, type PlaceOptions } from '../../../globe';
import { formatHeight, formatInt } from '../../../lib/format';
import { useBeat } from '../../../lib/useClock';
import { TierGlyph } from '../../../ui';
import { cardFlips, moonCardPlace } from '../cardplace';
import { TIER_LABEL, tierOf } from '../glyphs';
import { towerHeight } from '../placelabels';
import { countryName } from '../places';
import { clearance, useClearance } from './clearance';
import './tips.css';

function useCardPlacement(mode: 'point' | 'moon') {
  const ref = useRef<HTMLDivElement>(null);
  const card = useRef({ w: 240, h: 120 });
  const state = useRef({ x: false, y: false, nudge: 0 });
  useClearance();
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) card.current = { w: el.offsetWidth, h: el.offsetHeight };
  }, []);
  const options = useMemo<PlaceOptions>(
    () => ({
      dx: 0,
      dy: 0,
      fade: false,
      onUpdate: (p) => {
        const el = ref.current;
        if (!el) return;
        const s = state.current;
        let fx: boolean;
        let fy = false;
        let nudge = 0;
        if (mode === 'moon') {
          const m = moonCardPlace(p, card.current, clearance.top, {
            w: window.innerWidth,
            leftClear: clearance.left,
          });
          fx = m.flipX;
          nudge = m.nudge;
        } else {
          const f = cardFlips(p, card.current, window.innerWidth, clearance.top);
          fx = f.x;
          fy = f.y;
        }
        if (fx !== s.x) {
          s.x = fx;
          el.toggleAttribute('data-flip-x', fx);
        }
        if (fy !== s.y) {
          s.y = fy;
          el.toggleAttribute('data-flip-y', fy);
        }
        if (nudge !== s.nudge) {
          s.nudge = nudge;
          el.style.setProperty('--card-nudge', `${nudge}px`);
        }
      },
    }),
    [mode],
  );
  return { ref, options };
}

/** The card for what the pointer rests on: a node, a site or the moon. */
export function Tip({ hover }: { hover: GlobeHover }) {
  if (hover.kind === 'moon') return <MoonCard />;
  return hover.info.isCluster ? (
    <SiteTip loc={hover.info.loc} />
  ) : (
    <NodeTip id={hover.id} nodeKey={hover.key} />
  );
}

/** A single node: its endpoint, tier, where it is, who runs it and its place in the queue. */
function NodeTip({ id, nodeKey }: { id: number; nodeKey: string }) {
  const runtime = useRuntime();
  const t = runtime.store.nodes;
  const i = t.indexOf(id);
  const anchor = useMemo<Anchor>(() => ({ kind: 'node', id }), [id]);
  const { ref, options } = useCardPlacement('point');
  const tier = i >= 0 ? tierOf(t.tier[i]) : 'unknown';
  const info = i >= 0 ? t.locations?.info(t.loc[i] ?? 0) : undefined;
  const country = i >= 0 ? countryName(t.countryCode(i), 'long') : null;
  const place = [info?.city, country].filter(Boolean).join(', ');
  const org = i >= 0 ? t.orgName(i) : '';
  const rank = i >= 0 ? (t.rank[i] ?? 0) : 0;
  const endpoint = i >= 0 ? t.endpoint(i) : '';
  return (
    <GlobeLabel anchor={anchor} className="globe-tipwrap" options={options}>
      <div className="globe-tip" data-kind="node" data-tier={tier} ref={ref}>
        <span className="gt-title mono">{endpoint || nodeKey}</span>
        <span className="gt-row">
          <TierGlyph tier={tier} size={13} />
          <b className="gt-tier">{TIER_LABEL[tier]}</b>
          {place ? <span className="gt-dim">{place}</span> : null}
        </span>
        {org ? <span className="gt-row gt-dim">{org}</span> : null}
        {rank > 0 ? (
          <span className="gt-row gt-dim">
            Queue position <b className="mono">{formatInt(rank)}</b>
          </span>
        ) : null}
      </div>
    </GlobeLabel>
  );
}

/**
 * A site (a co-location hub): where it is, how many nodes, and the tier split. The card is pinned to the top
 * of the site's tower, so it rides the tower as the globe turns.
 */
function SiteTip({ loc }: { loc: number }) {
  const runtime = useRuntime();
  const t = runtime.store.nodes;
  const info = t.locations?.info(loc);
  const { ref, options } = useCardPlacement('point');
  const counts = [0, 0, 0];
  let n = 0;
  let cc = '';
  for (let r = 0; r < t.count; r++) {
    if (t.loc[r] !== loc) continue;
    n++;
    if (!cc) cc = t.countryCode(r);
    const k = (t.tier[r] ?? 0) - 1;
    if (k >= 0 && k < 3) counts[k] = (counts[k] ?? 0) + 1;
  }
  const lat = info?.lat;
  const lon = info?.lon;
  const anchor = useMemo<Anchor | null>(
    () =>
      lat === undefined || lon === undefined || !Number.isFinite(lat)
        ? null
        : { kind: 'world', lat, lon, alt: towerHeight(n) + 0.004 },
    [lat, lon, n],
  );
  const where = [info?.city, countryName(cc, 'long')].filter(Boolean).join(', ');
  return (
    <GlobeLabel anchor={anchor} className="globe-tipwrap" options={options}>
      <div className="globe-tip" data-kind="site" ref={ref}>
        <span className="gt-title">{where || 'A site'}</span>
        <span className="gt-row gt-dim">
          <b className="mono">{formatInt(n)}</b> {n === 1 ? 'node' : 'nodes'} at this site
        </span>
        <span className="gt-row gt-tiers">
          {(['cumulus', 'nimbus', 'stratus'] as const).map((tier, k) => (
            <span key={tier} className="gt-tier-chip" data-tier={tier}>
              <TierGlyph tier={tier} size={12} />
              <b className="mono">{formatInt(counts[k] ?? 0)}</b>
            </span>
          ))}
        </span>
        <span className="gt-hint">Click to zoom in</span>
      </div>
    </GlobeLabel>
  );
}

/** The moon's card: the chain's height, the next block, the network's size; hover, focus or the M key. */
export function MoonCard() {
  const runtime = useRuntime();
  const beat = useBeat(runtime.clock);
  const nodes = useNetwork((s) => s.nodes.count);
  const tip = useNetwork((s) => s.tip);
  const anchor = useMemo<Anchor>(() => ({ kind: 'moon' }), []);
  const { ref, options } = useCardPlacement('moon');
  return (
    <GlobeLabel anchor={anchor} className="globe-tipwrap" options={options}>
      <div className="globe-tip" data-kind="moon" ref={ref}>
        <span className="gt-title">Flux chain</span>
        <span className="gt-row gt-dim tabular">
          {tip ? `Block ${formatHeight(tip.height)}` : 'Waiting for a block'}
        </span>
        <span className="gt-row gt-dim tabular">
          {beat.height === null ? '' : `Next block in ${Math.ceil(beat.remainingMs / 1000)} s`}
        </span>
        <span className="gt-row gt-dim tabular">Network {formatInt(nodes)} nodes</span>
        <span className="gt-hint">
          Click for About Flux <kbd className="kbd">M</kbd>
        </span>
      </div>
    </GlobeLabel>
  );
}

/** The one-time note beside the moon: two quiet lines that fade out when `leaving`. */
export function MoonHintCard({ leaving }: { leaving: boolean }) {
  const anchor = useMemo<Anchor>(() => ({ kind: 'moon' }), []);
  const { ref, options } = useCardPlacement('moon');
  return (
    <GlobeLabel anchor={anchor} className="globe-tipwrap" options={options}>
      <div
        className="globe-tip globe-hint"
        data-kind="moon"
        data-leaving={leaving || undefined}
        role="status"
        ref={ref}
      >
        <span className="gt-title">That is the chain.</span>
        <span className="gt-dim">Click it.</span>
      </div>
    </GlobeLabel>
  );
}
