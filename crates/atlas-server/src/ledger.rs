//! Store-derived ledgers kept in memory, so the endpoints that need history stay memory reads:
//!
//! - [`PayoutLedger`]: the payouts of the last 30 days of stored blocks, by payment address
//!   (operator earnings);
//! - [`AppLedger`]: every permanent app message in compact form (the app economy).
//!
//! Each lives in a [`Slot`] that is rebuilt from the store in the background when its key moves
//! (stale-while-revalidate); only the very first request waits for a build.

use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};

use atlas_core::api::{AppEconomyDay, AppEconomyDto, AppSpend};
use atlas_core::app::app_expire_height;
use atlas_core::emission::PON_ACTIVATION_HEIGHT;
use atlas_core::event::AppMessageKind;
use atlas_core::{Amount, NodeId, Tier};
use atlas_store::Store;
use compact_str::CompactString;

use crate::error::ApiError;

/// Blocks per day at the PoN target spacing.
pub const BLOCKS_PER_DAY: u32 = 2_880;
/// Window lengths in blocks.
pub const WINDOW_24H: u32 = BLOCKS_PER_DAY;
pub const WINDOW_7D: u32 = 7 * BLOCKS_PER_DAY;
pub const WINDOW_30D: u32 = 30 * BLOCKS_PER_DAY;
/// Milliseconds per block (estimates of block times from heights).
const BLOCK_MS: u64 = 30_000;
const DAY_MS: u64 = 86_400_000;

// ---------------------------------------------------------------------------------------------
// Slot: a value rebuilt in the background
// ---------------------------------------------------------------------------------------------

struct SlotState<T> {
    value: Option<(Instant, u64, Arc<T>)>,
    refreshing: bool,
}

/// A shared value keyed by a cheap version number. A request with a newer key gets the held
/// value while one background task rebuilds it (at most every `min_age`); a value older than
/// `max_age` is rebuilt whatever the key. Only the first request waits.
pub struct Slot<T> {
    state: tokio::sync::Mutex<SlotState<T>>,
}

impl<T> Default for Slot<T> {
    fn default() -> Self {
        Self {
            state: tokio::sync::Mutex::new(SlotState {
                value: None,
                refreshing: false,
            }),
        }
    }
}

impl<T: Send + Sync + 'static> Slot<T> {
    /// The held value, refreshing it as described on [`Slot`]. `build` runs at most once per
    /// call (inline the first time, in a spawned task afterwards).
    pub async fn get<F, Fut>(
        self: &Arc<Self>,
        key: u64,
        min_age: Duration,
        max_age: Duration,
        build: F,
    ) -> Result<Arc<T>, ApiError>
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<T, ApiError>> + Send + 'static,
    {
        let mut st = self.state.lock().await;
        if let Some((at, held_key, v)) = st.value.as_ref() {
            let v = Arc::clone(v);
            let age = at.elapsed();
            let stale = (*held_key != key && age >= min_age) || age >= max_age;
            if stale && !st.refreshing {
                st.refreshing = true;
                let slot = Arc::clone(self);
                tokio::spawn(async move {
                    let built = build().await;
                    let mut st = slot.state.lock().await;
                    st.refreshing = false;
                    match built {
                        Ok(v) => st.value = Some((Instant::now(), key, Arc::new(v))),
                        Err(e) => tracing::warn!(error = %e.message, "ledger rebuild failed"),
                    }
                });
            }
            return Ok(v);
        }
        let v = Arc::new(build().await?);
        st.value = Some((Instant::now(), key, Arc::clone(&v)));
        Ok(v)
    }
}

// ---------------------------------------------------------------------------------------------
// Payouts by address
// ---------------------------------------------------------------------------------------------

/// One payout of a stored block.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PayoutEntry {
    pub height: u32,
    pub amount: Amount,
    pub tier: Tier,
    /// The exact node, when the block was attributed.
    pub node: Option<NodeId>,
}

/// The payouts of the contiguous stored blocks of the last 30 days, by payment address.
#[derive(Debug, Default)]
pub struct PayoutLedger {
    /// Highest stored block.
    pub tip: Option<u32>,
    /// First block of the contiguous stored range ending at `tip` (at most 30 days back).
    pub from: Option<u32>,
    pub from_ms: Option<u64>,
    by_address: HashMap<CompactString, Vec<PayoutEntry>>,
}

