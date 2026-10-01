//! Protection of the routes that compute per request (`/nodes`, `/operator/{address}`,
//! `/metrics`, `/timeline/state`, `/search`, node history and payments): a per-client token
//! bucket (429 with `Retry-After`) and a global cap on how many compute at once, so one client
//! cannot keep the single CPU busy for everyone (X1 M7).

use std::net::IpAddr;
use std::num::NonZeroU32;
use std::sync::atomic::{AtomicU64, Ordering};

use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use governor::clock::{Clock as _, DefaultClock};
use governor::{DefaultKeyedRateLimiter, Quota, RateLimiter};
use tokio::sync::{Semaphore, SemaphorePermit};

use crate::config::DerivedLimits;
use crate::error::ApiError;
use crate::extract::ClientIp;
use crate::state::AppState;

pub struct DerivedGuard {
    limiter: DefaultKeyedRateLimiter<IpAddr>,
    clock: DefaultClock,
    permits: Semaphore,
    limits: DerivedLimits,
    pub rate_limited: AtomicU64,
    pub busy: AtomicU64,
}

impl std::fmt::Debug for DerivedGuard {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DerivedGuard")
            .field("tracked", &self.limiter.len())
            .field("free", &self.permits.available_permits())
            .finish_non_exhaustive()
    }
}

impl DerivedGuard {
    pub fn new(limits: DerivedLimits) -> Self {
        let rps = NonZeroU32::new(limits.rps.max(1)).unwrap_or(NonZeroU32::MIN);
        let burst = NonZeroU32::new(limits.burst.max(1)).unwrap_or(NonZeroU32::MIN);
        Self {
            limiter: RateLimiter::keyed(Quota::per_second(rps).allow_burst(burst)),
            clock: DefaultClock::default(),
            permits: Semaphore::new(limits.concurrency.max(1)),
            limits,
            rate_limited: AtomicU64::new(0),
            busy: AtomicU64::new(0),
        }
    }

    /// Charges the client and waits for a compute slot.
    pub async fn enter(&self, ip: IpAddr) -> Result<SemaphorePermit<'_>, ApiError> {
        let key = crate::net::trust::client_key(ip);
        if let Err(not_until) = self.limiter.check_key(&key) {
            self.rate_limited.fetch_add(1, Ordering::Relaxed);
            let wait = not_until.wait_time_from(self.clock.now());
            return Err(ApiError::rate_limited(
                wait.as_secs_f64().ceil().max(1.0) as u64
            ));
        }
        if let Ok(Ok(p)) =
            tokio::time::timeout(self.limits.queue_timeout, self.permits.acquire()).await
        {
            return Ok(p);
        }
        self.busy.fetch_add(1, Ordering::Relaxed);
        Err(ApiError::unavailable("the server is busy; try again shortly").with_retry_after(2))
    }

    /// Forgets idle clients (call periodically).
    pub fn prune(&self) {
        self.limiter.retain_recent();
        self.limiter.shrink_to_fit();
    }
}

/// Route layer of the derived routes.
pub async fn guard(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let ip = req
        .extensions()
        .get::<ClientIp>()
        .map_or(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), |c| c.0);
    match state.derived.enter(ip).await {
        Ok(_permit) => next.run(req).await,
        Err(e) => e.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[tokio::test]
    #[allow(clippy::many_single_char_names)]
    async fn per_client_and_global() {
        let g = DerivedGuard::new(DerivedLimits {
            rps: 1,
            burst: 2,
            concurrency: 1,
            queue_timeout: Duration::from_millis(50),
        });
        let a: IpAddr = "203.0.113.1".parse().unwrap();
        let b: IpAddr = "203.0.113.2".parse().unwrap();
        drop(g.enter(a).await.unwrap());
        drop(g.enter(a).await.unwrap());
        let e = g.enter(a).await.unwrap_err();
        assert_eq!(e.status, axum::http::StatusCode::TOO_MANY_REQUESTS);
        // The compute slot is global: while one is held, another client waits, then gets 503.
        let held = g.enter(b).await.unwrap();
        let c: IpAddr = "203.0.113.3".parse().unwrap();
        let e = g.enter(c).await.unwrap_err();
        assert_eq!(e.status, axum::http::StatusCode::SERVICE_UNAVAILABLE);
        drop(held);
        drop(g.enter(c).await.unwrap());
        assert_eq!(g.rate_limited.load(Ordering::Relaxed), 1);
        assert_eq!(g.busy.load(Ordering::Relaxed), 1);
    }
}
