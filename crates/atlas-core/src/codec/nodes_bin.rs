//! `nodes.bin` format v1: the binary columnar node snapshot (ARCHITECTURE section 7).
//! Byte layout: see `README.md` in this directory.

use std::collections::HashMap;

use super::container::{
    CodecError, ContainerReader, ContainerWriter, DType, Header, decode_string_table,
    encode_string_table, read_f32, read_u16, read_u32,
};
use crate::ids::NodeId;
use crate::net::NodeEndpoint;
use crate::node::{NodeRecord, NodeStatus, Tier};

/// File magic.
pub const NODES_MAGIC: [u8; 4] = *b"FXAT";
/// Current format version.
pub const NODES_VERSION: u16 = 1;

/// Section kinds.
pub mod kind {
    pub const IDS: u16 = 1;
    pub const LAT: u16 = 2;
    pub const LON: u16 = 3;
    pub const TIER: u16 = 4;
    pub const STATUS: u16 = 5;
    pub const FLAGS: u16 = 6;
    pub const LOC: u16 = 7;
    pub const COUNTRY: u16 = 8;
    pub const ORG: u16 = 9;
    pub const APP_COUNT: u16 = 10;
    pub const RANK: u16 = 11;
    pub const LAST_PAID: u16 = 12;
    pub const CORES: u16 = 13;
    pub const RAM_GB: u16 = 14;
    pub const SSD_GB: u16 = 15;
    pub const VERSION: u16 = 16;
    pub const IPS: u16 = 32;
    pub const COUNTRIES: u16 = 33;
    pub const ORGS: u16 = 34;
    pub const VERSIONS: u16 = 35;
    pub const LOCATIONS: u16 = 36;
}

/// Bits of the `flags` column.
pub mod flags {
    pub const HAS_APPS: u8 = 1 << 0;
    pub const IPV6: u8 = 1 << 1;
    pub const NON_DEFAULT_PORT: u8 = 1 << 2;
    /// Location is approximate (local GeoIP fallback or city centroid).
    pub const GEO_APPROX: u8 = 1 << 3;
    pub const ARCANE: u8 = 1 << 4;
    /// Node hosts at least one enterprise (encrypted) app.
    pub const ENTERPRISE: u8 = 1 << 5;
    /// Paid within the last `RECENT_PAID_BLOCKS` blocks.
    pub const RECENTLY_PAID: u8 = 1 << 6;
    /// First seen within the last 24 hours.
    pub const NEW_24H: u8 = 1 << 7;
}

/// Blocks within which a payout counts as "recent" for [`flags::RECENTLY_PAID`] (5 minutes).
pub const RECENT_PAID_BLOCKS: u32 = 10;

/// Separator between country code and name in the COUNTRIES table.
pub const COUNTRY_SEP: char = '\u{1F}';

/// One node row as input to the encoder.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct NodeBinInput {
    pub id: NodeId,
    pub lat: Option<f32>,
    pub lon: Option<f32>,
    pub tier: Tier,
    pub status: NodeStatus,
    pub flags: u8,
    pub country_code: String,
    pub country_name: String,
    pub city: String,
    pub org: String,
    pub app_count: u16,
    /// 0-based queue rank; encoded as rank + 1 so that 0 means "n/a".
    pub rank: Option<u32>,
    pub last_paid: Option<u32>,
    pub cores: u16,
    pub ram_gb: u16,
    pub ssd_gb: u32,
    pub version: String,
    /// `ip:port`, empty when unknown.
    pub endpoint: String,
}

