//! Engine liveness: supervision of the parts that own or move state (ARCHITECTURE section 3.4).
//!
//! The reducer thread, the store writer thread, the publisher thread (and its mesh body worker)
//! and every ingest job task are supervised. A part that panics, or stops while the engine is
//! not shutting down, or stalls past its limit, marks the engine **dead**: `/healthz` and
//! `/readyz` answer 503 and the server process exits with status 1, so the container restart
//! policy restarts it on the persisted state. A frozen engine never keeps serving as healthy.
//!
//! Why supervision with a process exit rather than `panic = "abort"`: with abort, any panic
//! anywhere ends the process, including a panic inside one HTTP request (a dependency bug on a
//! crafted input), which would let a single request crash-loop the public server. With unwind,
//! such a panic ends only that request's task, while a panic in a state-owning part still ends
//! the process (after an orderly attempt to flush the store) through this module.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use atlas_core::now_ms;
use tokio::sync::watch;

/// The reducer must turn its loop at least this often (it ticks every 250 ms when idle).
pub const REDUCER_STALL: Duration = Duration::from_secs(90);
/// A store commit (or a wait for one: a compaction holds the database exclusively) may take
/// this long before the writer counts as stalled. Generous: this detects a wedged writer, not a
/// slow disk.
pub const WRITER_STALL: Duration = Duration::from_secs(30 * 60);
/// One publish (body rebuild and compression) may take this long.
pub const PUBLISH_STALL: Duration = Duration::from_secs(5 * 60);
/// Consecutive failed commits after which the store counts as failing (`/readyz` 503).
pub const STORE_FAILING_STREAK: u64 = 3;

/// Shared liveness state (one per engine).
#[derive(Debug)]
pub struct Liveness {
    dead_tx: watch::Sender<Option<String>>,
    first: Mutex<Option<String>>,
    stopping: AtomicBool,
    /// Last reducer loop turn (unix ms; 0 before the first).
    reducer_beat_ms: AtomicU64,
    /// The reducer is blocked on store writer backpressure since (unix ms; 0 = not blocked).
    reducer_waiting_ms: AtomicU64,
    /// The store writer is committing since (unix ms; 0 = idle).
    writer_busy_ms: AtomicU64,
    /// A publish started at (unix ms; 0 = none running).
    publish_busy_ms: AtomicU64,
    /// Batches queued for the store writer.
    pub writer_queue: AtomicU64,
    /// Times the reducer had to wait for the writer, and the total wait (ms).
    pub writer_backpressure: AtomicU64,
    pub writer_backpressure_ms: AtomicU64,
    /// Consecutive failed commits (0 after a success).
    pub commit_fail_streak: AtomicU64,
    /// The last commit error, for `/readyz`.
    last_commit_error: Mutex<Option<String>>,
}

impl Default for Liveness {
    fn default() -> Self {
        let (dead_tx, _) = watch::channel(None);
        Self {
            dead_tx,
            first: Mutex::new(None),
            stopping: AtomicBool::new(false),
            reducer_beat_ms: AtomicU64::new(0),
            reducer_waiting_ms: AtomicU64::new(0),
            writer_busy_ms: AtomicU64::new(0),
            publish_busy_ms: AtomicU64::new(0),
            writer_queue: AtomicU64::new(0),
            writer_backpressure: AtomicU64::new(0),
            writer_backpressure_ms: AtomicU64::new(0),
            commit_fail_streak: AtomicU64::new(0),
            last_commit_error: Mutex::new(None),
        }
    }
}

/// A point-in-time view for health endpoints and metrics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LivenessReport {
    /// Why the engine is dead (the first fatal reason), if it is.
    pub dead: Option<String>,
    /// Age of the reducer's last loop turn (ms).
    pub reducer_age_ms: u64,
    pub writer_queue: u64,
    pub writer_backpressure: u64,
    pub writer_backpressure_ms: u64,
    pub commit_fail_streak: u64,
    /// The store writer fails its commits (`/readyz` 503).
    pub store_failing: bool,
    pub last_commit_error: Option<String>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// The message of a panic payload.
pub fn panic_message(p: &(dyn std::any::Any + Send)) -> String {
    p.downcast_ref::<&str>()
        .map(|s| (*s).to_owned())
        .or_else(|| p.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "non-string panic payload".to_owned())
}

