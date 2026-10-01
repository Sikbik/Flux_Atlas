//! Who the client is: the trust model for forwarding headers (ARCHITECTURE section 11.2).
//!
//! Public traffic reaches the container two ways:
//! - through the Flux domain manager (FDM), an HAProxy fleet in `mode http` that terminates TLS
//!   for `atlas.app.runonflux.io` and appends the address it saw to `X-Forwarded-For`
//!   (`option forwardfor`); the TCP peer is then an FDM balancer;
//! - directly on `<node-ip>:<app port>`, where the TCP peer is the real client and any
//!   forwarding header was written by that client.
//!
//! So a forwarding header means something only when the TCP peer is a known proxy. The client
//! address is the peer, unless the peer is trusted: then it is the right-most
//! `X-Forwarded-For` entry that is not itself a trusted proxy. A trusted peer whose header is
//! missing or malformed is treated as the client (never an error). `X-Real-IP` and `Forwarded`
//! are ignored: FDM does not set them for ordinary apps, so they can only come from a caller.
//!
//! The built-in allow-list is FluxOS's own (`fdmAddresses` in `ZelBack/config/default.js`): the
//! public egress addresses of the FDM app balancers. `ATLAS_TRUSTED_PROXIES` replaces or extends
//! it.
//!
//! Limits are keyed by [`client_key`]: an IPv4 address, or the /64 of an IPv6 address (one
//! subscriber usually holds a whole /64).

use std::fmt;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::str::FromStr;

/// The FDM app balancers' public egress addresses: what an app container sees as the TCP peer
/// of a request through `<app>.app.runonflux.io`. Production (EU, Singapore, US) and staging.
/// Source: RunOnFlux/flux `ZelBack/config/default.js` `fdmAddresses` (2026-09-25), which FluxOS
/// itself uses to decide whether to read `X-Forwarded-For` (`ingressCapture.js`).
pub const FDM_APP_BALANCERS: &[&str] = &[
    // Production, EU (fdm-fn-1-1..4).
    "5.39.57.42",
    "5.39.57.43",
    "5.39.57.44",
    "5.39.57.45",
    // Production, Singapore (fdm-sg-1-1..4).
    "146.190.83.190",
    "146.190.103.145",
    "134.209.107.70",
    "146.190.105.10",
    // Production, US (fdm-usa-1-1..4).
    "5.161.211.14",
    "5.161.178.20",
    "5.161.42.73",
    "5.161.81.155",
    // Staging.
    "5.161.215.75",
    "5.161.109.34",
    "5.39.57.46",
    "5.39.57.47",
];

/// An address block (`a.b.c.d/n`, `x::/n` or a single address).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cidr {
    net: IpAddr,
    prefix: u8,
}

impl Cidr {
    pub fn contains(&self, ip: IpAddr) -> bool {
        match (self.net, canonical(ip)) {
            (IpAddr::V4(n), IpAddr::V4(a)) => {
                let m = mask_u32(self.prefix);
                u32::from(n) & m == u32::from(a) & m
            }
            (IpAddr::V6(n), IpAddr::V6(a)) => {
                let m = mask_u128(self.prefix);
                u128::from(n) & m == u128::from(a) & m
            }
            _ => false,
        }
    }
}

fn mask_u32(prefix: u8) -> u32 {
    if prefix == 0 {
        0
    } else {
        u32::MAX << (32 - u32::from(prefix.min(32)))
    }
}

fn mask_u128(prefix: u8) -> u128 {
    if prefix == 0 {
        0
    } else {
        u128::MAX << (128 - u32::from(prefix.min(128)))
    }
}

impl FromStr for Cidr {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let s = s.trim();
        let (addr, prefix) = match s.split_once('/') {
            Some((a, p)) => (a, Some(p)),
            None => (s, None),
        };
        let net = canonical(
            addr.parse::<IpAddr>()
                .map_err(|_| format!("invalid address {addr:?}"))?,
        );
        let max = if net.is_ipv4() { 32 } else { 128 };
        let prefix = match prefix {
            None => max,
            Some(p) => p
                .parse::<u8>()
                .ok()
                .filter(|p| *p <= max)
                .ok_or_else(|| format!("invalid prefix length in {s:?}"))?,
        };
        Ok(Self { net, prefix })
    }
}

