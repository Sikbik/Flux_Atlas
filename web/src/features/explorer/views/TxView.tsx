// /tx/$txid: where the value went. A hero amount, ten hexagons of finality, and a flow diagram of
// inputs, outputs, change and fee; Flux annotations for node and app transactions; every input and
// output with its spender; the raw record. A pending transaction is outlined and watched: it fills in
// the moment its block lands, with no reload.

import { ArrowLeftRight, Boxes, Clock, Coins, Layers, Server } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { NodeTxDto } from '../../../api/generated/NodeTxDto';
import type { TxDetailDto } from '../../../api/generated/TxDetailDto';
import { useNetwork, usePendingApps } from '../../../app/context';
import { formatBytes, formatInt, formatSats, formatUtcDateTime, parseFlux } from '../../../lib/format';
import { FlowDiagram } from '../flow/FlowDiagram';
import { isNotFound, useTxData } from '../hooks/useExplorerData';
import { payoutSchedule } from '../lib/emission';
import { buildFlow } from '../lib/txflow';
import { NODE_TX_KINDS, TX_KINDS } from '../lib/txkinds';
import {
  Amount,
  Chip,
  ConfirmationGauge,
  CopyButton,
  EmptyState,
  EntityHead,
  EntityLink,
  ErrorState,
  Hash,
  HeroAmount,
  KeyValue,
  LiveBadge,
  RelativeTime,
  Section,
  Skeleton,
  TabPanel,
  Tabs,
  TierChip,
  type TierName,
} from '../parts';
import { JsonView } from '../parts/JsonView';
import { AddressTag, NodeLink } from './shared';
import './tx.css';

type TabId = 'overview' | 'io' | 'raw';

function kindHead(tx: TxDetailDto): { kind: string; icon: typeof ArrowLeftRight } {
  switch (tx.kind) {
    case 'coinbase':
      return { kind: 'Coinbase transaction', icon: Coins };
    case 'app_message':
      return { kind: 'App payment', icon: Boxes };
    case 'node_start':
    case 'node_confirm':
    case 'node_tx':
      return { kind: 'Fluxnode transaction', icon: Server };
    default:
      return { kind: 'Transaction', icon: ArrowLeftRight };
  }
}

/** What the headline number is: value moved to others, the reward, or a word for value-less transactions. */
function useHero(tx: TxDetailDto): { sats: bigint | null; word: string | null; sentence: string } {
  return useMemo(() => {
    const model = buildFlow(tx);
    const node = tx.node_tx;
    if (tx.kind === 'node_start' || tx.kind === 'node_confirm' || tx.kind === 'node_tx') {
      const w = node ? NODE_TX_KINDS[node.kind].label : TX_KINDS[tx.kind].label;
      return { sats: null, word: w, sentence: node ? NODE_TX_KINDS[node.kind].hint : TX_KINDS[tx.kind].hint };
    }
    if (model.coinbase) {
      return {
        sats: model.valueOutSats,
        word: null,
        sentence: 'The reward of this block, paid out to one node per tier and the dev fund.',
      };
    }
    let sent = 0n;
    let recipients = 0;
    let change = 0;
    for (const c of model.outputs) {
      if (c.role === 'change') change += c.indices.length;
      else {
        sent += c.sats ?? 0n;
        recipients += c.folded ? c.indices.length : 1;
      }
    }
    if (model.selfTransfer || recipients === 0) {
      return {
        sats: model.valueOutSats,
        word: null,
        sentence: 'Moved between addresses of the same sender; nothing left the wallet.',
      };
    }
    const to = `${formatInt(recipients)} ${recipients === 1 ? 'recipient' : 'recipients'}`;
    const kindNote =
      tx.kind === 'app_message'
        ? 'Pays for an app message.'
        : change > 0
          ? 'The rest returns to the sender as change.'
          : '';
    return { sats: sent, word: null, sentence: `Sent to ${to}. ${kindNote}`.trim() };
  }, [tx]);
}

