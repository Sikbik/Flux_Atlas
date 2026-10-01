# Binary snapshot formats: `nodes.bin` and `mesh.bin`

Both formats share one container. Everything is little-endian. Every section starts at an
8-byte-aligned absolute offset, so a browser can wrap a section in a typed-array view
(`new Float32Array(buf, offset, count)`) without copying. Decoders must ignore section kinds and
dtypes they do not know: that is how the formats evolve without a version bump. A version bump
means a breaking change.

Reference implementation: `container.rs`, `nodes_bin.rs`, `mesh_bin.rs` in this directory.
Golden fixture: `crates/atlas-core/tests/golden/nodes.bin` with its decoded expectation
`nodes.expected.json` (see the end of this file).

## Container

### Header (32 bytes)

| Offset | Size | Type | Field |
|---:|---:|---|---|
| 0 | 4 | bytes | magic: `FXAT` (nodes) or `FXMS` (mesh) |
| 4 | 2 | u16 | format version (1) |
| 6 | 2 | u16 | flags (0; reserved) |
| 8 | 8 | u64 | `seq`: publish sequence the snapshot was built from |
| 16 | 8 | u64 | `generated_ms`: unix milliseconds |
| 24 | 4 | u32 | `count`: rows (nodes) or edges |
| 28 | 4 | u32 | `section_count` |

JavaScript reads the two u64 fields with `DataView.getBigUint64(off, true)`; both fit in a
double (`Number(...)`).

### Section table

Starts at byte 32: `section_count` entries of 12 bytes each, then zero padding up to the next
multiple of 8.

| Offset in entry | Size | Type | Field |
|---:|---:|---|---|
| 0 | 2 | u16 | `kind` (meaning depends on the format) |
| 2 | 2 | u16 | `dtype` (see below) |
| 4 | 4 | u32 | `offset`: absolute byte offset of the section, a multiple of 8 |
| 8 | 4 | u32 | `byte_len`: length without padding |

Sections follow in table order. Each is zero-padded to a multiple of 8, so the file length is a
multiple of 8.

### dtypes

| dtype | Meaning | Element size |
|---:|---|---:|
| 1 | u8 | 1 |
| 2 | u16 | 2 |
| 3 | u32 | 4 |
| 4 | i32 | 4 |
| 5 | f32 | 4 |
| 6 | f64 | 8 |
| 7 | u64 | 8 |
| 16 | string table | variable |
| 17 | struct (layout defined per section kind) | variable |

A fixed-width column has exactly `count` elements (`byte_len = count * size`).

### String table (dtype 16)

```
u32 n
u32 offsets[n + 1]      // offsets[0] = 0, offsets[n] = blob length, non-decreasing
u8  blob[offsets[n]]    // UTF-8; string i = blob[offsets[i] .. offsets[i+1]]
```

`offsets` starts 4 bytes into the section, so it is 4-byte aligned (`Uint32Array` works).
Decode with `TextDecoder` on `subarray` slices.

## `nodes.bin` (magic `FXAT`, version 1)

`count` = number of nodes. Row `i` of every column describes the same node. Rows are sorted by
node id.

| kind | Name | dtype | Content |
|---:|---|---|---|
| 1 | ids | u32 | `NodeId` (stable across restarts) |
| 2 | lat | f32 | degrees; NaN = unknown location |
| 3 | lon | f32 | degrees; NaN = unknown location |
| 4 | tier | u8 | 0 unknown, 1 cumulus, 2 nimbus, 3 stratus |
| 5 | status | u8 | 0 unknown, 1 confirmed, 2 started, 3 dos, 4 offline, 5 expired, 6 departed |
| 6 | flags | u8 | bit field, see below |
| 7 | loc | u32 | index into LOCATIONS (0 = unknown location) |
| 8 | country | u16 | index into COUNTRIES (0 = unknown) |
| 9 | org | u16 | index into ORGS (0 = unknown) |
| 10 | app_count | u16 | running app instances on the node |
| 11 | rank | u32 | payment-queue rank **plus one**; 0 = not queued. Upstream rank is 0-based (0 = paid in the next block), so a stored 1 means "next" |
| 12 | last_paid | u32 | height of the last payment; 0 = never |
| 13 | cores | u16 | benchmarked logical cores; 0 = unknown |
| 14 | ram_gb | u16 | benchmarked RAM, GB rounded; 0 = unknown |
| 15 | ssd_gb | u32 | benchmarked SSD, GB rounded; 0 = unknown |
| 16 | version | u16 | index into VERSIONS (FluxOS version; 0 = unknown) |
| 32 | ips | string table | `n = count`; `ip:port` per node (`[v6]:port` for IPv6); empty when unknown |
| 33 | COUNTRIES | string table | `code` + U+001F + `name` (for example `DE\u001FGermany`); entry 0 is `""` |
| 34 | ORGS | string table | provider name as reported; entry 0 is `""` |
| 35 | VERSIONS | string table | FluxOS versions; entry 0 is `""` |
| 36 | LOCATIONS | struct (17) | co-located clusters, see below |

