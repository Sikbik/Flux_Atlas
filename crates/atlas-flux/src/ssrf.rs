//! SSRF guard for per-node requests.
//!
//! Node addresses come from a public list that anyone can register into, so before connecting to
//! a node we require a globally routable unicast address and a FluxOS API port. The classifier is
//! deliberately strict: for IPv6 only the global unicast block `2000::/3` is accepted, minus the
//! special-purpose ranges inside it; embedded IPv4 forms (mapped, compatible, NAT64, 6to4) are
//! rejected or judged by their IPv4 payload.
//!
//! [`GuardedEndpoint`] is the only way to build a per-node request target, so every per-node
//! request path goes through [`check_endpoint`].

use std::fmt;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use atlas_core::NodeEndpoint;

/// Why an address or endpoint was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum SsrfError {
    #[error("unspecified address")]
    Unspecified,
    #[error("'this network' address (0.0.0.0/8)")]
    ThisNetwork,
    #[error("loopback address")]
    Loopback,
    #[error("private address (RFC 1918)")]
    Private,
    #[error("shared address space (CGNAT 100.64.0.0/10)")]
    SharedCgnat,
    #[error("link-local address")]
    LinkLocal,
    #[error("multicast address")]
    Multicast,
    #[error("broadcast address")]
    Broadcast,
    #[error("documentation address")]
    Documentation,
    #[error("benchmarking address (198.18.0.0/15)")]
    Benchmarking,
    #[error("IETF protocol assignment")]
    IetfProtocol,
    #[error("reserved address")]
    Reserved,
    #[error("unique local address (fc00::/7)")]
    UniqueLocal,
    #[error("site-local address (fec0::/10)")]
    SiteLocal,
    #[error("IPv4-translated or tunnelled IPv6 address")]
    Translated,
    #[error("discard-only address (100::/64)")]
    Discard,
    #[error("IPv6 outside global unicast (2000::/3)")]
    NotGlobalUnicast,
    #[error("port {0} is not a FluxOS API port")]
    Port(u16),
}

/// Classification of an IP address.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IpClass {
    /// Globally routable unicast: allowed.
    Public,
    Blocked(SsrfError),
}

const fn v4_in(ip: u32, net: u32, prefix: u32) -> bool {
    let mask = if prefix == 0 {
        0
    } else {
        u32::MAX << (32 - prefix)
    };
    ip & mask == net & mask
}

const fn v4(a: u8, b: u8, c: u8, d: u8) -> u32 {
    u32::from_be_bytes([a, b, c, d])
}

/// Classifies an IPv4 address.
pub fn classify_v4(ip: Ipv4Addr) -> IpClass {
    use SsrfError as E;
    let x = u32::from(ip);
    let blocked = |e| IpClass::Blocked(e);
    if x == 0 {
        return blocked(E::Unspecified);
    }
    if x == u32::MAX {
        return blocked(E::Broadcast);
    }
    // Ordered from most to least specific where ranges nest.
    let table: &[(u32, u32, SsrfError)] = &[
        (v4(0, 0, 0, 0), 8, E::ThisNetwork),
        (v4(10, 0, 0, 0), 8, E::Private),
        (v4(100, 64, 0, 0), 10, E::SharedCgnat),
        (v4(127, 0, 0, 0), 8, E::Loopback),
        (v4(169, 254, 0, 0), 16, E::LinkLocal),
        (v4(172, 16, 0, 0), 12, E::Private),
        (v4(192, 0, 0, 0), 24, E::IetfProtocol),
        (v4(192, 0, 2, 0), 24, E::Documentation),
        (v4(192, 88, 99, 0), 24, E::Reserved),
        (v4(192, 168, 0, 0), 16, E::Private),
        (v4(198, 18, 0, 0), 15, E::Benchmarking),
        (v4(198, 51, 100, 0), 24, E::Documentation),
        (v4(203, 0, 113, 0), 24, E::Documentation),
        (v4(224, 0, 0, 0), 4, E::Multicast),
        (v4(240, 0, 0, 0), 4, E::Reserved),
    ];
    for (net, prefix, err) in table {
        if v4_in(x, *net, *prefix) {
            return blocked(*err);
        }
    }
    IpClass::Public
}

