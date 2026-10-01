//! Pure derivations over [`crate::state::NetworkState`]: each takes an upstream result, mutates
//! the state and records events, live deltas and store writes on a [`crate::state::Tick`].

pub mod apps;
pub mod block;
pub mod reconcile;
pub mod round;
