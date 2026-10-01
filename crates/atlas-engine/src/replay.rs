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

/// Default byte bound of the replay ring (serialized JSON size of the messages it holds).
pub const REPLAY_MAX_BYTES: usize = 16 << 20;

/// Counts the bytes a serializer writes.
struct Counter(usize);

impl std::io::Write for Counter {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0 += b.len();
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Serialized size of a message (what a client receives), without allocating it.
pub(crate) fn json_len(msg: &LiveMsg) -> usize {
    let mut c = Counter(0);
    let _ = serde_json::to_writer(&mut c, msg);
    c.0
}

#[derive(Debug)]
pub(crate) struct ReplayRing {
    cap: usize,
    max_bytes: usize,
    bytes: usize,
    buf: VecDeque<(Arc<LiveMsg>, usize)>,
}

impl ReplayRing {
    pub(crate) fn new(cap: usize) -> Self {
        Self::with_bytes(cap, REPLAY_MAX_BYTES)
    }

    /// A ring of at most `cap` messages and about `max_bytes` (serialized) of them; the newest
    /// message is always kept.
    pub(crate) fn with_bytes(cap: usize, max_bytes: usize) -> Self {
        Self {
            cap: cap.max(1),
            max_bytes,
            bytes: 0,
            buf: VecDeque::with_capacity(cap.clamp(1, 8192)),
        }
    }

    /// Messages must be pushed in strictly increasing `seq` order.
    pub(crate) fn push(&mut self, msg: Arc<LiveMsg>) {
        let n = json_len(&msg);
        self.bytes += n;
        self.buf.push_back((msg, n));
        while self.buf.len() > 1 && (self.buf.len() > self.cap || self.bytes > self.max_bytes) {
            if let Some((_, old)) = self.buf.pop_front() {
                self.bytes -= old;
            }
        }
    }

    /// Serialized bytes held.
    pub(crate) fn bytes(&self) -> usize {
        self.bytes
    }

    /// Everything with `seq > since`. `latest` is the engine's current sequence, which may be ahead
    /// of the ring when a publish carried no live message.
    pub(crate) fn since(&self, since: u64, latest: u64) -> Result<Vec<Arc<LiveMsg>>, Resync> {
        if since >= latest {
            return Ok(Vec::new());
        }
        let oldest = self.buf.front().map_or(0, |m| m.0.seq);
        // Gap-free only if the ring still holds seq `since + 1` (or the first message after it).
        if self.buf.is_empty() || oldest > since + 1 {
            return Err(Resync {
                requested: since,
                oldest,
                latest,
            });
        }
        let start = self.buf.partition_point(|m| m.0.seq <= since);
        Ok(self
            .buf
            .range(start..)
            .map(|(m, _)| Arc::clone(m))
            .collect())
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

    #[test]
    fn byte_bound() {
        let one = json_len(&msg(1));
        assert!(one > 10);
        // Room for about three messages by bytes, ten by count.
        let mut r = ReplayRing::with_bytes(10, one * 3 + one / 2);
        for s in 1..=8 {
            r.push(msg(s));
        }
        assert_eq!(r.buf.len(), 3);
        assert!(r.bytes() <= one * 3 + one / 2);
        let seqs: Vec<u64> = r.since(5, 8).unwrap().iter().map(|m| m.seq).collect();
        assert_eq!(seqs, vec![6, 7, 8]);
        assert!(r.since(4, 8).is_err());
        // A message larger than the whole bound is still kept (alone).
        let mut r = ReplayRing::with_bytes(10, 1);
        r.push(msg(1));
        r.push(msg(2));
        assert_eq!(r.buf.len(), 1);
        assert_eq!(r.since(1, 2).unwrap()[0].seq, 2);
    }
}
