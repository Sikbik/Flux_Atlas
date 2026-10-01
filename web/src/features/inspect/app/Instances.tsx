import { ChevronRight, Loader } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { AppInstanceDto } from '../../../api/generated/AppInstanceDto';
import { useRuntime } from '../../../app/context';
import { formatAgo } from '../../../lib/format';
import { countryName } from '../derive/appSpec';
import { readNodeLive } from '../sources/live';
import { Chip, NodeLink, TierGlyph, tierLabel, VirtualList } from '../ui';
import { useAppCtx } from './context';

const ROW = 46;
const VIRTUAL_FROM = 24;

/** Keys that appeared after the first render, for a highlight that plays once as a row arrives. */
function useArrivals(keys: readonly string[]): ReadonlySet<string> {
  const seen = useRef<Map<string, number> | null>(null);
  const now = Date.now();
  if (seen.current === null) {
    seen.current = new Map(keys.map((k) => [k, 0]));
  } else {
    for (const k of keys) if (!seen.current.has(k)) seen.current.set(k, now);
  }
  const fresh = new Set<string>();
  for (const [k, t] of seen.current) if (t > 0 && now - t < 2400) fresh.add(k);
  // Forget keys that left, so a node that returns later is announced again.
  useEffect(() => {
    const live = new Set(keys);
    for (const k of seen.current?.keys() ?? []) if (!live.has(k)) seen.current?.delete(k);
  });
  return fresh;
}

interface Row {
  key: string;
  kind: 'instance' | 'installing';
  endpoint: string;
  inst?: AppInstanceDto;
  sinceMs: number | null;
}

/** Every instance of the app, newest first, with installs in progress on top. Updates as nodes come and go. */
export function InstancesBody() {
  const { detail, live } = useAppCtx();
  const { store, clock } = useRuntime();
  const now = clock.now();

  const rows: Row[] = [
    ...live.installing.map<Row>((e) => ({
      key: `i:${e.node ?? e.endpoint}`,
      kind: 'installing',
      endpoint: e.endpoint,
      sinceMs: e.sinceMs,
    })),
    ...[...detail.instances]
      .sort((a, b) => (b.running_since_ms ?? 0) - (a.running_since_ms ?? 0))
      .map<Row>((inst) => ({
        key: `n:${inst.node ?? inst.endpoint}`,
        kind: 'instance',
        endpoint: inst.endpoint,
        inst,
        sinceMs: inst.running_since_ms,
      })),
  ];
  const fresh = useArrivals(rows.map((r) => r.key));

  const render = (r: Row) => {
    const n = r.inst?.node != null ? readNodeLive(store, r.inst.node) : null;
    const tier = n?.tier ?? 'unknown';
    const older = r.inst && detail.spec_hash && r.inst.spec_hash && r.inst.spec_hash !== detail.spec_hash;
    const country = r.inst?.country_code ? countryName(r.inst.country_code) : null;
    const since = r.sinceMs ? formatAgo(now - r.sinceMs) : null;
    const body = (
      <>
        <span className="ix-hrow-glyph">
          {r.kind === 'installing' ? (
            <Loader size={16} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <TierGlyph tier={tier} size={16} />
          )}
        </span>
        <span className="ix-hrow-main">
          <b className="ix-mono ix-irow-ep">{r.endpoint}</b>
          <span className="ix-hrow-sub">
            {r.kind === 'installing'
              ? `Installing${since ? `, started ${since}` : ''}`
              : [tier !== 'unknown' ? tierLabel(tier) : null, country, since ? `up ${since}` : null]
                  .filter(Boolean)
                  .join(' · ')}
          </span>
        </span>
        {older ? (
          <Chip size="sm" title="This instance still runs the previous spec during a rolling update">
            previous spec
          </Chip>
        ) : null}
        {r.kind === 'instance' ? (
          <ChevronRight className="ix-hrow-chev" size={15} strokeWidth={1.75} aria-hidden="true" />
        ) : null}
      </>
    );
    const attrs = { 'data-tier': tier, 'data-new': fresh.has(r.key) || undefined } as const;
    return r.kind === 'instance' ? (
      <NodeLink nodeKey={r.endpoint} className="ix-hrow ix-irow" {...attrs}>
        {body}
      </NodeLink>
    ) : (
      <div className="ix-hrow ix-irow" data-pending="" {...attrs}>
        {body}
      </div>
    );
  };

  if (rows.length === 0) {
    return <p className="ix-cap">No node runs this app right now.</p>;
  }
  return rows.length > VIRTUAL_FROM ? (
    <VirtualList
      items={rows}
      rowHeight={ROW}
      height={Math.min(rows.length, 7) * ROW}
      keyOf={(r) => r.key}
      label={`Instances of ${detail.display_name}`}
      className="ix-ilist"
      renderRow={render}
    />
  ) : (
    <ul className="ix-ilist ix-ilist-plain" aria-label={`Instances of ${detail.display_name}`}>
      {rows.map((r) => (
        <li key={r.key} className="ix-ilist-cell">
          {render(r)}
        </li>
      ))}
    </ul>
  );
}
