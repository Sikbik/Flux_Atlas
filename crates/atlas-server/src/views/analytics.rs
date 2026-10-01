//! Network analytics computed from the published node list (active nodes only): geography,
//! providers grouped by ASN, versions, capacity, and decentralization (Nakamoto coefficients).

use std::collections::{BTreeMap, HashMap, HashSet};

use atlas_core::NodeRecord;
use atlas_core::api::{
    CapacityDto, CapacityTotals, CountBucket, DecentralizationDto, GeoBreakdownDto,
    OperatorSizeBucket, ProviderBucket, ProvidersDto, TierCapacity, VersionsDto,
};
use atlas_core::app::Resources;
use atlas_core::node::Tier;
use atlas_engine::Published;

fn active(nodes: &[NodeRecord]) -> impl Iterator<Item = &NodeRecord> {
    nodes.iter().filter(|n| n.status.is_active())
}

/// Buckets sorted by count (desc), then key.
fn buckets(counts: HashMap<String, (String, u32)>, total: u32) -> Vec<CountBucket> {
    let mut v: Vec<CountBucket> = counts
        .into_iter()
        .map(|(key, (label, count))| CountBucket {
            key,
            label,
            count,
            share: share(count, total),
        })
        .collect();
    v.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.key.cmp(&b.key)));
    v
}

fn share(part: u32, total: u32) -> f64 {
    if total == 0 {
        0.0
    } else {
        f64::from(part) / f64::from(total)
    }
}

pub fn continent_name(code: &str) -> &'static str {
    match code {
        "AF" => "Africa",
        "AN" => "Antarctica",
        "AS" => "Asia",
        "EU" => "Europe",
        "NA" => "North America",
        "OC" => "Oceania",
        "SA" => "South America",
        _ => "Unknown",
    }
}

/// `GET /network/geo`.
pub fn geo(nodes: &[NodeRecord]) -> GeoBreakdownDto {
    let mut continents: HashMap<String, (String, u32)> = HashMap::new();
    let mut countries: HashMap<String, (String, u32)> = HashMap::new();
    let mut regions: HashMap<String, (String, u32)> = HashMap::new();
    let mut unlocated = 0u32;
    let mut total = 0u32;
    for n in active(nodes) {
        total += 1;
        let Some(g) = n.geo.as_ref().filter(|g| !g.country_code.is_empty()) else {
            unlocated += 1;
            continue;
        };
        if !g.has_coords() {
            unlocated += 1;
        }
        if !g.continent_code.is_empty() {
            let c = g.continent_code.to_string();
            continents
                .entry(c.clone())
                .or_insert_with(|| (continent_name(&c).to_owned(), 0))
                .1 += 1;
        }
        countries
            .entry(g.country_code.to_string())
            .or_insert_with(|| {
                let label = if g.country.is_empty() {
                    g.country_code.to_string()
                } else {
                    g.country.to_string()
                };
                (label, 0)
            })
            .1 += 1;
        if !g.region.is_empty() {
            regions
                .entry(format!("{}/{}", g.country_code, g.region))
                .or_insert_with(|| (g.region.to_string(), 0))
                .1 += 1;
        }
    }
    GeoBreakdownDto {
        continents: buckets(continents, total),
        countries: buckets(countries, total),
        regions: buckets(regions, total),
        unlocated,
    }
}

/// Provider grouping key: the ASN when known, else the normalized org name.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ProviderKey {
    Asn(u32),
    Org(String),
}

impl ProviderKey {
    pub fn of(n: &NodeRecord) -> Option<Self> {
        let g = n.geo.as_ref()?;
        if let Some(asn) = g.asn {
            return Some(Self::Asn(asn));
        }
        let org = g.org.trim();
        (!org.is_empty()).then(|| Self::Org(org.to_ascii_lowercase()))
    }

    /// Route key: `AS<n>` or the org.
    pub fn key(&self) -> String {
        match self {
            Self::Asn(a) => format!("AS{a}"),
            Self::Org(o) => o.clone(),
        }
    }
}

#[derive(Default)]
struct ProviderAcc {
    nodes: u32,
    hosts: HashSet<std::net::IpAddr>,
    countries: HashSet<String>,
    spellings: HashMap<String, u32>,
}

