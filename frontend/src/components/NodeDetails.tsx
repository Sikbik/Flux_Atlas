import type { AtlasNode } from '../types';
import { formatNumber, formatBandwidth } from '../utils/format';
import { StatusBadge } from './StatusBadge';

interface NodeDetailsProps {
  node: AtlasNode | null;
}

export const NodeDetails = ({ node }: NodeDetailsProps) => {
  if (!node) {
    return (
      <div className="node-details node-details--empty">
        <h3>No Node Selected</h3>
        <p>Tap a node in the atlas to dive into its connections, tier, and Arcane status.</p>
      </div>
    );
  }

  const { metrics, meta } = node;

  // Extract IP and port from the node's IP field
  const ipAddress = (meta as any).ip || node.label;
  const portMatch = ipAddress.match(/:(\d+)$/);
  const port = portMatch ? portMatch[1] : null;
  const ipOnly = port ? ipAddress.replace(`:${port}`, '') : ipAddress;

  return (
    <div className="node-details">
      <div className="node-details__header">
        <h3>
          {ipOnly}
          {port ? <span style={{ color: '#38e8ff', marginLeft: '8px' }}>:{port}</span> : null}
        </h3>
        <div className="node-details__badges">
          <StatusBadge type="tier" value={node.tier} />
          <StatusBadge type="status" value={node.status} />
          {node.isHub ? <span className="status-badge status-badge--hub">HUB</span> : null}
        </div>
      </div>

      <dl className="node-details__grid">
        <div>
          <dt>Outgoing Peers</dt>
          <dd>{formatNumber(metrics.outgoingPeers)}</dd>
        </div>
        <div>
          <dt>Incoming Peers</dt>
          <dd>{formatNumber(metrics.incomingPeers)}</dd>
        </div>
        {meta.bandwidth ? (
          <>
            <div>
              <dt>Download Speed</dt>
              <dd>{formatBandwidth(meta.bandwidth.download_speed)}</dd>
            </div>
            <div>
              <dt>Upload Speed</dt>
              <dd>{formatBandwidth(meta.bandwidth.upload_speed)}</dd>
            </div>
          </>
        ) : null}
      </dl>

      <div className="node-details__meta">
        {meta.paymentAddress ? (
          <div>
            <span className="meta-label">Payment Address</span>
            <span className="meta-value meta-value--mono">{meta.paymentAddress}</span>
          </div>
        ) : null}
        {meta.collateral ? (
          <div>
            <span className="meta-label">Collateral Output</span>
            <span className="meta-value meta-value--mono">{meta.collateral}</span>
          </div>
        ) : null}
        {meta.frontendUrl ? (
          <div>
            <span className="meta-label">Frontend URL</span>
            <a
              href={meta.frontendUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="meta-value meta-value--mono meta-value--link"
              style={{ color: '#38e8ff', textDecoration: 'none', cursor: 'pointer' }}
            >
              {meta.frontendUrl}
            </a>
          </div>
        ) : null}
        {meta.rpcEndpoint ? (
          <div>
            <span className="meta-label">RPC Endpoint</span>
            <span className="meta-value meta-value--mono">{meta.rpcEndpoint}</span>
          </div>
        ) : null}
        {meta.lastConfirmedHeight ? (
          <div>
            <span className="meta-label">Last Confirmed Block</span>
            <span className="meta-value">{formatNumber(meta.lastConfirmedHeight)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};
