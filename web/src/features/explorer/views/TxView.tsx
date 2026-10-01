// /tx/$txid: where the value went. A hero amount, ten hexagons of finality, and a flow diagram of
// inputs, outputs, change and fee; Flux annotations for node and app transactions; every input and
// output with its spender; the raw record. A pending transaction is outlined and watched: it fills in
// the moment its block lands, with no reload.

import { ArrowLeftRight, Boxes, Clock, Coins, Layers, Server } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { NodeTxDto } from '../../../api/generated/NodeTxDto';
import type { TxDetailDto } from '../../../api/generated/TxDetailDto';
import type { TxInputDto } from '../../../api/generated/TxInputDto';
import type { TxOutputDto } from '../../../api/generated/TxOutputDto';
import { useNetwork, usePendingApps } from '../../../app/context';
import { formatBytes, formatInt, formatSats, formatUtcDateTime, parseFlux } from '../../../lib/format';
import {
  Amount,
  Chip,
  CopyButton,
  DataTable,
  type DataTableColumn,
  EmptyState,
  EntityLink,
  ErrorState,
  Hash,
  KeyValue,
  RelativeTime,
  Row,
  Section,
  Skeleton,
  Stat,
  StatGrid,
  StatusChip,
  TabPanel,
  Tabs,
  TierChip,
  type TierName,
  Unknown,
  ViewHeader,
} from '../../../ui';
import { FlowDiagram } from '../flow/FlowDiagram';
import { ConfirmationGauge } from '../gauge/ConfirmationGauge';
import { isNotFound, useTxData } from '../hooks/useExplorerData';
import { JsonView } from '../json/JsonView';
import { payoutSchedule } from '../lib/emission';
import { buildFlow } from '../lib/txflow';
import { NODE_TX_KINDS, TX_KINDS } from '../lib/txkinds';
import { AddressTag, Dense, NodeLink } from './shared';
import './view.css';

type TabId = 'overview' | 'io' | 'raw';

