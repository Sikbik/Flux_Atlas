import { OctagonX, ShieldAlert, TriangleAlert, WifiOff } from 'lucide-react';
import { useTip } from '../../../app/context';
import { formatInt } from '../../../lib/format';
import { spanText } from '../derive/eta';
import { blocksSinceConfirm, checkinGauge } from '../derive/expiry';
import { Alert, Btn } from '../ui';
import { useNodeCtx } from './context';

/**
 * The one thing worth interrupting for: a node that is gone, banned, past expiry, close to expiring or
 * unreachable. Nothing at all while the node is fine, so a healthy node's first screen stays calm.
 */
export function StatusAlert({ onOpenHealth }: { onOpenHealth: () => void }) {
  const { node, live } = useNodeCtx();
  const tip = useTip();
  const status = live?.status ?? node?.status ?? 'unknown';
  const lastConfirmed = Math.max(live?.lastConfirmed ?? 0, node?.last_confirmed_height ?? 0);
  const since = blocksSinceConfirm(tip?.height, lastConfirmed);
  const g = checkinGauge(since);
  const gone = node?.status === 'departed' || (node?.departed_ms ?? null) !== null;
  const reachable = live?.reachable ?? node?.reachable ?? null;

  let alert: { tone: 'off' | 'warn' | 'crit'; icon: typeof OctagonX; title: string; body: string } | null =
    null;
  if (gone) {
    alert = {
      tone: 'off',
      icon: OctagonX,
      title: 'This node has left the network',
      body: 'It no longer appears on the node list, so it is not paid. Its history stays here.',
    };
  } else if (status === 'dos') {
    alert = {
      tone: 'crit',
      icon: ShieldAlert,
      title: 'DoS listed',
      body: 'Banned for 720 blocks after a failed benchmark or a network violation. The payment queue skips it until the ban ends.',
    };
  } else if (status === 'confirmed' || status === 'offline') {
    if (g.state === 'expired') {
      alert = {
        tone: 'crit',
        icon: OctagonX,
        title: 'Past expiry',
        body: `${formatInt(since ?? 0)} blocks without a check-in. The network drops the node unless a confirm is already on its way.`,
      };
    } else if (g.state === 'atRisk') {
      alert = {
        tone: 'warn',
        icon: TriangleAlert,
        title: 'At risk of expiring',
        body: `Expires in ${formatInt(g.blocksToExpiry ?? 0)} blocks (${spanText(g.msToExpiry ?? 0)}) unless it checks in.`,
      };
    } else if (reachable === false) {
      alert = {
        tone: 'warn',
        icon: WifiOff,
        title: 'Not reachable',
        body: 'The last stats round could not reach this node. It keeps its place in the queue while it checks in.',
      };
    }
  }
  if (!alert) return null;
  const Icon = alert.icon;
  return (
    <div className="ix-alertwrap ix-rise" style={{ '--ix-i': 0 } as React.CSSProperties}>
      <Alert tone={alert.tone} title={alert.title} icon={<Icon size={16} strokeWidth={1.75} />}>
        <span className="ix-alert-body">{alert.body}</span>
        {alert.tone === 'warn' || alert.tone === 'crit' ? (
          <span className="ix-alert-act">
            <Btn variant="ghost" onClick={onOpenHealth}>
              Show check-ins
            </Btn>
          </span>
        ) : null}
      </Alert>
    </div>
  );
}
