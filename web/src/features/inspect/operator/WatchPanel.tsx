import { ArrowRight, BellRing, ChevronDown, WalletCards } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useUi } from '../../../store/ui';
import { Button, Hash, Section, Switch } from '../../../ui';
import { useOpenWallet } from '../../wallet/hooks/useOpenWallet';
import { type FleetNode, fleetWallets, walletCaption } from '../derive/operator';
import { ALERT_KINDS, ALERT_LABELS } from '../derive/watch';
import { announceWatch } from '../sources/hooks';
import { NodeFinder } from '../ui/NodeFinder';
import type { useOpenSet } from '../ui/openset';
import { WATCH_LIVE_LIMIT } from '../watch/model';
import { useNotificationPermission, useWatchPrefs } from '../watch/prefs';

/** Adds any node of the network to the watchlist: find it, press Enter. */
export function WatchAdd() {
  const watched = useUi((s) => s.watched);
  const watch = useUi((s) => s.watch);
  return (
    <NodeFinder
      label="Add a node to the watchlist"
      placeholder="Add a node: IP, port or id"
      keepText={false}
      note={(h) => (watched.includes(h.id) ? 'Watching' : null)}
      onPick={(h) => {
        if (watched.includes(h.id)) return;
        watch(h.id);
        announceWatch(h.endpoint);
      }}
    />
  );
}

/** Wallets shown before "Show all". */
const WALLETS_SHOWN = 3;

/**
 * The wallets the watched nodes are paid to, each one press into the wallet workspace. A watchlist usually
 * follows one operator's nodes, so this is usually a single row: that operator's wallet.
 */
export function WatchWallets({ nodes }: { nodes: readonly FleetNode[] }) {
  const wallets = useMemo(() => fleetWallets(nodes), [nodes]);
  const known = useMemo(() => nodes.filter((n) => n.paymentAddress).length, [nodes]);
  const openWallet = useOpenWallet();
  const [all, setAll] = useState(false);
  if (wallets.length === 0) return null;
  const shown = all ? wallets : wallets.slice(0, WALLETS_SHOWN);
  return (
    <div className="ix-pad ix-gap-top">
      <ul
        className="ix-wallets"
        aria-label={wallets.length === 1 ? 'Wallet of the watched nodes' : 'Wallets of the watched nodes'}
      >
        {shown.map((w) => {
          const caption = walletCaption(w.nodes, nodes.length, known);
          return (
            <li key={w.address}>
              <button
                type="button"
                className="ix-wallet"
                aria-label={`Open wallet ${w.address} in the wallet workspace. ${caption}.`}
                title="Earnings, payments, fleet, health and apps of this address, in the wallet workspace"
                onClick={() => openWallet(w.address)}
              >
                <span className="ix-wallet-i" aria-hidden="true">
                  <WalletCards size={16} strokeWidth={1.5} />
                </span>
                <span className="ix-wallet-t">
                  <Hash value={w.address} head={6} tail={5} copy={false} className="ix-wallet-addr" />
                  <span>{caption}</span>
                </span>
                <span className="ix-wallet-go" aria-hidden="true">
                  Open wallet <ArrowRight size={14} strokeWidth={1.75} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {wallets.length > shown.length ? (
        <Button
          size="sm"
          variant="ghost"
          icon={ChevronDown}
          className="ix-wallets-more"
          onClick={() => setAll(true)}
        >
          Show all {wallets.length} wallets
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Which alerts the watchlist raises and whether they also reach the desktop. Everything applies at once;
 * the browser only asks for permission when the user turns notifications on.
 */
export function AlertsFold({ open }: { open: ReturnType<typeof useOpenSet> }) {
  const kinds = useWatchPrefs((s) => s.kinds);
  const notify = useWatchPrefs((s) => s.notify);
  const setNotify = useWatchPrefs((s) => s.setNotify);
  const setKind = useWatchPrefs((s) => s.setKind);
  const [permission, request] = useNotificationPermission();
  const on = ALERT_KINDS.filter((k) => kinds[k]).length;
  const desktop = notify && permission === 'granted';

  const description =
    permission === 'unsupported'
      ? 'This browser cannot show notifications.'
      : permission === 'denied'
        ? 'Blocked for this site in the browser settings.'
        : 'Shown when this tab is in the background.';

  return (
    <Section
      collapsible
      level={3}
      title="Alerts"
      icon={BellRing}
      aside={`${on} of ${ALERT_KINDS.length} on${desktop ? ', on the desktop' : ''}`}
      open={open.isOpen('alerts')}
      onOpenChange={(v) => open.setOpen('alerts', v)}
    >
      <div className="ix-switches">
        <Switch
          layout="row"
          label="Desktop notifications"
          description={description}
          checked={desktop}
          disabled={permission === 'unsupported' || permission === 'denied'}
          onChange={async (next) => {
            if (!next) {
              setNotify(false);
              return;
            }
            const result = permission === 'granted' ? 'granted' : await request();
            setNotify(result === 'granted');
          }}
        />
        {ALERT_KINDS.map((k) => (
          <Switch
            key={k}
            layout="row"
            label={ALERT_LABELS[k].title}
            description={ALERT_LABELS[k].hint}
            checked={kinds[k]}
            onChange={(next) => setKind(k, next)}
          />
        ))}
      </div>
      <p className="ix-cap">
        Every alert also appears in the app as a toast. The server follows up to {WATCH_LIVE_LIMIT} watched
        nodes in real time. The list is kept on this device.
      </p>
    </Section>
  );
}
