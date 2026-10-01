// What one recorded moment says about itself: how many nodes were confirmed, how they split by tier,
// and which columns of the recording exist. A recording made before the server learned a column simply
// does not have it; the view says "not recorded" for that, never zero.

import { NodeSection, type NodesBin, statusCode, tierCode } from '../../../api/nodesBin';

export interface ArchiveInfo {
  /** The instant that was asked for (unix ms). */
  t: number;
  /** Rows in the recorded state: every node the network knew then, whatever its status. */
  rows: number;
  /** Confirmed nodes, the number the live count shows; null when the status column was not recorded. */
  nodes: number | null;
  /** Confirmed nodes by tier. */
  tiers: { cumulus: number; nimbus: number; stratus: number };
  /** Rows with a known place on the globe. */
  located: number;
  /** Plain names of the facts this moment records, and of those it does not. */
  recorded: string[];
  missing: string[];
}

/** The facts a node row can carry, by plain name, and the nodes.bin sections each one needs. */
const FACTS: readonly { label: string; sections: readonly number[] }[] = [
  { label: 'Location', sections: [NodeSection.Lat, NodeSection.Lon] },
  { label: 'Tier', sections: [NodeSection.Tier] },
  { label: 'Status', sections: [NodeSection.Status] },
  { label: 'Host address', sections: [NodeSection.Ips] },
  { label: 'Country', sections: [NodeSection.Country] },
  { label: 'Provider', sections: [NodeSection.Org] },
  { label: 'FluxOS version', sections: [NodeSection.Version] },
  { label: 'Cores, memory and storage', sections: [NodeSection.Cores, NodeSection.RamGb, NodeSection.SsdGb] },
  { label: 'Apps per node', sections: [NodeSection.AppCount] },
  { label: 'Payment queue rank', sections: [NodeSection.Rank] },
  { label: 'Last payment', sections: [NodeSection.LastPaid] },
  { label: 'Node flags', sections: [NodeSection.Flags] },
];

type SummaryInput = Pick<NodesBin, 'count' | 'status' | 'tier' | 'lat' | 'lon' | 'present'>;

/** Summarises a decoded `/timeline/state` for the chip and its details. */
export function summarize(bin: SummaryInput, t: number): ArchiveInfo {
  const hasStatus = bin.present.has(NodeSection.Status);
  const hasTier = bin.present.has(NodeSection.Tier);
  const confirmed = statusCode('confirmed');
  const cumulus = tierCode('cumulus');
  const nimbus = tierCode('nimbus');
  const stratus = tierCode('stratus');
  const tiers = { cumulus: 0, nimbus: 0, stratus: 0 };
  let nodes = 0;
  let located = 0;
  for (let i = 0; i < bin.count; i++) {
    if (Number.isFinite(bin.lat[i]) && Number.isFinite(bin.lon[i])) located++;
    if (!hasStatus || bin.status[i] !== confirmed) continue;
    nodes++;
    if (!hasTier) continue;
    const code = bin.tier[i];
    if (code === cumulus) tiers.cumulus++;
    else if (code === nimbus) tiers.nimbus++;
    else if (code === stratus) tiers.stratus++;
  }
  const recorded: string[] = [];
  const missing: string[] = [];
  for (const f of FACTS) (f.sections.every((s) => bin.present.has(s)) ? recorded : missing).push(f.label);
  return { t, rows: bin.count, nodes: hasStatus ? nodes : null, tiers, located, recorded, missing };
}