/// Sums of one operator's payouts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Earnings {
    pub d1: Option<Amount>,
    pub d7: Option<Amount>,
    pub d30: Option<Amount>,
    pub covered: Option<Amount>,
}

impl PayoutLedger {
    /// Reads the ledger from the store.
    pub fn build(st: &Store) -> Result<Self, ApiError> {
        let Some(tip) = st.tip_block()?.map(|b| b.height) else {
            return Ok(Self::default());
        };
        let floor = tip.saturating_sub(WINDOW_30D - 1);
        let Some(from) = st.contiguous_from(tip, floor)? else {
            return Ok(Self::default());
        };
        let from_ms = st.block(from)?.map(|b| b.time_ms);
        let mut by_address: HashMap<CompactString, Vec<PayoutEntry>> = HashMap::new();
        for (height, p) in st.payouts_range(from, tip)? {
            by_address.entry(p.address).or_default().push(PayoutEntry {
                height,
                amount: p.amount,
                tier: p.tier,
                node: p.node,
            });
        }
        Ok(Self {
            tip: Some(tip),
            from: Some(from),
            from_ms,
            by_address,
        })
    }

    /// Payouts to `address`, ascending by height.
    pub fn payouts(&self, address: &str) -> &[PayoutEntry] {
        self.by_address.get(address).map_or(&[], Vec::as_slice)
    }

    /// True when every block of the last `blocks` blocks up to the tip is in the ledger.
    pub fn covers(&self, blocks: u32) -> bool {
        match (self.tip, self.from) {
            (Some(tip), Some(from)) => u64::from(from) + u64::from(blocks) <= u64::from(tip) + 1,
            _ => false,
        }
    }

    /// Sums the payouts `keep` selects over the windows.
    pub fn earnings<'a>(&self, entries: impl Iterator<Item = &'a PayoutEntry>) -> Earnings {
        let Some(tip) = self.tip else {
            return Earnings::default();
        };
        let mut sums = [Amount::ZERO; 4];
        let windows = [WINDOW_24H, WINDOW_7D, WINDOW_30D, u32::MAX];
        for e in entries {
            let age = tip.saturating_sub(e.height);
            for (i, w) in windows.iter().enumerate() {
                if age < *w {
                    sums[i] += e.amount;
                }
            }
        }
        let pick = |i: usize, w: u32| self.covers(w).then_some(sums[i]);
        Earnings {
            d1: pick(0, WINDOW_24H),
            d7: pick(1, WINDOW_7D),
            d30: pick(2, WINDOW_30D),
            covered: self.from.map(|_| sums[3]),
        }
    }
}

// ---------------------------------------------------------------------------------------------
// App messages
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
struct Msg {
    height: u32,
    register: bool,
    paid: Amount,
    app: u32,
}

/// Every permanent app message in compact form, plus each app's active intervals.
#[derive(Debug, Default)]
pub struct AppLedger {
    /// The one-time `permanentmessages` backfill has finished.
    pub complete: bool,
    /// `(key, display name)` per app index.
    names: Vec<(String, String)>,
    /// Ascending by height.
    msgs: Vec<Msg>,
    /// Per app: FLUX paid and messages over the whole history, and the latest height.
    all_time: Vec<(Amount, u32, u32)>,
    /// Starts and ends of the merged active intervals `[start, end)`, each sorted.
    starts: Vec<u32>,
    ends: Vec<u32>,
}

