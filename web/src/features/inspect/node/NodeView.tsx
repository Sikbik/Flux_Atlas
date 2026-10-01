import { Coins, Cpu, Fingerprint, GitBranch, HeartPulse, Layers, Network, SearchX } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import { isApiError } from '../../../api/http';
import { useNodeDetail } from '../../../api/queries';
import { useNetwork } from '../../../app/context';
import { EmptyState, ErrorState, Section, Skeleton, Stat, StatGrid } from '../../../ui';
import { ipOfEndpoint } from '../sources/host';
import { useNodeLive, useResolvedId } from '../sources/live';
import { useOpenSet } from '../ui/openset';
import { ActivityBody } from './Activity';
import { NodeContext, type NodeCtx } from './context';
import { NodeAlert, NodeHeader } from './Header';
import { HealthBody } from './Health';
import { IdentityBody } from './Identity';
import { PayLead } from './Lead';
import { NetworkBody } from './Network';
import { PaymentsBody } from './Payments';
import { HardwareBody, VersionsBody } from './Specs';
import {
  ActivitySummary,
  HardwareSummary,
  HealthSummary,
  IdentitySummary,
  NetworkSummary,
  PaymentsSummary,
  VersionsSummary,
} from './Summaries';
import '../ui/parts.css';
import './node.css';

function NodeSkeleton() {
  return (
    <article className="ix ix-node" aria-busy="true" aria-label="Loading the node">
      <div className="ix-skel-head">
        <Skeleton w={84} h={12} />
        <Skeleton w="62%" h={24} />
        <Skeleton w="44%" h={12} />
      </div>
      <div className="ix-pad ix-gap-top">
        <Skeleton h={140} radius={14} />
      </div>
      <Section>
        <StatGrid columns={2} className="ix-paylead">
          <Stat hero label="Next payment" loading />
          <Stat label="Per day" loading />
          <Stat label="30 days" loading />
        </StatGrid>
      </Section>
    </article>
  );
}

/**
 * The node inspector (`/node/:key`): who it is, where, when it is paid next and what it earns up front;
 * payments, health, hardware, network, apps and identity one fold away, every field sourced or marked unknown.
 */
export function NodeView({ nodeKey }: { nodeKey: string }) {
  const q = useNodeDetail(nodeKey);
  const resolved = useResolvedId(nodeKey);
  const loaded = useNetwork((s) => s.loaded);
  const detail = q.data;
  const id = detail?.node.id ?? resolved;
  const live = useNodeLive(id);
  const node = detail?.node;
  const tier = live?.tier ?? node?.tier ?? 'unknown';
  const endpoint = live?.endpoint || node?.endpoint || '';

  const ctx = useMemo<NodeCtx>(
    () => ({
      routeKey: nodeKey,
      id,
      detail,
      node,
      live,
      tier,
      endpoint,
      ip: ipOfEndpoint(endpoint),
      apiKey: id ?? nodeKey,
    }),
    [nodeKey, id, detail, node, live, tier, endpoint],
  );

  if (q.isError && !live) {
    const notFound = isApiError(q.error) && q.error.code === 'not_found';
    return (
      <article className="ix ix-node" aria-label={notFound ? 'Node not found' : 'Node unavailable'}>
        {notFound ? (
          <EmptyState icon={SearchX} title="No node at that address" pattern>
            Nothing in the network matches {nodeKey}. Try the full IP with its port, or the collateral
            outpoint.
          </EmptyState>
        ) : (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
        )}
      </article>
    );
  }
  if (!live && !detail && (q.isPending || !loaded)) return <NodeSkeleton />;

  return (
    <NodeContext.Provider value={ctx}>
      <NodeBody tier={tier} label={endpoint || nodeKey} />
    </NodeContext.Provider>
  );
}

function Fold({
  id,
  open,
  title,
  icon,
  summary,
  children,
}: {
  id: string;
  open: ReturnType<typeof useOpenSet>;
  title: string;
  icon: typeof Coins;
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <Section
      collapsible
      level={3}
      title={title}
      icon={icon}
      aside={summary}
      open={open.isOpen(id)}
      onOpenChange={(v) => open.setOpen(id, v)}
    >
      {children}
    </Section>
  );
}

/** The inspector body: the lead facts first, everything else one fold away. */
function NodeBody({ tier, label }: { tier: string; label: string }) {
  const open = useOpenSet('node');
  return (
    <article className="ix ix-node" data-tier={tier} aria-label={`Node ${label}`}>
      <NodeHeader />
      <NodeAlert onOpenHealth={() => open.setOpen('health', true)} />
      <PayLead />
      <Fold id="payments" open={open} title="Payments" icon={Coins} summary={<PaymentsSummary />}>
        <PaymentsBody />
      </Fold>
      <Fold id="health" open={open} title="Health" icon={HeartPulse} summary={<HealthSummary />}>
        <HealthBody />
      </Fold>
      <Fold id="hardware" open={open} title="Hardware" icon={Cpu} summary={<HardwareSummary />}>
        <HardwareBody />
      </Fold>
      <Fold id="software" open={open} title="Software" icon={GitBranch} summary={<VersionsSummary />}>
        <VersionsBody />
      </Fold>
      <Fold id="network" open={open} title="Network" icon={Network} summary={<NetworkSummary />}>
        <NetworkBody />
      </Fold>
      <Fold id="activity" open={open} title="Apps and activity" icon={Layers} summary={<ActivitySummary />}>
        <ActivityBody />
      </Fold>
      <Fold id="identity" open={open} title="Identity" icon={Fingerprint} summary={<IdentitySummary />}>
        <IdentityBody />
      </Fold>
    </article>
  );
}
