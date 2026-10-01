//! StatsRound: merges one stats.runonflux.io `fluxinfo` round (hardware, versions, geo,
//! reachability, locked app resources) into the node records.
//!
//! About 150 rows per round are unreachable placeholders with zeroed fields; they only flip
//! `reachable` and never overwrite known hardware, versions or location.

use atlas_core::event::Event;
use atlas_core::live::{DeltaCause, FeedKind, FeedRef};
use atlas_core::node::{Geo, Hardware, Versions};
use atlas_core::{NodeId, Outpoint};
use atlas_flux::models::stats::StatsNodeRow;

use crate::state::{NetworkState, Tick, mask};

const SW: DeltaCause = DeltaCause::Sweep;

/// The part of a stats row the engine uses.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RoundNode {
    pub outpoint: Outpoint,
    pub reachable: bool,
    pub hw: Option<Hardware>,
    pub versions: Versions,
    pub geo: Option<Geo>,
    pub arcane: Option<bool>,
    pub upnp: Option<bool>,
    pub static_ip: Option<bool>,
    pub zelid: Option<String>,
    /// Locked app resources (cores, RAM GB, storage GB).
    pub locked: Option<[f64; 3]>,
    pub peers: Option<(u16, u16)>,
}

impl RoundNode {
    /// Extracts a row; `None` without a usable collateral.
    pub fn from_row(row: &StatsNodeRow) -> Option<Self> {
        let outpoint = row.outpoint()?;
        let reachable = row.reachable();
        let flux = row.info.flux.as_ref().filter(|_| reachable);
        let locked = row
            .info
            .apps
            .as_ref()
            .filter(|_| reachable)
            .and_then(|a| a.resources.as_ref())
            .map(|r| {
                [
                    r.cpus_locked.unwrap_or(0.0),
                    r.ram_locked_mb.unwrap_or(0.0) / 1024.0,
                    r.hdd_locked_gb.unwrap_or(0.0),
                ]
            });
        Some(Self {
            outpoint,
            reachable,
            hw: row.hardware(),
            versions: row.versions(),
            geo: row.geo().filter(Geo::has_coords),
            arcane: row.is_arcane(),
            upnp: flux.and_then(|f| f.upnp),
            static_ip: flux.and_then(|f| f.static_ip),
            zelid: flux.and_then(|f| f.zelid.clone()).filter(|z| !z.is_empty()),
            locked,
            peers: flux.and_then(|f| match (f.connections_out, f.connections_in) {
                (Some(o), Some(i)) => Some((o as u16, i as u16)),
                _ => None,
            }),
        })
    }
}

/// What a round changed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RoundReport {
    pub rows: usize,
    pub matched: usize,
    pub unreachable: u32,
    pub went_unreachable: u32,
    pub recovered: u32,
    pub hardware_changed: u32,
    pub versions_changed: u32,
    pub located: u32,
}

/// True when the benchmark changed materially (fluctuating speeds and ping are ignored).
#[allow(clippy::float_cmp)]
pub fn hardware_material_change(a: Option<&Hardware>, b: &Hardware) -> bool {
    let Some(a) = a else { return true };
    a.cores != b.cores
        || a.ram_gb.round() != b.ram_gb.round()
        || a.ssd_gb.round() != b.ssd_gb.round()
        || a.arch != b.arch
        || a.bench_status != b.bench_status
        || a.bench_tier != b.bench_tier
}

/// True when two locations differ enough to move the node on the globe or re-label it.
pub fn geo_material_change(a: Option<&Geo>, b: &Geo) -> bool {
    let Some(a) = a else { return true };
    !a.has_coords()
        || (a.lat - b.lat).abs() > 0.01
        || (a.lon - b.lon).abs() > 0.01
        || a.country_code != b.country_code
        || a.org != b.org
}