const fn v6_in(ip: u128, net: u128, prefix: u32) -> bool {
    let mask = if prefix == 0 {
        0
    } else {
        u128::MAX << (128 - prefix)
    };
    ip & mask == net & mask
}

/// Classifies an IPv6 address.
pub fn classify_v6(ip: Ipv6Addr) -> IpClass {
    use SsrfError as E;
    let x = u128::from(ip);
    let blocked = |e| IpClass::Blocked(e);
    if x == 0 {
        return blocked(E::Unspecified);
    }
    if x == 1 {
        return blocked(E::Loopback);
    }
    // IPv4-mapped (::ffff:a.b.c.d): judge by the IPv4 payload, but never allow a public mapped
    // address either (the socket layer would treat it as IPv4; require the plain form).
    if let Some(v4) = ip.to_ipv4_mapped() {
        return match classify_v4(v4) {
            IpClass::Public => blocked(E::Translated),
            b @ IpClass::Blocked(_) => b,
        };
    }
    let net = |s: &str| u128::from(s.parse::<Ipv6Addr>().unwrap_or(Ipv6Addr::UNSPECIFIED));
    let table: [(u128, u32, SsrfError); 14] = [
        // IPv4-compatible (deprecated) ::a.b.c.d
        (0, 96, E::Translated),
        (net("64:ff9b::"), 96, E::Translated),
        (net("64:ff9b:1::"), 48, E::Translated),
        (net("100::"), 64, E::Discard),
        (net("2001:db8::"), 32, E::Documentation),
        (net("2001::"), 32, E::Translated), // Teredo
        (net("2001::"), 23, E::IetfProtocol),
        (net("2002::"), 16, E::Translated), // 6to4
        (net("3fff::"), 20, E::Documentation),
        (net("5f00::"), 16, E::Reserved), // SRv6 SIDs
        (net("fc00::"), 7, E::UniqueLocal),
        (net("fe80::"), 10, E::LinkLocal),
        (net("fec0::"), 10, E::SiteLocal),
        (net("ff00::"), 8, E::Multicast),
    ];
    for (n, prefix, err) in table {
        if v6_in(x, n, prefix) {
            return blocked(err);
        }
    }
    if !v6_in(x, net("2000::"), 3) {
        return blocked(E::NotGlobalUnicast);
    }
    IpClass::Public
}

/// Classifies any IP address.
pub fn classify(ip: IpAddr) -> IpClass {
    match ip {
        IpAddr::V4(v4) => classify_v4(v4),
        IpAddr::V6(v6) => classify_v6(v6),
    }
}

/// Ok if the address is globally routable unicast.
pub fn check_ip(ip: IpAddr) -> Result<(), SsrfError> {
    match classify(ip) {
        IpClass::Public => Ok(()),
        IpClass::Blocked(e) => Err(e),
    }
}

/// FluxOS reserves 16100..=16299 for its own services (apps may not bind there); node API
/// ports (16127, UPnP 16137..16197) and their TLS (+1) and UI (-1) neighbours live inside it.
pub const FLUXOS_PORT_RANGE: std::ops::RangeInclusive<u16> = 16100..=16299;

/// Ok if the endpoint is a public address on a FluxOS port.
pub fn check_endpoint(ep: &NodeEndpoint) -> Result<(), SsrfError> {
    check_ip(ep.ip)?;
    if !FLUXOS_PORT_RANGE.contains(&ep.port) {
        return Err(SsrfError::Port(ep.port));
    }
    Ok(())
}

