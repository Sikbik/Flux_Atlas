//! App derivations: placement (instances), catalog, chain-fed register/update messages,
//! pending messages, installs and install failures.

use std::collections::HashSet;

use atlas_core::app::{AppInstance, AppMessageRecord, AppRecord, AppSpec, PendingAppMessage};
use atlas_core::event::{AppMessageKind, Event};
use atlas_core::live::{
    AppInstallingMsg, AppPendingMsg, AppPendingResolvedMsg, DeltaCause, FeedKind, FeedRef, LiveBody,
};
use atlas_core::{Hash32, NodeEndpoint};

use crate::state::apps::{InstanceChange, PlacementDiff};
use crate::state::{NetworkState, Tick, mask};

/// Applies placement rows (`/apps/locations`, or one app's `/apps/location/<name>`).
pub fn apply_placement(
    st: &mut NetworkState,
    tick: &mut Tick,
    rows: Vec<(String, AppInstance)>,
    scope: Option<&str>,
) -> PlacementDiff {
    let cold = !st.apps.placement_loaded && scope.is_none();
    let mut diff = st.apps.apply_locations(rows, scope);
    let now = tick.now_ms;
    // Resolve node ids on every stored instance of touched apps.
    for name in &diff.touched {
        if let Some(rec) = st.apps.records.get_mut(name) {
            for i in &mut rec.locations {
                if i.node.is_none() {
                    i.node = st.nodes.resolve_endpoint(&i.endpoint);
                }
            }
            tick.batch.put_app(rec.clone());
        }
    }
    if !cold {
        for (app, changes) in &mut diff.changes {
            for ch in changes.iter_mut() {
                let inst = match ch {
                    InstanceChange::Started(i)
                    | InstanceChange::Removed(i)
                    | InstanceChange::Updated(i) => i,
                };
                if inst.node.is_none() {
                    inst.node = st.nodes.resolve_endpoint(&inst.endpoint);
                }
                let (event, which) = match ch {
                    InstanceChange::Started(i) => (
                        Event::AppInstanceStarted {
                            app: app.clone(),
                            node: i.node,
                            endpoint: i.endpoint,
                        },
                        0,
                    ),
                    InstanceChange::Removed(i) => (
                        Event::AppInstanceRemoved {
                            app: app.clone(),
                            node: i.node,
                            endpoint: i.endpoint,
                        },
                        1,
                    ),
                    InstanceChange::Updated(i) => (
                        Event::AppInstanceUpdated {
                            app: app.clone(),
                            node: i.node,
                            endpoint: i.endpoint,
                            spec_hash: i.spec_hash,
                        },
                        2,
                    ),
                };
                let node = ch.instance().node;
                tick.event(event, Some(now));
                if let Some(n) = node {
                    tick.app_instance(DeltaCause::Sweep, app, n, which);
                }
            }
        }
        for name in &diff.touched {
            tick.app_upserted(DeltaCause::Sweep, name);
        }
    }
    if !diff.touched.is_empty() || cold {
        refresh_app_counts(st, tick);
        st.summary_dirty = true;
        tick.publish = true;
    }
    diff
}

/// Recomputes every node's `app_count` from the instances.
pub fn refresh_app_counts(st: &mut NetworkState, tick: &mut Tick) {
    let counts = st.apps.endpoint_counts();
    let ids: Vec<_> = st
        .nodes
        .listed()
        .map(|e| (e.rec.id, e.rec.endpoint, e.rec.app_count))
        .collect();
    for (id, ep, old) in ids {
        let new = ep.and_then(|e| counts.get(&e).copied()).unwrap_or(0);
        if new != old {
            if let Some(e) = st.nodes.get_mut(id) {
                e.rec.app_count = new;
            }
            st.nodes.touch_persist(id);
            tick.node_changed(DeltaCause::Sweep, id, mask::APPS | mask::FLAGS);
        }
    }
}

