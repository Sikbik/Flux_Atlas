// Archaeology: which generation of the app specification the registry is written in. Apps carry the
// version of the spec they were last published with, and the newest generation lets an owner keep the
// compose file private (an enterprise app). The headline is how many of the newest generation do; the
// instrument is the apps by spec version, newest first.

import { Boxes } from 'lucide-react';
import { useMemo } from 'react';
import { useNetwork } from '../../../app/context';
import { formatInt } from '../../../lib/format';
import {
  BarList,
  type BarListItem,
  Section,
  Skeleton,
  Stat,
  StatGrid,
  StatusChip,
  ViewHeader,
} from '../../../ui';
import { BAR_LABEL_COLUMN } from '../lib/concentration';

export function ArchaeologyTab() {
  const apps = useNetwork((s) => s.appList());

  const model = useMemo(() => {
    const by = new Map<number, { apps: number; enterprise: number; instances: number }>();
    for (const a of apps) {
      const e = by.get(a.spec_version) ?? { apps: 0, enterprise: 0, instances: 0 };
      e.apps++;
      if (a.enterprise) e.enterprise++;
      e.instances += a.instances_target;
      by.set(a.spec_version, e);
    }
    const versions = [...by.entries()].sort((a, b) => b[0] - a[0]);
    const items: BarListItem[] = versions.map(([v, e]) => ({
      id: String(v),
      label: `Version ${v}`,
      title: `Specification version ${v}: ${formatInt(e.apps)} apps${e.enterprise > 0 ? `, ${formatInt(e.enterprise)} with a private compose file` : ''}, ${formatInt(e.instances)} instances wanted`,
      value: e.apps,
      display: formatInt(e.apps),
      detail: e.enterprise > 0 ? `${formatInt(e.enterprise)} encrypted` : undefined,
    }));
    const latest = versions[0];
    return { items, total: apps.length, latest: latest ? { version: latest[0], ...latest[1] } : null };
  }, [apps]);

  if (apps.length === 0) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading the app registry">
        <ViewHeader level={2} kind="Archaeology" icon={Boxes} title="App specifications" />
        <div className="ex-hero">
          <StatGrid min={220}>
            <Stat hero label="Newest-generation apps that keep their compose file private" loading />
          </StatGrid>
        </div>
        <Section title="Apps by specification version">
          <Skeleton h={220} radius={12} />
        </Section>
      </div>
    );
  }
  const { latest } = model;
  const shareEnterprise = latest && latest.apps > 0 ? latest.enterprise / latest.apps : 0;

  return (
    <>
      <ViewHeader
        level={2}
        kind="Archaeology"
        icon={Boxes}
        title="App specifications"
        subtitle={`${formatInt(model.total)} apps across ${formatInt(model.items.length)} specification versions, each app at the version it was last published with.`}
        freshness={<StatusChip status="live" label="Live registry" />}
      />

      <div className="ex-hero">
        <StatGrid min={220}>
          <Stat
            hero
            label={latest ? `Version ${latest.version} apps that are encrypted` : 'Apps'}
            value={latest ? (shareEnterprise * 100).toFixed(0) : null}
            unit="%"
            caption={
              latest
                ? `${formatInt(latest.enterprise)} of ${formatInt(latest.apps)} keep their compose file private; the network shows only their instances, expiry and owner`
                : undefined
            }
          />
        </StatGrid>
      </div>

      <Section title="Apps by specification version">
        <BarList
          label="Apps by specification version"
          items={model.items}
          limit={8}
          labelWidth={BAR_LABEL_COLUMN}
        />
        <p className="ex-caption">
          An app's own history of registrations, renewals and updates is on its History tab.
        </p>
      </Section>
    </>
  );
}
