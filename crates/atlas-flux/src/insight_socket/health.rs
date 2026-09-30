//! Socket health bookkeeping and reconnect backoff. Both are pure (time is passed in), so
//! they are unit-tested without a network or a clock.

use std::time::Duration;

use rand::RngExt;

/// Why a socket is not healthy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Unhealthy {
    /// Not connected (never connected yet, or the last session failed to connect).
    NotConnected,
    /// Connected, but no `block` event for longer than `block_stale_after`.
    BlockStale,
    /// The last session ended because the server did not answer a ping in time.
    PingTimeout,
}

/// Health of one socket, or the combination of several (see [`SocketHealth::combine`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SocketHealth {
    /// A socket.io session is established and subscribed.
    pub connected: bool,
    /// Wall-clock ms of the most recent `block` event (kept across reconnects).
    pub last_block_ms: Option<u64>,
    /// Wall-clock ms of the most recent frame of any kind.
    pub last_frame_ms: Option<u64>,
    /// Connected, not stale and no ping timeout.
    pub healthy: bool,
    /// Why `healthy` is false; `None` when healthy.
    pub reason: Option<Unhealthy>,
}

impl Default for SocketHealth {
    fn default() -> Self {
        Self {
            connected: false,
            last_block_ms: None,
            last_frame_ms: None,
            healthy: false,
            reason: Some(Unhealthy::NotConnected),
        }
    }
}

impl SocketHealth {
    /// Combines per-socket health: healthy (and connected) if any socket is, newest block and
    /// frame times across all. When none is healthy, the reason of the first socket is kept.
    pub fn combine<'a>(items: impl IntoIterator<Item = &'a SocketHealth>) -> SocketHealth {
        let mut out = SocketHealth::default();
        let mut first_reason = None;
        for h in items {
            out.connected |= h.connected;
            out.healthy |= h.healthy;
            out.last_block_ms = out.last_block_ms.max(h.last_block_ms);
            out.last_frame_ms = out.last_frame_ms.max(h.last_frame_ms);
            if first_reason.is_none() {
                first_reason = h.reason;
            }
        }
        out.reason = if out.healthy {
            None
        } else {
            first_reason.or(Some(Unhealthy::NotConnected))
        };
        out
    }
}

/// Mutable health state of one socket. All times are wall-clock ms.
#[derive(Debug, Clone, Default)]
pub(super) struct HealthTracker {
    connected_since_ms: Option<u64>,
    first_connected_ms: Option<u64>,
    last_block_ms: Option<u64>,
    last_frame_ms: Option<u64>,
    last_drop: Option<Unhealthy>,
}

impl HealthTracker {
    pub(super) fn on_connected(&mut self, now_ms: u64) {
        self.connected_since_ms = Some(now_ms);
        self.first_connected_ms.get_or_insert(now_ms);
        self.last_drop = None;
    }

    pub(super) fn on_disconnected(&mut self, why: Unhealthy) {
        self.connected_since_ms = None;
        self.last_drop = Some(why);
    }

    pub(super) fn on_frame(&mut self, now_ms: u64) {
        self.last_frame_ms = Some(now_ms);
    }

    pub(super) fn on_block(&mut self, now_ms: u64) {
        self.last_block_ms = Some(now_ms);
    }

    /// Health at `now_ms`. Before the first block, staleness counts from the first successful
    /// connect, so a fresh socket gets one full `stale_after` of grace; after that it counts
    /// from the last block, across reconnects.
    pub(super) fn snapshot(&self, now_ms: u64, stale_after: Duration) -> SocketHealth {
        let connected = self.connected_since_ms.is_some();
        let reason = if connected {
            let since = self
                .last_block_ms
                .or(self.first_connected_ms)
                .unwrap_or(now_ms);
            (now_ms.saturating_sub(since) >= duration_ms(stale_after))
                .then_some(Unhealthy::BlockStale)
        } else {
            Some(self.last_drop.unwrap_or(Unhealthy::NotConnected))
        };
        SocketHealth {
            connected,
            last_block_ms: self.last_block_ms,
            last_frame_ms: self.last_frame_ms,
            healthy: reason.is_none(),
            reason,
        }
    }

    /// True when the current session has gone `stale_after` without a block, counted from the
    /// later of the last block and the start of this session (so a stalled chain causes at
    /// most one reconnect per `stale_after`).
    pub(super) fn stale_for_reconnect(&self, now_ms: u64, stale_after: Duration) -> bool {
        let Some(since) = self.connected_since_ms else {
            return false;
        };
        let since = since.max(self.last_block_ms.unwrap_or(0));
        now_ms.saturating_sub(since) >= duration_ms(stale_after)
    }
}

