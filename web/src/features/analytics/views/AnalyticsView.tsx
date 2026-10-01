// /analytics/$tab: nine questions about the network, one answer each. Every tab opens on its headline
// (the number that answers the question), then one instrument, then detail one step away. Charts are
// linked to the globe behind the window: choosing a bar or a band sets a filter in the URL.

import { useNavigate } from '@tanstack/react-router';
import { ANALYTICS_TABS, type AnalyticsTab } from '../../../app/search';
import { TabPanel, Tabs } from '../../explorer/parts';
import { useAggregateRefresh } from '../hooks/useAggregates';
import { ArchaeologyTab } from '../tabs/Archaeology';
import { CapacityTab } from '../tabs/Capacity';
import { ChurnTab } from '../tabs/Churn';
import { EconomicsTab } from '../tabs/Economics';
import { FairnessTab } from '../tabs/Fairness';
import { GeographyTab } from '../tabs/Geography';
import { HostingTab } from '../tabs/Hosting';
import { OverviewTab } from '../tabs/Overview';
import { VersionsTab } from '../tabs/Versions';
import './analytics.css';

const LABELS: Record<AnalyticsTab, string> = {
  overview: 'Overview',
  geography: 'Geography',
  hosting: 'Hosting',
  capacity: 'Capacity',
  versions: 'Versions',
  churn: 'Churn',
  archaeology: 'Archaeology',
  economics: 'Economics',
  fairness: 'Fairness',
};

const ITEMS = ANALYTICS_TABS.map((id) => ({ id, label: LABELS[id] }));
const BASE = 'analytics';

function Body({ tab }: { tab: AnalyticsTab }) {
  switch (tab) {
    case 'overview':
      return <OverviewTab />;
    case 'geography':
      return <GeographyTab />;
    case 'hosting':
      return <HostingTab />;
    case 'capacity':
      return <CapacityTab />;
    case 'versions':
      return <VersionsTab />;
    case 'churn':
      return <ChurnTab />;
    case 'archaeology':
      return <ArchaeologyTab />;
    case 'economics':
      return <EconomicsTab />;
    case 'fairness':
      return <FairnessTab />;
  }
}

export function AnalyticsView({ tab }: { tab: AnalyticsTab }) {
  useAggregateRefresh();
  const navigate = useNavigate();
  return (
    <div className="ex-root an-root" data-tab={tab}>
      <Tabs
        className="an-tabs"
        items={ITEMS}
        value={tab}
        label="Analytics sections"
        id={BASE}
        onChange={(next) =>
          void navigate({
            to: '/analytics/$tab',
            params: { tab: next },
            search: (prev: Record<string, unknown>) => prev,
          } as never)
        }
      />
      <TabPanel tabsId={BASE} id={tab}>
        <Body tab={tab} />
      </TabPanel>
    </div>
  );
}
