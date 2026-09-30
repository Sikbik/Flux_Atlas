//! Node network addresses (`ip[:port]`) as advertised in the node list.

use std::fmt;
use std::net::{IpAddr, Ipv6Addr};
use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use ts_rs::TS;

/// Default FluxOS API port. The UI port is the API port minus one.
pub const DEFAULT_API_PORT: u16 = 16127;

/// A node's advertised API endpoint. The node list omits the port for 16127; UPnP nodes
/// advertise `ip:port` with ports 16137..16197.
///
/// Serialized as text in every format: `a.b.c.d:port` or `[v6]:port`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, TS)]
#[ts(as = "String")]
pub struct NodeEndpoint {
    pub ip: IpAddr,
    pub port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum EndpointError {
    #[error("empty address")]
    Empty,
    #[error("invalid address: {0}")]
    Invalid(String),
}

impl NodeEndpoint {
    pub const fn new(ip: IpAddr, port: u16) -> Self {
        Self { ip, port }
    }

    /// Parses an advertised address. Returns `Ok(None)` for the empty string (the node list
    /// carries a few confirmed nodes without an IP).
    pub fn parse_opt(s: &str) -> Result<Option<Self>, EndpointError> {
        if s.trim().is_empty() {
            Ok(None)
        } else {
            s.parse().map(Some)
        }
    }

    /// FluxOS UI port (API port minus one).
    pub const fn ui_port(&self) -> u16 {
        self.port.saturating_sub(1)
    }

    pub const fn is_default_port(&self) -> bool {
        self.port == DEFAULT_API_PORT
    }

    /// `http://ip:port` base URL of the node's FluxOS API.
    pub fn api_base_url(&self) -> String {
        match self.ip {
            IpAddr::V4(v4) => format!("http://{v4}:{}", self.port),
            IpAddr::V6(v6) => format!("http://[{v6}]:{}", self.port),
        }
    }
}

impl fmt::Display for NodeEndpoint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.ip {
            IpAddr::V4(v4) => write!(f, "{v4}:{}", self.port),
            IpAddr::V6(v6) => write!(f, "[{v6}]:{}", self.port),
        }
    }
}

impl FromStr for NodeEndpoint {
    type Err = EndpointError;

    /// Accepts `a.b.c.d`, `a.b.c.d:port`, `[v6]`, `[v6]:port` and a bare IPv6 address.
    fn from_str(input: &str) -> Result<Self, Self::Err> {
        let s = input.trim();
        if s.is_empty() {
            return Err(EndpointError::Empty);
        }
        let bad = || EndpointError::Invalid(input.to_owned());
        if let Some(rest) = s.strip_prefix('[') {
            let (host, tail) = rest.split_once(']').ok_or_else(bad)?;
            let ip: Ipv6Addr = host.parse().map_err(|_| bad())?;
            let port = match tail.strip_prefix(':') {
                Some(p) => p.parse().map_err(|_| bad())?,
                None if tail.is_empty() => DEFAULT_API_PORT,
                None => return Err(bad()),
            };
            return Ok(Self {
                ip: IpAddr::V6(ip),
                port,
            });
        }
        if let Ok(ip) = s.parse::<IpAddr>() {
            return Ok(Self {
                ip,
                port: DEFAULT_API_PORT,
            });
        }
        let (host, port) = s.rsplit_once(':').ok_or_else(bad)?;
        let ip: IpAddr = host.parse().map_err(|_| bad())?;
        if ip.is_ipv6() {
            // An unbracketed IPv6 with a port is ambiguous.
            return Err(bad());
        }
        let port: u16 = port.parse().map_err(|_| bad())?;
        if port == 0 {
            return Err(bad());
        }
        Ok(Self { ip, port })
    }
}

impl Serialize for NodeEndpoint {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for NodeEndpoint {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = std::borrow::Cow::<str>::deserialize(deserializer)?;
        s.parse().map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_forms() {
        let a: NodeEndpoint = "5.230.173.203".parse().unwrap();
        assert_eq!(a.port, DEFAULT_API_PORT);
        assert_eq!(a.to_string(), "5.230.173.203:16127");
        let b: NodeEndpoint = "80.208.17.20:16187".parse().unwrap();
        assert_eq!(b.port, 16187);
        assert_eq!(b.ui_port(), 16186);
        let c: NodeEndpoint = "[2001:db8::1]:16137".parse().unwrap();
        assert_eq!(c.port, 16137);
        assert_eq!(c.to_string(), "[2001:db8::1]:16137");
        let d: NodeEndpoint = "2001:db8::1".parse().unwrap();
        assert_eq!(d.port, DEFAULT_API_PORT);
        assert_eq!(NodeEndpoint::parse_opt("").unwrap(), None);
        assert!("1.2.3.4:".parse::<NodeEndpoint>().is_err());
        assert!("1.2.3.4:0".parse::<NodeEndpoint>().is_err());
        assert!("host.example:16127".parse::<NodeEndpoint>().is_err());
        assert!("1.2.3.4:99999".parse::<NodeEndpoint>().is_err());
    }

    #[test]
    fn urls() {
        let a: NodeEndpoint = "1.2.3.4:16137".parse().unwrap();
        assert_eq!(a.api_base_url(), "http://1.2.3.4:16137");
        let b: NodeEndpoint = "[::2]:16127".parse().unwrap();
        assert_eq!(b.api_base_url(), "http://[::2]:16127");
    }
}
