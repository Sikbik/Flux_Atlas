//! T3 WatchProbe: direct `/flux/version` probes of watched hosts every 60 s, through the SSRF
//! guard. Gives near-real-time offline detection for the nodes people are looking at.
//!
//! Scheduling (X1 M6):
//! - **Targets** are up to [`MAX_HOSTS`] hosts of the watched nodes, picked by fair share
//!   across connections ([`crate::EngineHandle::probe_nodes`]), not the lowest IPs.
//! - **Per-host cadence.** A host is probed when it was not probed in the last interval
//!   (60 s), whatever the watch lists do. A watch change never restarts a round.
//! - **New targets soon.** A watch change wakes the job after a debounce (2 s); only hosts
//!   never probed, or not within the interval, are probed then.
//! - **Bounded total.** Every probe takes a token from a bucket of [`MAX_HOSTS`] per interval,
//!   so watch churn cannot raise the probe rate above the steady state of [`MAX_HOSTS`] hosts
//!   every 60 s.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::net::IpAddr;
use std::time::Duration;

use atlas_core::NodeId;
use atlas_flux::GuardedEndpoint;
use tokio::sync::watch;
use tokio::task::JoinSet;
use tokio::time::Instant;

use super::JobCtx;
use crate::WatchSet;
use crate::obs::Obs;
use crate::stats::Upstream;

/// Hosts probed per interval at most (targets, and the token bucket size).
pub const MAX_HOSTS: usize = 256;
/// Wait after a watch change before probing new targets.
pub const DEBOUNCE: Duration = Duration::from_secs(2);
/// Probes in flight at once (each to a different host).
pub const CONCURRENCY: usize = 16;
/// Shortest sleep between scheduling passes.
const MIN_GAP: Duration = Duration::from_secs(1);

/// Probe budget.
#[derive(Debug, Clone, Copy)]
pub struct ProbeBudget {
    /// Per-host cadence, and the refill period of the token bucket.
    pub interval: Duration,
    /// Probes per interval in total (bucket capacity and refill).
    pub per_interval: u32,
    pub debounce: Duration,
    pub concurrency: usize,
}

impl ProbeBudget {
    pub fn standard(interval: Duration) -> Self {
        Self {
            interval,
            per_interval: MAX_HOSTS as u32,
            debounce: DEBOUNCE,
            concurrency: CONCURRENCY,
        }
    }
}

/// Which hosts are due, and the token bucket bounding the total.
#[derive(Debug)]
struct ProbePlan {
    budget: ProbeBudget,
    /// Last probe per host, kept for one interval.
    last: HashMap<IpAddr, Instant>,
    tokens: f64,
    refilled: Instant,
}

impl ProbePlan {
    fn new(budget: ProbeBudget, now: Instant) -> Self {
        Self {
            budget,
            last: HashMap::new(),
            tokens: f64::from(budget.per_interval),
            refilled: now,
        }
    }

    fn capacity(&self) -> f64 {
        f64::from(self.budget.per_interval.max(1))
    }

    fn refill(&mut self, now: Instant) {
        let elapsed = now.duration_since(self.refilled).as_secs_f64();
        let period = self.budget.interval.as_secs_f64().max(1e-3);
        self.tokens = (self.tokens + elapsed / period * self.capacity()).min(self.capacity());
        self.refilled = now;
    }

    /// The targets to probe now, in target order: not probed within the interval, while
    /// tokens last. Marks them probed.
    fn take_due(&mut self, now: Instant, targets: &[IpAddr]) -> Vec<IpAddr> {
        self.refill(now);
        let iv = self.budget.interval;
        self.last.retain(|_, t| now.duration_since(*t) < iv);
        let mut out = Vec::new();
        for ip in targets {
            if self.tokens < 1.0 {
                break;
            }
            if self.last.contains_key(ip) {
                continue;
            }
            self.tokens -= 1.0;
            self.last.insert(*ip, now);
            out.push(*ip);
        }
        out
    }

    /// When the next current target falls due (or the next token arrives for one that is
    /// due), at least [`MIN_GAP`] from now and at most one interval.
    fn next_wake(&self, now: Instant, targets: &[IpAddr]) -> Instant {
        let iv = self.budget.interval;
        let mut wake = now + iv;
        let token_in = Duration::from_secs_f64(
            ((1.0 - self.tokens).max(0.0) / self.capacity()) * iv.as_secs_f64(),
        );
        for ip in targets {
            let due = self.last.get(ip).map_or(now + token_in, |t| *t + iv);
            wake = wake.min(due);
        }
        wake.max(now + MIN_GAP)
    }
}

