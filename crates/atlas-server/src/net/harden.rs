//! Process hardening at startup (ARCHITECTURE section 11.2), run by `atlas serve` on its main
//! thread before the runtime starts any other thread (Linux capabilities and `no_new_privs`
//! are per thread and inherited by the threads created afterwards).
//!
//! - **File descriptors.** The soft `RLIMIT_NOFILE` is raised to the hard limit: Docker gives
//!   containers a soft limit of 1024, which about a thousand idle sockets would exhaust.
//! - **Capabilities.** The container runs as root because FluxOS mounts a root-owned volume.
//!   The server needs no capability for that: as uid 0 it owns the volume, and it binds an
//!   unprivileged port. So every capability is dropped from the effective, permitted,
//!   inheritable, ambient and bounding sets. If the data directory holds files owned by
//!   another user (an unusual volume), `CAP_DAC_OVERRIDE` and `CAP_FOWNER` are kept so the
//!   server can still write them, and a warning names the reason.
//! - **`no_new_privs`.** Set, so nothing the process could ever execute gains privileges.
//!
//! What remains is uid 0 without capabilities: it can read and write files owned by root
//! inside the container (its own data, the image's read-only files) and nothing more than an
//! ordinary user otherwise.

use std::path::Path;

#[cfg(target_os = "linux")]
use rustix::thread::CapabilitySet;

/// What [`harden`] did, for the startup log.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Hardening {
    /// Soft file descriptor limit before and after.
    pub nofile_before: Option<u64>,
    pub nofile_after: Option<u64>,
    /// Effective capabilities before (bit mask) and kept.
    pub caps_before: u64,
    pub caps_kept: u64,
    /// Capabilities removed from the bounding set.
    pub bounding_dropped: u32,
    pub no_new_privs: bool,
    /// Why capabilities were kept, if any were.
    pub kept_reason: Option<String>,
    /// Steps that failed (logged as warnings; the server still runs).
    pub errors: Vec<String>,
}

/// Raises the soft `RLIMIT_NOFILE` to the hard limit. Returns (before, after).
pub fn raise_nofile() -> (Option<u64>, Option<u64>, Option<String>) {
    #[cfg(unix)]
    {
        use rustix::process::{Resource, Rlimit, getrlimit, setrlimit};
        let cur = getrlimit(Resource::Nofile);
        let before = cur.current;
        if cur.current.is_some() && cur.current != cur.maximum {
            let target = Rlimit {
                current: cur.maximum,
                maximum: cur.maximum,
            };
            if let Err(e) = setrlimit(Resource::Nofile, target) {
                return (before, before, Some(format!("raising RLIMIT_NOFILE: {e}")));
            }
        }
        (before, getrlimit(Resource::Nofile).current, None)
    }
    #[cfg(not(unix))]
    {
        (None, None, None)
    }
}

/// True when every entry of `dir` (two levels deep: the database and `geoip/`) is owned by
/// `uid`. Missing entries are fine; unreadable ones count as foreign.
#[cfg(unix)]
pub fn owned_by(dir: &Path, uid: u32) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt as _;
    let check = |p: &Path| -> Result<(), String> {
        match std::fs::symlink_metadata(p) {
            Ok(m) if m.uid() == uid => Ok(()),
            Ok(m) => Err(format!("{} is owned by uid {}", p.display(), m.uid())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("{}: {e}", p.display())),
        }
    };
    check(dir)?;
    let Ok(rd) = std::fs::read_dir(dir) else {
        return Ok(());
    };
    for e in rd.flatten() {
        let p = e.path();
        check(&p)?;
        if p.is_dir()
            && let Ok(inner) = std::fs::read_dir(&p)
        {
            for f in inner.flatten() {
                check(&f.path())?;
            }
        }
    }
    Ok(())
}

