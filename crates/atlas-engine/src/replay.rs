//! Bounded ring of recent live messages for reconnect replay (`sub` with `since_seq`).

use std::collections::VecDeque;
use std::sync::Arc;

use atlas_core::live::LiveMsg;

/// The requested sequence is older than the ring holds; the client must refetch bootstrap.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("replay gap: requested after seq {requested}, ring holds {oldest}..={latest}")]
pub struct Resync {
    pub requested: u64,
    /// Oldest seq still held (0 when empty).
    pub oldest: u64,
    /// Latest seq published.
    pub latest: u64,
}

#[derive(Debug)]
pub(crate) struct ReplayRing {
    cap: usize,
    buf: VecDeque<Arc<LiveMsg>>,
}

impl ReplayRing {
    pub(crate) fn new(cap: usize) -> Self {
        Self {
            cap: cap.max(1),
            buf: VecDeque::with_capacity(cap.max(1)),
        }
    }

    /// Messages held, and the capacity.
    pub(crate) fn len_cap(&self) -> (usize, usize) {
        (self.buf.len(), self.cap)
    }

    /// Messages must be pushed in strictly increasing `seq` order.
    pub(crate) fn push(&mut self, msg: Arc<LiveMsg>) {
        if self.buf.len() == self.cap {
            self.buf.pop_front();
        }
        self.buf.push_back(msg);
    }

    /// Everything with `seq > since`. `latest` is the engine's current sequence, which may be ahead
    /// of the ring when a publish carried no live message.
    pub(crate) fn since(&self, since: u64, latest: u64) -> Result<Vec<Arc<LiveMsg>>, Resync> {
        if since >= latest {
            return Ok(Vec::new());
        }
        let oldest = self.buf.front().map_or(0, |m| m.seq);
        // Gap-free only if the ring still holds seq `since + 1` (or the first message after it).
        if self.buf.is_empty() || oldest > since + 1 {
            return Err(Resync {
                requested: since,
                oldest,
                latest,
            });
        }
        let start = self.buf.partition_point(|m| m.seq <= since);
        Ok(self.buf.range(start..).cloned().collect())
    }
}

#[cfg(test)]
mod tests {
    use atlas_core::live::LiveBody;

    use super::*;

    fn msg(seq: u64) -> Arc<LiveMsg> {
        Arc::new(LiveMsg::new(seq, 0, None, LiveBody::Ping { now_ms: 0 }))
    }

    #[test]
    fn replay_window() {
        let mut r = ReplayRing::new(3);
        assert_eq!(r.since(0, 0).unwrap().len(), 0);
        assert!(r.since(0, 1).is_err());
        for s in 1..=5 {
            r.push(msg(s));
        }
        // Holds 3, 4, 5.
        let seqs = |v: Vec<Arc<LiveMsg>>| v.iter().map(|m| m.seq).collect::<Vec<_>>();
        assert_eq!(seqs(r.since(2, 5).unwrap()), vec![3, 4, 5]);
        assert_eq!(seqs(r.since(4, 5).unwrap()), vec![5]);
        assert_eq!(seqs(r.since(5, 5).unwrap()), Vec::<u64>::new());
        assert_eq!(seqs(r.since(9, 5).unwrap()), Vec::<u64>::new());
        let e = r.since(1, 5).unwrap_err();
        assert_eq!((e.requested, e.oldest, e.latest), (1, 3, 5));
    }
}