function TxSkeleton() {
  return (
    <div className="ex-root" role="status" aria-busy="true" aria-label="Loading transaction">
      <EntityHead
        kind="Transaction"
        icon={ArrowLeftRight}
        title={<Skeleton w={260} h={46} radius={8} />}
        loading
      >
        <Skeleton w={200} h={22} radius={11} />
        <Skeleton w={110} h={22} radius={11} />
        <Skeleton w={170} h={22} radius={11} />
      </EntityHead>
      <div style={{ padding: '0 var(--ex-pad)' }}>
        <Skeleton h={36} radius={10} style={{ margin: '14px 0' }} />
      </div>
      <Section title="Where the value went">
        <Skeleton h={230} radius={14} />
      </Section>
    </div>
  );
}

function NodeTxCard({ n }: { n: NodeTxDto }) {
  const info = NODE_TX_KINDS[n.kind];
  const tier = (n.benchmark_tier ?? 'unknown') as TierName | 'unknown';
  return (
    <Section title="Fluxnode transaction" icon={Server} aside={info.label}>
      <p className="ex-note">{info.hint}</p>
      <KeyValue
        items={[
          {
            label: 'Node',
            value: <NodeLink id={n.node} fallbackEndpoint={n.endpoint} fallbackTier={n.benchmark_tier} />,
          },
          {
            label: 'Collateral',
            value: (
              <span className="ex-hashrow">
                {n.collateral}
                <CopyButton value={n.collateral} what="collateral" />
              </span>
            ),
            mono: true,
          },
          { label: 'Benchmark tier', value: n.benchmark_tier ? <TierChip tier={tier} /> : null },
          { label: 'Signed', value: formatUtcDateTime(n.sig_time_ms) },
          { label: 'Version', value: formatInt(n.tx_version), mono: true },
          { label: 'Collateral type', value: n.p2sh ? 'P2SH (multisig capable)' : 'P2PKH' },
        ]}
      />
    </Section>
  );
}

function AppMessageCard({ tx }: { tx: TxDetailDto }) {
  const pending = usePendingApps();
  const payload = tx.outputs.find((o) => o.op_return)?.op_return ?? null;
  const known = payload ? pending.find((p) => p.hash === payload) : undefined;
  return (
    <Section title="App message" icon={Boxes} aside={known ? known.kind : undefined}>
      <p className="ex-note">
        An app message registers, renews or updates an app on the network. Its hash rides in the data output;
        the app's node specification is stored separately.
      </p>
      <KeyValue
        items={[
          {
            label: 'Message hash',
            value: payload ? <Hash value={payload} full copy="hover" what="message hash" /> : null,
            mono: true,
          },
          {
            label: 'App',
            value: known ? (
              <EntityLink kind="app" value={known.app}>
                {known.app}
              </EntityLink>
            ) : (
              <span className="ex-muted">Not recorded in this transaction</span>
            ),
          },
        ]}
      />
    </Section>
  );
}

function CoinbaseCard({ tx }: { tx: TxDetailDto }) {
  const sched = tx.height !== null ? payoutSchedule(tx.height) : null;
  if (!sched) return null;
  const rows: [string, bigint, TierName | null][] = [
    ['Stratus', sched.stratus, 'stratus'],
    ['Nimbus', sched.nimbus, 'nimbus'],
    ['Cumulus', sched.cumulus, 'cumulus'],
  ];
  return (
    <Section
      title="How this reward is split"
      icon={Layers}
      aside={`subsidy ${formatSats(sched.subsidy, { decimals: 2 })}`}
    >
      <p className="ex-note">
        Every output of a Proof of Node coinbase is recognised by its amount. One node per tier is paid its
        tier's share of the subsidy; the dev fund receives the remainder plus the fees of the block.
      </p>
      <KeyValue
        items={[
          ...rows.map(([label, sats, tier]) => ({
            label,
            value: (
              <span className="ex-tierrow">
                <TierChip tier={tier} label={label} size="sm" />
                <Amount value={sats} decimals={2} />
              </span>
            ),
          })),
          { label: 'Dev fund (minimum)', value: <Amount value={sched.devFundMin} decimals={2} /> },
        ]}
      />
    </Section>
  );
}

