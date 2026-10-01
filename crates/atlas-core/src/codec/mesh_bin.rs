//! `mesh.bin` format v1: the peer overlay graph as deduplicated undirected edges.
//! Byte layout: see `README.md` in this directory.

use std::collections::BTreeMap;

use super::container::{CodecError, ContainerReader, ContainerWriter, Header, ORIGIN_KIND, Origin};
use crate::ids::NodeId;

/// File magic.
pub const MESH_MAGIC: [u8; 4] = *b"FXMS";
/// Current format version.
pub const MESH_VERSION: u16 = 1;

/// Section kinds.
pub mod kind {
    pub const A: u16 = 1;
    pub const B: u16 = 2;
    pub const FLAGS: u16 = 3;
}

/// Bits of the edge `flags` column.
pub mod flags {
    /// Both endpoints report the link.
    pub const BIDIRECTIONAL: u8 = 1 << 0;
    /// Endpoints are on different continents.
    pub const CROSS_CONTINENT: u8 = 1 << 1;
}

/// Normalizes edges to `a < b`, drops self-loops, merges duplicates (OR-ing flags) and sorts.
pub fn normalize_edges(
    edges: impl IntoIterator<Item = (NodeId, NodeId, u8)>,
) -> Vec<(NodeId, NodeId, u8)> {
    let mut map: BTreeMap<(NodeId, NodeId), u8> = BTreeMap::new();
    for (x, y, f) in edges {
        if x == y {
            continue;
        }
        let key = if x < y { (x, y) } else { (y, x) };
        *map.entry(key).or_insert(0) |= f;
    }
    map.into_iter().map(|((a, b), f)| (a, b, f)).collect()
}

/// Encodes a mesh snapshot. Edges are normalized first.
pub fn encode_mesh_bin(
    seq: u64,
    generated_ms: u64,
    edges: impl IntoIterator<Item = (NodeId, NodeId, u8)>,
) -> Vec<u8> {
    encode_mesh_bin_from(seq, generated_ms, edges, None)
}

/// [`encode_mesh_bin`] stamped with the server that built it (section ORIGIN).
pub fn encode_mesh_bin_from(
    seq: u64,
    generated_ms: u64,
    edges: impl IntoIterator<Item = (NodeId, NodeId, u8)>,
    origin: Option<Origin>,
) -> Vec<u8> {
    let edges = normalize_edges(edges);
    let a: Vec<u32> = edges.iter().map(|e| e.0.0).collect();
    let b: Vec<u32> = edges.iter().map(|e| e.1.0).collect();
    let f: Vec<u8> = edges.iter().map(|e| e.2).collect();
    let mut w = ContainerWriter::new(Header {
        magic: MESH_MAGIC,
        version: MESH_VERSION,
        flags: 0,
        seq,
        generated_ms,
        count: edges.len() as u32,
    });
    w.u32s(kind::A, &a)
        .u32s(kind::B, &b)
        .u8s(kind::FLAGS, &f)
        .origin(origin);
    w.finish()
}

/// A decoded `mesh.bin`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MeshBin {
    pub seq: u64,
    pub generated_ms: u64,
    pub a: Vec<u32>,
    pub b: Vec<u32>,
    pub flags: Vec<u8>,
    /// The server that built the snapshot (absent from older servers and fixtures).
    pub origin: Option<Origin>,
    pub unknown_sections: Vec<u16>,
}

impl MeshBin {
    pub fn edge_count(&self) -> usize {
        self.a.len()
    }
}

/// Decodes `mesh.bin`; `a` and `b` are required, `flags` defaults to zeros.
pub fn decode_mesh_bin(buf: &[u8]) -> Result<MeshBin, CodecError> {
    let r = ContainerReader::parse(buf, MESH_MAGIC, MESH_VERSION)?;
    let n = r.header.count as usize;
    Ok(MeshBin {
        seq: r.header.seq,
        generated_ms: r.header.generated_ms,
        a: r.u32s(kind::A, n)?
            .ok_or(CodecError::MissingSection(kind::A))?,
        b: r.u32s(kind::B, n)?
            .ok_or(CodecError::MissingSection(kind::B))?,
        flags: r.u8s(kind::FLAGS, n)?.unwrap_or_else(|| vec![0; n]),
        origin: r.origin()?,
        unknown_sections: r
            .kinds
            .iter()
            .copied()
            .filter(|k| ![kind::A, kind::B, kind::FLAGS, ORIGIN_KIND].contains(k))
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_normalization() {
        let edges = vec![
            (NodeId(5), NodeId(2), 0),
            (NodeId(2), NodeId(5), flags::BIDIRECTIONAL),
            (NodeId(1), NodeId(9), flags::CROSS_CONTINENT),
            (NodeId(3), NodeId(3), 0),
        ];
        let buf = encode_mesh_bin(4, 99, edges);
        assert_eq!(buf.len() % 8, 0);
        let m = decode_mesh_bin(&buf).unwrap();
        assert_eq!(m.seq, 4);
        assert_eq!(m.a, vec![1, 2]);
        assert_eq!(m.b, vec![9, 5]);
        assert_eq!(m.flags, vec![flags::CROSS_CONTINENT, flags::BIDIRECTIONAL]);
        assert!(m.a.iter().zip(&m.b).all(|(a, b)| a < b));
    }

    #[test]
    fn origin_roundtrip() {
        let o = Origin {
            started_ms: 1_790_000_000_123,
            instance: 0x0123_4567_89ab_cdef,
        };
        let buf = encode_mesh_bin_from(3, 4, [(NodeId(1), NodeId(2), 0)], Some(o));
        let m = decode_mesh_bin(&buf).unwrap();
        assert_eq!(m.origin, Some(o));
        assert_eq!(o.instance_hex(), "0123456789abcdef");
        assert_eq!(Origin::parse_instance("0123456789abcdef"), Some(o.instance));
        assert!(m.unknown_sections.is_empty());
        assert_eq!(
            decode_mesh_bin(&encode_mesh_bin(0, 0, [])).unwrap().origin,
            None
        );
    }

    #[test]
    fn empty() {
        let m = decode_mesh_bin(&encode_mesh_bin(0, 0, Vec::new())).unwrap();
        assert_eq!(m.edge_count(), 0);
    }

    #[test]
    fn wrong_magic() {
        let buf = encode_mesh_bin(0, 0, Vec::new());
        assert!(crate::codec::nodes_bin::decode_nodes_bin(&buf).is_err());
    }
}