### flags (kind 6)

| Bit | Mask | Meaning |
|---:|---:|---|
| 0 | 0x01 | has_apps: at least one running app instance |
| 1 | 0x02 | ipv6 endpoint |
| 2 | 0x04 | non-default API port (UPnP; not 16127) |
| 3 | 0x08 | geo_approx: location from the local GeoIP fallback |
| 4 | 0x10 | arcane: host runs ArcaneOS |
| 5 | 0x20 | enterprise: hosts at least one enterprise (encrypted) app |
| 6 | 0x40 | recently_paid: paid within the last 10 blocks |
| 7 | 0x80 | new_24h: first seen within the last 24 hours |

### LOCATIONS (kind 36, dtype 17)

```
u32 n
n x {                      // 16 bytes each, starting at section offset 4
  f32 lat                  // NaN for entry 0
  f32 lon
  u16 country              // index into COUNTRIES
  u16 pad                  // 0
  u32 node_count
}
string table (n entries)   // city names ("" when the source has no city)
```

Entry 0 is always "unknown location" (NaN coordinates); its `node_count` is the number of
unlocated nodes. A cluster groups nodes whose coordinates round to the same 0.01 degree cell
with the same country and city; `lat`/`lon` are those of the first node seen in the cluster.
The per-node `lat`/`lon` columns keep exact coordinates.

### Evolution rules

- New columns get new kinds; decoders skip unknown kinds.
- Only `ids` is required. A decoder should default missing columns (NaN coordinates, zeros,
  empty strings) so that a server may drop columns.
- A missing column means **not recorded**: unknown for every row, never "all zeros". A producer
  that does not know a column leaves it out (`encode_nodes_bin_without`) rather than writing
  zeros; `/timeline/state` omits `rank` (11) always, and `last_paid` (12), `app_count` (10) and
  `flags` (6) when its keyframe did not record them. Decoders expose which columns were present
  (Rust `NodesBin::has`, web `NodesBin.present` / `hasColumn`), and readers must not present a
  defaulted column as data.
- Changing the meaning or type of an existing kind requires a version bump.

## `mesh.bin` (magic `FXMS`, version 1)

`count` = number of undirected edges. Edges are deduplicated, satisfy `a < b`, and are sorted by
`(a, b)`.

| kind | Name | dtype | Content |
|---:|---|---|---|
| 1 | a | u32 | NodeId of the lower endpoint |
| 2 | b | u32 | NodeId of the higher endpoint |
| 3 | flags | u8 | bit 0 (0x01) bidirectional: both ends report the link; bit 1 (0x02) cross-continent |

`a` and `b` are required; `flags` defaults to zeros.

## Golden fixture

`crates/atlas-core/tests/golden/nodes.bin` is built by the test `golden_nodes_bin` from the real
node fixtures (`docs/research/fixtures/flux/daemon_viewdeterministicfluxnodelist.json` plus the
rows of `stats_fluxinfo.json` that are not in the list): 49 nodes, 24 located, one with an empty
IP, a mix of default and UPnP ports. `nodes.expected.json` holds the decoded summary: header
fields, `byte_len`, the full section table (kind, dtype, offset, byte_len), the first five rows of
every column (`lat`/`lon` `null` for NaN), the COUNTRIES / ORGS / VERSIONS tables, all LOCATIONS
entries, and whole-column checks (sums of ids, rank, last_paid, loc, app_count, flags; located
count; tier counts). The test fails if the encoder output drifts; regenerate with
`ATLAS_UPDATE_GOLDEN=1 cargo test -p atlas-core --test golden_nodes_bin` and update the web decoder
in the same change.