function IoRows({ tx }: { tx: TxDetailDto }) {
  const coinbase = tx.kind === 'coinbase' || tx.inputs.some((i) => i.coinbase);
  return (
    <div className="ex-io">
      <Section title="Inputs" aside={formatInt(tx.inputs.length)}>
        {tx.inputs.length === 0 ? (
          <p className="ex-muted">
            {tx.kind === 'node_start' || tx.kind === 'node_confirm' || tx.kind === 'node_tx'
              ? 'A fluxnode transaction spends nothing: it is signed by the node collateral.'
              : 'The explorer did not list any inputs.'}
          </p>
        ) : (
          <ol className="ex-iolist">
            {tx.inputs.map((inp, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: inputs are positional
              <li key={i} className="ex-iorow">
                <span className="ex-iorow__n">{i}</span>
                <div className="ex-iorow__main">
                  {coinbase || inp.coinbase ? (
                    <span>Newly issued coins</span>
                  ) : (
                    <AddressTag address={inp.address} />
                  )}
                  {inp.prev_txid ? (
                    <span className="ex-iorow__sub">
                      spends output {inp.prev_vout} of <EntityLink kind="tx" value={inp.prev_txid} />
                    </span>
                  ) : null}
                </div>
                <Amount value={inp.value} exact />
              </li>
            ))}
          </ol>
        )}
      </Section>
      <Section title="Outputs" aside={formatInt(tx.outputs.length)}>
        <ol className="ex-iolist">
          {tx.outputs.map((o) => (
            <li key={o.n} className="ex-iorow">
              <span className="ex-iorow__n">{o.n}</span>
              <div className="ex-iorow__main">
                {o.script_type === 'nulldata' || (o.address === null && o.op_return !== null) ? (
                  <span className="ex-iorow__data">
                    Data output <code>{o.op_return ?? 'binary'}</code>
                  </span>
                ) : (
                  <AddressTag address={o.address} />
                )}
                <span className="ex-iorow__sub">
                  {o.script_type ? <Chip size="sm">{o.script_type}</Chip> : null}
                  {o.spent_txid ? (
                    <span>
                      spent in <EntityLink kind="tx" value={o.spent_txid} />
                      {o.spent_height !== null ? (
                        <>
                          {' '}
                          at block <EntityLink kind="block" value={o.spent_height} />
                        </>
                      ) : null}
                    </span>
                  ) : o.script_type === 'nulldata' ? null : (
                    <span className="ex-iorow__unspent">
                      <i aria-hidden="true" /> unspent
                    </span>
                  )}
                </span>
              </div>
              <Amount value={o.value} exact />
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

export function TxView({ txid }: { txid: string }) {
  const q = useTxData(txid);
  const [tab, setTab] = useState<TabId>('overview');
  const firstSeen = useNetwork((s) => s.mempool.get(txid)?.firstSeenMs ?? null);
  const tx = q.data;

  const hero = useHero(tx ?? EMPTY_TX);
  if (q.isPending) return <TxSkeleton />;
  if (!tx) {
    if (isNotFound(q.error)) {
      return (
        <div className="ex-root">
          <EmptyState icon={ArrowLeftRight} title="No such transaction">
            The chain and the mempool this server follows have no transaction with this id. A transaction that
            was just broadcast can take a moment to appear; this page will not refresh by itself, so open it
            again shortly.
          </EmptyState>
        </div>
      );
    }
    return (
      <div className="ex-root">
        <ErrorState title="Could not load this transaction" onRetry={() => void q.refetch()}>
          The explorer did not answer. The transaction is fine; try again in a moment.
        </ErrorState>
      </div>
    );
  }

  const head = kindHead(tx);
  const pending = q.pending;
  const final = !pending && q.confirmations >= 10;
  const feeSats = parseFlux(tx.fee);
  const rate = feeSats !== null && tx.size > 0 ? Number(feeSats) / tx.size : null;
  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'io' as const, label: 'Inputs and outputs', badge: `${tx.inputs.length}/${tx.outputs.length}` },
    { id: 'raw' as const, label: 'Raw' },
  ];
  const tabsId = `tx-${txid.slice(0, 8)}`;

  return (
    <div className="ex-root">
      <EntityHead
        kind={head.kind}
        icon={head.icon}
        status={pending ? 'pending' : 'ok'}
        aside={final ? null : <LiveBadge label={pending ? 'Watching the mempool' : 'Following the chain'} />}
        title={
          hero.sats !== null ? (
            <HeroAmount sats={hero.sats} decimals={hero.sats % 1_000_000n === 0n ? 2 : 8} />
          ) : (
            <span className="ex-head__word">{hero.word}</span>
          )
        }
        sub={
          <>
            <span>{hero.sentence}</span>
            <Hash value={tx.txid} full copy="always" what="transaction id" />
          </>
        }
      >
        <ConfirmationGauge confirmations={q.confirmations} pending={pending} />
        <Chip>{TX_KINDS[tx.kind].label}</Chip>
        {tx.height !== null ? (
          <Chip>
            Block <EntityLink kind="block" value={tx.height} />
          </Chip>
        ) : null}
        {tx.time_ms !== null ? (
          <Chip icon={Clock}>
            {formatUtcDateTime(tx.time_ms)} <RelativeTime ts={tx.time_ms} />
          </Chip>
        ) : firstSeen !== null ? (
          <Chip icon={Clock}>
            Seen <RelativeTime ts={firstSeen} />
          </Chip>
        ) : (
          <Chip icon={Clock}>In the mempool</Chip>
        )}
        {feeSats !== null && feeSats > 0n ? (
          <Chip mono title={rate === null ? undefined : `${rate.toFixed(1)} sat per byte`}>
            fee <Amount value={feeSats} decimals={8} unit={false} />
          </Chip>
        ) : null}
        {tx.size > 0 ? <Chip mono>{formatBytes(tx.size)}</Chip> : null}
      </EntityHead>

      <Tabs items={tabs} value={tab} onChange={setTab} label="Transaction sections" id={tabsId} />

      {tab === 'overview' ? (
        <TabPanel tabsId={tabsId} id="overview">
          {tx.outputs.length > 0 || tx.inputs.length > 0 ? (
            <Section title="Where the value went" aside="band width is proportional to the amount">
              <FlowDiagram tx={tx} pending={pending} />
            </Section>
          ) : null}
          {tx.node_tx ? <NodeTxCard n={tx.node_tx} /> : null}
          {tx.kind === 'app_message' ? <AppMessageCard tx={tx} /> : null}
          {tx.kind === 'coinbase' ? <CoinbaseCard tx={tx} /> : null}
          <Section title="Details" collapsible defaultOpen={false}>
            <KeyValue
              items={[
                {
                  label: 'Transaction id',
                  value: <Hash value={tx.txid} full copy="hover" what="transaction id" />,
                },
                {
                  label: 'Block',
                  value:
                    tx.height !== null ? (
                      <EntityLink kind="block" value={tx.height} />
                    ) : (
                      <span className="ex-muted">Pending</span>
                    ),
                },
                {
                  label: 'Block hash',
                  value: tx.block_hash ? (
                    <Hash value={tx.block_hash} full copy="hover" what="block hash" />
                  ) : null,
                },
                { label: 'Version', value: formatInt(tx.version), mono: true },
                {
                  label: 'Value in',
                  value: tx.value_in === null ? null : <Amount value={tx.value_in} exact />,
                },
                { label: 'Value out', value: <Amount value={tx.value_out} exact /> },
              ]}
            />
          </Section>
        </TabPanel>
      ) : tab === 'io' ? (
        <TabPanel tabsId={tabsId} id="io">
          <IoRows tx={tx} />
        </TabPanel>
      ) : (
        <TabPanel tabsId={tabsId} id="raw">
          <Section>
            <JsonView value={tx} label="Transaction record, as served" />
          </Section>
        </TabPanel>
      )}
      <span className="ex-sr" aria-live="polite">
        {pending ? 'Waiting for the next block' : final ? 'Confirmed' : `${q.confirmations} confirmations`}
      </span>
    </div>
  );
}

const EMPTY_TX: TxDetailDto = {
  txid: '',
  height: null,
  block_hash: null,
  time_ms: null,
  confirmations: 0,
  size: 0,
  version: 0,
  kind: 'unknown',
  inputs: [],
  outputs: [],
  value_in: null,
  value_out: '0',
  fee: null,
  node_tx: null,
};
