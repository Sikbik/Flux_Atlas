import { formatInt, parseEndpoint } from '../../../lib/format';
import { positionOf } from '../derive/queue';
import { LADDER_PORTS, useHostLive } from '../sources/host';
import { useQueues } from '../sources/live';
import { tierLabel } from './chips';
import { TierGlyph } from './glyphs';
import { NodeLink } from './links';

/**
 * A host's eight UPnP ports, each showing the node on it (tier, port, queue position) or "free". Every
 * occupied port is a link to its node; `selectedId` lights the one being inspected.
 */
export function HostLadder({ ip, selectedId }: { ip: string; selectedId?: number | null }) {
  const { byPort } = useHostLive(ip);
  const queues = useQueues();
  return (
    <ul className="ix-ladder" aria-label={`Nodes on ${ip}`}>
      {LADDER_PORTS.map((port) => {
        const n = byPort.get(port);
        if (!n) {
          return (
            <li className="ix-slot" data-free="" key={port}>
              <span>{port}</span>
              <small>free</small>
            </li>
          );
        }
        const pos = positionOf(queues, n.id);
        return (
          <li key={port} className="ix-slot-cell">
            <NodeLink
              nodeKey={n.endpoint || n.id}
              className="ix-slot"
              data-tier={n.tier}
              data-sel={n.id === selectedId}
              title={`${n.endpoint}, ${tierLabel(n.tier)}${pos ? `, queue position ${formatInt(pos.position + 1)}` : ''}`}
            >
              <TierGlyph tier={n.tier} size={14} />
              <span>{port}</span>
              <small>{pos ? `#${formatInt(pos.position + 1)}` : 'n/a'}</small>
            </NodeLink>
          </li>
        );
      })}
    </ul>
  );
}

/** The port of an endpoint, or 0. */
export const portOf = (endpoint: string): number => parseEndpoint(endpoint)?.port ?? 0;