fn duration_ms(d: Duration) -> u64 {
    u64::try_from(d.as_millis()).unwrap_or(u64::MAX)
}

/// Jittered exponential backoff: each delay is uniform in `[base / 2, base]`, and `base`
/// doubles from `min` up to `max`.
#[derive(Debug, Clone)]
pub(super) struct Backoff {
    min: Duration,
    max: Duration,
    base: Duration,
}

impl Backoff {
    pub(super) fn new(min: Duration, max: Duration) -> Self {
        let max = max.max(min);
        Self {
            min,
            max,
            base: min,
        }
    }

    pub(super) fn reset(&mut self) {
        self.base = self.min;
    }

    /// The un-jittered delay the next call to [`Backoff::next_delay`] is based on.
    #[cfg(test)]
    pub(super) fn base(&self) -> Duration {
        self.base
    }

    pub(super) fn next_delay(&mut self) -> Duration {
        let base = self.base;
        self.base = (self.base * 2).min(self.max);
        let hi = duration_ms(base);
        let lo = hi / 2;
        if hi == 0 {
            return Duration::ZERO;
        }
        Duration::from_millis(rand::rng().random_range(lo..=hi))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    const STALE: Duration = Duration::from_secs(90);

    #[test]
    fn tracker_transitions() {
        let mut t = HealthTracker::default();
        let h = t.snapshot(1_000, STALE);
        assert_eq!(h, SocketHealth::default());

        t.on_frame(1_000);
        t.on_connected(1_000);
        let h = t.snapshot(1_500, STALE);
        assert!(h.connected && h.healthy && h.reason.is_none());
        assert_eq!(h.last_frame_ms, Some(1_000));

        // Grace period ends 90 s after the first connect with no block.
        let h = t.snapshot(91_000, STALE);
        assert_eq!(h.reason, Some(Unhealthy::BlockStale));
        assert!(h.connected && !h.healthy);
        assert!(t.stale_for_reconnect(91_000, STALE));

        t.on_block(92_000);
        assert!(t.snapshot(92_000, STALE).healthy);
        assert!(t.snapshot(181_999, STALE).healthy);
        assert!(!t.snapshot(182_000, STALE).healthy);

        // A ping timeout drops the session and is reported until the next connect.
        t.on_disconnected(Unhealthy::PingTimeout);
        let h = t.snapshot(100_000, STALE);
        assert_eq!(h.reason, Some(Unhealthy::PingTimeout));
        assert!(!h.connected);
        assert_eq!(h.last_block_ms, Some(92_000));
        assert!(!t.stale_for_reconnect(500_000, STALE));

        // Reconnecting does not reset staleness: it still counts from the last block.
        t.on_connected(200_000);
        let h = t.snapshot(200_000, STALE);
        assert_eq!(h.reason, Some(Unhealthy::BlockStale));
        // But the forced-reconnect clock restarts with the session.
        assert!(!t.stale_for_reconnect(200_000, STALE));
        assert!(t.stale_for_reconnect(290_000, STALE));
        t.on_block(201_000);
        assert!(t.snapshot(201_000, STALE).healthy);
    }

    #[test]
    fn combine_any_healthy() {
        let bad = SocketHealth {
            connected: false,
            last_block_ms: Some(10),
            last_frame_ms: Some(50),
            healthy: false,
            reason: Some(Unhealthy::PingTimeout),
        };
        let good = SocketHealth {
            connected: true,
            last_block_ms: Some(20),
            last_frame_ms: Some(30),
            healthy: true,
            reason: None,
        };
        let c = SocketHealth::combine([&bad, &good]);
        assert!(c.healthy && c.connected && c.reason.is_none());
        assert_eq!((c.last_block_ms, c.last_frame_ms), (Some(20), Some(50)));
        let c = SocketHealth::combine([&bad, &bad]);
        assert!(!c.healthy);
        assert_eq!(c.reason, Some(Unhealthy::PingTimeout));
        let c = SocketHealth::combine(std::iter::empty());
        assert_eq!(c, SocketHealth::default());
    }

    #[test]
    fn backoff_doubles_caps_and_resets() {
        let mut b = Backoff::new(Duration::from_millis(500), Duration::from_secs(30));
        let mut bases = Vec::new();
        for _ in 0..10 {
            let base = b.base();
            let d = b.next_delay();
            assert!(d >= base / 2 && d <= base, "{d:?} vs {base:?}");
            bases.push(base.as_millis());
        }
        assert_eq!(
            bases,
            vec![
                500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000
            ]
        );
        b.reset();
        assert_eq!(b.base(), Duration::from_millis(500));
        let mut z = Backoff::new(Duration::ZERO, Duration::ZERO);
        assert_eq!(z.next_delay(), Duration::ZERO);
    }
}