impl NodeBinInput {
    /// Builds a row from a node record. `tip` and `now_ms` drive the time-relative flags;
    /// `enterprise` says whether the node hosts enterprise apps.
    pub fn from_record(rec: &NodeRecord, tip: u32, now_ms: u64, enterprise: bool) -> Self {
        let geo = rec.geo.as_ref().filter(|g| g.has_coords());
        let mut f = 0u8;
        if rec.app_count > 0 {
            f |= flags::HAS_APPS;
        }
        if let Some(ep) = &rec.endpoint {
            if ep.ip.is_ipv6() {
                f |= flags::IPV6;
            }
            if !ep.is_default_port() {
                f |= flags::NON_DEFAULT_PORT;
            }
        }
        if geo.is_some_and(|g| g.source == crate::node::GeoSource::LocalDb) {
            f |= flags::GEO_APPROX;
        }
        if rec.arcane == Some(true) {
            f |= flags::ARCANE;
        }
        if enterprise {
            f |= flags::ENTERPRISE;
        }
        if rec
            .last_paid_height
            .is_some_and(|h| h > 0 && tip.saturating_sub(h) < RECENT_PAID_BLOCKS)
        {
            f |= flags::RECENTLY_PAID;
        }
        if rec.first_seen_ms > 0 && now_ms.saturating_sub(rec.first_seen_ms) < 86_400_000 {
            f |= flags::NEW_24H;
        }
        let hw = rec.hw.as_ref();
        Self {
            id: rec.id,
            lat: geo.map(|g| g.lat),
            lon: geo.map(|g| g.lon),
            tier: rec.tier,
            status: rec.status,
            flags: f,
            country_code: rec
                .geo
                .as_ref()
                .map(|g| g.country_code.to_string())
                .unwrap_or_default(),
            country_name: rec
                .geo
                .as_ref()
                .map(|g| g.country.to_string())
                .unwrap_or_default(),
            city: rec
                .geo
                .as_ref()
                .map(|g| g.city.to_string())
                .unwrap_or_default(),
            org: rec
                .geo
                .as_ref()
                .map(|g| g.org.to_string())
                .unwrap_or_default(),
            app_count: rec.app_count,
            rank: rec.rank,
            last_paid: rec.last_paid_height.filter(|h| *h > 0),
            cores: hw.map_or(0, |h| h.cores),
            ram_gb: hw.map_or(0, |h| h.ram_gb.round().clamp(0.0, 65_535.0) as u16),
            ssd_gb: hw.map_or(0, |h| h.ssd_gb.round().max(0.0) as u32),
            version: rec
                .versions
                .flux_os
                .as_deref()
                .unwrap_or_default()
                .to_owned(),
            endpoint: rec.endpoint.map(|e| e.to_string()).unwrap_or_default(),
        }
    }
}

/// One entry of the LOCATIONS table.
#[derive(Debug, Clone, PartialEq)]
pub struct LocationEntry {
    pub lat: f32,
    pub lon: f32,
    /// Index into COUNTRIES.
    pub country: u16,
    pub node_count: u32,
    pub city: String,
}

/// Interns strings; index 0 is always the empty string ("unknown").
#[derive(Debug, Default)]
struct Interner {
    list: Vec<String>,
    map: HashMap<String, u16>,
}

impl Interner {
    fn new() -> Self {
        let mut s = Self::default();
        s.list.push(String::new());
        s.map.insert(String::new(), 0);
        s
    }

    fn intern(&mut self, v: &str) -> u16 {
        if let Some(i) = self.map.get(v) {
            return *i;
        }
        // Saturate rather than wrap if a table ever outgrows u16 (it maps to "unknown").
        let Ok(i) = u16::try_from(self.list.len()) else {
            return 0;
        };
        self.list.push(v.to_owned());
        self.map.insert(v.to_owned(), i);
        i
    }
}

/// Encodes a node snapshot. Rows are written in the given order (callers sort by id).
pub fn encode_nodes_bin(seq: u64, generated_ms: u64, rows: &[NodeBinInput]) -> Vec<u8> {
    encode_nodes_bin_without(seq, generated_ms, rows, &[])
}

