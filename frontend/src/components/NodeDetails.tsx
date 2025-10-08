import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { AtlasNode } from '../types';
import { formatNumber, formatBandwidth } from '../utils/format';
import { StatusBadge } from './StatusBadge';

interface NodeDetailsProps {
  node: AtlasNode | null;
}

export const NodeDetails = ({ node }: NodeDetailsProps) => {
  const [showAppsModal, setShowAppsModal] = useState(false);
  const [showAppsTooltip, setShowAppsTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const appsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showAppsTooltip && appsRef.current && !showAppsModal) {
      const rect = appsRef.current.getBoundingClientRect();
      setTooltipPosition({
        top: rect.top,
        left: rect.left + rect.width / 2,
      });
    }
  }, [showAppsTooltip, showAppsModal]);
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
        {meta.apps && meta.apps.length > 0 ? (
          <>
            <div
              ref={appsRef}
              style={{ position: 'relative' }}
              onMouseEnter={() => setShowAppsTooltip(true)}
              onMouseLeave={() => setShowAppsTooltip(false)}
              onClick={() => {
                setShowAppsModal(true);
                setShowAppsTooltip(false);
              }}
            >
              <dt>Installed Apps</dt>
              <dd style={{ cursor: 'pointer' }}>{formatNumber(meta.apps.length)}</dd>
            </div>
            {showAppsTooltip && !showAppsModal && createPortal(
              <div style={{
                position: 'fixed',
                top: `${tooltipPosition.top - 8}px`,
                left: `${tooltipPosition.left}px`,
                transform: 'translate(-50%, -100%)',
                padding: '12px',
                background: 'linear-gradient(135deg, rgba(56, 232, 255, 0.15) 0%, rgba(123, 97, 255, 0.15) 100%)',
                border: '1px solid rgba(56, 232, 255, 0.3)',
                borderRadius: '8px',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                backdropFilter: 'blur(10px)',
                zIndex: 10000,
                minWidth: '280px',
                maxWidth: '400px',
                maxHeight: '300px',
                overflowY: 'auto',
                pointerEvents: 'none'
              }}>
                {meta.apps.map((app, idx) => (
                  <div key={idx} style={{
                    marginBottom: idx < meta.apps!.length - 1 ? '12px' : '0',
                    paddingBottom: idx < meta.apps!.length - 1 ? '12px' : '0',
                    borderBottom: idx < meta.apps!.length - 1 ? '1px solid rgba(56, 232, 255, 0.2)' : 'none'
                  }}>
                    <div style={{
                      fontWeight: 'bold',
                      color: '#38e8ff',
                      marginBottom: '4px',
                      fontSize: '13px'
                    }}>
                      {app.name}
                    </div>
                    <div style={{
                      fontSize: '11px',
                      color: 'rgba(255, 255, 255, 0.8)',
                      lineHeight: '1.4'
                    }}>
                      {app.description}
                    </div>
                  </div>
                ))}
              </div>,
              document.body
            )}
            {showAppsModal && createPortal(
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(0, 0, 0, 0.7)',
                  backdropFilter: 'blur(4px)',
                  zIndex: 10000,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '20px'
                }}
                onClick={() => setShowAppsModal(false)}
              >
                <div
                  style={{
                    background: 'linear-gradient(135deg, rgba(16, 24, 45, 0.95) 0%, rgba(24, 32, 60, 0.95) 100%)',
                    border: '1px solid rgba(56, 232, 255, 0.3)',
                    borderRadius: '16px',
                    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6)',
                    maxWidth: '500px',
                    width: '100%',
                    maxHeight: '80vh',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden'
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{
                    padding: '20px',
                    borderBottom: '1px solid rgba(56, 232, 255, 0.2)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <h3 style={{ margin: 0, color: '#38e8ff', fontSize: '18px' }}>
                      Installed Applications ({meta.apps.length})
                    </h3>
                    <button
                      onClick={() => setShowAppsModal(false)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#38e8ff',
                        fontSize: '24px',
                        cursor: 'pointer',
                        padding: '0',
                        width: '30px',
                        height: '30px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '4px',
                        transition: 'background 0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(56, 232, 255, 0.1)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                    >
                      ×
                    </button>
                  </div>
                  <div style={{
                    padding: '20px',
                    overflowY: 'auto',
                    flex: 1
                  }}>
                    {meta.apps.map((app, idx) => (
                      <div key={idx} style={{
                        marginBottom: idx < meta.apps!.length - 1 ? '20px' : '0',
                        paddingBottom: idx < meta.apps!.length - 1 ? '20px' : '0',
                        borderBottom: idx < meta.apps!.length - 1 ? '1px solid rgba(56, 232, 255, 0.15)' : 'none'
                      }}>
                        <div style={{
                          fontWeight: 'bold',
                          color: '#38e8ff',
                          marginBottom: '8px',
                          fontSize: '15px'
                        }}>
                          {app.name}
                        </div>
                        <div style={{
                          fontSize: '13px',
                          color: 'rgba(255, 255, 255, 0.8)',
                          lineHeight: '1.5'
                        }}>
                          {app.description}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>,
              document.body
            )}
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
