import { SearchX, WifiOff } from 'lucide-react';
import { useMemo } from 'react';
import { isApiError } from '../../../api/http';
import { useNodeDetail } from '../../../api/queries';
import { useNetwork } from '../../../app/context';
import { ipOfEndpoint } from '../sources/host';
import { useNodeLive, useResolvedId } from '../sources/live';
import { Alert, Btn, Sk, State } from '../ui';
import { NodeContext, type NodeCtx } from './context';
import { HealthSection, HostSection } from './Health';
import { Hero } from './Hero';
import { IdentitySection } from './Identity';
import { PeersSection, RelatedSection } from './Network';
import { PaymentBlock, PaymentHistory } from './Payment';
import { HardwareSection, ReachSection, VersionsSection } from './Specs';
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

  const gone = node?.status === 'departed' || (node?.departed_ms ?? null) !== null;
  return (
    <NodeContext.Provider value={ctx}>
      <article className="ix ix-node" data-tier={tier} aria-label={`Node ${endpoint || nodeKey}`}>
        <Hero />
        {gone ? (
          <section className="ix-sec" data-bare="">
            <Alert tone="off" title="This node has left the network">
              It no longer appears on the node list, so it is not paid. Its history stays here.
            </Alert>
          </section>
        ) : null}
        <PaymentBlock />
        <PaymentHistory />
        <HostSection />
        <HealthSection />
        <HardwareSection />
        <VersionsSection />
        <ReachSection />
        <PeersSection />
        <RelatedSection />
        <IdentitySection />
      </article>
    </NodeContext.Provider>
  );
}
