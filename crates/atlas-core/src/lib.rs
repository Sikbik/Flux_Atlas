//! Flux Atlas core: domain model, identifiers, money, emission math, events, HTTP API DTOs,
//! live protocol messages, and the `nodes.bin` / `mesh.bin` codecs.
//!
//! This crate has no I/O. Everything that crosses the wire to the web app derives `ts_rs::TS`
//! and is exported by [`export_typescript`].
#![cfg_attr(test, allow(clippy::unwrap_used))]

pub mod amount;
pub mod api;
pub mod app;
pub mod chain;
pub mod codec;
pub mod emission;
pub mod event;
pub mod ids;
pub mod live;
pub mod net;
pub mod node;

use std::path::Path;

pub use amount::{Amount, COIN};
pub use ids::{BlockHash, Collateral, Hash32, NodeId, Outpoint, OutpointPrefix, Txid};
pub use net::{DEFAULT_API_PORT, NodeEndpoint};
pub use node::{NodeRecord, NodeStatus, Tier};

/// Current wall-clock time in unix milliseconds.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// API/WS protocol version advertised in `ServerInfo::api_version`.
pub const API_VERSION: u32 = 1;

/// Exports every frontend-facing type (with its dependencies) as TypeScript into `dir`.
///
/// 64-bit integers are exported as `number` (times in ms and sequence numbers stay far below
/// 2^53); money is always a decimal string (`Amount`).
pub fn export_typescript(dir: &Path) -> Result<(), ts_rs::ExportError> {
    use ts_rs::TS;
    let cfg = ts_rs::Config::new()
        .with_large_int("number")
        .with_out_dir(dir);
    macro_rules! export {
        ($($t:ty),* $(,)?) => { $( <$t>::export_all(&cfg)?; )* };
    }
    export!(
        api::BootstrapDto,
        api::NodesQuery,
        api::NodesPage,
        api::NodeDetailDto,
        api::NodeHistoryDto,
        api::NodePaymentsPage,
        api::NodePeersDto,
        api::AppsIndexDto,
        api::AppDetailDto,
        api::AppHistoryDto,
        api::GeoBreakdownDto,
        api::ProvidersDto,
        api::VersionsDto,
        api::CapacityDto,
        api::DecentralizationDto,
        api::MetricsSeriesDto,
        api::BlocksPage,
        api::BlockDetailDto,
        api::TxDetailDto,
        api::AddressDto,
        api::AddressTxsPage,
        api::AddressNodesDto,
        api::MempoolDto,
        api::SupplyDto,
        api::RichListDto,
        api::SearchResultsDto,
        api::TimelineDto,
        api::OperatorDto,
        api::ApiErrorDto,
        api::HealthDto,
        live::ClientMsg,
        live::LiveMsg,
        live::Topic,
        emission::PayoutSchedule,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    /// Regenerates `web/src/api/generated/` from the Rust types. Running the test suite keeps the
    /// frontend contract in sync with the backend.
    #[test]
    fn export_bindings() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/src/api/generated");
        std::fs::create_dir_all(&dir).unwrap();
        super::export_typescript(&dir).unwrap();
        let live = std::fs::read_to_string(dir.join("LiveMsg.ts")).unwrap();
        assert!(live.contains("seq"));
        let payout = std::fs::read_to_string(dir.join("PayoutDto.ts")).unwrap();
        assert!(payout.contains("amount: Amount"));
        let amount = std::fs::read_to_string(dir.join("Amount.ts")).unwrap();
        assert!(amount.contains("export type Amount = string;"));
    }
}