/// The scheduling loop, generic over the targets and the probe so tests can drive it with
/// paused time. `targets` returns `(host, payload)` in priority order; `probe` resolves to
/// false once results cannot be delivered (the loop then stops); `on_pass` gets the time to
/// the next planned pass.
pub(crate) async fn probe_loop<T, Tg, P, Fut>(
    budget: ProbeBudget,
    mut watch: watch::Receiver<WatchSet>,
    mut shutdown: watch::Receiver<bool>,
    mut targets: Tg,
    probe: P,
    mut on_pass: impl FnMut(Duration),
) where
    T: Send + 'static,
    Tg: FnMut() -> Vec<(IpAddr, T)>,
    P: Fn(IpAddr, T) -> Fut,
    Fut: Future<Output = bool> + Send + 'static,
{
    let mut plan = ProbePlan::new(budget, Instant::now());
    loop {
        if *shutdown.borrow() {
            return;
        }
        let list = targets();
        let ips: Vec<IpAddr> = list.iter().map(|(ip, _)| *ip).collect();
        let due = plan.take_due(Instant::now(), &ips);
        if !due.is_empty() {
            let mut payloads: HashMap<IpAddr, T> = list.into_iter().collect();
            let mut running = JoinSet::new();
            for ip in due {
                let Some(t) = payloads.remove(&ip) else {
                    continue;
                };
                while running.len() >= budget.concurrency.max(1) {
                    if let Some(Ok(false)) = running.join_next().await {
                        return;
                    }
                }
                running.spawn(probe(ip, t));
            }
            while let Some(r) = running.join_next().await {
                if matches!(r, Ok(false)) {
                    return;
                }
            }
        }
        let now = Instant::now();
        let wake = plan.next_wake(now, &ips);
        on_pass(wake.duration_since(now));
        tokio::select! {
            () = tokio::time::sleep_until(wake) => {}
            r = watch.changed() => {
                if r.is_err() {
                    return;
                }
                // Debounce: one pass for a burst of changes, never a restarted round.
                tokio::select! {
                    () = tokio::time::sleep(budget.debounce) => {}
                    () = super::stopped(&mut shutdown) => return,
                }
                watch.borrow_and_update();
            }
            () = super::stopped(&mut shutdown) => return,
        }
    }
}

/// Hosts of the fair-share probe nodes, in priority order, one entry per IP.
fn targets(ctx: &JobCtx) -> Vec<(IpAddr, GuardedEndpoint)> {
    // Co-hosted nodes share an IP, so ask for more nodes than hosts.
    let picked = ctx.handle.probe_nodes(MAX_HOSTS * 2);
    if picked.is_empty() {
        return Vec::new();
    }
    let rank: HashMap<NodeId, usize> = picked.iter().enumerate().map(|(i, n)| (*n, i)).collect();
    let p = ctx.handle.published();
    let mut found: Vec<(usize, IpAddr, GuardedEndpoint)> = p
        .nodes
        .iter()
        .filter_map(|r| {
            let i = *rank.get(&r.id)?;
            let ep = r.endpoint?;
            let g = GuardedEndpoint::new(ep).ok()?;
            Some((i, ep.ip, g))
        })
        .collect();
    found.sort_unstable_by_key(|f| f.0);
    let mut seen = HashSet::new();
    found
        .into_iter()
        .filter(|f| seen.insert(f.1))
        .take(MAX_HOSTS)
        .map(|(_, ip, g)| (ip, g))
        .collect()
}

