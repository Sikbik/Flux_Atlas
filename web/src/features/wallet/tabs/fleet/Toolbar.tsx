// The controls above the fleet table: search, the filters, how to group, which columns to show and how dense. Nothing
// here changes the wallet; it changes what the table shows, and the chosen columns, density and grouping are
// remembered by this browser.

import { Columns3, ListFilter, Rows2, Rows3 } from 'lucide-react';
import { formatInt } from '../../../../lib/format';
import {
  Button,
  Chip,
  Popover,
  SearchField,
  SegmentedControl,
  Select,
  type SelectOption,
  Switch,
} from '../../../../ui';
import {
  BUCKET_LABEL,
  BUCKETS,
  type Bucket,
  COLUMN_SPECS,
  type ColumnId,
  DEFAULT_COLUMNS,
  type Facet,
  type Facets,
  type FleetFilter,
  filterCount,
  GROUP_OPTIONS,
  type GroupBy,
  type RowSummary,
} from '../../lib/fleet';
import type { Density } from '../../prefs';
import { PAY_TIERS, type PayTier } from '../../types';

const TIER_WORD: Record<PayTier, string> = { cumulus: 'Cumulus', nimbus: 'Nimbus', stratus: 'Stratus' };
const ANY = '*';

const GROUP_LABEL: Record<GroupBy, string> = {
  none: 'No grouping',
  tier: 'Group by tier',
  state: 'Group by state',
  country: 'Group by country',
  city: 'Group by city',
  provider: 'Group by provider',
  version: 'Group by FluxOS version',
};

const GROUP_CHOICES: readonly SelectOption<GroupBy>[] = GROUP_OPTIONS.map((o) => ({
  value: o.value,
  label: GROUP_LABEL[o.value],
}));

const DENSITIES = [
  { value: 'comfortable', label: 'Comfortable rows', icon: Rows2 },
  { value: 'compact', label: 'Compact rows', icon: Rows3 },
] as const;

const COLUMN_GROUPS = ['Identity', 'Payments', 'Place', 'Software and hardware'] as const;

function facetOptions(all: string, list: readonly Facet[]): SelectOption[] {
  return [
    { value: ANY, label: all },
    ...list.map((f) => ({
      value: f.value,
      label: f.label,
      description: `${formatInt(f.count)} ${f.count === 1 ? 'node' : 'nodes'}`,
    })),
  ];
}

interface FiltersProps {
  filter: FleetFilter;
  onFilter: (patch: Partial<FleetFilter>) => void;
  facets: Facets;
  /** The whole fleet's counts, so each choice says how many nodes it would keep. */
  all: RowSummary;
  onClear: () => void;
}

function Filters({ filter, onFilter, facets, all, onClear }: FiltersProps) {
  const toggle = <T extends string>(list: readonly T[], v: T): T[] =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const tierCount = (t: PayTier) => all.tiers[t];
  const bucketCount = (b: Bucket) =>
    b === 'healthy' ? all.healthy : b === 'attention' ? all.attention : all.down;

  return (
    <div className="wl-filters">
      <fieldset className="wl-filters__group">
        <legend className="wl-filters__label">Tier</legend>
        <div className="wl-filters__chips">
          {PAY_TIERS.filter((t) => tierCount(t) > 0 || filter.tiers.includes(t)).map((t) => (
            <Chip
              key={t}
              size="md"
              selected={filter.tiers.includes(t)}
              onClick={() => onFilter({ tiers: toggle(filter.tiers, t) })}
            >
              {TIER_WORD[t]}
              <span className="wl-filters__n">{formatInt(tierCount(t))}</span>
            </Chip>
          ))}
        </div>
      </fieldset>
      <fieldset className="wl-filters__group">
        <legend className="wl-filters__label">State</legend>
        <div className="wl-filters__chips">
          {BUCKETS.filter((b) => bucketCount(b) > 0 || filter.buckets.includes(b)).map((b) => (
            <Chip
              key={b}
              size="md"
              selected={filter.buckets.includes(b)}
              onClick={() => onFilter({ buckets: toggle(filter.buckets, b) })}
            >
              {BUCKET_LABEL[b]}
              <span className="wl-filters__n">{formatInt(bucketCount(b))}</span>
            </Chip>
          ))}
        </div>
      </fieldset>
      <Select
        size="sm"
        label="Country"
        options={facetOptions('Any country', facets.country)}
        value={filter.country ?? ANY}
        onChange={(v) => onFilter({ country: v === ANY ? null : v })}
        emptyText="No countries"
      />
      <Select
        size="sm"
        label="Provider"
        options={facetOptions('Any provider', facets.provider)}
        value={filter.provider ?? ANY}
        onChange={(v) => onFilter({ provider: v === ANY ? null : v })}
        emptyText="No providers"
      />
      <Select
        size="sm"
        label="FluxOS version"
        mono
        options={facetOptions('Any version', facets.version)}
        value={filter.version ?? ANY}
        onChange={(v) => onFilter({ version: v === ANY ? null : v })}
        emptyText="No versions"
      />
      <div className="wl-filters__foot">
        <Button size="sm" variant="ghost" onClick={onClear} disabled={filterCount(filter) === 0}>
          Clear all
        </Button>
      </div>
    </div>
  );
}

