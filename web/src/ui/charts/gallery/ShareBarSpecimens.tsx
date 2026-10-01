import { useMemo, useState } from 'react';
import { useNetworkGeo } from '../../../api/queries';
import { useSummary } from '../../../app/context';
import { formatCompact } from '../../../lib/format';
import { Button } from '../../controls/Button';
import { SpecGrid, Specimen } from '../../gallery/primitives';
import { ShareBar, type ShareSegment } from '../ShareBar';
import './chartsGallery.css';

/** Node tiers, continents and reachability as stacked shares: real data, every legend form and state. */
export function ShareBarSpecimens() {
  const summary = useSummary();
  const geo = useNetworkGeo();
  const [shuffle, setShuffle] = useState(0);

  const tiers = useMemo<ShareSegment[]>(() => {
    const t = summary?.tiers;
    if (!t) return [];
    return [
      { id: 'cumulus', label: 'Cumulus', value: t.cumulus, tier: 'cumulus' },
      { id: 'nimbus', label: 'Nimbus', value: t.nimbus, tier: 'nimbus' },
      { id: 'stratus', label: 'Stratus', value: t.stratus, tier: 'stratus' },
    ];
  }, [summary?.tiers]);

  const continents = useMemo<ShareSegment[]>(
    () =>
      (geo.data?.continents ?? []).slice(0, 6).map((c) => ({ id: c.key, label: c.label, value: c.count })),
    [geo.data],
  );

  const reach = useMemo<ShareSegment[]>(() => {
    if (!summary) return [];
    const unreachable = summary.unreachable_count;
    return [
      { id: 'up', label: 'Reachable', value: Math.max(0, summary.node_count - unreachable) },
      { id: 'unreachable', label: 'Unknown', value: unreachable, unknown: true },
    ];
  }, [summary]);

  const tiny = useMemo<ShareSegment[]>(
    () => [
      { id: 'a', label: 'Large', value: 9400 },
      { id: 'b', label: 'Medium', value: 520 },
      { id: 'c', label: 'Small', value: 60 },
      { id: 'd', label: 'Tiny', value: 7 },
      { id: 'e', label: 'Trace', value: 1 },
    ],
    [],
  );

  // A synthetic live change: the same segments with new weights, so the glide between them shows.
  const moving = useMemo<ShareSegment[]>(() => {
    const w = [
      [50, 30, 20],
      [30, 45, 25],
      [20, 25, 55],
    ][shuffle % 3] as number[];
    return [
      { id: 'cumulus', label: 'Cumulus', value: w[0] ?? 0, tier: 'cumulus' },
      { id: 'nimbus', label: 'Nimbus', value: w[1] ?? 0, tier: 'nimbus' },
      { id: 'stratus', label: 'Stratus', value: w[2] ?? 0, tier: 'stratus' },
    ];
  }, [shuffle]);

  return (
    <>
      <h3 className="kgc-group">
        ShareBar <small>a stacked bar of parts of a whole, cut apart by surface gaps, with a key</small>
      </h3>
      <SpecGrid min={360}>
        <Specimen
          title="Node tiers"
          caption="Real tier counts. Tier ink colors and the tier glyph in the key, so tier is never color alone; hover a segment or a key entry."
          surface="raised"
          layout="stack"
        >
          <ShareBar segments={tiers} label="Node tiers" size="lg" legend="list" loading={!summary} />
        </Specimen>
        <Specimen
          title="Continents"
          caption="Real continents in the fixed categorical order, the inline key with amount and share."
          surface="raised"
          layout="stack"
        >
          <ShareBar
            segments={continents}
            label="Nodes by continent"
            format={formatCompact}
            loading={geo.isPending}
          />
        </Specimen>
        <Specimen
          title="Reachability"
          caption="The unknown share is a hatched gray segment named Unknown, from the real unreachable count."
          surface="raised"
          layout="stack"
        >
          <ShareBar segments={reach} label="Node reachability" loading={!summary} legend="list" />
        </Specimen>
        <Specimen
          title="Tiny segments"
          caption="A part under 1 percent keeps a 3 px sliver so it can be hovered; its share is still exact in the key."
          surface="raised"
          layout="stack"
        >
          <ShareBar segments={tiny} label="Size classes" legend="list" show="percent" />
        </Specimen>
        <Specimen
          title="Glide"
          caption="Synthetic. The same segments with new weights glide to their new widths; reduced motion jumps."
          surface="raised"
          layout="stack"
        >
          <ShareBar segments={moving} label="Synthetic tiers" size="lg" legend="inline" show="percent" />
          <div className="kgc-controls">
            <Button size="sm" onClick={() => setShuffle((n) => n + 1)}>
              Change weights
            </Button>
          </div>
        </Specimen>
        <Specimen
          title="Narrow, no key"
          caption="A 220 px bar with the key hidden: the hover text and the accessible name carry the figures."
          surface="raised"
          layout="stack"
          width={220}
        >
          <ShareBar segments={tiers} label="Node tiers" legend="none" loading={!summary} />
        </Specimen>
        <Specimen
          title="Loading"
          caption="Skeleton bar and key rows at the real geometry."
          surface="raised"
          layout="stack"
        >
          <ShareBar segments={[]} loading legend="list" />
        </Specimen>
        <Specimen
          title="Empty"
          caption="No data: a dashed empty track and the words, never a full bar."
          surface="raised"
          layout="stack"
        >
          <ShareBar segments={[{ id: 'a', label: 'Nodes', value: null }]} label="Nodes" />
        </Specimen>
      </SpecGrid>
    </>
  );
}