/// `GET /network/providers`: grouped by ASN (not by org spelling).
pub fn providers(nodes: &[NodeRecord]) -> ProvidersDto {
    let mut acc: HashMap<ProviderKey, ProviderAcc> = HashMap::new();
    let (mut total, mut hosting_known, mut hosting_yes) = (0u32, 0u32, 0u32);
    for n in active(nodes) {
        let Some(key) = ProviderKey::of(n) else {
            continue;
        };
        total += 1;
        let g = n.geo.as_ref();
        if let Some(h) = g.and_then(|g| g.hosting) {
            hosting_known += 1;
            hosting_yes += u32::from(h);
        }
        let a = acc.entry(key).or_default();
        a.nodes += 1;
        if let Some(ep) = n.endpoint {
            a.hosts.insert(ep.ip);
        }
        if let Some(g) = g {
            if !g.country_code.is_empty() {
                a.countries.insert(g.country_code.to_string());
            }
            if !g.org.trim().is_empty() {
                *a.spellings.entry(g.org.trim().to_owned()).or_default() += 1;
            }
        }
    }
    let mut providers: Vec<ProviderBucket> = acc
        .into_iter()
        .map(|(key, a)| {
            let org = a
                .spellings
                .iter()
                .max_by(|x, y| x.1.cmp(y.1).then_with(|| y.0.cmp(x.0)))
                .map_or_else(|| key.key(), |(s, _)| s.clone());
            ProviderBucket {
                asn: match key {
                    ProviderKey::Asn(n) => Some(n),
                    ProviderKey::Org(_) => None,
                },
                org,
                nodes: a.nodes,
                hosts: a.hosts.len() as u32,
                countries: a.countries.len() as u32,
                share: share(a.nodes, total),
            }
        })
        .collect();
    providers.sort_by(|a, b| b.nodes.cmp(&a.nodes).then_with(|| a.org.cmp(&b.org)));
    ProvidersDto {
        providers,
        hosting_share: share(hosting_yes, hosting_known),
    }
}

/// `GET /network/versions`. Nodes without a known value land in an `unknown` bucket.
pub fn versions(nodes: &[NodeRecord]) -> VersionsDto {
    type Get = fn(&NodeRecord) -> Option<&str>;
    let fields: [Get; 5] = [
        |n| n.versions.flux_os.as_deref(),
        |n| n.versions.daemon.as_deref(),
        |n| n.versions.bench.as_deref(),
        |n| n.versions.arcane.as_deref(),
        |n| n.versions.os.as_deref(),
    ];
    let total = active(nodes).count() as u32;
    let mut out: Vec<Vec<CountBucket>> = fields
        .iter()
        .map(|get| {
            let mut m: HashMap<String, (String, u32)> = HashMap::new();
            for n in active(nodes) {
                let v = get(n).filter(|s| !s.is_empty()).unwrap_or("unknown");
                m.entry(v.to_owned()).or_insert_with(|| (v.to_owned(), 0)).1 += 1;
            }
            buckets(m, total)
        })
        .collect();
    let os = out.pop().unwrap_or_default();
    let arcane = out.pop().unwrap_or_default();
    let bench = out.pop().unwrap_or_default();
    let daemon = out.pop().unwrap_or_default();
    let flux_os = out.pop().unwrap_or_default();
    VersionsDto {
        flux_os,
        daemon,
        bench,
        arcane,
        os,
    }
}

fn add_capacity(t: &mut CapacityTotals, n: &NodeRecord) {
    let Some(hw) = n.hw.as_ref() else { return };
    t.nodes += 1;
    t.cores += u64::from(hw.cores);
    t.ram_gb += f64::from(hw.ram_gb);
    t.ssd_gb += f64::from(hw.ssd_gb);
    t.down_mbps += f64::from(hw.down_mbps);
    t.up_mbps += f64::from(hw.up_mbps);
}

fn add_resources(a: &mut Resources, b: Resources) {
    a.cpu += b.cpu;
    a.ram_mb += b.ram_mb;
    a.hdd_gb += b.hdd_gb;
}

