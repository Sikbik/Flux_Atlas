//! TEMPORARY SHIM: `WatchHooks` for the engine handle.
//!
//! INTEGRATION: B2 adds `EngineHandle::set_watch(conn_id, nodes, apps)` and
//! `EngineHandle::clear_watch(conn_id)`. At merge, replace both bodies below with plain
//! forwarding calls (`EngineHandle::set_watch(self, conn_id, nodes, apps)` and
//! `EngineHandle::clear_watch(self, conn_id)`). Until then the calls are logged and dropped.

use atlas_core::NodeId;
use atlas_engine::EngineHandle;

use crate::watch::WatchHooks;

impl WatchHooks for EngineHandle {
    fn set_watch(&self, conn_id: u64, nodes: Vec<NodeId>, apps: Vec<String>) {
        // INTEGRATION: forward to EngineHandle::set_watch.
        tracing::debug!(
            conn_id,
            nodes = nodes.len(),
            apps = apps.len(),
            "watch set (engine hook not wired yet)"
        );
    }

    fn clear_watch(&self, conn_id: u64) {
        // INTEGRATION: forward to EngineHandle::clear_watch.
        tracing::debug!(conn_id, "watch cleared (engine hook not wired yet)");
    }
}
