import { useNetwork } from '../../../app/context';
import { formatUtcDateTime } from '../../../lib/format';
import { Amount, EntityLink, Hash, Height, KeyValue, type KeyValueItem } from '../../../ui';
import { useNodeCtx } from './context';
import { SubHead } from './SubHead';

const block = (h: number | null | undefined, none = 'Unknown') => (h ? <Height value={h} /> : none);

/** Collateral, keys, addresses and the heights that define the node's history. */
export function IdentityBody() {
  const { node, live, tier, endpoint } = useNodeCtx();
  const collateral = useNetwork((s) => s.tierStats.find((t) => t.tier === tier)?.collateral ?? null);

  const lastConfirmed = Math.max(live?.lastConfirmed ?? 0, node?.last_confirmed_height ?? 0);
  const lastPaid = Math.max(live?.lastPaid ?? 0, node?.last_paid_height ?? 0);

  const keys: KeyValueItem[] = [
    { label: 'Collateral', value: collateral ? <Amount value={collateral} decimals={0} /> : null },
    {
      label: 'Outpoint',
      value: node ? (
        <Hash value={node.outpoint} head={8} tail={6} copy="always" what="collateral outpoint" />
      ) : null,
    },
    { label: 'Endpoint', value: endpoint || null, mono: true, copy: true },
    {
      label: 'Payment address',
      value: node?.payment_address ? (
        <EntityLink kind="operator" value={node.payment_address} copy="always" />
      ) : null,
      note: node?.payment_address ? (
        <EntityLink kind="address" value={node.payment_address}>
          Open in the explorer
        </EntityLink>
      ) : undefined,
    },
    {
      label: 'ZelID',
      value: node?.zelid ? <Hash value={node.zelid} head={8} tail={5} copy="always" what="ZelID" /> : null,
    },
    {
      label: 'Public key',
      value: node?.pubkey ? (
        <Hash value={node.pubkey} head={8} tail={6} copy="always" what="public key" />
      ) : null,
    },
  ];

  const heights: KeyValueItem[] = [
    { label: 'Added', value: block(node?.added_height) },
    { label: 'Confirmed', value: block(node?.confirmed_height) },
    { label: 'Last check-in', value: block(lastConfirmed) },
    { label: 'Last paid', value: block(lastPaid, 'Not paid yet') },
    { label: 'Active since', value: node?.active_since_ms ? formatUtcDateTime(node.active_since_ms) : null },
    {
      label: 'Port mapping',
      value:
        node?.upnp === null || node?.upnp === undefined
          ? null
          : `${node.upnp ? 'UPnP' : 'Direct'}${node.static_ip != null ? (node.static_ip ? ', static IP' : ', dynamic IP') : ''}`,
    },
    ...(node?.ui_url
      ? [{ label: 'FluxOS panel', value: 'Open in a new tab', href: node.ui_url } satisfies KeyValueItem]
      : []),
  ];

  return (
    <div className="ix-stack ix-stack-lg">
      <div>
        <SubHead title="Keys and addresses" />
        <KeyValue items={keys} />
      </div>
      <div>
        <SubHead title="Heights and dates" />
        <KeyValue items={heights} />
      </div>
    </div>
  );
}
