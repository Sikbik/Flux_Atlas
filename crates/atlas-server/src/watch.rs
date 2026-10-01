//! Watch hooks: how the WebSocket layer tells the engine which nodes and apps connected clients
//! are looking at (WatchProbe fast offline detection, hot-app instance polling, no coalescing).

use std::sync::Arc;

use atlas_core::NodeId;
use atlas_engine::EngineHandle;

/// Implemented by the engine. Calls must be cheap and non-blocking; the WS layer calls
/// `set_watch` on every `sub` that carries `watch` / `watch_apps`, and `clear_watch` when a
/// connection that set a watch goes away (or subscribes again without one).
pub trait WatchHooks: Send + Sync + 'static {
    /// Replaces the watch set of connection `conn_id`.
    fn set_watch(&self, conn_id: u64, nodes: Vec<NodeId>, apps: Vec<String>);
    /// Drops every watch of connection `conn_id`.
    fn clear_watch(&self, conn_id: u64);
}

impl<T: WatchHooks + ?Sized> WatchHooks for Arc<T> {
    fn set_watch(&self, conn_id: u64, nodes: Vec<NodeId>, apps: Vec<String>) {
        (**self).set_watch(conn_id, nodes, apps);
    }

    fn clear_watch(&self, conn_id: u64) {
        (**self).clear_watch(conn_id);
    }
}

/// The production hooks: forward to the engine, which unions every connection's watches into
/// WatchProbe targets and hot-app polling.
impl WatchHooks for EngineHandle {
    fn set_watch(&self, conn_id: u64, nodes: Vec<NodeId>, apps: Vec<String>) {
        EngineHandle::set_watch(self, conn_id, nodes, apps);
    }

    fn clear_watch(&self, conn_id: u64) {
        EngineHandle::clear_watch(self, conn_id);
    }
}

/// A recorded hook call (for tests and diagnostics).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WatchCall {
    Set {
        conn_id: u64,
        nodes: Vec<NodeId>,
        apps: Vec<String>,
    },
    Clear {
        conn_id: u64,
    },
}

/// Hooks that record every call. Useful in tests.
#[derive(Debug, Default)]
pub struct RecordingHooks {
    calls: std::sync::Mutex<Vec<WatchCall>>,
}

impl RecordingHooks {
    pub fn calls(&self) -> Vec<WatchCall> {
        self.calls
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    fn push(&self, c: WatchCall) {
        self.calls
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(c);
    }
}

impl WatchHooks for RecordingHooks {
    fn set_watch(&self, conn_id: u64, nodes: Vec<NodeId>, apps: Vec<String>) {
        self.push(WatchCall::Set {
            conn_id,
            nodes,
            apps,
        });
    }

    fn clear_watch(&self, conn_id: u64) {
        self.push(WatchCall::Clear { conn_id });
    }
}