impl fmt::Display for Cidr {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}/{}", self.net, self.prefix)
    }
}

/// Peers whose forwarding headers are believed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrustedProxies {
    nets: Vec<Cidr>,
    /// Every peer is trusted (the legacy `ATLAS_TRUST_PROXY=1`). Safe only when the port is
    /// reachable through the proxy alone, which is not the case on Flux.
    all: bool,
}

impl Default for TrustedProxies {
    /// The FDM app balancers.
    fn default() -> Self {
        Self::fdm()
    }
}

impl TrustedProxies {
    /// The built-in FDM allow-list.
    pub fn fdm() -> Self {
        Self {
            nets: FDM_APP_BALANCERS
                .iter()
                .filter_map(|a| a.parse().ok())
                .collect(),
            all: false,
        }
    }

    /// No proxy: every forwarding header is ignored.
    pub fn none() -> Self {
        Self {
            nets: Vec::new(),
            all: false,
        }
    }

    /// Every peer (legacy `ATLAS_TRUST_PROXY=1`).
    pub fn all() -> Self {
        Self {
            nets: Vec::new(),
            all: true,
        }
    }

    /// Parses `ATLAS_TRUSTED_PROXIES`: a comma-separated list of `fdm` (the built-in list),
    /// `none`, `all`, addresses and CIDR blocks. `fdm,10.0.0.0/8` extends the built-in list.
    pub fn parse(s: &str) -> Result<Self, String> {
        let mut out = Self::none();
        let mut any = false;
        for part in s.split(',').map(str::trim).filter(|p| !p.is_empty()) {
            any = true;
            match part.to_ascii_lowercase().as_str() {
                "none" | "off" => {}
                "fdm" | "default" => out.nets.extend(Self::fdm().nets),
                "all" | "any" | "*" => out.all = true,
                _ => out.nets.push(part.parse()?),
            }
        }
        if !any {
            return Err("empty proxy list (use `none` to trust no proxy)".to_owned());
        }
        out.nets.dedup();
        Ok(out)
    }

    pub fn is_trusted(&self, peer: IpAddr) -> bool {
        self.all || self.nets.iter().any(|n| n.contains(peer))
    }

    pub fn trusts_all(&self) -> bool {
        self.all
    }

    /// Number of configured blocks (for the startup log).
    pub fn len(&self) -> usize {
        self.nets.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nets.is_empty() && !self.all
    }

    /// Whether `ip` is one of the built-in FDM balancers (for the anonymised peer counters:
    /// these are public infrastructure addresses, never a user's).
    pub fn is_fdm(ip: IpAddr) -> bool {
        let ip = canonical(ip);
        FDM_APP_BALANCERS
            .iter()
            .any(|a| a.parse::<IpAddr>().is_ok_and(|b| b == ip))
    }
}

/// How the client address of a request was found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// Untrusted peer without forwarding headers: the peer is the client.
    Direct,
    /// Untrusted peer that sent `X-Forwarded-For`: ignored, the peer is the client.
    DirectHeaderIgnored,
    /// Trusted peer: the client came from `X-Forwarded-For`.
    Forwarded,
    /// Trusted peer without `X-Forwarded-For`: the peer is the client.
    ProxyNoHeader,
    /// Trusted peer with an unusable `X-Forwarded-For`: the peer is the client.
    ProxyBadHeader,
}

impl Source {
    pub const ALL: [Self; 5] = [
        Self::Direct,
        Self::DirectHeaderIgnored,
        Self::Forwarded,
        Self::ProxyNoHeader,
        Self::ProxyBadHeader,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::DirectHeaderIgnored => "direct_header_ignored",
            Self::Forwarded => "forwarded",
            Self::ProxyNoHeader => "proxy_no_header",
            Self::ProxyBadHeader => "proxy_bad_header",
        }
    }

    pub fn index(self) -> usize {
        self as usize
    }
}

/// Maps IPv4-mapped IPv6 (`::ffff:a.b.c.d`) to IPv4.
pub fn canonical(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map_or(IpAddr::V6(v6), IpAddr::V4),
        v4 @ IpAddr::V4(_) => v4,
    }
}