/// What a catalog merge did.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CatalogReport {
    pub apps: usize,
    pub added: u32,
    pub updated: u32,
    pub removed: u32,
    /// Specs older than the record already held (a stale copy of the catalog), left alone.
    pub stale: u32,
    /// Apps missing from the catalog but registered or updated after its newest spec, kept.
    pub kept_newer: u32,
}

/// True when a catalog spec at `height` with `hash` should replace `old`. App records are
/// monotonic: a spec older than the held one never replaces it (a stale catalog fetch once
/// rolled records back to an older spec without any event), and at one height a known hash is
/// kept unless the held record has none.
fn supersedes(old: &AppRecord, hash: Option<Hash32>, height: u32) -> bool {
    match height.cmp(&old.height) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Equal => old.spec_hash.is_none() && hash.is_some(),
    }
}

/// Merges the global app catalog. The first load into an empty table emits no events.
///
/// Records only move forward (see [`supersedes`]), and an app missing from the catalog is
/// removed only when its record is not newer than the catalog's newest spec, so a stale copy of
/// the catalog neither rolls a record back nor drops an app registered after it was built.
pub fn apply_catalog(
    st: &mut NetworkState,
    tick: &mut Tick,
    specs: Vec<(AppSpec, Option<Hash32>, u32)>,
) -> CatalogReport {
    let now = tick.now_ms;
    let cold = !st.apps.catalog_loaded;
    let mut rep = CatalogReport {
        apps: specs.len(),
        ..CatalogReport::default()
    };
    let catalog_height = specs.iter().map(|(_, _, h)| *h).max().unwrap_or(0);
    let mut seen = HashSet::with_capacity(specs.len());
    for (spec, hash, height) in specs {
        let key = spec.key();
        if key.is_empty() {
            continue;
        }
        seen.insert(key.clone());
        match st.apps.records.get(&key) {
            None => {
                let rec = AppRecord::from_spec(spec, hash, height, now);
                if !cold && !hash.is_some_and(|h| st.apps.applied.contains(&h)) {
                    tick.event(
                        Event::AppRegistered {
                            app: key.clone(),
                            owner: rec.spec.owner.clone(),
                            spec_hash: hash,
                            height,
                            paid: None,
                        },
                        None,
                    );
                    tick.feed(
                        FeedKind::AppDeployed,
                        vec![FeedRef::App { name: key.clone() }],
                        &[],
                        now,
                    );
                }
                if let Some(h) = hash {
                    st.apps.applied.insert(h);
                }
                tick.batch.put_app(rec.clone());
                st.apps.records.insert(key.clone(), rec);
                tick.app_upserted(DeltaCause::Reconcile, &key);
                rep.added += 1;
            }
            Some(old) if old.spec_hash == hash && old.height == height => {}
            Some(old) if !supersedes(old, hash, height) => rep.stale += 1,
            Some(old) => {
                let changed = old.spec.diff(&spec);
                let mut rec = AppRecord::from_spec(spec, hash, height, now);
                rec.first_seen_ms = old.first_seen_ms;
                rec.registered_height = old.registered_height;
                rec.locations.clone_from(&old.locations);
                if !cold && !hash.is_some_and(|h| st.apps.applied.contains(&h)) {
                    update_event(tick, &key, &changed, hash, height, rec.expire_height, None);
                }
                if let Some(h) = hash {
                    st.apps.applied.insert(h);
                }
                tick.batch.put_app(rec.clone());
                st.apps.records.insert(key.clone(), rec);
                tick.app_upserted(DeltaCause::Reconcile, &key);
                rep.updated += 1;
            }
        }
    }
    let mut gone: Vec<String> = Vec::new();
    for (k, r) in &st.apps.records {
        if seen.contains(k) {
            continue;
        }
        if r.height > catalog_height {
            rep.kept_newer += 1;
        } else {
            gone.push(k.clone());
        }
    }
    for name in gone {
        st.apps.records.remove(&name);
        tick.batch.delete_app(&name);
        tick.event(Event::AppExpired { app: name.clone() }, None);
        tick.feed(
            FeedKind::AppExpired,
            vec![FeedRef::App { name: name.clone() }],
            &[],
            now,
        );
        tick.app_removed(DeltaCause::Reconcile, &name);
        rep.removed += 1;
    }
    st.apps.catalog_loaded = true;
    if rep.added + rep.updated + rep.removed > 0 {
        st.apps.dirty = true;
        st.summary_dirty = true;
        refresh_app_counts(st, tick);
    }
    rep
}