interface ColumnsProps {
  columns: readonly ColumnId[];
  onColumns: (ids: readonly ColumnId[]) => void;
}

function Columns({ columns, onColumns }: ColumnsProps) {
  const on = new Set(columns);
  const set = (id: ColumnId, shown: boolean) => {
    const next = new Set(on);
    if (shown) next.add(id);
    else next.delete(id);
    onColumns([...next]);
  };
  return (
    <div className="wl-columns">
      {COLUMN_GROUPS.map((g) => (
        <fieldset key={g} className="wl-columns__group">
          <legend>{g}</legend>
          {COLUMN_SPECS.filter((c) => c.group === g).map((c) => (
            <Switch
              key={c.id}
              layout="row"
              label={c.label}
              checked={on.has(c.id)}
              disabled={c.id === 'node'}
              onChange={(v) => set(c.id, v)}
            />
          ))}
        </fieldset>
      ))}
      <div className="wl-filters__foot">
        <Button size="sm" variant="ghost" onClick={() => onColumns(DEFAULT_COLUMNS)}>
          Reset the columns
        </Button>
      </div>
    </div>
  );
}

export interface ToolbarProps extends FiltersProps {
  columns: readonly ColumnId[];
  onColumns: (ids: readonly ColumnId[]) => void;
  groupBy: GroupBy;
  onGroupBy: (g: GroupBy) => void;
  density: Density;
  onDensity: (d: Density) => void;
}

export function Toolbar(p: ToolbarProps) {
  const n = filterCount({ ...p.filter, text: '' });
  return (
    <div className="wl-toolbar">
      <SearchField
        className="wl-toolbar__search"
        size="sm"
        aria-label="Search the fleet"
        placeholder="Search by address, place, provider or version"
        value={p.filter.text}
        onValueChange={(text) => p.onFilter({ text })}
      />
      <div className="wl-toolbar__tools">
        <Popover
          aria-label="Filter the fleet"
          width={340}
          trigger={
            <Button size="sm" icon={ListFilter} data-active={n > 0 || undefined}>
              Filters
              {n > 0 ? <span className="wl-toolbar__count">{n}</span> : null}
            </Button>
          }
          content={
            <Filters
              filter={p.filter}
              onFilter={p.onFilter}
              facets={p.facets}
              all={p.all}
              onClear={p.onClear}
            />
          }
        />
        <Select
          size="sm"
          aria-label="Group the nodes"
          options={GROUP_CHOICES}
          value={p.groupBy}
          onChange={p.onGroupBy}
        />
        <Popover
          aria-label="Choose the columns"
          width={300}
          trigger={
            <Button size="sm" icon={Columns3}>
              Columns
            </Button>
          }
          content={<Columns columns={p.columns} onColumns={p.onColumns} />}
        />
        <SegmentedControl
          size="sm"
          iconOnly
          aria-label="Row density"
          options={DENSITIES}
          value={p.density}
          onChange={p.onDensity}
        />
      </div>
    </div>
  );
}
