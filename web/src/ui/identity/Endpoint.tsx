import type { CSSProperties, Ref } from 'react';
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
  style?: CSSProperties;
  /** Ref to the outermost element (the wrapper when there is a copy button, `className` or `style`; otherwise the link). */
  ref?: Ref<HTMLElement>;
}

/** An IP and port in Plex Mono, IPv6 bracketed, linked to its node or host. Unknown when absent. */
export function Endpoint({
  value,
  ip,
  port,
  hideDefaultPort,
  link = true,
  copy,
  className,
  style,
  ref,
}: EndpointProps) {
  const raw = value ?? (ip ? (port ? `${ip.includes(':') ? `[${ip}]` : ip}:${port}` : ip) : null);
  const ep = parseEndpoint(raw);
  if (!ep) return <Unknown />;
  const full = formatEndpoint(ep);
  const text = formatEndpoint(ep, { hideDefaultPort });
  const wrapped = copy || className || style;
  const inner = wrapped ? undefined : ref;
  const body = link ? (
    <EntityLink kind={ep.port === null ? 'host' : 'node'} value={full} ref={inner as Ref<HTMLAnchorElement>}>
      {text}
    </EntityLink>
  ) : (
    <span className="ui-mono" ref={inner as Ref<HTMLSpanElement>}>
      {text}
    </span>
  );
  if (!copy) {
    return wrapped ? (
      <span ref={ref as Ref<HTMLSpanElement>} className={cx('ui-endpoint', className)} style={style}>
        {body}
      </span>
    ) : (
      body
    );
  }
  return (
    <span
      ref={ref as Ref<HTMLSpanElement>}
      className={cx('ui-entity-wrap', className)}
      style={style}
      data-copy="hover"
    >
      {body}
      <CopyButton value={full} what="endpoint" className="ui-entity__copy" />
    </span>
  );
}
