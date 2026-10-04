// Where the apps run: the running instances by the country of the node they run on, as the ranked bars the analytics
// geography draws. The fewest countries that together host more than half are in colour and the rest step back to the
// neutral gray, so the headline is a shape as well as a sentence. Choosing a country shows its nodes on the globe (the
// filter lives in the URL, as it does in analytics). Instances on nodes with no known location keep a row of their own:
// they are real instances in an unknown place, never dropped and never a zero.

import { Earth } from 'lucide-react';
import { useMemo } from 'react';
import type { AppsOverviewDto } from '../../../api/generated/AppsOverviewDto';
import { formatInt } from '../../../lib/format';
import { BarList, type BarListItem } from '../../../ui';
import { useGlobeFilter } from '../../analytics/hooks/useGlobeFilter';
import { REST_COLOR, shareText } from '../../analytics/lib/concentration';
import { HubLink, HubPanel, type HubQuery, type PanelState } from '..';
import { Ghost, WaitAside } from './ghost';
import { countryHeadline, countryModel, countrySummary } from './lib/countries';
import { GHOST_HEADLINE, ghostCountries } from './lib/placeholders';
import { isWaiting, panelError } from './parts';
import './countries.css';

/** The label column of the bars: the analytics one is for a wide panel; this panel is a third of the page. */
const LABEL_COLUMN = 'minmax(96px, 38%)';

/** The rows shown before "Show all": the leaders and a few more. */
const FIRST = 14;

/** The bars of a loading panel: more rows than it shows at first, as the network has countries. */
const GHOST_ITEMS: BarListItem[] = ghostCountries(FIRST + 10).map((c) => ({
  ...c,
  onSelect: () => undefined,
}));
const GHOST_TOTAL = 1_400;

function CountriesBody({
  headline,
  summary,
  items,
  total,
  selected,
}: {
  headline: string;
  summary: string | null;
  items: readonly BarListItem[];
  total: number;
  selected: string | null;
}) {
  return (
    <div className="ap-countries">
      <p className="ap-headline">{headline}</p>
      {summary ? <p className="ui-sr-only">{summary}</p> : null}
      <BarList
        label="Running instances by country"
        items={items}
        total={total}
        selectedId={selected}
        limit={FIRST}
        labelWidth={LABEL_COLUMN}
      />
    </div>
  );
}

export function CountriesPanel({ overview }: { overview: HubQuery<AppsOverviewDto> }) {
  const o = overview.data;
  const filter = useGlobeFilter();
  const selected = filter.cc && !filter.cc.includes(',') ? filter.cc.toUpperCase() : null;
  const model = useMemo(() => (o ? countryModel(o.countries, o.unlocated_instances) : null), [o]);

  const items = useMemo<BarListItem[]>(() => {
    if (!model) return [];
    return model.ranked.map((c) =>
      c.code === null
        ? {
            // The instances with no known location: in the neutral gray, at their rank, and not selectable.
            id: c.id,
            label: 'Unknown',
            title: `${formatInt(c.instances)} running ${c.instances === 1 ? 'instance is' : 'instances are'} on nodes whose address has no known location.`,
            value: c.instances,
            display: formatInt(c.instances),
            detail: shareText(c.share),
            color: REST_COLOR,
          }
        : {
            id: c.id,
            label: c.name,
            title: `${c.name}: ${formatInt(c.instances)} ${c.instances === 1 ? 'instance' : 'instances'}, ${shareText(c.share)}. Choose it to show these nodes on the globe.`,
            value: c.instances,
            display: formatInt(c.instances),
            detail: shareText(c.share),
            color: model.leaders.reached && !c.lead ? REST_COLOR : undefined,
            onSelect: () => filter.toggle('cc', c.id),
          },
    );
  }, [model, filter.toggle]);

  // Loading is the ready state with made-up bars, so the footer is there and the panel does not grow when they arrive.
  const loading = !o && overview.isPending;
  const state: PanelState = o
    ? model && model.total === 0 && model.countries === 0
      ? 'empty'
      : 'ready'
    : loading
      ? 'ready'
      : 'error';

  return (
    <HubPanel
      id="countries"
      span="third"
      fill="row"
      title="Where apps run"
      icon={Earth}
      aside={
        model ? (
          `${formatInt(model.countries)} ${model.countries === 1 ? 'country' : 'countries'}`
        ) : isWaiting(overview) ? (
          <WaitAside what="The countries" />
        ) : undefined
      }
      state={state}
      aria-busy={loading || undefined}
      error={overview.error}
      onRetry={() => void overview.refetch()}
      retrying={overview.isFetching}
      {...panelError(overview.error, 'where the apps run')}
      emptyIcon={Earth}
      emptyTitle="No instance has a stored location"
      emptyText="The server has not placed any running instance on a node yet."
      footer={
        <>
          <HubLink to={{ type: 'analytics', key: 'geography' }}>Open geography</HubLink>
          {loading || (model && model.total > 0) ? (
            <span className="ap-foot-note">Choose a country to show its nodes on the globe.</span>
          ) : null}
        </>
      }
    >
      {loading ? (
        <Ghost>
          <CountriesBody
            headline={GHOST_HEADLINE}
            summary={null}
            items={GHOST_ITEMS}
            total={GHOST_TOTAL}
            selected={null}
          />
        </Ghost>
      ) : model ? (
        <CountriesBody
          headline={countryHeadline(model)}
          summary={countrySummary(model)}
          items={items}
          total={model.total}
          selected={selected}
        />
      ) : null}
    </HubPanel>
  );
}