fn update_event(
    tick: &mut Tick,
    app: &str,
    changed: &[String],
    hash: Option<Hash32>,
    height: u32,
    expire_height: u32,
    paid: Option<atlas_core::Amount>,
) {
    let now = tick.now_ms;
    if changed.is_empty() || changed.iter().all(|c| c == "expire_blocks") {
        tick.event(
            Event::AppRenewed {
                app: app.to_owned(),
                height,
                expire_height,
            },
            None,
        );
        tick.feed(
            FeedKind::AppRenewed,
            vec![FeedRef::App {
                name: app.to_owned(),
            }],
            &[],
            now,
        );
    } else {
        tick.event(
            Event::AppUpdated {
                app: app.to_owned(),
                spec_hash: hash,
                height,
                changed: changed.to_vec(),
                paid,
            },
            None,
        );
        tick.feed(
            FeedKind::AppUpdated,
            vec![FeedRef::App {
                name: app.to_owned(),
            }],
            &[("changed", changed.len().to_string())],
            now,
        );
    }
}

/// Applies a mined register/update message found through the block's OP_RETURN.
pub fn apply_app_message(st: &mut NetworkState, tick: &mut Tick, msg: &AppMessageRecord) -> bool {
    let now = tick.now_ms;
    tick.batch.put_app_message(msg.clone());
    if let Some(p) = st.apps.pending.remove(&msg.hash) {
        resolve_pending(tick, &p, true);
    }
    if !st.apps.applied.insert(msg.hash) {
        return false;
    }
    let key = msg.spec.key();
    let old = st.apps.records.get(&key);
    if old.is_some_and(|o| o.height > msg.height) {
        return false;
    }
    let mut rec = AppRecord::from_spec(msg.spec.clone(), Some(msg.hash), msg.height, now);
    let changed = old.map(|o| o.spec.diff(&msg.spec)).unwrap_or_default();
    if let Some(o) = old {
        rec.first_seen_ms = o.first_seen_ms;
        rec.registered_height = o.registered_height;
        rec.locations.clone_from(&o.locations);
    }
    match msg.kind {
        AppMessageKind::Register => {
            rec.registered_height = rec.registered_height.or(Some(msg.height));
            tick.event(
                Event::AppRegistered {
                    app: key.clone(),
                    owner: msg.spec.owner.clone(),
                    spec_hash: Some(msg.hash),
                    height: msg.height,
                    paid: Some(msg.paid),
                },
                Some(msg.timestamp_ms),
            );
            tick.feed(
                FeedKind::AppDeployed,
                vec![
                    FeedRef::App { name: key.clone() },
                    FeedRef::Block { height: msg.height },
                ],
                &[("paid", msg.paid.to_string())],
                now,
            );
        }
        AppMessageKind::Update => update_event(
            tick,
            &key,
            &changed,
            Some(msg.hash),
            msg.height,
            rec.expire_height,
            Some(msg.paid),
        ),
    }
    tick.batch.put_app(rec.clone());
    st.apps.records.insert(key.clone(), rec);
    st.apps.dirty = true;
    st.summary_dirty = true;
    tick.app_upserted(DeltaCause::Block, &key);
    true
}

fn resolve_pending(tick: &mut Tick, p: &PendingAppMessage, mined: bool) {
    let app = p.spec.key();
    tick.batch.delete_pending(p.hash);
    tick.event(
        Event::AppPendingResolved {
            app: app.clone(),
            hash: p.hash,
            mined,
        },
        None,
    );
    tick.after.push((
        LiveBody::AppPendingResolved(AppPendingResolvedMsg {
            hash: p.hash,
            app,
            mined,
        }),
        None,
    ));
}