/// The limiter key of a client: the IPv4 address, or the /64 of an IPv6 one.
pub fn client_key(ip: IpAddr) -> IpAddr {
    match canonical(ip) {
        IpAddr::V6(v6) => IpAddr::V6(Ipv6Addr::from(u128::from(v6) & mask_u128(64))),
        v4 @ IpAddr::V4(_) => v4,
    }
}

/// One `X-Forwarded-For` element: an address, optionally bracketed or with a port.
fn parse_element(s: &str) -> Option<IpAddr> {
    let s = s.trim();
    if let Ok(ip) = s.parse::<IpAddr>() {
        return Some(canonical(ip));
    }
    // `[v6]:port`, `[v6]` or `v4:port`.
    if let Some(rest) = s.strip_prefix('[') {
        let end = rest.find(']')?;
        return rest[..end].parse::<IpAddr>().ok().map(canonical);
    }
    let (host, port) = s.rsplit_once(':')?;
    if port.bytes().all(|b| b.is_ascii_digit()) && !port.is_empty() {
        return host.parse::<Ipv4Addr>().ok().map(IpAddr::V4);
    }
    None
}

/// Largest `X-Forwarded-For` value considered (all header lines together).
const MAX_XFF_BYTES: usize = 2048;

/// The client address of a request from `peer` with these headers.
pub fn resolve(
    peer: IpAddr,
    headers: &http::HeaderMap,
    proxies: &TrustedProxies,
) -> (IpAddr, Source) {
    let peer = canonical(peer);
    let mut lines = headers.get_all("x-forwarded-for").iter().peekable();
    let has_header = lines.peek().is_some();
    if !proxies.is_trusted(peer) {
        let source = if has_header {
            Source::DirectHeaderIgnored
        } else {
            Source::Direct
        };
        return (peer, source);
    }
    if !has_header {
        return (peer, Source::ProxyNoHeader);
    }
    // Header lines are one list in order; the proxy appends the address it saw last.
    let mut joined = String::new();
    for l in lines {
        let Ok(v) = l.to_str() else {
            return (peer, Source::ProxyBadHeader);
        };
        if !joined.is_empty() {
            joined.push(',');
        }
        joined.push_str(v);
        if joined.len() > MAX_XFF_BYTES {
            break;
        }
    }
    // Walk from the right: skip hops that are trusted proxies themselves; the first other
    // address is the client. An unparsable element ends the walk (fall back to the peer).
    for elem in joined.rsplit(',') {
        match parse_element(elem) {
            Some(ip) if proxies.is_trusted(ip) && !proxies.trusts_all() => {}
            Some(ip) => return (ip, Source::Forwarded),
            None => return (peer, Source::ProxyBadHeader),
        }
    }
    // Every hop was a trusted proxy.
    (peer, Source::ProxyBadHeader)
}

#[cfg(test)]
mod tests {
    use http::HeaderMap;

    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    fn xff(values: &[&str]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for v in values {
            h.append("x-forwarded-for", v.parse().unwrap());
        }
        h
    }

    #[test]
    fn cidr_parsing_and_matching() {
        let c: Cidr = "10.0.0.0/8".parse().unwrap();
        assert!(c.contains(ip("10.200.1.1")));
        assert!(!c.contains(ip("11.0.0.1")));
        assert!(c.contains(ip("::ffff:10.1.2.3")), "mapped v4");
        let c: Cidr = "2001:db8::/32".parse().unwrap();
        assert!(c.contains(ip("2001:db8:1::5")));
        assert!(!c.contains(ip("2001:db9::1")));
        assert!(!c.contains(ip("10.0.0.1")));
        let one: Cidr = "5.39.57.42".parse().unwrap();
        assert!(one.contains(ip("5.39.57.42")));
        assert!(!one.contains(ip("5.39.57.43")));
        assert!("0.0.0.0/0".parse::<Cidr>().unwrap().contains(ip("1.2.3.4")));
        assert!("10.0.0.0/33".parse::<Cidr>().is_err());
        assert!("nope".parse::<Cidr>().is_err());
    }

