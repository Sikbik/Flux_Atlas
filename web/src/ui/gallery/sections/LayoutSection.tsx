import { Blocks, Cpu, Eye, Server, SquareArrowOutUpRight } from 'lucide-react';
import { useState } from 'react';
import { formatAgo, formatBytes, formatFlux, formatHeight, formatInt } from '../../../lib/format';
import {
  AnimatedNumber,
  Button,
  Card,
  Chip,
  Delta,
  EntityLink,
  Freshness,
  IconButton,
  KeyValue,
  Row,
  Section,
  SegmentedControl,
  Skeleton,
  Sparkline,
  Stack,
  Stat,
  StatGrid,
  StatusChip,
  TierChip,
  ViewHeader,
} from '../../index';
import { useGalleryData } from '../data';
import { GallerySection, SpecGrid, Specimen } from '../primitives';

type PayWindow = 'next' | 'recent';

/** Gallery section: ViewHeader, StatGrid, Section, Card, Stack and Row. */
export function LayoutSection() {
  const { node, network, blocks, lastOk, nodeSeries } = useGalleryData();
  const [pay, setPay] = useState<PayWindow>('next');
  const tip = network?.tip?.height ?? null;
  const geo = node?.geo;
  const place = geo ? [geo.city || geo.region, geo.country].filter(Boolean).join(', ') : null;
  const sincePaid = node && tip !== null && node.last_paid_height ? tip - node.last_paid_height : null;
  const block = blocks?.[0];

  return (
    <GallerySection
      id="layout"
      title="Layout"
      lead="Every view starts with a ViewHeader and is built from Sections. Columns follow the width of the window, not the viewport: headers fold by container query, stat grids by minimum tile width. Keep each surface calm: one primary action at most, everything else behind a menu or a fold."
    >
      <SpecGrid min={440}>
        <Specimen
          title="ViewHeader, node."
          caption="A sentence-case kind label, a mono title for ids, a subtitle, actions, chips and a freshness slot over a hairline of tier light. 420 px inspector."
          flush
          width={420}
        >
          {node ? (
            <ViewHeader
              kind="Node"
              icon={Server}
              tier={node.tier === 'unknown' ? undefined : node.tier}
              mono
              title={node.endpoint ?? 'Unknown endpoint'}
              subtitle={
                <>
                  {place ?? 'Unknown location'}
                  {sincePaid !== null ? `, paid ${formatInt(sincePaid)} blocks ago` : null}
                </>
              }
              freshness={<Freshness ts={lastOk('node_registry')} cadenceMs={90_000} label="nodes" />}
              actions={
                <>
                  <Button size="sm" icon={Eye}>
                    Watch
                  </Button>
                  <IconButton size="sm" icon={SquareArrowOutUpRight} label="Pop out" />
                </>
              }
            >
              <TierChip tier={node.tier} />
              <StatusChip status={node.status} />
              {node.arcane ? <Chip icon={Cpu}>ArcaneOS</Chip> : null}
            </ViewHeader>
          ) : (
            <Skeleton h={110} />
          )}
        </Specimen>
        <Specimen
          title="ViewHeader, block."
          caption="Without a tier it takes the Flux blue accent. The title is the figure; the subtitle says what is in it."
          flush
          width={420}
        >
          {block ? (
            <ViewHeader
              kind="Block"
              icon={Blocks}
              title={formatHeight(block.height)}
              subtitle={
                <>
                  {formatInt(block.tx_count)} transactions, {formatBytes(block.size)}, produced{' '}
                  {formatAgo(Date.now() - block.time_ms)}
                </>
              }
              freshness={<Freshness ts={lastOk('chain_stream')} cadenceMs={30_000} label="tip" />}
              actions={<Button size="sm">Raw</Button>}
            />
          ) : (
            <Skeleton h={90} />
          )}
        </Specimen>
        <Specimen
          title="ViewHeader, narrow."
          caption="Under 400 px of container width it folds to one column: actions drop below the chips, and a long id breaks into even lines."
          flush
          width={340}
        >
          <ViewHeader
            kind="Address"
            title="t1cz5PE2QnTYwoBnTRVxd8oiNMxdwFqDg9"
            mono
            subtitle="Operator of 7 nodes on 1 host"
            actions={
              <Button size="sm" variant="primary">
                Open operator view
              </Button>
            }
          />
        </Specimen>
        <Specimen
          title="StatGrid."
          caption="As many equal columns as fit, never narrower than the minimum tile width; the hero takes two. Real values from the live server, one hero figure per view."
          span={3}
        >
          <StatGrid min={150} style={{ width: '100%' }}>
            <Stat
              hero
              label="Nodes on the network"
              value={network ? <AnimatedNumber value={network.node_count} /> : undefined}
              loading={!network}
              caption={network ? `${formatInt(network.host_count)} IP addresses` : undefined}
              spark={
                nodeSeries ? <Sparkline values={nodeSeries} form="area" size="card" decorative /> : undefined
              }
            />
            <Stat
              label="Block height"
              value={
                network?.tip ? <AnimatedNumber value={network.tip.height} format={formatHeight} /> : undefined
              }
              loading={!network}
              caption="one block every 30 s"
            />
            <Stat
              label="Apps"
              value={network ? formatInt(network.app_count) : undefined}
              loading={!network}
              caption={network ? `${formatInt(network.instance_count)} instances` : undefined}
            />
            <Stat
              label="Block reward"
              value={network ? formatFlux(network.reward, { unit: false }) : undefined}
              unit="FLUX"
              loading={!network}
              caption="split across four outputs"
            />
            <Stat
              label="FLUX price"
              value={network?.price ? `$${network.price.usd.toFixed(4)}` : undefined}
              loading={!network}
              delta={
                network?.price ? (
                  <Delta kind="percent" value={network.price.change_24h_pct} period="24 h" />
                ) : null
              }
            />
          </StatGrid>
        </Specimen>
        <Specimen
          title="Section."
          caption="A hairline that fades out, a heading row with an aside, then the body. The second folds (open state shown), the third starts folded. Folded content is inert and leaves the tab order."
          flush
          width={420}
        >
          <Section title="Payment" aside="updates every block">
            <KeyValue
              items={[
                { label: 'Next payment', value: 'in 14.7 h' },
                { label: 'Queue position', value: '#1 of 1,764', mono: true },
              ]}
            />
          </Section>
          <Section title="Hardware" collapsible aside="benchmarked">
            <KeyValue
              items={[
                { label: 'Cores', value: node?.hardware?.cores ?? null },
                { label: 'Memory', value: node?.hardware ? `${node.hardware.ram_gb} GB` : null, mono: true },
                {
                  label: 'Storage',
                  value: node?.hardware ? `${node.hardware.total_storage_gb} GB` : null,
                  mono: true,
                },
              ]}
            />
          </Section>
          <Section title="Peers" collapsible defaultOpen={false}>
            <KeyValue items={[{ label: 'Outbound', value: node?.peers_out ?? null }]} />
          </Section>
        </Specimen>
        <Specimen
          title="Section, with actions."
          caption="Controls sit at the right end of the heading row; a ruled list separates its rows with a fading hairline."
          flush
          width={420}
        >
          <Section
            title="Payments"
            actions={
              <SegmentedControl<PayWindow>
                aria-label="Payment window"
                size="sm"
                value={pay}
                onChange={setPay}
                options={[
                  { value: 'next', label: 'Next' },
                  { value: 'recent', label: 'Recent' },
                ]}
              />
            }
          >
            <KeyValue
              ruled
              items={
                pay === 'next'
                  ? [
                      { label: 'Position', value: node?.rank ?? null, mono: true },
                      { label: 'Last paid', value: node?.last_paid_height ?? null, mono: true },
                      { label: 'Cycle', value: 'about 14.7 h' },
                    ]
                  : [
                      { label: 'Last block', value: node?.last_paid_height ?? null, mono: true },
                      { label: 'Confirmed at', value: node?.confirmed_height ?? null, mono: true },
                    ]
              }
            />
          </Section>
        </Specimen>
        <Specimen
          title="Card, Stack, Row."
          caption="Quiet surfaces and token-gap layout glue. A card is one ink step up with a rim that is lit at the top left; glow adds a faint corner light, and an interactive card brightens on hover."
          layout="stack"
        >
          <Row gap={5} wrap>
            <Card padding="md" style={{ flex: '1 1 140px' }}>
              <Stack gap={3}>
                <b>Raised</b>
                <span className="kg-note">the default</span>
              </Stack>
            </Card>
            <Card padding="md" glow style={{ flex: '1 1 140px' }}>
              <Stack gap={3}>
                <b>With glow</b>
                <span className="kg-note">corner light</span>
              </Stack>
            </Card>
            <Card padding="md" tone="flat" style={{ flex: '1 1 140px' }}>
              <Stack gap={3}>
                <b>Flat</b>
                <span className="kg-note">hairline only</span>
              </Stack>
            </Card>
          </Row>
          <Card padding="md" interactive glow data-tier="stratus">
            <Row justify="between">
              <Stack gap={2}>
                <b>Interactive, tier-tinted</b>
                <span className="kg-note">
                  Node views wear their tier:{' '}
                  <EntityLink
                    kind="tx"
                    value="8aa97365b148e2125de355988b4c1be4870edc0e869587f831f8c0d65871beec"
                  />
                </span>
              </Stack>
              <TierChip tier="stratus" />
            </Row>
          </Card>
        </Specimen>
      </SpecGrid>
    </GallerySection>
  );
}
