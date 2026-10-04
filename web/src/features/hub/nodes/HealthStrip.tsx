// How healthy the confirmed nodes are, as one strip under the hero's figure: healthy, at risk and unreachable in the
// status colours (and nothing else wears them), each with its count. The server counts the three over the confirmed
// nodes and a node can be both at risk and unreachable, so the strip is cut into parts that do not overlap and the
// legend gives the whole of each set. It owns its own states: it reads the nodes overview, which fills slowly after a
// start and can fail without touching the rest of the hero. Every line of it has a fixed height and never wraps, so a
// count that gains a digit moves nothing.

import { type ReactNode, useMemo } from 'react';
import { formatInt } from '../../../lib/format';
import { Button, Freshness } from '../../../ui';
import { shareText } from '../../analytics/lib/concentration';
import { isFilling, useNodesOverview } from '..';
import { GHOST_HEALTH } from './lib/placeholders';
import { type HealthModel, healthModel } from './lib/status';
import { Redact, WaitAside } from './Redact';
import './nodes.css';

/** The heading line and whatever sits at its right, then the body. */
function Frame({ aside, children }: { aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="nd-health">
      <div className="nd-health__head">
        <p className="nd-health__title">Health of confirmed nodes</p>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** The bar and its legend. */
function Strip({ model }: { model: HealthModel }) {
  return (
    <>
      <div className="nd-health__bar" role="img" aria-label={model.summary}>
        {model.parts
          .filter((p) => p.count > 0)
          .map((p) => (
            <i key={p.id} data-tone={p.tone} style={{ flexGrow: p.count }} />
          ))}
      </div>
      <ul className="nd-health__legend" aria-label="Node health, counted over confirmed nodes">
        {model.items.map((i) => (
          <li key={i.id} data-tone={i.tone} title={i.meaning}>
            <span className="nd-health__dot" aria-hidden="true" />
            <span className="nd-health__what">
              <b>{formatInt(i.count)}</b>
              <span>{i.label.toLowerCase()}</span>
            </span>
            <small>
              {shareText(i.share)}
              {i.id === 'unreachable' && model.overlap > 0
                ? `, ${formatInt(model.overlap)} also at risk`
                : ''}
            </small>
          </li>
        ))}
      </ul>
    </>
  );
}

export function HealthStrip() {
  const q = useNodesOverview();
  const model = useMemo(() => (q.data ? healthModel(q.data.status) : null), [q.data]);

  if (q.isPending) {
    return (
      <Frame aside={isFilling(q.failureReason) ? <WaitAside what="The health figures" /> : undefined}>
        <Redact className="nd-health__ghost">
          <Strip model={GHOST_HEALTH} />
        </Redact>
      </Frame>
    );
  }

  if (!q.data) {
    return (
      <Frame>
        <p className="nd-note" role="status" data-tone="warn">
          {isFilling(q.error)
            ? 'The server is still reading the chain tip, so the health of the nodes is not known yet.'
            : 'The health of the nodes could not be loaded.'}
          <Button size="sm" variant="ghost" loading={q.isFetching} onClick={() => void q.refetch()}>
            Try again
          </Button>
        </p>
      </Frame>
    );
  }

  if (!model) {
    return (
      <Frame>
        <p className="nd-note">No confirmed nodes to measure yet.</p>
      </Frame>
    );
  }

  return (
    <Frame aside={<Freshness label="health" ts={q.data.generated_ms} cadenceMs={90_000} />}>
      <Strip model={model} />
    </Frame>
  );
}