impl AppLedger {
    /// Reads every stored message.
    pub fn build(st: &Store, complete: bool) -> Result<Self, ApiError> {
        let mut index: HashMap<String, u32> = HashMap::new();
        let mut names: Vec<(String, String, u32)> = Vec::new();
        let mut per_app: Vec<Vec<(u32, u32)>> = Vec::new();
        let mut msgs: Vec<Msg> = Vec::new();
        st.for_each_app_message(|m| {
            let key = m.spec.key();
            let app = *index.entry(key.clone()).or_insert_with(|| {
                names.push((key, m.spec.name.clone(), m.height));
                per_app.push(Vec::new());
                (names.len() - 1) as u32
            });
            let n = &mut names[app as usize];
            if m.height >= n.2 {
                n.1.clone_from(&m.spec.name);
                n.2 = m.height;
            }
            per_app[app as usize]
                .push((m.height, app_expire_height(m.height, m.spec.expire_blocks)));
            msgs.push(Msg {
                height: m.height,
                register: m.kind == AppMessageKind::Register,
                paid: m.paid,
                app,
            });
        })?;
        msgs.sort_by_key(|m| (m.height, m.app));
        let mut all_time = vec![(Amount::ZERO, 0u32, 0u32); names.len()];
        for m in &msgs {
            let a = &mut all_time[m.app as usize];
            a.0 += m.paid;
            a.1 += 1;
            a.2 = a.2.max(m.height);
        }
        let (mut starts, mut ends) = (Vec::new(), Vec::new());
        for mut list in per_app {
            list.sort_unstable();
            let mut cur: Option<(u32, u32)> = None;
            for (i, (h, exp)) in list.iter().enumerate() {
                // A newer message replaces the expiry of the one before it.
                let end = list.get(i + 1).map_or(*exp, |(next, _)| (*exp).min(*next));
                if end <= *h {
                    continue;
                }
                cur = match cur {
                    Some((s, e)) if *h <= e => Some((s, e.max(end))),
                    Some((s, e)) => {
                        starts.push(s);
                        ends.push(e);
                        Some((*h, end))
                    }
                    None => Some((*h, end)),
                };
            }
            if let Some((s, e)) = cur {
                starts.push(s);
                ends.push(e);
            }
        }
        starts.sort_unstable();
        ends.sort_unstable();
        Ok(Self {
            complete,
            names: names.into_iter().map(|(k, d, _)| (k, d)).collect(),
            msgs,
            all_time,
            starts,
            ends,
        })
    }

    pub fn message_count(&self) -> usize {
        self.msgs.len()
    }

    /// Apps whose latest spec has not expired at `height`.
    pub fn active_at(&self, height: u32) -> u32 {
        let s = self.starts.partition_point(|x| *x <= height);
        let e = self.ends.partition_point(|x| *x <= height);
        (s - e) as u32
    }

    fn spend(&self, app: u32, paid: Amount, messages: u32, last_height: u32) -> AppSpend {
        let (name, display) = &self.names[app as usize];
        AppSpend {
            name: name.clone(),
            display_name: display.clone(),
            paid,
            messages,
            last_height,
        }
    }

