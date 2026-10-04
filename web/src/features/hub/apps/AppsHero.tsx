// The hero of the Apps hub: the number of apps as the one big figure, what runs (instances, and how much of it is
// enterprise), what apps lock of the network (the rails), and the figures that say who runs them and where. The apps
// and the instances come from the app index, the owners, countries and capacity from the overview; each figure waits
// for its own answer and says Unknown when it has none, so one endpoint being down never blanks the rest.

import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AppsIndexDto } from '../../../api/generated/AppsIndexDto';
import type { AppsOverviewDto } from '../../../api/generated/AppsOverviewDto';
import { formatInt } from '../../../lib/format';
import { AnimatedNumber, Button, Freshness } from '../../../ui';
import { HubFigure, HubFigures, HubHero, type HubQuery } from '..';
import { CapacityRails } from './CapacityRails';
import { Ghost } from './ghost';
import type { IndexTotals } from './lib/apps';
import { appsPerOwner, enterpriseShareNote, heroCaption, instancesNote } from './lib/hero';
import { GHOST_ENTERPRISE_APPS, GHOST_TOTALS } from './lib/placeholders';

/** The server builds the overview once per publish of the node snapshot, about every 90 seconds. */
export const OVERVIEW_CADENCE_MS = 90_000;

const OWNERS_NOTE = 'in the index';
const COUNTRIES_NOTE = 'with instances running';
const PER_OWNER_NOTE = 'on average';

/**
 * Made-up words and numbers of the size the real ones will be (the notes wrap in a narrow hero, and a figure that
 * waits must be as tall as the one that has arrived), drawn as blocks while the answer is on its way.
 */
const GHOST = {
  caption: heroCaption(GHOST_TOTALS, GHOST_ENTERPRISE_APPS),
  instances: formatInt(GHOST_TOTALS.instances),
  instancesNote: instancesNote(GHOST_TOTALS),
  owners: formatInt(1_396),
  enterprise: formatInt(GHOST_ENTERPRISE_APPS),
  enterpriseNote: enterpriseShareNote(GHOST_ENTERPRISE_APPS, GHOST_TOTALS.apps),
  countries: formatInt(54),
  perOwner: appsPerOwner(GHOST_TOTALS.apps, 1_396),
};

const made = (text: string | null): ReactNode => (text === null ? null : <Ghost as="span">{text}</Ghost>);

export interface AppsHeroProps {
  index: HubQuery<AppsIndexDto>;
  overview: HubQuery<AppsOverviewDto>;
  totals: IndexTotals | null;
}

export function AppsHero({ index, overview, totals }: AppsHeroProps) {
  const o = overview.data;
  const waitingIndex = index.isPending;
  const waitingOverview = overview.isPending;
  const owners = o ? o.total_owners : null;
  // The overview counts the enterprise apps too; the index says the same when the overview is not in.
  const enterpriseApps = o ? o.enterprise.apps : (totals?.enterpriseApps ?? null);

  return (
    <HubHero
      aria-label="Apps on the network"
      label="Apps on the network"
      loading={waitingIndex}
      value={<AnimatedNumber value={totals ? totals.apps : null} countUpOnMount />}
      aside={
        o ? <Freshness label="overview" ts={o.generated_ms} cadenceMs={OVERVIEW_CADENCE_MS} /> : undefined
      }
      caption={
        totals
          ? heroCaption(totals, enterpriseApps)
          : index.isError
            ? 'The app list could not be loaded, so the figures that come from it are unknown.'
            : made(GHOST.caption)
      }
      actions={
        index.isError ? (
          <Button size="sm" icon={RefreshCw} loading={index.isFetching} onClick={() => void index.refetch()}>
            Retry
          </Button>
        ) : undefined
      }
      visual={<CapacityRails overview={overview} enterpriseApps={enterpriseApps} />}
    >
      <HubFigures>
        <HubFigure
          label="Instances running"
          value={
            totals ? <AnimatedNumber value={totals.instances} /> : waitingIndex ? made(GHOST.instances) : null
          }
          note={totals ? instancesNote(totals) : waitingIndex ? made(GHOST.instancesNote) : null}
        />
        <HubFigure
          label="Owners"
          value={
            owners !== null ? <AnimatedNumber value={owners} /> : waitingOverview ? made(GHOST.owners) : null
          }
          note={owners !== null ? OWNERS_NOTE : waitingOverview ? made(OWNERS_NOTE) : null}
        />
        <HubFigure
          label="Enterprise apps"
          value={
            enterpriseApps !== null ? (
              <AnimatedNumber value={enterpriseApps} />
            ) : waitingOverview || waitingIndex ? (
              made(GHOST.enterprise)
            ) : null
          }
          note={
            enterpriseApps !== null
              ? enterpriseShareNote(enterpriseApps, totals ? totals.apps : null)
              : waitingOverview || waitingIndex
                ? made(GHOST.enterpriseNote)
                : null
          }
        />
        <HubFigure
          label="Countries"
          value={o ? formatInt(o.countries.length) : waitingOverview ? made(GHOST.countries) : null}
          note={o ? COUNTRIES_NOTE : waitingOverview ? made(COUNTRIES_NOTE) : null}
        />
        <HubFigure
          label="Apps per owner"
          value={
            appsPerOwner(totals ? totals.apps : null, owners) ??
            (waitingOverview || waitingIndex ? made(GHOST.perOwner) : null)
          }
          note={
            owners !== null && totals
              ? PER_OWNER_NOTE
              : waitingOverview || waitingIndex
                ? made(PER_OWNER_NOTE)
                : null
          }
        />
      </HubFigures>
    </HubHero>
  );
}
