// Expected against received: a queue pays every node in turn, so over a few weeks a fleet should have been paid about
// as many times as the queues said it would. The two counts side by side say whether it was, and the nodes paid short
// say where the difference came from. Luck either way is normal; only a real shortfall is news.

import { formatInt, formatPercent, shortCollateral } from '../../../../lib/format';
import { BarList, EntityLink, StatusChip } from '../../../../ui';
import { useWalletCtx } from '../../context';
import { formatDate } from '../../lib/dates';
import { missedRows, PAYMENT_VERDICT, paymentHealth } from '../../lib/earnings';
import { Panel } from '../../ui/Panel';

const STATUS = {
  ok: 'confirmed',
  pending: 'at-risk',
  warn: 'degraded',
  crit: 'error',
  off: 'unknown',
} as const;
const SHOWN = 6;

export function ExpectedReceived() {
  const { dto, fleet } = useWalletCtx();
  const e = dto.earnings;
  const health = paymentHealth(e);
  const rows = missedRows(e.missed);
  const verdict = PAYMENT_VERDICT[health.verdict];
  const byKey = new Map(fleet.rows.map((r) => [r.key, r]));

  if (health.expected <= 0) {
    return (
      <Panel title="Expected and received payments">
        <p className="wl-note">
          There is not enough history to say how many payments this wallet should have received yet. A node is
          paid once per cycle of its tier, so a few weeks of records are needed before the comparison means
          anything.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Expected and received payments"
      aside={e.covered_from_ms ? `since ${formatDate(e.covered_from_ms)}` : undefined}
      actions={<StatusChip status={STATUS[verdict.tone]} label={verdict.label} size="sm" />}
    >
      <BarList
        label="Payments expected and received"
        total={Math.max(health.expected, health.received)}
        items={[
          {
            id: 'expected',
            label: 'Expected',
            value: health.expected,
            display: formatInt(health.expected),
            color: 'var(--ink-5)',
          },
          {
            id: 'received',
            label: 'Received',
            value: health.received,
            display: formatInt(health.received),
            detail: health.rate === null ? undefined : formatPercent(health.rate, 1),
            color: 'var(--viz-1)',
          },
        ]}
      />
      <p className="wl-note">
        {health.shortfall > 0 ? (
          <>
            <b>{formatInt(health.shortfall)}</b> fewer than the queues owed, over {formatInt(rows.length)}{' '}
            {rows.length === 1 ? 'node' : 'nodes'}.{' '}
          </>
        ) : (
          'Nothing is owed. '
        )}
        Payments come in turn, so a few percent either way is luck, not a fault.
      </p>

      {rows.length > 0 ? (
        <div className="wl-missed">
          <h3 className="wl-sub">Paid less often than expected</h3>
          <ol aria-label="Nodes paid less often than expected, the largest shortfall first">
            {rows.slice(0, SHOWN).map((r) => {
              const node = byKey.get(r.key);
              return (
                <li key={r.key}>
                  <EntityLink kind="node" value={r.key} mono className="wl-missed__node">
                    {node?.endpoint || shortCollateral(r.key)}
                  </EntityLink>
                  <span className="wl-missed__bar" aria-hidden="true">
                    <i style={{ width: `${Math.max(3, r.share * 100).toFixed(1)}%` }} />
                  </span>
                  <span className="wl-missed__n ui-mono">
                    {formatInt(r.received)} of {formatInt(r.expected)}
                  </span>
                </li>
              );
            })}
          </ol>
          {rows.length > SHOWN ? (
            <p className="wl-note">
              And {formatInt(rows.length - SHOWN)} more, each with a smaller shortfall.
            </p>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