impl Liveness {
    /// Marks the engine dead (the first reason wins). Ignored once shutdown started, since parts
    /// stop on purpose then.
    pub fn fatal(&self, reason: impl Into<String>) {
        if self.stopping() {
            return;
        }
        let reason = reason.into();
        let mut first = lock(&self.first);
        if first.is_some() {
            tracing::error!(reason, "engine part failed (engine already dead)");
            return;
        }
        tracing::error!(
            reason,
            "engine part failed: the engine is dead and the process will restart"
        );
        *first = Some(reason.clone());
        self.dead_tx.send_replace(Some(reason));
    }

    pub fn dead(&self) -> Option<String> {
        lock(&self.first).clone()
    }

    /// Resolves with the reason once the engine is dead.
    pub async fn died(&self) -> String {
        let mut rx = self.dead_tx.subscribe();
        loop {
            if let Some(r) = rx.borrow_and_update().clone() {
                return r;
            }
            if rx.changed().await.is_err() {
                // The sender lives as long as the engine; pending forever is right otherwise.
                std::future::pending::<()>().await;
            }
        }
    }

    pub fn begin_stop(&self) {
        self.stopping.store(true, Ordering::Release);
    }

    pub fn stopping(&self) -> bool {
        self.stopping.load(Ordering::Acquire)
    }

    pub fn reducer_beat(&self) {
        self.reducer_beat_ms.store(now_ms(), Ordering::Relaxed);
    }

    pub fn reducer_waiting(&self, waiting: bool) {
        self.reducer_waiting_ms
            .store(if waiting { now_ms() } else { 0 }, Ordering::Relaxed);
    }

    pub fn writer_busy(&self, busy: bool) {
        self.writer_busy_ms
            .store(if busy { now_ms() } else { 0 }, Ordering::Relaxed);
    }

    pub fn publish_busy(&self, busy: bool) {
        self.publish_busy_ms
            .store(if busy { now_ms() } else { 0 }, Ordering::Relaxed);
    }

    pub fn commit_ok(&self) {
        self.commit_fail_streak.store(0, Ordering::Relaxed);
    }

    pub fn commit_failed(&self, e: &dyn std::fmt::Display) {
        self.commit_fail_streak.fetch_add(1, Ordering::Relaxed);
        *lock(&self.last_commit_error) = Some(e.to_string());
    }

    pub fn report(&self) -> LivenessReport {
        let now = now_ms();
        let beat = self.reducer_beat_ms.load(Ordering::Relaxed);
        let streak = self.commit_fail_streak.load(Ordering::Relaxed);
        LivenessReport {
            dead: self.dead(),
            reducer_age_ms: if beat == 0 {
                0
            } else {
                now.saturating_sub(beat)
            },
            writer_queue: self.writer_queue.load(Ordering::Relaxed),
            writer_backpressure: self.writer_backpressure.load(Ordering::Relaxed),
            writer_backpressure_ms: self.writer_backpressure_ms.load(Ordering::Relaxed),
            commit_fail_streak: streak,
            store_failing: streak >= STORE_FAILING_STREAK,
            last_commit_error: lock(&self.last_commit_error).clone(),
        }
    }

    /// One watchdog check at `now`: marks the engine dead when a part stalled. Returns the
    /// reason when it did.
    pub fn check(&self, now: u64) -> Option<String> {
        if self.stopping() || self.dead().is_some() {
            return None;
        }
        let age = |at: u64| (at > 0).then(|| now.saturating_sub(at));
        let waiting = age(self.reducer_waiting_ms.load(Ordering::Relaxed));
        let writer = age(self.writer_busy_ms.load(Ordering::Relaxed));
        let reason = if let Some(w) = writer.filter(|w| *w > WRITER_STALL.as_millis() as u64) {
            Some(format!(
                "store writer stalled: one commit running for {} s",
                w / 1000
            ))
        } else if waiting.is_some() {
            // Blocked on the writer's backpressure: the writer's own limit applies.
            None
        } else if let Some(r) = age(self.reducer_beat_ms.load(Ordering::Relaxed))
            .filter(|r| *r > REDUCER_STALL.as_millis() as u64)
        {
            Some(format!("reducer stalled: no loop turn for {} s", r / 1000))
        } else {
            age(self.publish_busy_ms.load(Ordering::Relaxed))
                .filter(|p| *p > PUBLISH_STALL.as_millis() as u64)
                .map(|p| format!("publisher stalled: one publish running for {} s", p / 1000))
        };
        if let Some(r) = &reason {
            self.fatal(r.clone());
        }
        reason
    }
}

