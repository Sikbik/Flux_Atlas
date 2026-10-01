import { Ban, Check, ExternalLink, Lock } from 'lucide-react';
import type { AppComponent } from '../../../api/generated/AppComponent';
import type { GeoRule } from '../../../api/generated/GeoRule';
import { formatInt, middleTruncate } from '../../../lib/format';
import { defaultAppDomain, describeGeoPlace, envNames, parseImage } from '../derive/appSpec';
import {
  AddressLink,
  BlockLink,
  Chip,
  CopyButton,
  Disclosure,
  HostLink,
  Kv,
  KvRow,
  State,
  useOpenSet,
} from '../ui';
import { useAppCtx } from './context';

const plural = (n: number, one: string, many = `${one}s`) => `${formatInt(n)} ${n === 1 ? one : many}`;

function Facts({ c }: { c: AppComponent }) {
  const img = parseImage(c.repotag);
  const env = envNames(c.environment);
  const domains = c.domains.filter(Boolean);
  const ports = c.ports.map((p, i) => ({ pub: p, inner: c.container_ports[i] }));
  return (
    <div className="ix-comp">
      <dl className="ix-comp-grid">
        <div>
          <dt>CPU</dt>
          <dd className="ix-mono">{c.cpu}</dd>
        </div>
        <div>
          <dt>Memory</dt>
          <dd className="ix-mono">{formatInt(c.ram_mb)} MB</dd>
        </div>
        <div>
          <dt>Disk</dt>
          <dd className="ix-mono">{formatInt(c.hdd_gb)} GB</dd>
        </div>
      </dl>
      <Kv>
        <KvRow label="Image" sans>
          {img ? (
            img.href ? (
              <a href={img.href} target="_blank" rel="noopener noreferrer" className="ix-link ix-trunc">
                {img.repository}:{img.tag} <ExternalLink size={11} strokeWidth={1.75} aria-hidden="true" />
              </a>
            ) : (
              <span className="ix-mono ix-trunc">
                {img.registry}/{img.repository}:{img.tag}
              </span>
            )
          ) : (
            'Unknown'
          )}
        </KvRow>
        {ports.length ? (
          <KvRow label="Ports">
            {ports.map((p) => (p.inner ? `${p.pub} to ${p.inner}` : String(p.pub))).join(', ')}
          </KvRow>
        ) : null}
        {domains.length ? <KvRow label="Domains">{domains.join(', ')}</KvRow> : null}
        {c.container_data ? <KvRow label="Data">{c.container_data}</KvRow> : null}
        {c.commands.length ? <KvRow label="Commands">{plural(c.commands.length, 'command')}</KvRow> : null}
      </Kv>
      {env.length ? (
        <div className="ix-comp-env">
          <span className="ix-cap">Environment, names only</span>
          <div className="ix-chips">
            {env.map((e) => (
              <Chip key={e} mono size="sm">
                {e}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}
      {c.has_repoauth || c.has_secrets || c.tiered ? (
        <div className="ix-chips">
          {c.has_repoauth ? (
            <Chip size="sm" title="The image is pulled with registry credentials that are not public">
              Private registry
            </Chip>
          ) : null}
          {c.has_secrets ? (
            <Chip size="sm" title="The component carries secrets that are not public">
              Secrets
            </Chip>
          ) : null}
          {c.tiered ? (
            <Chip size="sm" title="Resources scale with the node tier">
              Tiered resources
            </Chip>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The containers of the app, each one row until opened; a single component opens straight away. */
export function ComponentsBody() {
  const { detail } = useAppCtx();
  const open = useOpenSet(`comp:${detail.name}`);
  const { spec } = detail;
  if (spec.enterprise) {
    return (
      <State compact icon={<Lock size={20} strokeWidth={1.5} />} title="Encrypted enterprise app">
        Enterprise apps keep their components private; only the public fields (owner, instance count, expiry
        and placement) can be shown.
      </State>
    );
  }
  if (spec.components.length === 0) {
    return <p className="ix-cap">This spec lists no components.</p>;
  }
  if (spec.components.length === 1) return <Facts c={spec.components[0]!} />;
  return (
    <div className="ix-comps">
      {spec.components.map((c, i) => {
        const img = parseImage(c.repotag);
        return (
          <Disclosure
            compact
            index={i}
            key={c.name}
            title={<span className="ix-mono">{c.name}</span>}
            summary={
              <span>
                {img ? `${img.repository.split('/').pop()}:${img.tag}` : 'Unknown image'} · {c.cpu} CPU ·{' '}
                {formatInt(c.ram_mb)} MB · {formatInt(c.hdd_gb)} GB
              </span>
            }
            open={open.isOpen(c.name)}
            onToggle={(v) => open.setOpen(c.name, v)}
          >
            <Facts c={c} />
          </Disclosure>
        );
      })}
    </div>
  );
}

/** Where the network may place instances: geographic rules, host requirements and pinned nodes. */
export function PlacementBody() {
  const { detail } = useAppCtx();
  const { spec } = detail;
  const allowed = spec.geolocation.filter((r) => r.allow);
  const forbidden = spec.geolocation.filter((r) => !r.allow);
  const any =
    spec.geolocation.length === 0 && !spec.static_ip && spec.datacenter === null && spec.nodes.length === 0;
  const place = (r: GeoRule) => `${r.allow}:${r.continent}:${r.country}:${r.region}`;
  return (
    <div className="ix-place">
      {allowed.length ? (
        <div className="ix-place-group">
          <span className="ix-cap">Only in</span>
          <div className="ix-chips">
            {allowed.map((r) => (
              <Chip key={place(r)} data-status="ok" icon={<Check size={12} strokeWidth={2} />}>
                {describeGeoPlace(r)}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}
      {forbidden.length ? (
        <div className="ix-place-group">
          <span className="ix-cap">Never in</span>
          <div className="ix-chips">
            {forbidden.map((r) => (
              <Chip key={place(r)} data-status="crit" icon={<Ban size={12} strokeWidth={2} />}>
                {describeGeoPlace(r)}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}
      {spec.static_ip || spec.datacenter !== null ? (
        <div className="ix-chips">
          {spec.static_ip ? <Chip>Static IP required</Chip> : null}
          {spec.datacenter === true ? <Chip>Datacenter hosts only</Chip> : null}
          {spec.datacenter === false ? <Chip>Any kind of host</Chip> : null}
        </div>
      ) : null}
      {spec.nodes.length ? (
        <div className="ix-place-group">
          <span className="ix-cap">Pinned to these hosts</span>
          <div className="ix-chips">
            {spec.nodes.map((ip) => (
              <HostLink key={ip} ip={ip.split(':')[0] ?? ip} className="ix-chip" data-mono="">
                {ip}
              </HostLink>
            ))}
          </div>
        </div>
      ) : null}
      {any ? (
        <p className="ix-cap">No placement rules: any node may run an instance.</p>
      ) : (
        <p className="ix-cap">
          The owner set these rules in the specification; the network follows them when it picks nodes.
        </p>
      )}
    </div>
  );
}

/** Owner, description, contacts and the identifiers of the current spec. */
export function OwnerBody() {
  const { detail } = useAppCtx();
  const { spec } = detail;
  const url = defaultAppDomain(detail.name);
  return (
    <>
      {spec.description ? <p className="ix-desc">{spec.description}</p> : null}
      <Kv>
        <KvRow label="Owner">
          <AddressLink addr={spec.owner} className="ix-trunc" title="Open the address">
            {middleTruncate(spec.owner, 8, 5)}
          </AddressLink>
          <CopyButton value={spec.owner} label="Copy the owner" />
        </KvRow>
        <KvRow label="Address" sans>
          <a href={`https://${url}`} target="_blank" rel="noopener noreferrer" className="ix-link ix-trunc">
            {url} <ExternalLink size={11} strokeWidth={1.75} aria-hidden="true" />
          </a>
        </KvRow>
        <KvRow label="Contacts" sans>
          {spec.contacts.length ? `${plural(spec.contacts.length, 'contact')}, not shown` : 'None listed'}
        </KvRow>
        <KvRow label="Spec hash">
          {detail.spec_hash ? (
            <>
              <span className="ix-trunc" title={detail.spec_hash}>
                {middleTruncate(detail.spec_hash, 8, 6)}
              </span>
              <CopyButton value={detail.spec_hash} label="Copy the spec hash" />
            </>
          ) : (
            'Unknown'
          )}
        </KvRow>
        <KvRow label="Registered">
          {detail.registered_height ? (
            <>
              block{' '}
              <BlockLink height={detail.registered_height} className="ix-mono">
                {formatInt(detail.registered_height)}
              </BlockLink>
            </>
          ) : (
            'Unknown'
          )}
        </KvRow>
        <KvRow label="Last update">
          block{' '}
          <BlockLink height={detail.height} className="ix-mono">
            {formatInt(detail.height)}
          </BlockLink>
        </KvRow>
        <KvRow label="Expires">
          block <span className="ix-mono">{formatInt(detail.expire_height)}</span>
        </KvRow>
      </Kv>
    </>
  );
}
