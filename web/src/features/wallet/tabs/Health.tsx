// Health and risk: whether the fleet is fine, what is wrong and what to do about it, how its hardware stands against the
// network, how concentrated it is and how reliably its nodes stayed up. The server decides what is wrong; every kind of
// finding is explained in plain words with the nodes it touches, and each section has a text twin.

import { Users } from 'lucide-react';
import { useMemo } from 'react';
import { EmptyState, EntityLink } from '../../../ui';
import { useWalletCtx } from '../context';
import { groupIssues, summarizeIssues } from '../lib/health';
import { Panel } from '../ui/Panel';
import { Benchmarks } from './health/Benchmarks';
import { Concentration } from './health/Concentration';
import { Issues } from './health/Issues';
import { Uptime } from './health/Uptime';
import { Verdict } from './health/Verdict';
import './health.css';

export function HealthTab() {
  const { dto } = useWalletCtx();
  const attention = dto.health.attention;
  const groups = useMemo(() => groupIssues(attention), [attention]);
  const summary = useMemo(() => summarizeIssues(groups, attention), [groups, attention]);

  if (dto.nodes.length === 0) {
    return (
      <div className="wl-page wl-health">
        <Panel title="Health and risk" icon={Users}>
          <EmptyState compact title="No node to assess">
            Health is about the nodes paid to an address, and none is paid to this one.{' '}
            <EntityLink kind="address" value={dto.address}>
              Open the address in the explorer
            </EntityLink>
            .
          </EmptyState>
        </Panel>
      </div>
    );
  }

  return (
    <div className="wl-page wl-health">
      <Verdict healthy={dto.health.healthy} summary={summary} />
      <Issues groups={groups} />
      <Concentration />
      <Benchmarks />
      <Uptime />
    </div>
  );
}