    #[test]
    fn proxy_list_parsing() {
        let d = TrustedProxies::default();
        assert_eq!(d.len(), FDM_APP_BALANCERS.len());
        assert!(d.is_trusted(ip("5.161.211.14")));
        assert!(d.is_trusted(ip("::ffff:146.190.83.190")));
        assert!(!d.is_trusted(ip("203.0.113.9")));
        assert!(!d.is_trusted(ip("127.0.0.1")), "loopback is not a proxy");
        let n = TrustedProxies::parse("none").unwrap();
        assert!(n.is_empty() && !n.is_trusted(ip("5.161.211.14")));
        let x = TrustedProxies::parse("fdm, 10.0.0.0/8").unwrap();
        assert!(x.is_trusted(ip("10.9.9.9")) && x.is_trusted(ip("5.39.57.45")));
        assert!(
            TrustedProxies::parse("all")
                .unwrap()
                .is_trusted(ip("1.1.1.1"))
        );
        assert!(TrustedProxies::parse("").is_err());
        assert!(TrustedProxies::parse("fdm,bogus").is_err());
        assert!(TrustedProxies::is_fdm(ip("5.39.57.42")));
        assert!(!TrustedProxies::is_fdm(ip("5.39.57.41")));
    }

    #[test]
    fn untrusted_peer_headers_are_ignored() {
        let p = TrustedProxies::fdm();
        let peer = ip("198.51.100.20");
        assert_eq!(resolve(peer, &HeaderMap::new(), &p), (peer, Source::Direct));
        // A direct caller can write any header it likes: it is never believed.
        assert_eq!(
            resolve(peer, &xff(&["1.2.3.4"]), &p),
            (peer, Source::DirectHeaderIgnored)
        );
    }

    #[test]
    fn fdm_peer_appends_the_client() {
        let p = TrustedProxies::fdm();
        let fdm = ip("5.39.57.42");
        // HAProxy `option forwardfor` adds its own line after what the caller sent: the caller's
        // values are on the left and can be spoofed, the last element is what FDM saw.
        let h = xff(&["6.6.6.6, 7.7.7.7", "203.0.113.9"]);
        assert_eq!(resolve(fdm, &h, &p), (ip("203.0.113.9"), Source::Forwarded));
        let h = xff(&["2001:db8::1"]);
        assert_eq!(resolve(fdm, &h, &p), (ip("2001:db8::1"), Source::Forwarded));
        // A proxy in front of FDM that is itself trusted is skipped.
        let h = xff(&["203.0.113.9, 5.161.211.14"]);
        assert_eq!(resolve(fdm, &h, &p), (ip("203.0.113.9"), Source::Forwarded));
        // Ports and brackets.
        let h = xff(&["[2001:db8::7]:443"]);
        assert_eq!(resolve(fdm, &h, &p), (ip("2001:db8::7"), Source::Forwarded));
        let h = xff(&["203.0.113.4:5555"]);
        assert_eq!(resolve(fdm, &h, &p), (ip("203.0.113.4"), Source::Forwarded));
        // Missing or garbage: the peer.
        assert_eq!(
            resolve(fdm, &HeaderMap::new(), &p),
            (fdm, Source::ProxyNoHeader)
        );
        assert_eq!(
            resolve(fdm, &xff(&["1.2.3.4, unknown"]), &p),
            (fdm, Source::ProxyBadHeader)
        );
        assert_eq!(
            resolve(fdm, &xff(&["5.39.57.43"]), &p),
            (fdm, Source::ProxyBadHeader),
            "only proxies in the chain"
        );
        // Mapped peers are canonicalised before the check.
        assert_eq!(
            resolve(ip("::ffff:5.39.57.42"), &xff(&["203.0.113.9"]), &p).1,
            Source::Forwarded
        );
    }

    #[test]
    fn trust_all_takes_the_last_entry() {
        let p = TrustedProxies::all();
        let h = xff(&["10.0.0.1, 203.0.113.9"]);
        assert_eq!(
            resolve(ip("127.0.0.1"), &h, &p),
            (ip("203.0.113.9"), Source::Forwarded)
        );
    }

    #[test]
    fn keys_group_ipv6_by_64() {
        assert_eq!(client_key(ip("203.0.113.9")), ip("203.0.113.9"));
        assert_eq!(
            client_key(ip("2001:db8:1:2:aaaa::1")),
            client_key(ip("2001:db8:1:2:bbbb::9"))
        );
        assert_ne!(
            client_key(ip("2001:db8:1:2::1")),
            client_key(ip("2001:db8:1:3::1"))
        );
        assert_eq!(client_key(ip("::ffff:1.2.3.4")), ip("1.2.3.4"));
    }
}