    /// The economy at `tip` (height and block time) over the last `days` UTC days.
    pub fn economy(
        &self,
        tip: u32,
        tip_ms: u64,
        days: u32,
        top: usize,
        now_ms: u64,
    ) -> AppEconomyDto {
        let first_in = |w: u32| {
            let lo = tip.saturating_sub(w - 1);
            self.msgs.partition_point(|m| m.height < lo)
        };
        let upto = self.msgs.partition_point(|m| m.height <= tip);
        let window = |w: u32| &self.msgs[first_in(w).min(upto)..upto];
        let paid = |w: u32| window(w).iter().map(|m| m.paid).sum::<Amount>();
        let complete = self.complete;
        let last30 = window(WINDOW_30D);
        let registrations = last30.iter().filter(|m| m.register).count() as u32;

        // Day rows: block times estimated back from the tip (see `est_time`).
        let time_of = |h: u32| est_time(h, tip, tip_ms);
        let height_at = |t: u64| est_height(t, tip, tip_ms);
        let today = now_ms.max(tip_ms) / DAY_MS * DAY_MS;
        let first_day = today.saturating_sub(u64::from(days.max(1) - 1) * DAY_MS);
        let mut rows: Vec<AppEconomyDay> = (0..u64::from(days.max(1)))
            .map(|i| {
                let day_ms = first_day + i * DAY_MS;
                let end = (day_ms + DAY_MS - 1).min(tip_ms);
                AppEconomyDay {
                    day_ms,
                    registrations: 0,
                    updates: 0,
                    paid: Amount::ZERO,
                    active_apps: if day_ms > tip_ms {
                        0
                    } else {
                        self.active_at(height_at(end))
                    },
                }
            })
            .collect();
        let lo = height_at(first_day);
        let start = self.msgs.partition_point(|m| m.height < lo);
        for m in &self.msgs[start.min(upto)..upto] {
            let t = time_of(m.height);
            if t < first_day {
                continue;
            }
            let i = ((t - first_day) / DAY_MS) as usize;
            if let Some(r) = rows.get_mut(i) {
                if m.register {
                    r.registrations += 1;
                } else {
                    r.updates += 1;
                }
                r.paid += m.paid;
            }
        }

        let mut by_app: HashMap<u32, (Amount, u32, u32)> = HashMap::new();
        for m in last30 {
            let e = by_app.entry(m.app).or_default();
            e.0 += m.paid;
            e.1 += 1;
            e.2 = e.2.max(m.height);
        }
        let mut top30: Vec<(u32, (Amount, u32, u32))> = by_app.into_iter().collect();
        top30.sort_by(|a, b| b.1.0.cmp(&a.1.0).then(a.0.cmp(&b.0)));
        let mut all: Vec<(u32, &(Amount, u32, u32))> = self
            .all_time
            .iter()
            .enumerate()
            .map(|(i, v)| (i as u32, v))
            .collect();
        all.sort_by(|a, b| b.1.0.cmp(&a.1.0).then(a.0.cmp(&b.0)));

        AppEconomyDto {
            generated_ms: now_ms,
            tip_height: tip,
            history_complete: self.complete,
            paid_24h: complete.then(|| paid(WINDOW_24H)),
            paid_7d: complete.then(|| paid(WINDOW_7D)),
            paid_30d: complete.then(|| paid(WINDOW_30D)),
            registrations_30d: complete.then_some(registrations),
            updates_30d: complete.then_some(last30.len() as u32 - registrations),
            messages_total: self.msgs.len() as u32,
            paid_all_time: self.all_time.iter().map(|a| a.0).sum(),
            active_apps: self.active_at(tip),
            days: rows,
            top_apps_30d: top30
                .into_iter()
                .take(top)
                .map(|(app, (p, n, h))| self.spend(app, p, n, h))
                .collect(),
            top_apps_all_time: all
                .into_iter()
                .take(top)
                .map(|(app, (p, n, h))| self.spend(app, *p, *n, *h))
                .collect(),
        }
    }
}

/// Milliseconds per block before the PoN fork.
const POW_BLOCK_MS: u64 = 120_000;

/// Estimated time of block `h` counted back from the tip: 30 s per block down to the PoN fork,
/// 2 minutes per block before it.
pub fn est_time(h: u32, tip: u32, tip_ms: u64) -> u64 {
    let fork = PON_ACTIVATION_HEIGHT.min(tip);
    if h >= fork {
        return tip_ms.saturating_sub(u64::from(tip.saturating_sub(h)) * BLOCK_MS);
    }
    let fork_ms = tip_ms.saturating_sub(u64::from(tip - fork) * BLOCK_MS);
    fork_ms.saturating_sub(u64::from(fork - h) * POW_BLOCK_MS)
}

/// The last height whose estimated time ([`est_time`]) is at or before `t`.
pub fn est_height(t: u64, tip: u32, tip_ms: u64) -> u32 {
    if t >= tip_ms {
        return tip;
    }
    let fork = PON_ACTIVATION_HEIGHT.min(tip);
    let fork_ms = est_time(fork, tip, tip_ms);
    if t >= fork_ms {
        return tip - ((tip_ms - t).div_ceil(BLOCK_MS)) as u32;
    }
    fork.saturating_sub(((fork_ms - t).div_ceil(POW_BLOCK_MS)) as u32)
}

#[cfg(test)]
mod tests {
    use atlas_core::Hash32;
    use atlas_core::app::{AppMessageRecord, AppSpec};
    use atlas_core::chain::{BlockSummary, Payout};