/// Diffs the pending (broadcast, unmined) messages. Messages that vanish are kept until mined
/// (resolved by the chain feed) or past `expires_ms` (resolved unpaid).
pub fn apply_pending(st: &mut NetworkState, tick: &mut Tick, msgs: Vec<PendingAppMessage>) -> u32 {
    let now = tick.now_ms;
    let mut added = 0;
    for m in msgs {
        if st.apps.pending.contains_key(&m.hash) || st.apps.applied.contains(&m.hash) {
            continue;
        }
        let app = m.spec.key();
        tick.event(
            Event::AppPending {
                app: app.clone(),
                hash: m.hash,
                kind: m.kind,
                received_ms: m.received_ms,
                expires_ms: m.expires_ms,
            },
            Some(m.received_ms),
        );
        tick.after.push((
            LiveBody::AppPending(AppPendingMsg {
                hash: m.hash,
                app: app.clone(),
                kind: m.kind,
                received_ms: m.received_ms,
                expires_ms: m.expires_ms,
            }),
            Some(m.received_ms),
        ));
        tick.feed(
            FeedKind::AppPending,
            vec![FeedRef::App { name: app }],
            &[(
                "kind",
                match m.kind {
                    AppMessageKind::Register => "register".to_owned(),
                    AppMessageKind::Update => "update".to_owned(),
                },
            )],
            now,
        );
        tick.batch.put_pending(m.clone());
        st.apps.pending.insert(m.hash, m);
        added += 1;
    }
    expire_pending(st, tick);
    added
}

/// Resolves pending messages past their expiry as unpaid.
pub fn expire_pending(st: &mut NetworkState, tick: &mut Tick) {
    let now = tick.now_ms;
    let doomed: Vec<Hash32> = st
        .apps
        .pending
        .values()
        .filter(|p| p.expires_ms <= now)
        .map(|p| p.hash)
        .collect();
    for h in doomed {
        if let Some(p) = st.apps.pending.remove(&h) {
            resolve_pending(tick, &p, false);
        }
    }
}

/// Diffs in-progress installs.
pub fn apply_installing(
    st: &mut NetworkState,
    tick: &mut Tick,
    rows: Vec<(String, NodeEndpoint)>,
) -> u32 {
    let now = tick.now_ms;
    let new: HashSet<(String, NodeEndpoint)> = rows
        .into_iter()
        .map(|(a, e)| (a.to_ascii_lowercase(), e))
        .collect();
    let mut started = 0;
    for (app, ep) in &new {
        if st.apps.installing.contains(&(app.clone(), *ep)) {
            continue;
        }
        let node = st.nodes.resolve_endpoint(ep);
        tick.event(
            Event::AppInstalling {
                app: app.clone(),
                node,
                endpoint: *ep,
            },
            Some(now),
        );
        tick.after.push((
            LiveBody::AppInstalling(AppInstallingMsg {
                app: app.clone(),
                node,
                endpoint: ep.to_string(),
            }),
            Some(now),
        ));
        started += 1;
    }
    st.apps.installing = new;
    started
}

/// Reports install failures not seen before. The first poll only primes the set.
pub fn apply_install_errors(
    st: &mut NetworkState,
    tick: &mut Tick,
    rows: Vec<(String, NodeEndpoint, String)>,
    prime: bool,
) -> u32 {
    let now = tick.now_ms;
    let mut n = 0;
    for (app, ep, error) in rows {
        let app = app.to_ascii_lowercase();
        let key = (app.clone(), error.clone(), ep);
        if !st.apps.install_errors.insert(key) || prime {
            continue;
        }
        let node = st.nodes.resolve_endpoint(&ep);
        tick.event(
            Event::AppInstallFailed {
                app: app.clone(),
                node,
                endpoint: ep,
                error: error.chars().take(300).collect(),
            },
            Some(now),
        );
        let mut refs = vec![FeedRef::App { name: app }];
        if let Some(id) = node {
            refs.push(FeedRef::Node { id });
        }
        tick.feed(FeedKind::AppInstallFailed, refs, &[], now);
        n += 1;
    }
    n
}
