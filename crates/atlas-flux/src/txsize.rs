//! Serialized transaction size from the daemon's decoded JSON.
//!
//! `getblock` verbosity 2 carries neither a per-transaction `size` nor its `hex`, so the size is
//! recomputed from the decoded fields, following the wire format:
//!
//! - **Sapling (v4)**: header (4) + version group (4) + inputs (36-byte prevout, script,
//!   sequence 4) + outputs (value 8, script) + lock time (4) + expiry (4) + value balance (8) +
//!   spends (384 each) + outputs (948 each) + JoinSplit count + binding signature (64, when there
//!   is any Sapling spend or output).
//! - **Fluxnode start v5**: version (4) + type (1) + collateral (36) + collateral pubkey +
//!   node pubkey + sig time (4) + signature.
//! - **Fluxnode start v6**: as v5 plus the upgraded tx version (4); P2SH starts carry the
//!   redeem script instead of the collateral pubkey.
//! - **Fluxnode confirm v5**: version (4) + type (1) + collateral (36) + sig time (4) +
//!   benchmark tier (1) + benchmark sig time (4) + update type (1) + IP string + signature +
//!   benchmark signature.
//!
//! Every shape above was checked against the sizes Insight reports for the same transactions
//! (742 mainnet transactions, all equal; see `tests/fixtures.rs`). Anything else (legacy v1-v3,
//! JoinSplits, delegate starts, v6 confirms, missing fields) returns `None`: unknown, not 0.

use crate::models::daemon::DaemonTx;

/// Bitcoin `CompactSize` length prefix for `n`.
const fn compact_size(n: usize) -> usize {
    if n < 0xfd {
        1
    } else if n <= 0xffff {
        3
    } else if n <= 0xffff_ffff {
        5
    } else {
        9
    }
}

/// A length-prefixed byte vector of `n` bytes.
const fn var_bytes(n: usize) -> usize {
    compact_size(n) + n
}

/// Byte length of a hex string (`None` when it is not hex).
fn hex_len(s: &str) -> Option<usize> {
    let s = s.trim();
    (s.len().is_multiple_of(2) && s.bytes().all(|b| b.is_ascii_hexdigit())).then_some(s.len() / 2)
}

/// Decoded length of a standard (padded) base64 string (`None` when it is not base64).
fn base64_len(s: &str) -> Option<usize> {
    let s = s.trim();
    if s.is_empty() || !s.len().is_multiple_of(4) {
        return None;
    }
    let body = s.trim_end_matches('=');
    let pad = s.len() - body.len();
    if pad > 2
        || !body
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/')
    {
        return None;
    }
    Some(s.len() / 4 * 3 - pad)
}

/// A pubkey as the daemon prints it: base64 (current daemons) or hex.
fn key_len(s: &str) -> Option<usize> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    // A hex key (66 or 130 characters) is also valid base64; prefer hex when it fits a key.
    match hex_len(s) {
        Some(n @ (33 | 65)) => Some(n),
        _ => base64_len(s),
    }
}

/// Serialized length of a script given in `asm` form (`2 <hex> <hex> 2 OP_CHECKMULTISIG`).
fn asm_script_len(asm: &str) -> Option<usize> {
    let mut n = 0usize;
    for tok in asm.split_whitespace() {
        if tok.starts_with("OP_") {
            n += 1;
        } else if let Ok(v) = tok.parse::<i64>() {
            // -1 and 0..=16 are single opcodes; other numbers are minimal script-number pushes.
            n += if (-1..=16).contains(&v) {
                1
            } else {
                let mut bytes = 0;
                let mut m = v.unsigned_abs();
                while m > 0 {
                    bytes += 1;
                    m >>= 8;
                }
                // A set sign bit in the top byte needs one more byte.
                if (v.unsigned_abs() >> (bytes * 8 - 1)) & 1 == 1 {
                    bytes += 1;
                }
                1 + bytes
            };
        } else {
            let len = hex_len(tok)?;
            n += match len {
                0..=75 => 1,
                76..=255 => 2,
                256..=65_535 => 3,
                _ => 5,
            } + len;
        }
    }
    Some(n)
}

