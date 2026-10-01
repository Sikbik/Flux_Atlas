import { Blocks } from 'lucide-react';
import { useNetwork } from '../../../app/context';
import {
  formatFlux,
  formatInt,
  formatUtcDateTime,
  middleTruncate,
  shortCollateral,
} from '../../../lib/format';
import { AddressLink, Block, BlockLink, CopyButton, Kv, KvRow, OperatorLink } from '../ui';
import { useNodeCtx } from './context';

function Copyable({ text, value, label }: { text: string; value: string; label: string }) {
  return (
    <>
      <span className="ix-trunc" title={value}>
        {text}
      </span>
      <CopyButton value={value} label={label} />
    </>
  );
}

/** Collateral, keys, addresses and the heights that define the node's history. */
export function IdentityBody() {
  const { node, live, tier, endpoint } = useNodeCtx();
  const collateral = useNetwork((s) => s.tierStats.find((t) => t.tier === tier)?.collateral ?? null);

  const lastConfirmed = Math.max(live?.lastConfirmed ?? 0, node?.last_confirmed_height ?? 0);
  const lastPaid = Math.max(live?.lastPaid ?? 0, node?.last_paid_height ?? 0);
  const block = (h: number | null | undefined) =>
    h ? (
      <BlockLink height={h} className="ix-mono">
        {formatInt(h)}
      </BlockLink>
    ) : (
      'Unknown'
    );

  return (
    <>
      <Block title="Keys and addresses">
        <Kv>
          <KvRow label="Collateral">{collateral ? formatFlux(collateral, { decimals: 0 }) : 'Unknown'}</KvRow>
          <KvRow label="Outpoint">
            {node ? (
              <Copyable
                text={shortCollateral(node.outpoint)}
                value={node.outpoint}
                label="Copy the collateral outpoint"
              />
            ) : (
              'Unknown'
            )}
          </KvRow>
          <KvRow label="Endpoint">
            {endpoint ? (
              <Copyable text={endpoint} value={endpoint} label="Copy the IP and port" />
            ) : (
              'Unknown'
            )}
          </KvRow>
          <KvRow label="Payment address">
            {node?.payment_address ? (
              <>
                <OperatorLink addr={node.payment_address} className="ix-trunc" title="Open the operator view">
                  {middleTruncate(node.payment_address, 8, 5)}
                </OperatorLink>
                <AddressLink
                  addr={node.payment_address}
                  className="ix-copy"
                  title="Open the address in the explorer"
                  aria-label="Open the address in the explorer"
                >
                  <Blocks size={13} strokeWidth={1.75} aria-hidden="true" />
                </AddressLink>
                <CopyButton value={node.payment_address} label="Copy the payment address" />
              </>
            ) : (
              'Unknown'
            )}
          </KvRow>
          <KvRow label="ZelID">
            {node?.zelid ? (
              <Copyable text={middleTruncate(node.zelid, 8, 5)} value={node.zelid} label="Copy the ZelID" />
            ) : (
              'Unknown'
            )}
          </KvRow>
          <KvRow label="Public key">
            {node?.pubkey ? (
              <Copyable
                text={middleTruncate(node.pubkey, 8, 6)}
                value={node.pubkey}
                label="Copy the public key"
              />
            ) : (
              'Unknown'
            )}
          </KvRow>
        </Kv>
      </Block>
      <Block title="Heights and dates">
        <Kv>
          <KvRow label="Added">block {block(node?.added_height)}</KvRow>
          <KvRow label="Confirmed">block {block(node?.confirmed_height)}</KvRow>
          <KvRow label="Last check-in">{lastConfirmed ? <>block {block(lastConfirmed)}</> : 'Unknown'}</KvRow>
          <KvRow label="Last paid">{lastPaid ? <>block {block(lastPaid)}</> : 'Not paid yet'}</KvRow>
          <KvRow label="Active since">
            {node?.active_since_ms ? formatUtcDateTime(node.active_since_ms) : 'Unknown'}
          </KvRow>
          <KvRow label="Port mapping" sans>
            {node?.upnp === null || node?.upnp === undefined ? 'Unknown' : node.upnp ? 'UPnP' : 'Direct'}
            {node?.static_ip != null ? (node.static_ip ? ', static IP' : ', dynamic IP') : ''}
          </KvRow>
        </Kv>
      </Block>
    </>
  );
}
