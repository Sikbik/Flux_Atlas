//! Typed upstream response models. Every model is tolerant: unknown fields are ignored and
//! missing or malformed optional fields become `None` or defaults.

pub mod apps;
pub mod daemon;
pub mod fusion;
pub mod insight;
pub mod node_api;
pub mod nodes;
pub mod stats;