pub async fn run(ctx: JobCtx) {
    let budget = ProbeBudget::standard(ctx.cfg.watch_probe_interval);
    let probe_ctx = ctx.clone();
    let pass_ctx = ctx.clone();
    probe_loop(
        budget,
        ctx.watch.clone(),
        ctx.shutdown.clone(),
        || targets(&ctx),
        move |ip, g: GuardedEndpoint| {
            let c = probe_ctx.clone();
            async move {
                let ok = c
                    .call(
                        Upstream::Node,
                        "flux/version",
                        c.clients.node_api.version(&g),
                    )
                    .await
                    .is_ok();
                c.send(Obs::Probe { ip, ok }).await
            }
        },
        move |next| pass_ctx.next("watch_probe", next),
    )
    .await;
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;

    type Log = Arc<Mutex<Vec<(IpAddr, Instant)>>>;

    fn ip(a: u8, b: u8, c: u8) -> IpAddr {
        IpAddr::from([10, a, b, c])
    }

    fn budget() -> ProbeBudget {
        ProbeBudget {
            interval: Duration::from_secs(60),
            per_interval: 20,
            debounce: Duration::from_secs(2),
            concurrency: 4,
        }
    }

    /// A running loop over a shared target list.
    struct Harness {
        targets: Arc<Mutex<Vec<IpAddr>>>,
        log: Log,
        watch: watch::Sender<WatchSet>,
        stop: watch::Sender<bool>,
    }

    fn start(initial: Vec<IpAddr>) -> Harness {
        let list = Arc::new(Mutex::new(initial));
        let log: Log = Arc::new(Mutex::new(Vec::new()));
        let (wtx, wrx) = watch::channel(WatchSet::default());
        let (stx, srx) = watch::channel(false);
        let l = Arc::clone(&list);
        let g = Arc::clone(&log);
        tokio::spawn(probe_loop(
            budget(),
            wrx,
            srx,
            move || l.lock().unwrap().iter().map(|ip| (*ip, ())).collect(),
            move |ip, ()| {
                let g = Arc::clone(&g);
                async move {
                    g.lock().unwrap().push((ip, Instant::now()));
                    true
                }
            },
            |_| {},
        ));
        Harness {
            targets: list,
            log,
            watch: wtx,
            stop: stx,
        }
    }

    fn probes_of(log: &Log, host: IpAddr) -> Vec<Instant> {
        log.lock()
            .unwrap()
            .iter()
            .filter(|(i, _)| *i == host)
            .map(|(_, t)| *t)
            .collect()
    }

    fn assert_cadence(times: &[Instant], iv: Duration) {
        for w in times.windows(2) {
            assert!(
                w[1].duration_since(w[0]) >= iv,
                "probed twice within {iv:?}"
            );
        }
    }

    #[tokio::test(start_paused = true)]
    async fn steady_targets_are_probed_every_interval() {
        let stable: Vec<IpAddr> = (1..=10).map(|i| ip(0, 0, i)).collect();
        let hs = start(stable.clone());
        tokio::time::sleep(Duration::from_secs(600)).await;
        for h in &stable {
            let t = probes_of(&hs.log, *h);
            assert!((10..=11).contains(&t.len()), "{h}: {} probes", t.len());
            assert_cadence(&t, Duration::from_secs(60));
        }
        hs.stop.send(true).unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn watch_churn_does_not_raise_the_probe_rate() {
        let stable: Vec<IpAddr> = (1..=10).map(|i| ip(0, 0, i)).collect();
        let hs = start(stable.clone());
        // A client changes its watch list every 100 ms for 10 minutes, each time with a host
        // never seen before.
        let started = Instant::now();
        for step in 0..6000u32 {
            let [_, hi, mid, lo] = step.to_be_bytes();
            {
                let mut targets = hs.targets.lock().unwrap();
                targets.truncate(stable.len());
                targets.push(ip(hi.wrapping_add(1), mid, lo));
            }
            hs.watch.send_modify(|s| {
                s.nodes.clear();
                s.nodes.insert(NodeId(step));
            });
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let elapsed = started.elapsed();
        assert!(elapsed >= Duration::from_secs(600));
        // Existing targets keep their 60 s cadence: churn never restarts them.
        for h in &stable {
            let t = probes_of(&hs.log, *h);
            assert_cadence(&t, Duration::from_secs(60));
            assert!(t.len() <= 11, "{h}: {} probes", t.len());
        }
        // The total stays within the bucket: capacity plus one refill per interval.
        let total = hs.log.lock().unwrap().len();
        let bound = 20 + 20 * (elapsed.as_secs() as usize).div_ceil(60);
        assert!(total <= bound, "{total} probes, bound {bound}");
        hs.stop.send(true).unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn a_new_target_is_probed_after_the_debounce() {
        let stable: Vec<IpAddr> = (1..=3).map(|i| ip(0, 0, i)).collect();
        let hs = start(stable);
        tokio::time::sleep(Duration::from_secs(30)).await;
        let added = ip(9, 9, 9);
        let at = Instant::now();
        hs.targets.lock().unwrap().push(added);
        hs.watch.send_modify(|s| {
            s.nodes.insert(NodeId(1));
        });
        tokio::time::sleep(Duration::from_secs(5)).await;
        let t = probes_of(&hs.log, added);
        assert_eq!(t.len(), 1);
        let after = t[0].duration_since(at);
        assert!(
            after >= Duration::from_secs(2) && after < Duration::from_secs(3),
            "{after:?}"
        );
        // The existing targets were not re-probed by the change.
        assert_eq!(probes_of(&hs.log, ip(0, 0, 1)).len(), 1);
        hs.stop.send(true).unwrap();
    }

    #[test]
    fn plan_respects_tokens_and_order() {
        let now = Instant::now();
        let mut p = ProbePlan::new(
            ProbeBudget {
                per_interval: 3,
                ..budget()
            },
            now,
        );
        let t: Vec<IpAddr> = (1..=5).map(|i| ip(0, 0, i)).collect();
        assert_eq!(
            p.take_due(now, &t),
            t[..3].to_vec(),
            "priority order, 3 tokens"
        );
        assert!(p.take_due(now, &t).is_empty());
        // One token per 20 s: the next due host after 20 s is the fourth.
        let later = now + Duration::from_secs(20);
        assert_eq!(p.take_due(later, &t), vec![t[3]]);
        let wake = p.next_wake(later, &t);
        assert_eq!(wake.duration_since(later), Duration::from_secs(20));
    }
}