/// `GET /network/capacity`: benchmarked totals vs resources requested and locked by apps.
pub fn capacity(p: &Published) -> CapacityDto {
    let mut total = CapacityTotals::default();
    let mut by_tier: Vec<TierCapacity> = Tier::ALL
        .iter()
        .map(|&tier| TierCapacity {
            tier,
            totals: CapacityTotals::default(),
        })
        .collect();
    for n in active(&p.nodes) {
        add_capacity(&mut total, n);
        if let Some(i) = n.tier.index() {
            add_capacity(&mut by_tier[i].totals, n);
        }
    }
    let mut requested = Resources::default();
    let mut locked = Resources::default();
    for a in p.apps.iter() {
        add_resources(&mut requested, a.totals);
        add_resources(&mut locked, a.per_instance.scaled(a.instances_running));
    }
    CapacityDto {
        total,
        by_tier,
        apps_requested: requested,
        apps_locked: locked,
    }
}

/// Smallest number of entities that together hold more than half of `total`.
pub fn nakamoto(mut counts: Vec<u32>, total: u32) -> u32 {
    if total == 0 {
        return 0;
    }
    counts.sort_unstable_by(|a, b| b.cmp(a));
    let mut acc = 0u64;
    for (i, c) in counts.iter().enumerate() {
        acc += u64::from(*c);
        if acc * 2 > u64::from(total) {
            return i as u32 + 1;
        }
    }
    counts.len() as u32
}

/// Herfindahl-Hirschman index of the shares, 0..1.
pub fn hhi(counts: &[u32], total: u32) -> f64 {
    if total == 0 {
        return 0.0;
    }
    counts
        .iter()
        .map(|&c| {
            let s = share(c, total);
            s * s
        })
        .sum()
}

/// Operator identity: the ZelID when known, else the payment address.
fn operator_key(n: &NodeRecord) -> &str {
    n.zelid
        .as_deref()
        .filter(|z| !z.is_empty())
        .unwrap_or(&n.payment_address)
}

/// Default and largest `top` of `GET /network/decentralization`.
pub const TOP_OPERATORS_DEFAULT: u32 = 25;
pub const TOP_OPERATORS_MAX: u32 = 5_000;

/// `GET /network/decentralization` with `top` operator rows.
pub fn decentralization(nodes: &[NodeRecord], top_n: usize) -> DecentralizationDto {
    let mut countries: HashMap<&str, u32> = HashMap::new();
    let mut providers: HashMap<ProviderKey, u32> = HashMap::new();
    let mut operators: HashMap<&str, u32> = HashMap::new();
    let mut hosts: HashMap<std::net::IpAddr, u32> = HashMap::new();
    let (mut located, mut with_provider, mut total) = (0u32, 0u32, 0u32);
    for n in active(nodes) {
        total += 1;
        if let Some(g) = n.geo.as_ref().filter(|g| !g.country_code.is_empty()) {
            located += 1;
            *countries.entry(g.country_code.as_str()).or_default() += 1;
        }
        if let Some(k) = ProviderKey::of(n) {
            with_provider += 1;
            *providers.entry(k).or_default() += 1;
        }
        *operators.entry(operator_key(n)).or_default() += 1;
        if let Some(ep) = n.endpoint {
            *hosts.entry(ep.ip).or_default() += 1;
        }
    }
    let country_counts: Vec<u32> = countries.values().copied().collect();
    let provider_counts: Vec<u32> = providers.values().copied().collect();
    let operator_counts: Vec<u32> = operators.values().copied().collect();
    let mut sizes: BTreeMap<u32, u32> = BTreeMap::new();
    for c in &operator_counts {
        *sizes.entry(*c).or_default() += 1;
    }
    let mut top: Vec<(&str, u32)> = operators.into_iter().collect();
    top.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    DecentralizationDto {
        nakamoto_country: nakamoto(country_counts.clone(), located),
        nakamoto_provider: nakamoto(provider_counts.clone(), with_provider),
        operator_count: operator_counts.len() as u32,
        nakamoto_operator: nakamoto(operator_counts, total),
        hhi_country: hhi(&country_counts, located),
        hhi_provider: hhi(&provider_counts, with_provider),
        top_operators: top
            .into_iter()
            .take(top_n)
            .map(|(k, c)| CountBucket {
                key: k.to_owned(),
                label: k.to_owned(),
                count: c,
                share: share(c, total),
            })
            .collect(),
        multi_node_hosts: hosts.values().filter(|&&c| c > 1).count() as u32,
        operator_sizes: sizes
            .into_iter()
            .map(|(nodes, operators)| OperatorSizeBucket { nodes, operators })
            .collect(),
    }
}

