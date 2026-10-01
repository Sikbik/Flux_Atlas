import { formatEndpoint, parseEndpoint } from '../../lib/format';
import { CopyButton } from '../controls/CopyButton';
import { cx } from '../internal/cx';
import { EntityLink } from './EntityLink';
import { Unknown } from './Unknown';
import './identity.css';

export interface EndpointProps {
  /** `ip:port`, `[ipv6]:port` or a bare host. Alternatively pass `ip` and `port`. */
  value?: string | null;
  /** The host part, when it arrives separately from the port. */
  ip?: string | null;
  /** The port, when it arrives separately. */
  port?: number | null;
  /** Drop the default Flux API port (`:16127`) from the text. */
  hideDefaultPort?: boolean;
  /** Link to the node (with a port) or the host (without), default true. */
  link?: boolean;
  /** Add a copy button for the full `ip:port`. */
  copy?: boolean;
  className?: string;
}

/** An IP and port in Plex Mono, IPv6 bracketed, linked to its node or host. Unknown when absent. */
export function Endpoint({ value, ip, port, hideDefaultPort, link = true, copy, className }: EndpointProps) {
  const raw = value ?? (ip ? (port ? `${ip.includes(':') ? `[${ip}]` : ip}:${port}` : ip) : null);
  const ep = parseEndpoint(raw);
  if (!ep) return <Unknown />;
  const full = formatEndpoint(ep);
  const text = formatEndpoint(ep, { hideDefaultPort });
  const body = link ? (
    <EntityLink kind={ep.port === null ? 'host' : 'node'} value={full}>
      {text}
    </EntityLink>
  ) : (
    <span className="ui-mono">{text}</span>
  );
  if (!copy) return className ? <span className={cx('ui-endpoint', className)}>{body}</span> : body;
  return (
    <span className={cx('ui-entity-wrap', className)} data-copy="hover">
      {body}
      <CopyButton value={full} what="endpoint" className="ui-entity__copy" />
    </span>
  );
}
