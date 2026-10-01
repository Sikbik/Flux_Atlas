// /analytics/$tab: ten questions about the network, one answer each. Every tab opens on its headline
// (the number that answers the question), then one instrument, then detail one step away. Charts are
// linked to the globe behind the window: choosing a bar or a band sets a filter in the URL.

import { useNavigate } from '@tanstack/react-router';
import { ANALYTICS_TABS, type AnalyticsTab } from '../../../app/search';
import { TabPanel, Tabs } from '../../../ui';
import '../../explorer/views/view.css';
import { useAggregateRefresh } from '../hooks/useAggregates';
import { ArchaeologyTab } from '../tabs/Archaeology';
import { CapacityTab } from '../tabs/Capacity';
import { ChainTab } from '../tabs/Chain';
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
  chain: 'Chain',
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
    case 'chain':
      return <ChainTab />;
  }
}

export function AnalyticsView({ tab }: { tab: AnalyticsTab }) {
  useAggregateRefresh();
  const navigate = useNavigate();
  return (
    <div data-tab={tab}>
      <div className="ex-tabs">
        <Tabs
          items={ITEMS}
          value={tab}
          aria-label="Analytics sections"
          id={BASE}
          onChange={(next) =>
            void navigate({
              to: '/analytics/$tab',
              params: { tab: next },
              search: (prev: Record<string, unknown>) => prev,
            } as never)
          }
        />
      </div>
      <TabPanel tabsId={BASE} id={tab} value={tab}>
        <Body tab={tab} />
      </TabPanel>
    </div>
  );
}