/// Applies a round.
pub fn apply_round(
    st: &mut NetworkState,
    tick: &mut Tick,
    round_ms: u64,
    rows: &[RoundNode],
) -> RoundReport {
    let now = tick.now_ms;
    let mut rep = RoundReport {
        rows: rows.len(),
        ..RoundReport::default()
    };
    for row in rows {
        let Some(id) = st.nodes.id_of(&row.outpoint) else {
            continue;
        };
        if st.nodes.rec(id).is_none() {
            continue;
        }
        rep.matched += 1;
        let mut m = 0u16;
        let mut events: Vec<Event> = Vec::new();
        let mut persist = false;
        {
            let Some(e) = st.nodes.get_mut(id) else {
                continue;
            };
            let r = &mut e.rec;
            if row.reachable {
                if r.reachable == Some(false) {
                    events.push(Event::NodeRecovered { node: id });
                    rep.recovered += 1;
                }
                if r.reachable != Some(true) {
                    r.reachable = Some(true);
                    m |= mask::REACHABLE;
                    persist = true;
                }
                r.last_swept_ms = Some(round_ms);
                if let Some(hw) = &row.hw {
                    if hardware_material_change(r.hw.as_ref(), hw) {
                        // First sight of the hardware is not a change.
                        if r.hw.is_some() {
                            events.push(Event::NodeHardwareChanged {
                                node: id,
                                hardware: Box::new(hw.clone()),
                            });
                            rep.hardware_changed += 1;
                        }
                        r.hw = Some(hw.clone());
                        persist = true;
                    } else if r
                        .hw
                        .as_ref()
                        .is_some_and(|o| o.bench_time_ms != hw.bench_time_ms)
                    {
                        r.hw = Some(hw.clone());
                        persist = true;
                    }
                }
                if row.versions.flux_os.is_some() && row.versions != r.versions {
                    if r.versions.flux_os != row.versions.flux_os {
                        m |= mask::FLUX_OS;
                    }
                    if r.versions.flux_os.is_some() {
                        events.push(Event::NodeVersionChanged {
                            node: id,
                            versions: Box::new(row.versions.clone()),
                        });
                        rep.versions_changed += 1;
                    }
                    r.versions = row.versions.clone();
                    persist = true;
                }
                if let Some(g) = &row.geo
                    && geo_material_change(r.geo.as_ref(), g)
                {
                    events.push(Event::NodeLocated {
                        node: id,
                        geo: Box::new(g.clone()),
                    });
                    rep.located += 1;
                    r.geo = Some(g.clone());
                    m |= mask::GEO;
                    persist = true;
                }
                if row.arcane.is_some() && r.arcane != row.arcane {
                    r.arcane = row.arcane;
                    m |= mask::FLAGS;
                    persist = true;
                }
                if row.upnp.is_some() && r.upnp != row.upnp {
                    r.upnp = row.upnp;
                    persist = true;
                }
                if row.static_ip.is_some() && r.static_ip != row.static_ip {
                    r.static_ip = row.static_ip;
                    persist = true;
                }
                if row.zelid.is_some() && r.zelid.as_deref() != row.zelid.as_deref() {
                    r.zelid = row.zelid.as_deref().map(Into::into);
                    persist = true;
                }
                if let Some((o, i)) = row.peers
                    && (r.peers_out, r.peers_in) != (o, i)
                {
                    r.peers_out = o;
                    r.peers_in = i;
                }
                e.locked = row.locked;
            } else {
                rep.unreachable += 1;
                if r.reachable != Some(false) {
                    if r.reachable == Some(true) {
                        rep.went_unreachable += 1;
                    }
                    r.reachable = Some(false);
                    events.push(Event::NodeUnreachable { node: id });
                    m |= mask::REACHABLE;
                    persist = true;
                }
                e.locked = None;
            }
        }
        let watched = st.watched.contains(&id);
        for ev in events {
            if watched {
                watched_feed(tick, &ev, id, now);
            }
            tick.event(ev, Some(round_ms));
        }
        if persist {
            st.nodes.touch_persist(id);
        }
        if m != 0 {
            tick.node_changed(SW, id, m);
        }
    }
    st.round_ms = Some(round_ms);
    st.summary_dirty = true;
    tick.event(
        Event::StatsRound {
            round_ms,
            nodes: rep.matched as u32,
            unreachable: rep.unreachable,
        },
        Some(round_ms),
    );
    tick.publish = true;
    rep
}

/// Feed items for reachability changes of watched nodes.
pub fn watched_feed(tick: &mut Tick, ev: &Event, id: NodeId, now: u64) {
    let kind = match ev {
        Event::NodeUnreachable { .. } => FeedKind::NodeUnreachable,
        Event::NodeRecovered { .. } => FeedKind::NodeRecovered,
        _ => return,
    };
    tick.feed(kind, vec![FeedRef::Node { id }], &[], now);
}