/// [`encode_nodes_bin`] without the column kinds in `omit`. A producer that did not record a
/// column (the time machine has no ranks, for example) leaves it out: a missing column means
/// "not recorded", unknown for every row, and is never written as zeros. `ids` cannot be
/// omitted.
pub fn encode_nodes_bin_without(
    seq: u64,
    generated_ms: u64,
    rows: &[NodeBinInput],
    omit: &[u16],
) -> Vec<u8> {
    let n = rows.len();
    let mut ids = Vec::with_capacity(n);
    let mut lat = Vec::with_capacity(n);
    let mut lon = Vec::with_capacity(n);
    let mut tier = Vec::with_capacity(n);
    let mut status = Vec::with_capacity(n);
    let mut flag = Vec::with_capacity(n);
    let mut loc = Vec::with_capacity(n);
    let mut country = Vec::with_capacity(n);
    let mut org = Vec::with_capacity(n);
    let mut app_count = Vec::with_capacity(n);
    let mut rank = Vec::with_capacity(n);
    let mut last_paid = Vec::with_capacity(n);
    let mut cores = Vec::with_capacity(n);
    let mut ram = Vec::with_capacity(n);
    let mut ssd = Vec::with_capacity(n);
    let mut version = Vec::with_capacity(n);
    let mut ips = Vec::with_capacity(n);

    let mut countries = Interner::new();
    let mut orgs = Interner::new();
    let mut versions = Interner::new();
    // Location 0 is "unknown location".
    let mut locations: Vec<LocationEntry> = vec![LocationEntry {
        lat: f32::NAN,
        lon: f32::NAN,
        country: 0,
        node_count: 0,
        city: String::new(),
    }];
    let mut loc_map: HashMap<(i32, i32, u16, String), u32> = HashMap::new();

    for r in rows {
        let c = if r.country_code.is_empty() {
            0
        } else {
            countries.intern(&format!(
                "{}{COUNTRY_SEP}{}",
                r.country_code, r.country_name
            ))
        };
        let (la, lo) = match (r.lat, r.lon) {
            (Some(a), Some(b)) if a.is_finite() && b.is_finite() => (a, b),
            _ => (f32::NAN, f32::NAN),
        };
        let l = if la.is_nan() {
            locations[0].node_count += 1;
            0
        } else {
            // Co-located cluster: coordinates rounded to 0.01 degrees (about 1 km) plus
            // country and city.
            let key = (
                (la * 100.0).round() as i32,
                (lo * 100.0).round() as i32,
                c,
                r.city.clone(),
            );
            let next = locations.len() as u32;
            let id = *loc_map.entry(key).or_insert(next);
            if id == next {
                locations.push(LocationEntry {
                    lat: la,
                    lon: lo,
                    country: c,
                    node_count: 0,
                    city: r.city.clone(),
                });
            }
            locations[id as usize].node_count += 1;
            id
        };
        ids.push(r.id.0);
        lat.push(la);
        lon.push(lo);
        tier.push(r.tier.as_u8());
        status.push(r.status.as_u8());
        flag.push(r.flags);
        loc.push(l);
        country.push(c);
        org.push(orgs.intern(&r.org));
        app_count.push(r.app_count);
        rank.push(r.rank.map_or(0, |v| v.saturating_add(1)));
        last_paid.push(r.last_paid.unwrap_or(0));
        cores.push(r.cores);
        ram.push(r.ram_gb);
        ssd.push(r.ssd_gb);
        version.push(versions.intern(&r.version));
        ips.push(r.endpoint.as_str());
    }

    let mut w = ContainerWriter::new(Header {
        magic: NODES_MAGIC,
        version: NODES_VERSION,
        flags: 0,
        seq,
        generated_ms,
        count: n as u32,
    });
    w.u32s(kind::IDS, &ids)
        .f32s(kind::LAT, &lat)
        .f32s(kind::LON, &lon)
        .u8s(kind::TIER, &tier)
        .u8s(kind::STATUS, &status)
        .u8s(kind::FLAGS, &flag)
        .u32s(kind::LOC, &loc)
        .u16s(kind::COUNTRY, &country)
        .u16s(kind::ORG, &org)
        .u16s(kind::APP_COUNT, &app_count)
        .u32s(kind::RANK, &rank)
        .u32s(kind::LAST_PAID, &last_paid)
        .u16s(kind::CORES, &cores)
        .u16s(kind::RAM_GB, &ram)
        .u32s(kind::SSD_GB, &ssd)
        .u16s(kind::VERSION, &version)
        .strings(kind::IPS, &ips)
        .strings(kind::COUNTRIES, &countries.list)
        .strings(kind::ORGS, &orgs.list)
        .strings(kind::VERSIONS, &versions.list)
        .section(kind::LOCATIONS, DType::Struct, encode_locations(&locations));
    let omit: Vec<u16> = omit.iter().copied().filter(|k| *k != kind::IDS).collect();
    w.drop_sections(&omit);
    w.finish()
}