/// Lookup tables for search: countries, providers, versions present in the network.
#[derive(Debug, Default)]
pub struct SearchCatalog {
    /// Lowercase code and name to (code, name, count).
    pub countries: Vec<(String, String, u32)>,
    /// (route key, label, asn, count).
    pub providers: Vec<(String, String, Option<u32>, u32)>,
    /// (component, version, count).
    pub versions: Vec<(&'static str, String, u32)>,
}

impl SearchCatalog {
    pub fn build(nodes: &[NodeRecord]) -> Self {
        let geo = geo(nodes);
        let providers = providers(nodes);
        let versions = versions(nodes);
        let mut vs = Vec::new();
        for (component, list) in [
            ("flux_os", &versions.flux_os),
            ("daemon", &versions.daemon),
            ("bench", &versions.bench),
            ("arcane", &versions.arcane),
        ] {
            for b in list.iter().filter(|b| b.key != "unknown") {
                vs.push((component, b.key.clone(), b.count));
            }
        }
        Self {
            countries: geo
                .countries
                .into_iter()
                .map(|b| (b.key, b.label, b.count))
                .collect(),
            providers: providers
                .providers
                .into_iter()
                .map(|p| {
                    let key = p
                        .asn
                        .map_or_else(|| p.org.to_ascii_lowercase(), |a| format!("AS{a}"));
                    (key, p.org, p.asn, p.nodes)
                })
                .collect(),
            versions: vs,
        }
    }
}

#[cfg(test)]
mod tests {
    use atlas_core::ids::{Hash32, NodeId, Outpoint};
    use atlas_core::node::{Geo, NodeStatus};

    use super::*;

    fn node(id: u32, cc: &str, asn: Option<u32>, org: &str, ip: &str) -> NodeRecord {
        NodeRecord {
            id: NodeId(id),
            outpoint: Outpoint::new(Hash32([id as u8; 32]), 0),
            endpoint: Some(ip.parse().unwrap()),
            status: NodeStatus::Confirmed,
            tier: Tier::Cumulus,
            payment_address: format!("t1op{}", id % 3).into(),
            geo: Some(Geo {
                lat: 10.0,
                lon: 10.0,
                country_code: cc.into(),
                country: cc.into(),
                continent_code: "EU".into(),
                org: org.into(),
                asn,
                ..Geo::default()
            }),
            ..NodeRecord::default()
        }
    }

    #[test]
    fn nakamoto_math() {
        assert_eq!(nakamoto(vec![50, 30, 20], 100), 2);
        assert_eq!(nakamoto(vec![51, 49], 100), 1);
        assert_eq!(nakamoto(vec![], 0), 0);
        assert_eq!(nakamoto(vec![10; 10], 100), 6);
        assert!((hhi(&[50, 50], 100) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn providers_group_by_asn() {
        let nodes = vec![
            node(0, "DE", Some(24940), "Hetzner Online GmbH", "1.1.1.1"),
            node(1, "DE", Some(24940), "Hetzner Online", "1.1.1.2"),
            node(2, "FI", Some(24940), "Hetzner Online GmbH", "1.1.1.1:16137"),
            node(3, "US", None, "Some ISP", "2.2.2.2"),
        ];
        let p = providers(&nodes);
        assert_eq!(p.providers.len(), 2);
        let h = &p.providers[0];
        assert_eq!(h.asn, Some(24940));
        assert_eq!(h.nodes, 3);
        assert_eq!(h.hosts, 2);
        assert_eq!(h.countries, 2);
        assert_eq!(h.org, "Hetzner Online GmbH");
        let d = decentralization(&nodes, 25);
        assert_eq!(d.nakamoto_provider, 1);
        assert_eq!(d.nakamoto_country, 2, "DE holds exactly half, not more");
        assert_eq!(d.multi_node_hosts, 1);
        let g = geo(&nodes);
        assert_eq!(g.countries[0].key, "DE");
        assert_eq!(g.countries[0].count, 2);
    }
}
