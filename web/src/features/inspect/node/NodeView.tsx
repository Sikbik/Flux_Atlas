import { Cpu, Fingerprint, HeartPulse, History, Layers, Network, SearchX, WifiOff } from 'lucide-react';
import { useMemo } from 'react';
import { isApiError } from '../../../api/http';
import { useNodeDetail } from '../../../api/queries';
import { useNetwork } from '../../../app/context';
import { ipOfEndpoint } from '../sources/host';
import { useNodeLive, useResolvedId } from '../sources/live';
import { Btn, Disclosure, Disclosures, Sk, State, useOpenSet } from '../ui';
import { NodeContext, type NodeCtx } from './context';
import { HealthBody, HostBlock } from './Health';
import { Hero } from './Hero';
import { IdentityBody } from './Identity';
import { ActivityBody, PeersBlock } from './Network';
import { PaymentBlock, PaymentHistoryBody } from './Payment';
import { HardwareBlock, ReachBlock, VersionsBlock } from './Specs';
import { StatusAlert } from './StatusAlert';
import {
  ActivitySummary,
  HardwareSummary,
  HealthSummary,
  IdentitySummary,
  NetworkSummary,
  PaymentsSummary,
} from './Summaries';
import './node.css';

function NodeSkeleton() {
  return (
    <article className="ix ix-node" aria-busy="true" aria-label="Loading the node">
      <header className="ix-hero">
        <div className="ix-hero-card">
          <Sk h={176} r={0} />
        </div>
        <div className="ix-actions ix-hero-actions">
          <Sk h={30} w={84} r={10} />
          <Sk h={30} w={84} r={10} />
          <Sk h={30} w={96} r={10} />
        </div>
      </header>
      <section className="ix-sec" data-bare="">
        <Sk h={20} w={110} />
        <div className="ix-gap">
          <Sk h={146} r={8} />
        </div>
        <div className="ix-gap ix-grid" data-cols="3">
          <Sk h={90} r={14} />
          <Sk h={90} r={14} />
          <Sk h={90} r={14} />
        </div>
      </section>
    </article>
  );
}

/**
 * The node inspector (`/node/:key`): identity and place, the payment queue, host, health, hardware,
 * versions, reachability, mesh, related things and identity, every field sourced or marked unknown.
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
      <article className="ix ix-node" aria-label="Node not found">
        <State
          icon={notFound ? <SearchX size={20} strokeWidth={1.5} /> : <WifiOff size={20} strokeWidth={1.5} />}
          tone={notFound ? undefined : 'crit'}
          title={notFound ? 'No node at that address' : 'Could not load the node'}
          action={
            notFound ? undefined : (
              <Btn onClick={() => void q.refetch()} variant="primary">
                Try again
              </Btn>
            )
          }
        >
          {notFound
            ? `Nothing in the network matches ${nodeKey}. Try the full IP with its port, or the collateral outpoint.`
            : 'The server did not answer. The rest of Atlas keeps running; try again in a moment.'}
        </State>
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

/** The inspector body: the lead facts first, everything else one row away. */
function NodeBody({ tier, label }: { tier: string; label: string }) {
  const open = useOpenSet('node');
  const row = (id: string) => ({
    open: open.isOpen(id),
    onToggle: (next: boolean) => open.setOpen(id, next),
  });
  const icon = (Icon: typeof History) => <Icon size={15} strokeWidth={1.75} />;
  return (
    <article className="ix ix-node" data-tier={tier} aria-label={`Node ${label}`}>
      <Hero />
      <StatusAlert onOpenHealth={() => open.setOpen('health', true)} />
      <PaymentBlock />
      <Disclosures>
        <Disclosure
          index={2}
          title="Payment history"
          icon={icon(History)}
          summary={<PaymentsSummary />}
          {...row('payments')}
        >
          <PaymentHistoryBody />
        </Disclosure>
        <Disclosure
          index={3}
          title="Health"
          icon={icon(HeartPulse)}
          summary={<HealthSummary />}
          {...row('health')}
        >
          <HealthBody />
        </Disclosure>
        <Disclosure
          index={4}
          title="Hardware and software"
          icon={icon(Cpu)}
          summary={<HardwareSummary />}
          {...row('hardware')}
        >
          <HardwareBlock />
          <VersionsBlock />
        </Disclosure>
        <Disclosure
          index={5}
          title="Network"
          icon={icon(Network)}
          summary={<NetworkSummary />}
          {...row('network')}
        >
          <HostBlock />
          <ReachBlock />
          <PeersBlock />
        </Disclosure>
        <Disclosure
          index={6}
          title="Apps and activity"
          icon={icon(Layers)}
          summary={<ActivitySummary />}
          {...row('activity')}
        >
          <ActivityBody />
        </Disclosure>
        <Disclosure
          index={7}
          title="Identity"
          icon={icon(Fingerprint)}
          summary={<IdentitySummary />}
          {...row('identity')}
        >
          <IdentityBody />
        </Disclosure>
      </Disclosures>
    </article>
  );
}
