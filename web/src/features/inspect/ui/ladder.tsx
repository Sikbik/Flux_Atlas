import { formatInt } from '../../../lib/format';
import { EntityLink, TierGlyph, tierLabel } from '../../../ui';
import { positionOf } from '../derive/queue';
import { LADDER_PORTS, useHostLive } from '../sources/host';
import { useQueues } from '../sources/live';
import './ladder.css';

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
        const place = pos ? `#${formatInt(pos.position + 1)}` : 'n/a';
        const tier = n.tier === 'unknown' ? 'Unknown tier' : tierLabel(n.tier);
        return (
          <li
            key={port}
            className="ix-slot"
            data-tier={n.tier}
            data-sel={n.id === selectedId ? '' : undefined}
          >
            <EntityLink
              kind="node"
              value={n.endpoint || n.id}
              label={`Open node ${n.endpoint || n.id}, ${tier}${pos ? `, queue position ${formatInt(pos.position + 1)}` : ''}`}
              className="ix-slot__link"
            >
              <TierGlyph tier={n.tier} size={14} />
              <span>{port}</span>
              <small>{place}</small>
            </EntityLink>
          </li>
        );
      })}
    </ul>
  );
}