/// Drops every capability the server does not need and sets `no_new_privs`, on the calling
/// thread (call it before any other thread exists). `data_dir` must already exist.
pub fn drop_privileges(data_dir: &Path) -> Hardening {
    let mut out = Hardening::default();
    #[cfg(target_os = "linux")]
    {
        use rustix::thread::{
            capabilities, capability_is_in_bounding_set, clear_ambient_capability_set,
            remove_capability_from_bounding_set, set_capabilities, set_no_new_privs,
        };
        let before = match capabilities(None) {
            Ok(c) => c,
            Err(e) => {
                out.errors.push(format!("reading capabilities: {e}"));
                return out;
            }
        };
        out.caps_before = before.effective.bits();
        let mut keep = CapabilitySet::empty();
        if !before.effective.is_empty() {
            let uid = rustix::process::geteuid().as_raw();
            if let Err(why) = owned_by(data_dir, uid) {
                keep = (CapabilitySet::DAC_OVERRIDE | CapabilitySet::FOWNER) & before.permitted;
                out.kept_reason = Some(why);
            }
        }
        // The bounding set first: dropping from it needs CAP_SETPCAP, which goes next.
        for bit in 0..64u32 {
            let cap = CapabilitySet::from_bits_retain(1u64 << bit);
            if keep.contains(cap) {
                continue;
            }
            // Not in the set, or unknown to this kernel: nothing to drop.
            if capability_is_in_bounding_set(cap) != Ok(true) {
                continue;
            }
            match remove_capability_from_bounding_set(cap) {
                Ok(()) => out.bounding_dropped += 1,
                // Without CAP_SETPCAP (an unprivileged run) the bounding set stays.
                Err(rustix::io::Errno::PERM) => break,
                Err(e) => out.errors.push(format!("bounding set bit {bit}: {e}")),
            }
        }
        if let Err(e) = clear_ambient_capability_set() {
            out.errors
                .push(format!("clearing ambient capabilities: {e}"));
        }
        let sets = rustix::thread::CapabilitySets {
            effective: keep,
            permitted: keep,
            inheritable: CapabilitySet::empty(),
        };
        if let Err(e) = set_capabilities(None, sets) {
            out.errors.push(format!("setting capabilities: {e}"));
        }
        match set_no_new_privs(true) {
            Ok(()) => out.no_new_privs = true,
            Err(e) => out.errors.push(format!("setting no_new_privs: {e}")),
        }
        out.caps_kept = capabilities(None).map_or(out.caps_before, |c| c.effective.bits());
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = data_dir;
    }
    out
}

/// Raises the descriptor limit, then drops privileges. Logs what it did.
pub fn harden(data_dir: &Path) -> Hardening {
    let (before, after, nofile_err) = raise_nofile();
    let mut h = drop_privileges(data_dir);
    h.nofile_before = before;
    h.nofile_after = after;
    h.errors.extend(nofile_err);
    h
}

/// Capability names of a mask (for the log).
pub fn cap_names(mask: u64) -> Vec<String> {
    #[cfg(target_os = "linux")]
    {
        let set = CapabilitySet::from_bits_retain(mask);
        set.iter_names()
            .map(|(n, _)| n.to_ascii_lowercase())
            .collect()
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = mask;
        Vec::new()
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    fn status_field(name: &str) -> String {
        let s = std::fs::read_to_string("/proc/thread-self/status").unwrap();
        s.lines()
            .find_map(|l| l.strip_prefix(name))
            .unwrap()
            .trim()
            .to_owned()
    }

    #[test]
    fn privileges_drop_on_this_thread() {
        // A dedicated thread: capabilities and no_new_privs are per thread, so the rest of the
        // test process is unaffected.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_path_buf();
        let (h, nnp, eff, prm) = std::thread::spawn(move || {
            let h = drop_privileges(&path);
            (
                h,
                status_field("NoNewPrivs:"),
                status_field("CapEff:"),
                status_field("CapPrm:"),
            )
        })
        .join()
        .unwrap();
        assert!(h.errors.is_empty(), "{:?}", h.errors);
        assert!(h.no_new_privs);
        assert_eq!(nnp, "1");
        assert_eq!(u64::from_str_radix(&eff, 16).unwrap(), 0, "CapEff {eff}");
        assert_eq!(u64::from_str_radix(&prm, 16).unwrap(), 0, "CapPrm {prm}");
        assert_eq!(h.caps_kept, 0);
    }

    #[test]
    fn nofile_soft_reaches_hard() {
        let (before, after, err) = raise_nofile();
        assert!(err.is_none(), "{err:?}");
        let hard = rustix::process::getrlimit(rustix::process::Resource::Nofile).maximum;
        assert!(after >= before);
        assert_eq!(after, hard);
    }

    #[test]
    fn ownership_scan() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("geoip")).unwrap();
        std::fs::write(dir.path().join("geoip/x"), b"1").unwrap();
        let uid = rustix::process::geteuid().as_raw();
        assert!(owned_by(dir.path(), uid).is_ok());
        assert!(owned_by(dir.path(), uid + 1).is_err());
        assert!(cap_names(1 << 1).contains(&"dac_override".to_owned()));
    }
}