fn encode_locations(locs: &[LocationEntry]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + locs.len() * 16);
    out.extend_from_slice(&(locs.len() as u32).to_le_bytes());
    for l in locs {
        out.extend_from_slice(&l.lat.to_le_bytes());
        out.extend_from_slice(&l.lon.to_le_bytes());
        out.extend_from_slice(&l.country.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&l.node_count.to_le_bytes());
    }
    let names: Vec<&str> = locs.iter().map(|l| l.city.as_str()).collect();
    out.extend_from_slice(&encode_string_table(&names));
    out
}

fn decode_locations(bytes: &[u8]) -> Result<Vec<LocationEntry>, CodecError> {
    let err = || CodecError::BadStruct {
        kind: kind::LOCATIONS,
    };
    let n = read_u32(bytes, 0).ok_or_else(err)? as usize;
    let table_at = 4usize
        .checked_add(n.checked_mul(16).ok_or_else(err)?)
        .ok_or_else(err)?;
    let (names, used) =
        decode_string_table(bytes.get(table_at..).ok_or_else(err)?, kind::LOCATIONS)?;
    if names.len() != n || table_at + used != bytes.len() {
        return Err(err());
    }
    let mut out = Vec::with_capacity(n);
    for (i, city) in names.into_iter().enumerate() {
        let b = 4 + i * 16;
        out.push(LocationEntry {
            lat: read_f32(bytes, b).ok_or_else(err)?,
            lon: read_f32(bytes, b + 4).ok_or_else(err)?,
            country: read_u16(bytes, b + 8).ok_or_else(err)?,
            node_count: read_u32(bytes, b + 12).ok_or_else(err)?,
            city,
        });
    }
    Ok(out)
}

/// A decoded `nodes.bin`. Absent optional sections decode as defaults (NaN coordinates, zeros,
/// empty strings), so decoders written against v1 keep working when columns are dropped.
#[derive(Debug, Clone, PartialEq)]
pub struct NodesBin {
    pub version: u16,
    pub flags: u16,
    pub seq: u64,
    pub generated_ms: u64,
    pub ids: Vec<u32>,
    pub lat: Vec<f32>,
    pub lon: Vec<f32>,
    pub tier: Vec<u8>,
    pub status: Vec<u8>,
    pub node_flags: Vec<u8>,
    pub loc: Vec<u32>,
    pub country: Vec<u16>,
    pub org: Vec<u16>,
    pub app_count: Vec<u16>,
    /// rank + 1; 0 = n/a.
    pub rank: Vec<u32>,
    pub last_paid: Vec<u32>,
    pub cores: Vec<u16>,
    pub ram_gb: Vec<u16>,
    pub ssd_gb: Vec<u32>,
    pub version_idx: Vec<u16>,
    pub ips: Vec<String>,
    pub countries: Vec<String>,
    pub orgs: Vec<String>,
    pub versions: Vec<String>,
    pub locations: Vec<LocationEntry>,
    /// Section kinds present in the file that this decoder does not know.
    pub unknown_sections: Vec<u16>,
    /// Every section kind present in the file, in file order. A known column that is absent
    /// was not recorded by the producer: its defaulted values above mean "unknown".
    pub present: Vec<u16>,
}

impl NodesBin {
    /// True when the file carries the column `kind` (see [`kind`]).
    pub fn has(&self, kind: u16) -> bool {
        self.present.contains(&kind)
    }
}

impl NodesBin {
    pub fn len(&self) -> usize {
        self.ids.len()
    }

    pub fn is_empty(&self) -> bool {
        self.ids.is_empty()
    }

    /// Parsed endpoint of row `i`.
    pub fn endpoint(&self, i: usize) -> Option<NodeEndpoint> {
        self.ips
            .get(i)
            .and_then(|s| NodeEndpoint::parse_opt(s).ok().flatten())
    }
}

