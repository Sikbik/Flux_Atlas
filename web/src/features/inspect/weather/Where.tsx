import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useGlobeEngine } from '../../../globe';
import { formatInt, formatPercent } from '../../../lib/format';
import { BarList, type BarListItem, Section, SegmentedControl } from '../../../ui';
import { type Breakdown, formatLift, type Hotspot, placeName } from '../derive/weather';
import type { WeatherData } from '../sources/weather';

type Lens = 'places' | 'providers' | 'countries';

const LENSES = [
  { value: 'places', label: 'Places' },
  { value: 'providers', label: 'Providers' },
  { value: 'countries', label: 'Countries' },
] as const;

/** How many rows show before "Show all". */
const ROWS = 5;

const rate = (r: number) => formatPercent(r, r < 0.1 ? 1 : 0);

const HINT: Record<Lens, string> = {
  places: 'Select a place to fly there; the glows on the globe mark them.',
  providers: 'Select a provider to show only its nodes on the globe.',
  countries: 'Select a country to show only its nodes on the globe.',
};

function groupItems(rows: readonly Breakdown[]): BarListItem[] {
  return rows.map((b) => ({
    id: b.key,
    label: b.label,
    value: b.bad,
    display: formatInt(b.bad),
    detail: `${rate(b.rate)} of ${formatInt(b.total)}`,
    title: `${b.label}: ${formatInt(b.bad)} of ${formatInt(b.total)} nodes affected`,
  }));
}

function placeItems(spots: readonly Hotspot[], fly: (h: Hotspot) => void): BarListItem[] {
  return spots.map((h) => ({
    id: h.key,
    label: placeName(h),
    value: h.bad,
    display: formatInt(h.bad),
    detail: `of ${formatInt(h.total)}`,
    color: h.level === 'storm' ? 'var(--status-crit)' : 'var(--status-warn)',
    title: `${placeName(h)}: ${formatInt(h.bad)} of ${formatInt(h.total)} nodes affected, ${formatLift(h.lift)} the network's rate`,
    onSelect: () => fly(h),
  }));
}

/**
 * Where the trouble is, one list at a time: places on the globe that stand out, the providers carrying the
 * most affected nodes, or the countries. A place flies the camera there; a provider or country shows only
 * its nodes on the globe (a URL filter, so it can be shared and cleared).
 */
export function WeatherWhere({ w }: { w: WeatherData }) {
  const engine = useGlobeEngine();
  const navigate = useNavigate();
  const search = useRouterState({ select: (s) => s.location.search as { org?: string; cc?: string } });
  const [picked, setPicked] = useState<Lens | null>(null);
  const lens: Lens = picked ?? (w.hotspots.length > 0 ? 'places' : 'providers');

  const filter = (key: 'org' | 'cc') => (b: BarListItem) => {
    const on = (key === 'org' ? search.org : search.cc) === b.id;
    void navigate({
      to: '.',
      replace: true,
      search: ((prev: Record<string, unknown>) => ({ ...prev, [key]: on ? undefined : b.id })) as never,
    });
  };

  const items = useMemo<BarListItem[]>(() => {
    if (lens === 'places') {
      return placeItems(w.hotspots, (h) => void engine?.flyTo(h.lat, h.lon, 0.8, { tilt: 0.3 }));
    }
    return groupItems(lens === 'providers' ? w.providers : w.countries);
  }, [lens, w.hotspots, w.providers, w.countries, engine]);

  const active = lens === 'providers' ? search.org : lens === 'countries' ? search.cc : undefined;
  const onSelect = lens === 'providers' ? filter('org') : lens === 'countries' ? filter('cc') : undefined;

  return (
    <Section
      title="Affected nodes"
      aside={w.partial ? undefined : `${formatInt(w.counts.affected)} of ${formatInt(w.counts.total)}`}
    >
      <div className="ix-where">
        <SegmentedControl
          size="sm"
          fullWidth
          aria-label="Group by"
          options={LENSES}
          value={lens}
          onChange={setPicked}
        />
        <BarList
          label={`Affected nodes by ${lens === 'places' ? 'place' : lens === 'providers' ? 'provider' : 'country'}`}
          items={items}
          loading={w.scanning}
          limit={ROWS}
          labelWidth="minmax(128px, 50%)"
          selectedId={active ?? null}
          {...(onSelect ? { onSelect } : null)}
          emptyText={
            lens === 'places'
              ? 'No place stands out: the trouble, if any, is spread thin.'
              : 'No node is affected.'
          }
        />
        {w.scanning ? null : <p className="ix-cap ix-where-hint">{HINT[lens]}</p>}
      </div>
    </Section>
  );
}