impl DaemonTx {
    /// The serialized size in bytes: the daemon's own `size` when present, otherwise computed
    /// from the decoded fields (see the module docs). `None` when it cannot be determined.
    pub fn serialized_size(&self) -> Option<u32> {
        if let Some(s) = self.size.filter(|s| *s > 0) {
            return Some(s);
        }
        let n = if self.is_fluxnode() {
            self.fluxnode_size()?
        } else if self.version == 4 {
            self.sapling_size()?
        } else {
            return None;
        };
        u32::try_from(n).ok()
    }

    fn sapling_size(&self) -> Option<usize> {
        let mut n = 4 + 4 + compact_size(self.vin.len());
        for vin in &self.vin {
            let script = match (&vin.coinbase, &vin.script_sig) {
                (Some(cb), _) => hex_len(cb)?,
                (None, Some(sig)) => hex_len(&sig.hex)?,
                (None, None) => return None,
            };
            n += 36 + var_bytes(script) + 4;
        }
        n += compact_size(self.vout.len());
        for o in &self.vout {
            n += 8 + var_bytes(hex_len(&o.script_pub_key.hex)?);
        }
        let spends = self.shielded_spends?;
        let outputs = self.shielded_outputs?;
        if self.joinsplits? != 0 {
            return None;
        }
        n += 4 + 4 + 8;
        n += compact_size(spends) + 384 * spends;
        n += compact_size(outputs) + 948 * outputs;
        n += compact_size(0);
        if spends + outputs > 0 {
            n += 64;
        }
        Some(n)
    }

    fn fluxnode_size(&self) -> Option<usize> {
        let sig = var_bytes(base64_len(self.sig.as_deref()?)?);
        // version + type + collateral outpoint
        let head = 4 + 1 + 36;
        if self.is_start() {
            if self.using_delegates == Some(true) {
                return None;
            }
            let pubkey = var_bytes(key_len(self.zelnode_pubkey.as_deref()?)?);
            let collateral_key = || -> Option<usize> {
                Some(var_bytes(key_len(self.collateral_pubkey.as_deref()?)?))
            };
            return match self.version {
                5 => Some(head + collateral_key()? + pubkey + 4 + sig),
                6 => {
                    let auth = match self.fluxnode_upgraded_tx_version? {
                        1 => collateral_key()?,
                        2 => var_bytes(asm_script_len(self.redeemscript.as_deref()?)?),
                        _ => return None,
                    };
                    Some(head + 4 + auth + pubkey + 4 + sig)
                }
                _ => None,
            };
        }
        if self.is_confirm() && self.version == 5 {
            let ip = var_bytes(self.ip.as_deref().unwrap_or_default().len());
            let bench_sig = var_bytes(base64_len(self.benchmark_sig.as_deref()?)?);
            return Some(head + 4 + 1 + 4 + 1 + ip + sig + bench_sig);
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helpers() {
        assert_eq!(compact_size(252), 1);
        assert_eq!(compact_size(253), 3);
        assert_eq!(base64_len("aGk="), Some(2));
        assert_eq!(base64_len("aGVsbG8h"), Some(6));
        assert_eq!(base64_len("abc"), None);
        assert_eq!(hex_len("00ff"), Some(2));
        assert_eq!(hex_len("0g"), None);
        // 2-of-2 multisig: OP_2 + 2 x (push 33) + OP_2 + OP_CHECKMULTISIG.
        let k = "02".repeat(33);
        assert_eq!(
            asm_script_len(&format!("2 {k} {k} 2 OP_CHECKMULTISIG")),
            Some(71)
        );
        assert_eq!(asm_script_len("OP_DUP zz"), None);
    }
}