/// A node endpoint that passed [`check_endpoint`]. The only constructor is [`GuardedEndpoint::new`],
/// and per-node request helpers accept nothing else.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct GuardedEndpoint(NodeEndpoint);

impl GuardedEndpoint {
    pub fn new(ep: NodeEndpoint) -> Result<Self, SsrfError> {
        check_endpoint(&ep)?;
        Ok(Self(ep))
    }

    pub fn endpoint(&self) -> NodeEndpoint {
        self.0
    }

    /// `http://ip:port` base URL.
    pub fn base_url(&self) -> String {
        self.0.api_base_url()
    }
}

impl fmt::Display for GuardedEndpoint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use SsrfError as E;

    fn c(s: &str) -> IpClass {
        classify(s.parse().unwrap())
    }

    #[test]
    fn ipv4_blocked_ranges_and_boundaries() {
        let cases: &[(&str, Option<SsrfError>)] = &[
            ("0.0.0.0", Some(E::Unspecified)),
            ("0.1.2.3", Some(E::ThisNetwork)),
            ("0.255.255.255", Some(E::ThisNetwork)),
            ("1.0.0.0", None),
            ("9.255.255.255", None),
            ("10.0.0.0", Some(E::Private)),
            ("10.255.255.255", Some(E::Private)),
            ("11.0.0.0", None),
            ("100.63.255.255", None),
            ("100.64.0.0", Some(E::SharedCgnat)),
            ("100.100.100.100", Some(E::SharedCgnat)),
            ("100.127.255.255", Some(E::SharedCgnat)),
            ("100.128.0.0", None),
            ("100.34.4.6", None),
            ("126.255.255.255", None),
            ("127.0.0.1", Some(E::Loopback)),
            ("127.255.255.254", Some(E::Loopback)),
            ("128.0.0.0", None),
            ("169.253.255.255", None),
            ("169.254.0.1", Some(E::LinkLocal)),
            ("169.254.169.254", Some(E::LinkLocal)),
            ("169.255.0.0", None),
            ("172.15.255.255", None),
            ("172.16.0.0", Some(E::Private)),
            ("172.31.255.255", Some(E::Private)),
            ("172.32.0.0", None),
            ("191.255.255.255", None),
            ("192.0.0.0", Some(E::IetfProtocol)),
            ("192.0.0.8", Some(E::IetfProtocol)),
            ("192.0.0.255", Some(E::IetfProtocol)),
            ("192.0.1.0", None),
            ("192.0.2.1", Some(E::Documentation)),
            ("192.0.3.0", None),
            ("192.88.99.1", Some(E::Reserved)),
            ("192.167.255.255", None),
            ("192.168.0.1", Some(E::Private)),
            ("192.168.255.255", Some(E::Private)),
            ("192.169.0.0", None),
            ("198.17.255.255", None),
            ("198.18.0.0", Some(E::Benchmarking)),
            ("198.19.255.255", Some(E::Benchmarking)),
            ("198.20.0.0", None),
            ("198.51.100.7", Some(E::Documentation)),
            ("203.0.113.9", Some(E::Documentation)),
            ("203.0.114.0", None),
            ("223.255.255.255", None),
            ("224.0.0.1", Some(E::Multicast)),
            ("239.255.255.255", Some(E::Multicast)),
            ("240.0.0.1", Some(E::Reserved)),
            ("254.255.255.255", Some(E::Reserved)),
            ("255.255.255.255", Some(E::Broadcast)),
            ("8.8.8.8", None),
            ("94.130.137.2", None),
            ("65.109.63.147", None),
        ];
        for (ip, want) in cases {
            let got = c(ip);
            let expected = want.map_or(IpClass::Public, IpClass::Blocked);
            assert_eq!(got, expected, "{ip}");
        }
    }

    #[test]
    fn ipv6_blocked_ranges() {
        let cases: &[(&str, Option<SsrfError>)] = &[
            ("::", Some(E::Unspecified)),
            ("::1", Some(E::Loopback)),
            ("::ffff:127.0.0.1", Some(E::Loopback)),
            ("::ffff:10.1.2.3", Some(E::Private)),
            ("::ffff:192.168.1.1", Some(E::Private)),
            ("::ffff:100.64.1.1", Some(E::SharedCgnat)),
            ("::ffff:8.8.8.8", Some(E::Translated)),
            ("::8.8.8.8", Some(E::Translated)),
            ("64:ff9b::a00:1", Some(E::Translated)),
            ("64:ff9b:1::1", Some(E::Translated)),
            ("100::1", Some(E::Discard)),
            ("2001:db8::1", Some(E::Documentation)),
            ("2001:0:4136:e378:8000:63bf:3fff:fdd2", Some(E::Translated)),
            ("2001:10::1", Some(E::IetfProtocol)),
            ("2001:1ff::1", Some(E::IetfProtocol)),
            ("2001:200::1", None),
            ("2002:c0a8:101::1", Some(E::Translated)),
            ("3fff::1", Some(E::Documentation)),
            ("3fff:fff::1", Some(E::Documentation)),
            ("3fff:1000::1", None),
            ("5f00::1", Some(E::Reserved)),
            ("fc00::1", Some(E::UniqueLocal)),
            ("fd12:3456::1", Some(E::UniqueLocal)),
            ("fe80::1", Some(E::LinkLocal)),
            ("febf::1", Some(E::LinkLocal)),
            ("fec0::1", Some(E::SiteLocal)),
            ("ff02::1", Some(E::Multicast)),
            ("ff05::2", Some(E::Multicast)),
            ("1::1", Some(E::NotGlobalUnicast)),
            ("4000::1", Some(E::NotGlobalUnicast)),
            ("2a01:4f8::1", None),
            ("2606:4700:4700::1111", None),
            ("2c0f:fb50::1", None),
        ];
        for (ip, want) in cases {
            let got = c(ip);
            let expected = want.map_or(IpClass::Public, IpClass::Blocked);
            assert_eq!(got, expected, "{ip}");
        }
    }

    #[test]
    fn endpoint_ports() {
        let ok: NodeEndpoint = "94.130.137.2:16137".parse().unwrap();
        assert!(check_endpoint(&ok).is_ok());
        assert!(GuardedEndpoint::new(ok).is_ok());
        let default: NodeEndpoint = "94.130.137.2".parse().unwrap();
        assert!(check_endpoint(&default).is_ok());
        let bad_port: NodeEndpoint = "94.130.137.2:22".parse().unwrap();
        assert_eq!(check_endpoint(&bad_port), Err(E::Port(22)));
        let edge: NodeEndpoint = "94.130.137.2:16300".parse().unwrap();
        assert_eq!(check_endpoint(&edge), Err(E::Port(16300)));
        let private: NodeEndpoint = "192.168.1.5:16127".parse().unwrap();
        assert_eq!(GuardedEndpoint::new(private).unwrap_err(), E::Private);
        assert_eq!(
            GuardedEndpoint::new(ok).unwrap().base_url(),
            "http://94.130.137.2:16137"
        );
    }

    /// Every IP in the real node-list fixtures is public.
    #[test]
    fn fixture_node_ips_are_public() {
        let dir = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../docs/research/fixtures/flux/"
        );
        let raw =
            std::fs::read_to_string(format!("{dir}daemon_viewdeterministicfluxnodelist.json"))
                .unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let mut n = 0;
        for e in v["data"].as_array().unwrap() {
            let ip = e["ip"].as_str().unwrap();
            if ip.is_empty() {
                continue;
            }
            let ep: NodeEndpoint = ip.parse().unwrap();
            assert!(GuardedEndpoint::new(ep).is_ok(), "{ip}");
            n += 1;
        }
        assert!(n > 10);
    }
}