const KNOWN: [u16; 21] = [
    kind::IDS,
    kind::LAT,
    kind::LON,
    kind::TIER,
    kind::STATUS,
    kind::FLAGS,
    kind::LOC,
    kind::COUNTRY,
    kind::ORG,
    kind::APP_COUNT,
    kind::RANK,
    kind::LAST_PAID,
    kind::CORES,
    kind::RAM_GB,
    kind::SSD_GB,
    kind::VERSION,
    kind::IPS,
    kind::COUNTRIES,
    kind::ORGS,
    kind::VERSIONS,
    kind::LOCATIONS,
];

/// Decodes `nodes.bin`, tolerating unknown and missing optional sections. `ids` is required.
pub fn decode_nodes_bin(buf: &[u8]) -> Result<NodesBin, CodecError> {
    let r = ContainerReader::parse(buf, NODES_MAGIC, NODES_VERSION)?;
    let n = r.header.count as usize;
    let ids = r
        .u32s(kind::IDS, n)?
        .ok_or(CodecError::MissingSection(kind::IDS))?;
    let ips = r
        .strings(kind::IPS)?
        .unwrap_or_else(|| vec![String::new(); n]);
    if ips.len() != n {
        return Err(CodecError::WrongLength {
            kind: kind::IPS,
            found: ips.len(),
            expected: n,
        });
    }
    let locations = match r.raw(kind::LOCATIONS, DType::Struct)? {
        Some(b) => decode_locations(b)?,
        None => Vec::new(),
    };
    Ok(NodesBin {
        version: r.header.version,
        flags: r.header.flags,
        seq: r.header.seq,
        generated_ms: r.header.generated_ms,
        ids,
        lat: r.f32s(kind::LAT, n)?.unwrap_or_else(|| vec![f32::NAN; n]),
        lon: r.f32s(kind::LON, n)?.unwrap_or_else(|| vec![f32::NAN; n]),
        tier: r.u8s(kind::TIER, n)?.unwrap_or_else(|| vec![0; n]),
        status: r.u8s(kind::STATUS, n)?.unwrap_or_else(|| vec![0; n]),
        node_flags: r.u8s(kind::FLAGS, n)?.unwrap_or_else(|| vec![0; n]),
        loc: r.u32s(kind::LOC, n)?.unwrap_or_else(|| vec![0; n]),
        country: r.u16s(kind::COUNTRY, n)?.unwrap_or_else(|| vec![0; n]),
        org: r.u16s(kind::ORG, n)?.unwrap_or_else(|| vec![0; n]),
        app_count: r.u16s(kind::APP_COUNT, n)?.unwrap_or_else(|| vec![0; n]),
        rank: r.u32s(kind::RANK, n)?.unwrap_or_else(|| vec![0; n]),
        last_paid: r.u32s(kind::LAST_PAID, n)?.unwrap_or_else(|| vec![0; n]),
        cores: r.u16s(kind::CORES, n)?.unwrap_or_else(|| vec![0; n]),
        ram_gb: r.u16s(kind::RAM_GB, n)?.unwrap_or_else(|| vec![0; n]),
        ssd_gb: r.u32s(kind::SSD_GB, n)?.unwrap_or_else(|| vec![0; n]),
        version_idx: r.u16s(kind::VERSION, n)?.unwrap_or_else(|| vec![0; n]),
        ips,
        countries: r
            .strings(kind::COUNTRIES)?
            .unwrap_or_else(|| vec![String::new()]),
        orgs: r
            .strings(kind::ORGS)?
            .unwrap_or_else(|| vec![String::new()]),
        versions: r
            .strings(kind::VERSIONS)?
            .unwrap_or_else(|| vec![String::new()]),
        locations,
        unknown_sections: r
            .kinds
            .iter()
            .copied()
            .filter(|k| !KNOWN.contains(k))
            .collect(),
        present: r.kinds.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: u32, lat: Option<f32>, cc: &str, org: &str) -> NodeBinInput {
        NodeBinInput {
            id: NodeId(id),
            lat,
            lon: lat.map(|v| v + 1.0),
            tier: Tier::Nimbus,
            status: NodeStatus::Confirmed,
            flags: flags::HAS_APPS,
            country_code: cc.into(),
            country_name: format!("{cc} land"),
            city: String::new(),
            org: org.into(),
            app_count: 2,
            rank: Some(0),
            last_paid: Some(100),
            cores: 8,
            ram_gb: 32,
            ssd_gb: 500,
            version: "8.20.0".into(),
            endpoint: format!("1.2.3.{id}:16127"),
        }
    }

    #[test]
    fn roundtrip() {
        let rows = vec![
            row(1, Some(50.0), "DE", "Hetzner"),
            row(2, Some(50.001), "DE", "Hetzner"),
            row(3, None, "", ""),
            row(4, Some(10.0), "US", "OVH"),
        ];
        let buf = encode_nodes_bin(9, 1234, &rows);
        assert_eq!(buf.len() % 8, 0);
        let d = decode_nodes_bin(&buf).unwrap();
        assert_eq!(d.seq, 9);
        assert_eq!(d.ids, vec![1, 2, 3, 4]);
        assert!(d.lat[2].is_nan());
        assert_eq!(d.rank, vec![1, 1, 1, 1]);
        assert_eq!(d.countries[0], "");
        assert_eq!(d.countries[d.country[0] as usize], "DE\u{1F}DE land");
        assert_eq!(d.orgs[d.org[3] as usize], "OVH");
        // Nodes 1 and 2 share a location cluster; node 3 is in the unknown location 0.
        assert_eq!(d.loc[0], d.loc[1]);
        assert_eq!(d.loc[2], 0);
        assert_eq!(d.locations[d.loc[0] as usize].node_count, 2);
        assert_eq!(d.locations[0].node_count, 1);
        assert_eq!(d.endpoint(3).unwrap().to_string(), "1.2.3.4:16127");
        assert!(d.unknown_sections.is_empty());
    }

    #[test]
    fn unknown_sections_are_ignored() {
        let rows = [row(1, Some(1.0), "FR", "x")];
        let mut w = ContainerWriter::new(Header {
            magic: NODES_MAGIC,
            version: 1,
            flags: 0,
            seq: 1,
            generated_ms: 2,
            count: 1,
        });
        w.u32s(kind::IDS, &[rows[0].id.0])
            .u8s(200, &[42])
            .strings(201, &["future"]);
        let d = decode_nodes_bin(&w.finish()).unwrap();
        assert_eq!(d.ids, vec![1]);
        assert_eq!(d.unknown_sections, vec![200, 201]);
        assert!(d.lat[0].is_nan());
        assert_eq!(d.ips, vec![String::new()]);
    }

    #[test]
    fn missing_ids_is_an_error() {
        let w = ContainerWriter::new(Header {
            magic: NODES_MAGIC,
            version: 1,
            flags: 0,
            seq: 1,
            generated_ms: 2,
            count: 0,
        });
        assert_eq!(
            decode_nodes_bin(&w.finish()).unwrap_err(),
            CodecError::MissingSection(kind::IDS)
        );
    }

    #[test]
    fn omitted_columns_are_absent_not_zero() {
        let rows = [row(1, Some(1.0), "FR", "x"), row(2, None, "", "")];
        let full = decode_nodes_bin(&encode_nodes_bin(1, 2, &rows)).unwrap();
        assert!(full.has(kind::RANK) && full.has(kind::LAST_PAID));
        let buf = encode_nodes_bin_without(1, 2, &rows, &[kind::RANK, kind::IDS, kind::FLAGS]);
        assert_eq!(buf.len() % 8, 0);
        let d = decode_nodes_bin(&buf).unwrap();
        assert!(!d.has(kind::RANK), "rank not recorded");
        assert!(!d.has(kind::FLAGS));
        assert!(d.has(kind::IDS), "ids can never be omitted");
        assert!(d.has(kind::LAST_PAID));
        assert_eq!(d.ids, vec![1, 2]);
        assert_eq!(d.cores, full.cores);
        assert!(d.unknown_sections.is_empty());
    }

    #[test]
    fn empty_snapshot() {
        let d = decode_nodes_bin(&encode_nodes_bin(0, 0, &[])).unwrap();
        assert!(d.is_empty());
        assert_eq!(d.locations.len(), 1);
    }
}
