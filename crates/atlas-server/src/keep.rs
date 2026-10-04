//! [`KeepGood`]: a value from a third-party source that is refreshed after a lifetime and kept
//! when a refresh fails (the price view, Fusion's fee table, the fleet history).
//!
//! - The first request fills it inline; concurrent first requests share that one fill.
//! - After `ttl` the held copy is still served at once while one background task refreshes it
//!   (stale while revalidate), so only the very first request ever waits.
//! - A failed fill or refresh is not retried for `retry`: a failing upstream is asked at most
//!   that often, however many requests arrive. A failed refresh keeps the last good copy.

use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::error::ApiError;

struct KeepState<T> {
    /// The last good value and when it was fetched.
    value: Option<(Instant, Arc<T>)>,
    refreshing: bool,
    /// The last failure and when it happened.
    failed: Option<(Instant, ApiError)>,
}

/// A last-good value with a lifetime (see the module docs).
pub struct KeepGood<T> {
    ttl: Duration,
    retry: Duration,
    state: tokio::sync::Mutex<KeepState<T>>,
}

impl<T> std::fmt::Debug for KeepGood<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("KeepGood")
            .field("ttl", &self.ttl)
            .field("retry", &self.retry)
            .finish_non_exhaustive()
    }
}

impl<T: Send + Sync + 'static> KeepGood<T> {
    /// Refreshed after `ttl`; a failure is not retried for `retry`.
    pub fn new(ttl: Duration, retry: Duration) -> Self {
        Self {
            ttl,
            retry,
            state: tokio::sync::Mutex::new(KeepState {
                value: None,
                refreshing: false,
                failed: None,
            }),
        }
    }

    /// The held value and when it was fetched, refreshing it in the background when it is older
    /// than the lifetime; filled inline when nothing is held. `fetch` runs at most once per
    /// call.
    pub async fn get<F, Fut>(self: &Arc<Self>, fetch: F) -> Result<(Instant, Arc<T>), ApiError>
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<T, ApiError>> + Send + 'static,
    {
        let mut st = self.state.lock().await;
        let backing_off = st
            .failed
            .as_ref()
            .is_some_and(|(at, _)| at.elapsed() < self.retry);
        if let Some((at, v)) = st.value.as_ref() {
            let held = (*at, Arc::clone(v));
            if at.elapsed() >= self.ttl && !st.refreshing && !backing_off {
                st.refreshing = true;
                self.spawn_refresh(fetch);
            }
            return Ok(held);
        }
        if backing_off && let Some((_, e)) = st.failed.as_ref() {
            return Err(e.clone());
        }
        // First fill: inline, holding the lock, so concurrent first requests wait for it.
        match fetch().await {
            Ok(v) => {
                let v = Arc::new(v);
                let at = Instant::now();
                st.value = Some((at, Arc::clone(&v)));
                st.failed = None;
                Ok((at, v))
            }
            Err(e) => {
                st.failed = Some((Instant::now(), e.clone()));
                Err(e)
            }
        }
    }

    /// The held value without waiting: `None` until the first fill succeeded. Starts the fill
    /// (or the refresh of an expired copy) in the background, as [`Self::get`] would.
    pub async fn peek<F, Fut>(self: &Arc<Self>, fetch: F) -> Option<(Instant, Arc<T>)>
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<T, ApiError>> + Send + 'static,
    {
        let mut st = self.state.lock().await;
        let backing_off = st
            .failed
            .as_ref()
            .is_some_and(|(at, _)| at.elapsed() < self.retry);
        let held = st.value.as_ref().map(|(at, v)| (*at, Arc::clone(v)));
        let expired = held.as_ref().is_none_or(|(at, _)| at.elapsed() >= self.ttl);
        if expired && !st.refreshing && !backing_off {
            st.refreshing = true;
            self.spawn_refresh(fetch);
        }
        held
    }

    fn spawn_refresh<F, Fut>(self: &Arc<Self>, fetch: F)
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<T, ApiError>> + Send + 'static,
    {
        let me = Arc::clone(self);
        tokio::spawn(async move {
            let r = fetch().await;
            let mut st = me.state.lock().await;
            st.refreshing = false;
            match r {
                Ok(v) => {
                    st.value = Some((Instant::now(), Arc::new(v)));
                    st.failed = None;
                }
                Err(e) => {
                    tracing::debug!(error = %e.message, "refresh failed; keeping the last good copy");
                    st.failed = Some((Instant::now(), e));
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU32, Ordering};

    use super::*;

    fn counter() -> Arc<AtomicU32> {
        Arc::new(AtomicU32::new(0))
    }

    async fn fill(
        k: &Arc<KeepGood<u32>>,
        calls: &Arc<AtomicU32>,
        ok: bool,
    ) -> Result<u32, ApiError> {
        let calls = Arc::clone(calls);
        k.get(move || async move {
            let n = calls.fetch_add(1, Ordering::SeqCst) + 1;
            tokio::time::sleep(Duration::from_millis(20)).await;
            if ok {
                Ok(n)
            } else {
                Err(ApiError::upstream("down"))
            }
        })
        .await
        .map(|(_, v)| *v)
    }

    #[tokio::test]
    async fn first_fill_is_shared_and_then_cached() {
        let k = Arc::new(KeepGood::new(
            Duration::from_secs(60),
            Duration::from_secs(60),
        ));
        let calls = counter();
        let mut tasks = Vec::new();
        for _ in 0..10 {
            let (k, calls) = (Arc::clone(&k), Arc::clone(&calls));
            tasks.push(tokio::spawn(async move { fill(&k, &calls, true).await }));
        }
        for t in tasks {
            assert_eq!(t.await.unwrap().unwrap(), 1);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1, "one upstream call");
        assert_eq!(fill(&k, &calls, true).await.unwrap(), 1);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn stale_copy_is_served_while_refreshing_and_kept_on_failure() {
        let ms = Duration::from_millis;
        let k = Arc::new(KeepGood::new(ms(100), ms(250)));
        let calls = counter();
        assert_eq!(fill(&k, &calls, true).await.unwrap(), 1);
        tokio::time::sleep(ms(120)).await;
        // Expired: the old copy at once, a refresh behind it.
        assert_eq!(fill(&k, &calls, true).await.unwrap(), 1);
        tokio::time::sleep(ms(40)).await;
        assert_eq!(fill(&k, &calls, true).await.unwrap(), 2, "refreshed");
        // A failing refresh keeps the last good copy.
        tokio::time::sleep(ms(120)).await;
        assert_eq!(fill(&k, &calls, false).await.unwrap(), 2);
        tokio::time::sleep(ms(40)).await;
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        // Within the retry pause nobody asks the upstream again.
        assert_eq!(fill(&k, &calls, true).await.unwrap(), 2);
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        tokio::time::sleep(ms(260)).await;
        assert_eq!(fill(&k, &calls, true).await.unwrap(), 2);
        tokio::time::sleep(ms(40)).await;
        assert_eq!(fill(&k, &calls, true).await.unwrap(), 4);
    }

    #[tokio::test]
    async fn failed_first_fill_backs_off() {
        let k = Arc::new(KeepGood::new(
            Duration::from_secs(60),
            Duration::from_millis(60),
        ));
        let calls = counter();
        assert!(fill(&k, &calls, false).await.is_err());
        // The error is repeated without a call during the pause.
        let e = fill(&k, &calls, true).await.unwrap_err();
        assert_eq!(e.message, "down");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        tokio::time::sleep(Duration::from_millis(70)).await;
        assert_eq!(fill(&k, &calls, true).await.unwrap(), 2);
    }

    #[tokio::test]
    async fn peek_never_waits() {
        let k: Arc<KeepGood<u32>> = Arc::new(KeepGood::new(
            Duration::from_secs(60),
            Duration::from_secs(60),
        ));
        let got = k
            .peek(|| async {
                tokio::time::sleep(Duration::from_millis(20)).await;
                Ok(7)
            })
            .await;
        assert!(got.is_none(), "nothing held yet; the fill runs behind");
        tokio::time::sleep(Duration::from_millis(50)).await;
        let got = k.peek(|| async { Ok(8) }).await;
        assert_eq!(got.map(|(_, v)| *v), Some(7));
    }
}
