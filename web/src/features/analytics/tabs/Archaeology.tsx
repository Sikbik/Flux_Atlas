// Archaeology: which generation of the app specification the registry is written in. Apps carry the
// version of the spec they were last published with, and the newest generation lets an owner keep the
// compose file private (an enterprise app). The headline is how many of the newest generation do; the
// instrument is the apps by spec version, newest first.

import { Boxes } from 'lucide-react';
import { useMemo } from 'react';
import { useNetwork } from '../../../app/context';
import { formatInt } from '../../../lib/format';
import { Chip, EntityHead, HeroNumber, LiveBadge, Section, Skeleton } from '../../explorer/parts';
import { RankedBars, type RankedItem } from '../viz/RankedBars';

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
    const total = apps.length;
    const items: RankedItem[] = versions.map(([v, e]) => ({
      key: String(v),
      label: `Version ${v}`,
      sub: e.enterprise > 0 ? `${formatInt(e.enterprise)} encrypted` : undefined,
      count: e.apps,
      share: total > 0 ? e.apps / total : 0,
      title: `Specification version ${v}: ${formatInt(e.apps)} apps${e.enterprise > 0 ? `, ${formatInt(e.enterprise)} with a private compose file` : ''}, ${formatInt(e.instances)} instances wanted`,
    }));
    const latest = versions[0];
    return { items, total, latest: latest ? { version: latest[0], ...latest[1] } : null };
  }, [apps]);

  if (apps.length === 0) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading the app registry">
        <EntityHead kind="Archaeology" icon={Boxes} title={<Skeleton w={260} h={46} radius={8} />} loading />
        <Section>
          <Skeleton h={260} radius={14} />
        </Section>
      </div>
    );
  }
  const { latest } = model;
  const shareEnterprise = latest && latest.apps > 0 ? latest.enterprise / latest.apps : 0;

  return (
    <>
      <EntityHead
        kind="Archaeology"
        icon={Boxes}
        status="ok"
        aside={<LiveBadge label="Live registry" />}
        title={
          latest ? (
            <HeroNumber
              whole={(shareEnterprise * 100).toFixed(0)}
              frac="%"
              unit={`of version ${latest.version} apps are encrypted`}
            />
          ) : (
            <HeroNumber whole="No apps" />
          )
        }
        sub={
          latest ? (
            <span>
              {formatInt(latest.enterprise)} of {formatInt(latest.apps)} keep their compose file private; the
              network shows only their instances, expiry and owner.
            </span>
          ) : undefined
        }
      >
        <Chip mono>{formatInt(model.total)} apps</Chip>
        <Chip>{formatInt(model.items.length)} spec versions</Chip>
      </EntityHead>

      <Section title="Apps by specification version" aside="newest first">
        <RankedBars items={model.items} label="Apps by specification version" initial={8} />
        <p className="an-note">
          The version is the one each app was last published with. An app's own history of registrations,
          renewals and updates is on its History tab.
        </p>
      </Section>
    </>
  );
}
