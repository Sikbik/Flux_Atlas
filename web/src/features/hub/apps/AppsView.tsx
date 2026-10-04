// /apps: the app network, live. What the Apps dock button opens. The hero is the number of apps with what they lock of
// the network; under it a search for apps in place, the go-to tiles, and panels for the biggest apps, who owns them,
// where they run, what is deployed each day, what apps pay, and which are new or about to expire. Every panel owns
// its own loading, empty and error state, so one endpoint being down never blanks the page.

import { Boxes } from 'lucide-react';
import { useMemo } from 'react';
import { useAppsIndex } from '../../../api/queries';
import { ViewHeader } from '../../../ui';
import { Hub, HubGrid, HubStack, useAppsOverview, useHashAnchor } from '..';
import { ExpiringPanel, NewAppsPanel } from './AppLists';
import { AppsHero } from './AppsHero';
import { AppsSearch } from './AppsSearch';
import { AppsTiles } from './AppsTiles';
import { useAppEconomy } from './api';
import { CountriesPanel } from './CountriesPanel';
import { DeploymentsPanel } from './DeploymentsPanel';
import { EconomyPanel } from './EconomyPanel';
import { indexTotals } from './lib/apps';
import { OwnersPanel } from './OwnersPanel';
import { TopAppsPanel } from './TopAppsPanel';

export function AppsView() {
  const index = useAppsIndex();
  const overview = useAppsOverview();
  const economy = useAppEconomy();
  const apps = index.data?.apps;
  const totals = useMemo(() => (apps ? indexTotals(apps) : null), [apps]);
  // A link to a section (`/apps#owners`) scrolls once the overview, which the sections are made of, is in.
  useHashAnchor(!overview.isPending);

  return (
    <Hub>
      <ViewHeader
        kind="Apps"
        icon={Boxes}
        title="The app network"
        subtitle="What runs on Flux: the apps, who owns them, where they run, and what they ask of the network."
      />
      <HubStack>
        <AppsSearch apps={apps} />
        <AppsHero index={index} overview={overview} totals={totals} />
        <AppsTiles overview={overview} economy={economy} />
        <HubGrid>
          <TopAppsPanel index={index} overview={overview} totals={totals} />
          <OwnersPanel overview={overview} apps={apps} totals={totals} />
          <CountriesPanel overview={overview} />
          <DeploymentsPanel overview={overview} />
          <EconomyPanel economy={economy} />
          <NewAppsPanel overview={overview} />
          <ExpiringPanel overview={overview} />
        </HubGrid>
      </HubStack>
    </Hub>
  );
}