/// Runs `f` on the current thread, marking the engine dead when it panics, or when it returns
/// while the engine is not shutting down.
pub fn supervise_thread(live: &Liveness, part: &str, f: impl FnOnce()) {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(()) => {
            if !live.stopping() {
                live.fatal(format!("{part} stopped unexpectedly"));
            }
        }
        Err(p) => live.fatal(format!("{part} panicked: {}", panic_message(p.as_ref()))),
    }
}

/// Runs `f`, a loop that ends when its input channel closes (the store writer, the publisher,
/// the mesh body worker: their sender is the reducer, which is supervised itself). Only a panic
/// marks the engine dead; a normal end follows the reducer's stop, which reports itself.
pub fn supervise_worker(live: &Liveness, part: &str, f: impl FnOnce()) {
    if let Err(p) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        live.fatal(format!("{part} panicked: {}", panic_message(p.as_ref())));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_reason_wins_and_stop_silences() {
        let l = Liveness::default();
        assert!(l.dead().is_none());
        l.fatal("a");
        l.fatal("b");
        assert_eq!(l.dead().as_deref(), Some("a"));
        let l = Liveness::default();
        l.begin_stop();
        l.fatal("a");
        assert!(l.dead().is_none());
    }

    #[test]
    fn thread_panic_and_unexpected_return_are_fatal() {
        let l = Liveness::default();
        supervise_thread(&l, "reducer", || panic!("boom"));
        assert_eq!(l.dead().as_deref(), Some("reducer panicked: boom"));
        let l = Liveness::default();
        supervise_thread(&l, "store writer", || {});
        assert_eq!(
            l.dead().as_deref(),
            Some("store writer stopped unexpectedly")
        );
        let l = Liveness::default();
        l.begin_stop();
        supervise_thread(&l, "store writer", || {});
        assert!(l.dead().is_none());
        // Workers end with their channel: only a panic is a failure.
        let l = Liveness::default();
        supervise_worker(&l, "publisher", || {});
        assert!(l.dead().is_none());
        supervise_worker(&l, "publisher", || panic!("p"));
        assert_eq!(l.dead().as_deref(), Some("publisher panicked: p"));
    }

    #[test]
    fn watchdog_limits() {
        let l = Liveness::default();
        let t0 = 1_000_000_000;
        l.reducer_beat_ms.store(t0, Ordering::Relaxed);
        assert_eq!(l.check(t0 + 60_000), None);
        // Blocked on the writer: the reducer limit does not apply.
        l.reducer_waiting_ms.store(t0, Ordering::Relaxed);
        l.writer_busy_ms.store(t0, Ordering::Relaxed);
        assert_eq!(l.check(t0 + 120_000), None);
        assert!(
            l.check(t0 + 31 * 60_000)
                .unwrap()
                .contains("store writer stalled")
        );
        let l = Liveness::default();
        l.reducer_beat_ms.store(t0, Ordering::Relaxed);
        assert!(l.check(t0 + 91_000).unwrap().contains("reducer stalled"));
    }

    #[test]
    fn store_failing_after_a_streak() {
        let l = Liveness::default();
        for _ in 0..STORE_FAILING_STREAK {
            assert!(!l.report().store_failing);
            l.commit_failed(&"disk full");
        }
        let r = l.report();
        assert!(r.store_failing);
        assert_eq!(r.last_commit_error.as_deref(), Some("disk full"));
        l.commit_ok();
        assert!(!l.report().store_failing);
    }

    #[tokio::test]
    async fn died_resolves() {
        let l = std::sync::Arc::new(Liveness::default());
        let l2 = std::sync::Arc::clone(&l);
        let w = tokio::spawn(async move { l2.died().await });
        tokio::task::yield_now().await;
        l.fatal("x");
        assert_eq!(w.await.unwrap(), "x");
    }
}