/** "2,560.00000000" -> "2,560": a headline figure shows the digits that matter, not eight decimals of zeros. */
function trimFlux(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** The fee tile's caption: the rate and the size, or a plain statement when no fee was paid. */
function feeCaption(fee: bigint, size: number): string | undefined {
  const bytes = size > 0 ? formatBytes(size) : null;
  if (fee === 0n) return bytes ? `No fee paid, ${bytes}` : 'No fee paid';
  if (size <= 0) return undefined;
  return `${(Number(fee) / size).toFixed(1)} sat per byte, ${bytes}`;
}

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

interface Hero {
  /** What the figure is ("Sent", "Block reward"). */
  label: string;
  sats: bigint | null;
  word: string | null;
  sentence: string;
}

/** What the headline number is: value moved to others, the reward, or a word for value-less transactions. */
function useHero(tx: TxDetailDto): Hero {
  return useMemo(() => {
    const model = buildFlow(tx);
    const node = tx.node_tx;
    if (tx.kind === 'node_start' || tx.kind === 'node_confirm' || tx.kind === 'node_tx') {
      const w = node ? NODE_TX_KINDS[node.kind].label : TX_KINDS[tx.kind].label;
      return {
        label: 'Action',
        sats: null,
        word: w,
        sentence: node ? NODE_TX_KINDS[node.kind].hint : TX_KINDS[tx.kind].hint,
      };
    }
    if (model.coinbase) {
      return {
        label: 'Block reward',
        sats: model.valueOutSats,
        word: null,
        sentence: 'Paid out to one node per tier and the dev fund.',
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
        label: 'Value moved',
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
    return { label: 'Sent', sats: sent, word: null, sentence: `Sent to ${to}. ${kindNote}`.trim() };
  }, [tx]);
}

function TxSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading transaction">
      <ViewHeader kind="Transaction" icon={ArrowLeftRight} title={<Skeleton w={260} h={26} radius={6} />}>
        <Skeleton w={200} h={22} radius={11} />
        <Skeleton w={110} h={22} radius={11} />
      </ViewHeader>
      <div className="ex-hero">
        <StatGrid min={220}>
          <Stat hero label="Sent" loading />
        </StatGrid>
      </div>
      <Section title="Where the value went">
        <Skeleton h={230} radius={12} />
      </Section>
    </div>
  );
}

function NodeTxCard({ n }: { n: NodeTxDto }) {
  const tier = (n.benchmark_tier ?? 'unknown') as TierName | 'unknown';
  return (
    <Section title="The node" icon={Server}>
      <KeyValue
        align="start"
        items={[
          {
            label: 'Node',
            value: (
              <NodeLink
                id={n.node}
                outpoint={n.collateral}
                fallbackEndpoint={n.endpoint}
                fallbackTier={n.benchmark_tier}
              />
            ),
          },
          { label: 'Collateral', value: <Hash value={n.collateral} full copy="hover" what="collateral" /> },
          { label: 'Benchmark tier', value: n.benchmark_tier ? <TierChip tier={tier} /> : null },
          { label: 'Signed', value: formatUtcDateTime(n.sig_time_ms), mono: true },
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
        align="start"
        items={[
          {
            label: 'Message hash',
            value: payload ? <Hash value={payload} full copy="hover" what="message hash" /> : null,
          },
          {
            label: 'App',
            value: known ? (
              <EntityLink kind="app" value={known.app}>
                {known.app}
              </EntityLink>
            ) : (
              <Unknown>Not recorded in this transaction</Unknown>
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
  const rows: [TierName, bigint][] = [
    ['stratus', sched.stratus],
    ['nimbus', sched.nimbus],
    ['cumulus', sched.cumulus],
  ];
  return (
    <Section
      title="Reward split"
      icon={Layers}
      aside={`subsidy ${formatSats(sched.subsidy, { decimals: 2 })}`}
      collapsible
      defaultOpen={false}
    >
      <p className="ex-note">
        Every output of a Proof of Node coinbase is recognised by its amount. One node per tier is paid its
        tier's share of the subsidy; the dev fund receives the remainder plus the fees of the block.
      </p>
      <KeyValue
        align="start"
        items={[
          ...rows.map(([tier, sats]) => ({
            label: <TierChip tier={tier} size="sm" />,
            value: <Amount value={sats} decimals={2} />,
          })),
          { label: 'Dev fund (minimum)', value: <Amount value={sched.devFundMin} decimals={2} /> },
        ]}
      />
    </Section>
  );
}

// ---- inputs and outputs --------------------------------------------------------------------------

interface InRow {
  n: number;
  input: TxInputDto;
}
interface OutRow {
  n: number;
  output: TxOutputDto;
}

// The address and its amount sit side by side, and the link to the neighbouring transaction comes last:
// on a phone the table scrolls sideways and the amount stays in view.
const indexColumn = { id: 'n', header: '#', numeric: true, width: 56, sticky: false } as const;

function inputColumns(coinbase: boolean): readonly DataTableColumn<InRow>[] {
  return [
    { ...indexColumn, cell: (r) => r.n },
    {
      id: 'from',
      header: 'From',
      cell: (r) =>
        coinbase || r.input.coinbase ? (
          <span className="ex-note">Newly issued coins</span>
        ) : (
          <AddressTag address={r.input.address} />
        ),
      minWidth: 150,
    },
    {
      id: 'amount',
      header: 'Amount',
      numeric: true,
      cell: (r) => <Amount value={r.input.value} exact />,
      minWidth: 160,
    },
    {
      id: 'spends',
      header: 'Spends',
      cell: (r) =>
        r.input.prev_txid ? (
          <span>
            output {r.input.prev_vout} of <EntityLink kind="tx" value={r.input.prev_txid} />
          </span>
        ) : (
          <span className="ex-note">No earlier output</span>
        ),
      minWidth: 210,
    },
  ];
}

const OUTPUT_COLUMNS: readonly DataTableColumn<OutRow>[] = [
  { ...indexColumn, cell: (r) => r.n },
  {
    id: 'to',
    header: 'To',
    cell: (r) => {
      const o = r.output;
      return o.script_type === 'nulldata' || (o.address === null && o.op_return !== null) ? (
        <span>
          Data output <code className="ex-code">{o.op_return ?? 'binary'}</code>
        </span>
      ) : (
        <AddressTag address={o.address} />
      );
    },
    minWidth: 150,
  },
  {
    id: 'amount',
    header: 'Amount',
    numeric: true,
    cell: (r) => <Amount value={r.output.value} exact />,
    minWidth: 160,
  },
  {
    id: 'state',
    header: 'Spent',
    cell: (r) => {
      const o = r.output;
      if (o.spent_txid) {
        return (
          <span>
            in <EntityLink kind="tx" value={o.spent_txid} />
            {o.spent_height !== null ? (
              <>
                {' at '}
                <EntityLink kind="block" value={o.spent_height} />
              </>
            ) : null}
          </span>
        );
      }
      if (o.script_type === 'nulldata') return <span className="ex-note">Not spendable</span>;
      return (
        <Chip size="sm" tone="ghost">
          Unspent
        </Chip>
      );
    },
    minWidth: 210,
  },
];

function IoTables({ tx }: { tx: TxDetailDto }) {
  const coinbase = tx.kind === 'coinbase' || tx.inputs.some((i) => i.coinbase);
  const inRows = useMemo<InRow[]>(() => tx.inputs.map((input, n) => ({ n, input })), [tx.inputs]);
  const outRows = useMemo<OutRow[]>(
    () => tx.outputs.map((output) => ({ n: output.n, output })),
    [tx.outputs],
  );
  const inCols = useMemo(() => inputColumns(coinbase), [coinbase]);
  const nodeTx = tx.kind === 'node_start' || tx.kind === 'node_confirm' || tx.kind === 'node_tx';
  return (
    <>
      <Section title="Inputs" aside={formatInt(tx.inputs.length)} flush>
        {tx.inputs.length === 0 ? (
          <p className="ex-note ex-pad">
            {nodeTx
              ? 'A fluxnode transaction spends nothing: it is signed by the node collateral.'
              : 'The explorer did not list any inputs.'}
          </p>
        ) : (
          <Dense>
            <DataTable
              aria-label="Inputs"
              rows={inRows}
              columns={inCols}
              rowKey={(r) => r.n}
              rowHeight="compact"
              maxHeight={360}
            />
          </Dense>
        )}
      </Section>
      <Section title="Outputs" aside={formatInt(tx.outputs.length)} flush>
        <Dense>
          <DataTable
            aria-label="Outputs"
            rows={outRows}
            columns={OUTPUT_COLUMNS}
            rowKey={(r) => r.n}
            rowHeight="compact"
            maxHeight={360}
          />
        </Dense>
      </Section>
    </>
  );
}

export function TxView({ txid }: { txid: string }) {
  const q = useTxData(txid);
  const [picked, setTab] = useState<TabId>('overview');
  const firstSeen = useNetwork((s) => s.mempool.get(txid)?.firstSeenMs ?? null);
  const tx = q.data;

  const hero = useHero(tx ?? EMPTY_TX);
  if (q.isPending) return <TxSkeleton />;
  if (!tx) {
    if (isNotFound(q.error)) {
      return (
        <EmptyState icon={ArrowLeftRight} title="No such transaction" pattern>
          The chain and the mempool this server follows have no transaction with this id. A transaction that
          was just broadcast can take a moment to appear; this page will not refresh by itself, so open it
          again shortly.
        </EmptyState>
      );
    }
    return (
      <ErrorState error={q.error} title="Could not load this transaction" onRetry={() => void q.refetch()}>
        The explorer did not answer. The transaction is fine; try again in a moment.
      </ErrorState>
    );
  }

  const head = kindHead(tx);
  const pending = q.pending;
  const final = !pending && q.confirmations >= 10;
  const feeSats = parseFlux(tx.fee);
  // A coinbase and a node transaction pay no fee worth a tile; a transfer shows even a zero one.
  const showFee = feeSats !== null && (feeSats > 0n || tx.kind === 'transfer' || tx.kind === 'app_message');
  const hasIo = tx.inputs.length > 0 || tx.outputs.length > 0;
  const tab: TabId = picked === 'io' && !hasIo ? 'overview' : picked;
  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    ...(hasIo
      ? [
          {
            id: 'io' as const,
            label: 'Inputs and outputs',
            badge: `${tx.inputs.length}/${tx.outputs.length}`,
          },
        ]
      : []),
    { id: 'raw' as const, label: 'Raw' },
  ];
  const tabsId = `tx-${txid.slice(0, 8)}`;

  return (
    <div>
      <ViewHeader
        kind={head.kind}
        icon={head.icon}
        title={tx.txid}
        mono
        subtitle={hero.sentence}
        freshness={
          <Row gap={3} wrap={false}>
            {final ? null : (
              <StatusChip
                status={pending ? 'pending' : 'live'}
                label={pending ? 'Watching the mempool' : 'Following the chain'}
              />
            )}
            <CopyButton size="md" value={tx.txid} what="transaction id" />
          </Row>
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
      </ViewHeader>

      <div className="ex-hero">
        <StatGrid min={220}>
          <Stat
            hero
            label={hero.label}
            value={
              hero.sats !== null ? trimFlux(formatSats(hero.sats, { decimals: 8, unit: false })) : hero.word
            }
            unit={hero.sats !== null ? 'FLUX' : undefined}
          />
          {showFee && feeSats !== null ? (
            <Stat
              label="Fee"
              value={trimFlux(formatSats(feeSats, { decimals: 8, unit: false }))}
              unit="FLUX"
              caption={feeCaption(feeSats, tx.size)}
            />
          ) : null}
        </StatGrid>
      </div>

      <div className="ex-tabs">
        <Tabs items={tabs} value={tab} onChange={setTab} aria-label="Transaction sections" id={tabsId} />
      </div>

      <TabPanel tabsId={tabsId} id="overview" value={tab}>
        {hasIo ? (
          <Section title="Where the value went">
            <FlowDiagram tx={tx} pending={pending} />
            <p className="ex-caption">Band width is proportional to the amount.</p>
          </Section>
        ) : null}
        {tx.node_tx ? <NodeTxCard n={tx.node_tx} /> : null}
        {tx.kind === 'app_message' ? <AppMessageCard tx={tx} /> : null}
        {tx.kind === 'coinbase' ? <CoinbaseCard tx={tx} /> : null}
        <Section title="Details" collapsible defaultOpen={false}>
          <KeyValue
            align="start"
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
                    <Unknown>Pending</Unknown>
                  ),
              },
              {
                label: 'Block hash',
                value: tx.block_hash ? (
                  <Hash value={tx.block_hash} full copy="hover" what="block hash" />
                ) : null,
              },
              { label: 'Version', value: formatInt(tx.version), mono: true },
              { label: 'Size', value: tx.size > 0 ? formatBytes(tx.size) : null },
              { label: 'Fee', value: feeSats === null ? null : <Amount value={feeSats} exact /> },
              {
                label: 'Value in',
                value: tx.value_in === null ? null : <Amount value={tx.value_in} exact />,
              },
              { label: 'Value out', value: <Amount value={tx.value_out} exact /> },
            ]}
          />
        </Section>
      </TabPanel>
      <TabPanel tabsId={tabsId} id="io" value={tab}>
        <IoTables tx={tx} />
      </TabPanel>
      <TabPanel tabsId={tabsId} id="raw" value={tab}>
        <Section>
          <JsonView value={tx} label="Transaction record, as served" />
        </Section>
      </TabPanel>
      <span className="ui-sr-only" aria-live="polite">
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
