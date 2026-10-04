// How spread out the network is, in two measures: the Nakamoto coefficient (the fewest countries, providers or
// operators that together run more than half of the nodes) as three figures, and the Herfindahl-Hirschman index of the
// countries and the providers on a gauge cut in three bands. Under them a plain-language reading says what the numbers
// mean together. It is an observation, not a verdict: nodes concentrated in a few places are a risk to uptime, and
// that is not the same as control. While it loads, the panel draws the same figures with made-up numbers.

import { Scale } from 'lucide-react';
import { type CSSProperties, useMemo } from 'react';
import { useNetworkDecentralization } from '../../../api/queries';
import { formatInt } from '../../../lib/format';
import { HubLink, HubPanel, type PanelState } from '..';
import { type DecentralModel, decentralModel, type HhiFigure } from './lib/decentral';
import { GHOST_DECENTRAL } from './lib/placeholders';
import { Redact } from './Redact';
import './panels.css';

function Gauge({ h }: { h: HhiFigure }) {
  return (
    <span
      className="nd-gauge"
      role="img"
      aria-label={`${h.label}: HHI ${h.text}, ${h.word}`}
      style={{ '--at': h.at } as CSSProperties}
    >
      <i data-band="low" />
      <i data-band="moderate" />
      <i data-band="high" />
      <span className="nd-gauge__at" />
    </span>
  );
}

function Figures({ model }: { model: DecentralModel }) {
  return (
    <div className="nd-dc">
      <div>
        <ul className="nd-dc__nak" aria-label="The fewest that together run more than half of all nodes">
          {model.nakamoto.map((f) => (
            <li key={f.id}>
              <b>{formatInt(f.n)}</b>
              <span>{f.noun}</span>
            </li>
          ))}
        </ul>
        <p className="nd-dc__lead">
          The fewest of each that together run more than half of all nodes (the Nakamoto coefficient)
        </p>
      </div>
      <ul className="nd-dc__hhi" aria-label="Concentration of nodes, Herfindahl-Hirschman index">
        {model.hhi.map((h) => (
          <li key={h.id} data-band={h.band}>
            <span className="nd-dc__hhi-head">
              <span>{h.label}</span>
              <b>{h.text}</b>
              <small>{h.word}</small>
            </span>
            <Gauge h={h} />
          </li>
        ))}
      </ul>
      <p className="nd-dc__reading">{model.reading}</p>
    </div>
  );
}

export function DecentralizationPanel() {
  const q = useNetworkDecentralization();
  const model = useMemo(() => (q.data ? decentralModel(q.data) : null), [q.data]);
  const loading = q.isPending;
  const state: PanelState = q.data ? (model ? 'ready' : 'empty') : loading ? 'ready' : 'error';

  return (
    <HubPanel
      id="nd-decentral"
      span="half"
      title="Decentralization"
      icon={Scale}
      aside={model ? `${formatInt(model.operators)} operators` : undefined}
      state={state}
      aria-busy={loading || undefined}
      error={q.error}
      onRetry={() => void q.refetch()}
      retrying={q.isFetching}
      errorTitle="Could not load the figures"
      errorText="They are computed by this server from the node list; try again in a moment."
      emptyIcon={Scale}
      emptyTitle="Nothing to measure yet"
      emptyText="The server has no confirmed nodes to measure."
      footer={
        <>
          <HubLink to={{ type: 'analytics', key: 'fairness' }}>Open fairness in analytics</HubLink>
          <span className="nd-foot-note">Fewer means more concentrated</span>
        </>
      }
    >
      {model ? (
        <Figures model={model} />
      ) : loading ? (
        <Redact>
          <Figures model={GHOST_DECENTRAL} />
        </Redact>
      ) : null}
    </HubPanel>
  );
}
