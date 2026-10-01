import { OctagonX, ServerCrash, ShieldAlert, TriangleAlert, WifiOff } from 'lucide-react';
import { formatInt } from '../../../lib/format';
import { Endpoint, EntityLink } from '../../../ui';
import { spanText } from '../derive/eta';
import { checkinGauge } from '../derive/expiry';
import type { Attention, Concentration, FleetNode } from '../derive/operator';
import { Callout } from '../ui/callout';

const SHOWN = 3;

/** A node as a link: its address when it has one, else its number. */
function NodeRef({ node }: { node: FleetNode }) {
  return node.endpoint ? (
    <Endpoint value={node.endpoint} />
  ) : (
    <EntityLink kind="node" value={String(node.id)}>
      Node {node.id}
    </EntityLink>
  );
}

function Nodes({ nodes }: { nodes: readonly FleetNode[] }) {
  const rest = nodes.length - SHOWN;
  return (
    <>
      {nodes.slice(0, SHOWN).map((n) => (
        <NodeRef key={n.id} node={n} />
      ))}
      {rest > 0 ? <span className="ix-dim">and {formatInt(rest)} more</span> : null}
    </>
  );
}

function plural(n: number, one: string, many: string): string {
  return `${formatInt(n)} ${n === 1 ? one : many}`;
}

function AttentionCallout({ group }: { group: Attention }) {
  const n = group.nodes.length;
  const first = group.nodes[0];
  if (!first) return null;
  const links = <Nodes nodes={group.nodes} />;
  switch (group.kind) {
    case 'expired':
      return (
        <Callout
          tone="crit"
          role="alert"
          icon={<OctagonX size={16} strokeWidth={1.5} />}
          title={`${plural(n, 'node is', 'nodes are')} past expiry`}
          actions={links}
        >
          640 blocks without a check-in: the network drops a node here unless a confirm is already on its way.
        </Callout>
      );
    case 'at_risk': {
      const g = checkinGauge(first.sinceConfirm);
      return (
        <Callout
          tone="warn"
          icon={<TriangleAlert size={16} strokeWidth={1.5} />}
          title={`${plural(n, 'node is', 'nodes are')} at risk of expiring`}
          actions={links}
        >
          {g.msToExpiry !== null
            ? `The closest expires in ${spanText(g.msToExpiry)} (${formatInt(g.blocksToExpiry ?? 0)} blocks) unless it checks in.`
            : 'No check-in for 560 blocks or more.'}
        </Callout>
      );
    }
    case 'dos':
      return (
        <Callout
          tone="crit"
          icon={<ShieldAlert size={16} strokeWidth={1.5} />}
          title={`${plural(n, 'node is', 'nodes are')} DoS listed`}
          actions={links}
        >
          Banned for 720 blocks after a failed benchmark or a network violation. The queue skips it until the
          ban ends.
        </Callout>
      );
    case 'unreachable':
      return (
        <Callout
          tone="warn"
          icon={<WifiOff size={16} strokeWidth={1.5} />}
          title={`${plural(n, 'node', 'nodes')} not reachable`}
          actions={links}
        >
          The last stats round could not reach {n === 1 ? 'it' : 'them'}. {n === 1 ? 'It keeps' : 'They keep'}{' '}
          the place in the queue while check-ins continue.
        </Callout>
      );
  }
}

/** The banners worth interrupting for: what is closest to costing money (at most two). */
export function AttentionCallouts({ groups }: { groups: readonly Attention[] }) {
  const shown = groups.slice(0, 2);
  if (shown.length === 0) return null;
  return (
    <div className="ix-pad ix-callouts">
      {shown.map((g) => (
        <AttentionCallout key={g.kind} group={g} />
      ))}
      {groups.length > shown.length ? (
        <p className="ix-cap">
          {formatInt(groups.length - shown.length)} more{' '}
          {groups.length - shown.length === 1 ? 'issue' : 'issues'} in the node list below.
        </p>
      ) : null}
    </div>
  );
}

/** One host or provider carrying most of the payouts: advice, so it sits with the nodes, not above the numbers. */
export function ConcentrationCallout({ concentration }: { concentration: Concentration }) {
  if (concentration.level === 'none') return null;
  return (
    <Callout
      tone={concentration.level === 'crit' ? 'crit' : 'warn'}
      icon={<ServerCrash size={16} strokeWidth={1.5} />}
      title={concentration.headline}
    >
      {concentration.body}
    </Callout>
  );
}
