// The spec of an app, one fold at a time: its components (one tab each), where the network may place
// instances, and who owns it. An enterprise app is encrypted, so only the public fields appear.

import { Ban, Check, Lock } from 'lucide-react';
import { useId, useState } from 'react';
import type { AppComponent } from '../../../api/generated/AppComponent';
import type { GeoRule } from '../../../api/generated/GeoRule';
import { formatInt } from '../../../lib/format';
import {
  Chip,
  EmptyState,
  EntityLink,
  Hash,
  Height,
  KeyValue,
  type KeyValueItem,
  TabPanel,
  Tabs,
} from '../../../ui';
import { defaultAppDomain, describeGeoPlace, envNames, parseImage } from '../derive/appSpec';
import { useAppCtx } from './context';
import { plural } from './summary';

function ComponentFacts({ c }: { c: AppComponent }) {
  const img = parseImage(c.repotag);
  const env = envNames(c.environment);
  const domains = c.domains.filter(Boolean);
  const ports = c.ports.map((p, i) => ({ pub: p, inner: c.container_ports[i] }));
  const items: KeyValueItem[] = [
    {
      label: 'Image',
      value: img
        ? img.href
          ? `${img.repository}:${img.tag}`
          : `${img.registry}/${img.repository}:${img.tag}`
        : null,
      ...(img?.href ? { href: img.href } : null),
      mono: true,
    },
    {
      label: 'Resources',
      value: `${c.cpu} CPU · ${formatInt(c.ram_mb)} MB RAM · ${formatInt(c.hdd_gb)} GB disk`,
      mono: true,
    },
  ];
  if (ports.length) {
    items.push({
      label: 'Ports',
      value: ports.map((p) => (p.inner ? `${p.pub} to ${p.inner}` : String(p.pub))).join(', '),
      mono: true,
    });
  }
  if (domains.length) items.push({ label: 'Domains', value: domains.join(', '), mono: true });
  if (c.container_data) items.push({ label: 'Data', value: c.container_data, mono: true });
  if (c.commands.length) items.push({ label: 'Commands', value: plural(c.commands.length, 'command') });
  return (
    <div className="ix-comp">
      {c.description ? <p className="ix-app-desc">{c.description}</p> : null}
      <KeyValue align="start" items={items} />
      {env.length ? (
        <div className="ix-chipgroup">
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

/** The containers of the app: a single component shows straight away, several get a tab each. */
export function ComponentsPanel() {
  const { detail } = useAppCtx();
  const { spec } = detail;
  const tabsId = useId();
  const [picked, setPicked] = useState<string | null>(null);
  if (spec.enterprise) {
    return (
      <EmptyState compact icon={Lock} title="Encrypted enterprise app">
        Enterprise apps keep their components private; only the public fields (owner, instance count, expiry
        and placement) can be shown.
      </EmptyState>
    );
  }
  const comps = spec.components;
  if (comps.length === 0) return <p className="ix-cap">This spec lists no components.</p>;
  const first = comps[0] as AppComponent;
  if (comps.length === 1) return <ComponentFacts c={first} />;
  const value = comps.some((c) => c.name === picked) ? (picked as string) : first.name;
  return (
    <div className="ix-comps">
      <Tabs
        size="sm"
        id={tabsId}
        aria-label="Components"
        items={comps.map((c) => ({ id: c.name, label: c.name }))}
        value={value}
        onChange={setPicked}
      />
      {comps.map((c) => (
        <TabPanel key={c.name} tabsId={tabsId} id={c.name} value={value} className="ix-comps-panel">
          <ComponentFacts c={c} />
        </TabPanel>
      ))}
    </div>
  );
}

/** Where the network may place instances: geographic rules, host requirements and pinned nodes. */
export function PlacementPanel() {
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
        <div className="ix-chipgroup">
          <span className="ix-cap">Only in</span>
          <div className="ix-chips">
            {allowed.map((r) => (
              <Chip key={place(r)} data-status="ok" icon={Check}>
                {describeGeoPlace(r)}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}
      {forbidden.length ? (
        <div className="ix-chipgroup">
          <span className="ix-cap">Never in</span>
          <div className="ix-chips">
            {forbidden.map((r) => (
              <Chip key={place(r)} data-status="crit" icon={Ban}>
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
        <div className="ix-chipgroup">
          <span className="ix-cap">Pinned to these hosts</span>
          <div className="ix-chips">
            {spec.nodes.map((ip) => (
              <EntityLink key={ip} kind="host" value={ip.split(':')[0] ?? ip} mono>
                {ip}
              </EntityLink>
            ))}
          </div>
        </div>
      ) : null}
      <p className="ix-cap">
        {any
          ? 'No placement rules: any node may run an instance.'
          : 'The owner set these rules in the specification; the network follows them when it picks nodes.'}
      </p>
    </div>
  );
}

/** Owner, description, contacts and the identifiers of the current spec. */
export function OwnerPanel() {
  const { detail } = useAppCtx();
  const { spec } = detail;
  const url = defaultAppDomain(detail.name);
  return (
    <div className="ix-comp">
      {spec.description ? <p className="ix-app-desc">{spec.description}</p> : null}
      <KeyValue
        align="start"
        items={[
          {
            label: 'Owner',
            value: <EntityLink kind="address" value={spec.owner} copy />,
          },
          { label: 'Address', value: url, href: `https://${url}`, mono: true },
          {
            label: 'Contacts',
            value: spec.contacts.length
              ? `${plural(spec.contacts.length, 'contact')}, not shown`
              : 'None listed',
          },
          {
            label: 'Spec hash',
            value: detail.spec_hash ? (
              <Hash value={detail.spec_hash} head={8} tail={6} what="spec hash" />
            ) : null,
          },
          { label: 'Registered', value: <Height value={detail.registered_height} /> },
          { label: 'Last update', value: <Height value={detail.height} /> },
          { label: 'Expires', value: <Height value={detail.expire_height} link={false} /> },
        ]}
      />
    </div>
  );
}