    use super::*;

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let st = Store::open(dir.path().join("t.redb")).unwrap();
        (dir, st)
    }

    fn block(height: u32, payouts: Vec<Payout>) -> BlockSummary {
        let mut hash = [0u8; 32];
        hash[..4].copy_from_slice(&height.to_le_bytes());
        BlockSummary {
            height,
            hash: Hash32(hash),
            prev_hash: Hash32::default(),
            time_ms: u64::from(height) * 30_000,
            size: 1000,
            tx_count: 1,
            kind: atlas_core::chain::BlockKind::Pon,
            version: 100,
            producer_collateral: None,
            producer: None,
            payouts: payouts.into_iter().collect(),
            dev_fund: Amount::ZERO,
            fees: Amount::ZERO,
            reward: Amount::from_flux(14),
            value_out: Amount::ZERO,
            confirm_count: 0,
            start_count: 0,
            transfer_count: 0,
        }
    }

    fn payout(tier: Tier, address: &str, flux: i64, node: Option<u32>) -> Payout {
        Payout {
            tier,
            address: address.into(),
            amount: Amount::from_flux(flux),
            node: node.map(NodeId),
        }
    }

    #[test]
    fn block_time_estimates_cross_the_fork() {
        let (tip, tip_ms) = (3_000_000u32, 1_790_000_000_000u64);
        assert_eq!(est_time(tip, tip, tip_ms), tip_ms);
        assert_eq!(est_time(tip - 2_880, tip, tip_ms), tip_ms - DAY_MS);
        let fork_ms = tip_ms - u64::from(tip - PON_ACTIVATION_HEIGHT) * 30_000;
        assert_eq!(est_time(PON_ACTIVATION_HEIGHT, tip, tip_ms), fork_ms);
        assert_eq!(
            est_time(PON_ACTIVATION_HEIGHT - 720, tip, tip_ms),
            fork_ms - DAY_MS
        );
        for h in [
            tip,
            tip - 1,
            tip - 2_880,
            PON_ACTIVATION_HEIGHT + 1,
            PON_ACTIVATION_HEIGHT,
            1_900_000,
        ] {
            let t = est_time(h, tip, tip_ms);
            assert_eq!(est_height(t, tip, tip_ms), h);
            assert_eq!(est_height(t + 1, tip, tip_ms), h);
            assert!(est_height(t - 1, tip, tip_ms) < h);
        }
    }

    #[test]
    fn earnings_follow_the_windows_and_their_coverage() {
        let (_d, st) = store();
        let tip = 100_000u32;
        let mut b = atlas_store::WriteBatch::default();
        // Ten days of blocks: every block pays "A" 1 FLUX (Cumulus) and "B" 9 FLUX (Stratus).
        for h in (tip - 10 * BLOCKS_PER_DAY + 1)..=tip {
            b.put_block(block(
                h,
                vec![
                    payout(Tier::Cumulus, "A", 1, None),
                    payout(Tier::Stratus, "B", 9, Some(7)),
                ],
            ));
        }
        st.commit(b).unwrap();
        let l = PayoutLedger::build(&st).unwrap();
        assert_eq!(l.tip, Some(tip));
        assert_eq!(l.from, Some(tip - 10 * BLOCKS_PER_DAY + 1));
        assert!(l.covers(WINDOW_7D) && !l.covers(WINDOW_30D));
        let e = l.earnings(l.payouts("A").iter());
        assert_eq!(e.d1, Some(Amount::from_flux(2_880)));
        assert_eq!(e.d7, Some(Amount::from_flux(20_160)));
        assert_eq!(
            e.d30, None,
            "30 days are not stored: unknown, not a partial sum"
        );
        assert_eq!(e.covered, Some(Amount::from_flux(28_800)));
        assert_ne!(e.d1, e.d7);
        // A gap breaks the contiguous range: only the blocks above it count.
        let mut b = atlas_store::WriteBatch::default();
        b.delete_blocks_from(tip - BLOCKS_PER_DAY);
        st.commit(b).unwrap();
        let mut b = atlas_store::WriteBatch::default();
        for h in (tip - BLOCKS_PER_DAY + 1)..=tip {
            b.put_block(block(h, vec![payout(Tier::Cumulus, "A", 1, None)]));
        }
        st.commit(b).unwrap();
        let l = PayoutLedger::build(&st).unwrap();
        assert_eq!(l.from, Some(tip - BLOCKS_PER_DAY + 1));
        let e = l.earnings(l.payouts("A").iter());
        assert_eq!(e.d1, Some(Amount::from_flux(2_880)));
        assert_eq!(e.d7, None);
        // Empty store: nothing known.
        let (_d2, empty) = store();
        let l = PayoutLedger::build(&empty).unwrap();
        assert_eq!(l.earnings(l.payouts("A").iter()), Earnings::default());
    }

    fn msg(
        name: &str,
        height: u32,
        kind: AppMessageKind,
        flux: i64,
        expire: u32,
    ) -> AppMessageRecord {
        let mut hash = [0u8; 32];
        hash[..4].copy_from_slice(&height.to_le_bytes());
        hash[4..8].copy_from_slice(&(name.len() as u32).to_le_bytes());
        hash[8] = name.as_bytes()[0];
        AppMessageRecord {
            hash: Hash32(hash),
            txid: None,
            height,
            timestamp_ms: 0,
            kind,
            paid: Amount::from_flux(flux),
            spec: AppSpec {
                spec_version: 8,
                name: name.to_owned(),
                expire_blocks: Some(expire),
                ..AppSpec::default()
            },
        }
    }

    #[test]
    fn app_economy_windows_days_and_active_apps() {
        let (_d, st) = store();
        let tip = 3_000_000u32;
        let day = BLOCKS_PER_DAY;
        let mut b = atlas_store::WriteBatch::default();
        // Alpha: registered 40 days ago for 10 days, renewed 35 days ago (gap: expired between
        // day -30 and the update?) and updated today.
        b.put_app_message(msg(
            "Alpha",
            tip - 40 * day,
            AppMessageKind::Register,
            10,
            10 * day,
        ));
        b.put_app_message(msg(
            "alpha",
            tip - 35 * day,
            AppMessageKind::Update,
            5,
            10 * day,
        ));
        b.put_app_message(msg("Alpha", tip - 10, AppMessageKind::Update, 3, 30 * day));
        // Beta: registered 2 days ago, 100 FLUX, still active.
        b.put_app_message(msg(
            "Beta",
            tip - 2 * day,
            AppMessageKind::Register,
            100,
            20 * day,
        ));
        // Gamma: registered 60 days ago for 5 days: long expired.
        b.put_app_message(msg(
            "Gamma",
            tip - 60 * day,
            AppMessageKind::Register,
            1,
            5 * day,
        ));
        st.commit(b).unwrap();
        let l = AppLedger::build(&st, true).unwrap();
        assert_eq!(l.message_count(), 5);
        let tip_ms = 1_790_000_000_000u64;
        let e = l.economy(tip, tip_ms, 45, 10, tip_ms);
        assert_eq!(e.paid_24h, Some(Amount::from_flux(3)));
        assert_eq!(e.paid_7d, Some(Amount::from_flux(103)));
        assert_eq!(e.paid_30d, Some(Amount::from_flux(103)));
        assert_eq!((e.registrations_30d, e.updates_30d), (Some(1), Some(1)));
        assert_eq!(e.messages_total, 5);
        assert_eq!(e.paid_all_time, Amount::from_flux(119));
        // Alpha (updated today) and Beta are active at the tip.
        assert_eq!(e.active_apps, 2);
        assert_eq!(e.days.len(), 45);
        assert_eq!(e.days.iter().map(|d| d.registrations).sum::<u32>(), 2);
        assert_eq!(e.days.iter().map(|d| d.updates).sum::<u32>(), 2);
        // Alpha lapsed 25 days ago (its 35-day-old update ran 10 days) until today's update.
        let lapsed = e
            .days
            .iter()
            .find(|d| d.day_ms + 20 * DAY_MS <= tip_ms)
            .unwrap();
        assert_eq!(lapsed.active_apps, 0, "{lapsed:?}");
        let last = e.days.last().unwrap();
        assert_eq!(last.active_apps, 2);
        assert_eq!(e.top_apps_30d[0].name, "beta");
        assert_eq!(e.top_apps_30d[0].paid, Amount::from_flux(100));
        assert_eq!(e.top_apps_all_time[1].name, "alpha");
        assert_eq!(e.top_apps_all_time[1].messages, 3);
        assert_eq!(e.top_apps_all_time[1].display_name, "Alpha");
        // Incomplete history: windows unknown, not partial sums.
        let l = AppLedger::build(&st, false).unwrap();
        let e = l.economy(tip, tip_ms, 7, 5, tip_ms);
        assert_eq!((e.paid_24h, e.paid_30d, e.updates_30d), (None, None, None));
        assert!(!e.history_complete);
    }
}
