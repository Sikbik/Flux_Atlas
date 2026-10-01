//! Binary snapshot formats: `nodes.bin` and `mesh.bin`. Byte layouts are documented in
//! `README.md` next to this file; the web decoder implements the same layout.

pub mod container;
pub mod mesh_bin;
pub mod nodes_bin;

pub use container::CodecError;
pub use mesh_bin::{MeshBin, decode_mesh_bin, encode_mesh_bin};
pub use nodes_bin::{
    NodeBinInput, NodesBin, decode_nodes_bin, encode_nodes_bin, encode_nodes_bin_without,
};
