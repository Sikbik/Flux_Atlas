//! Pre-serialized, pre-compressed response bodies.
//!
//! The publisher builds each hot body once per publish; the server only picks an encoding and
//! copies bytes. The ETag is strong and content-derived, so identical bodies across publishes keep
//! their ETag and clients get `304 Not Modified`.

use std::io::Write;

use bytes::Bytes;

/// Content encodings a prebuilt body is available in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding {
    Identity,
    Brotli,
    Gzip,
    Zstd,
}

impl Encoding {
    /// `Content-Encoding` header value; `None` for identity.
    pub fn header_value(self) -> Option<&'static str> {
        match self {
            Self::Identity => None,
            Self::Brotli => Some("br"),
            Self::Gzip => Some("gzip"),
            Self::Zstd => Some("zstd"),
        }
    }

    /// Picks the best encoding the client accepts. Preference: zstd, br, gzip, identity.
    /// Honors `q=0` exclusions; ignores other q-values (all accepted encodings are treated alike).
    pub fn negotiate(accept_encoding: Option<&str>) -> Self {
        let Some(header) = accept_encoding else {
            return Self::Identity;
        };
        let mut zstd = false;
        let mut br = false;
        let mut gzip = false;
        for part in header.split(',') {
            let mut it = part.split(';');
            let name = it.next().unwrap_or("").trim().to_ascii_lowercase();
            let refused = it.any(|p| {
                let p = p.trim();
                p.strip_prefix("q=")
                    .and_then(|q| q.trim().parse::<f32>().ok())
                    .is_some_and(|q| q <= 0.0)
            });
            if refused {
                continue;
            }
            match name.as_str() {
                "zstd" => zstd = true,
                "br" => br = true,
                "gzip" | "x-gzip" => gzip = true,
                "*" => {
                    zstd = true;
                    br = true;
                    gzip = true;
                }
                _ => {}
            }
        }
        if zstd {
            Self::Zstd
        } else if br {
            Self::Brotli
        } else if gzip {
            Self::Gzip
        } else {
            Self::Identity
        }
    }
}

/// One response body in every supported encoding.
#[derive(Debug, Clone)]
pub struct PrebuiltBody {
    pub content_type: &'static str,
    pub raw: Bytes,
    pub br: Bytes,
    pub gzip: Bytes,
    pub zstd: Bytes,
    /// Strong ETag including quotes: `"<first 16 bytes of blake3(raw), hex>"`.
    pub etag: String,
}

/// Compression levels used for prebuilt bodies. Bodies are built once and served many times, so
/// these lean towards ratio over speed.
const BROTLI_QUALITY: u32 = 9;
const BROTLI_WINDOW: u32 = 22;
const GZIP_LEVEL: u32 = 9;
const ZSTD_LEVEL: i32 = 15;

impl PrebuiltBody {
    /// Compresses `raw` in all encodings.
    pub fn build(content_type: &'static str, raw: impl Into<Bytes>) -> std::io::Result<Self> {
        let raw: Bytes = raw.into();
        let hash = blake3::hash(&raw);
        let etag = format!("\"{}\"", &hash.to_hex()[..32]);

        let mut br = Vec::with_capacity(raw.len() / 4 + 64);
        {
            let mut w =
                brotli::CompressorWriter::new(&mut br, 64 * 1024, BROTLI_QUALITY, BROTLI_WINDOW);
            w.write_all(&raw)?;
            w.flush()?;
        }
        let mut gz = flate2::write::GzEncoder::new(
            Vec::with_capacity(raw.len() / 4 + 64),
            flate2::Compression::new(GZIP_LEVEL),
        );
        gz.write_all(&raw)?;
        let gzip = gz.finish()?;
        let zstd = zstd::bulk::compress(&raw, ZSTD_LEVEL)?;

        Ok(Self {
            content_type,
            raw,
            br: br.into(),
            gzip: gzip.into(),
            zstd: zstd.into(),
            etag,
        })
    }

    /// JSON body from any serializable value.
    pub fn json<T: serde::Serialize>(value: &T) -> std::io::Result<Self> {
        let raw = serde_json::to_vec(value).map_err(std::io::Error::other)?;
        Self::build("application/json", raw)
    }

    /// Bytes for an encoding.
    pub fn bytes(&self, enc: Encoding) -> &Bytes {
        match enc {
            Encoding::Identity => &self.raw,
            Encoding::Brotli => &self.br,
            Encoding::Gzip => &self.gzip,
            Encoding::Zstd => &self.zstd,
        }
    }

    /// Negotiates against an `Accept-Encoding` header value.
    pub fn select(&self, accept_encoding: Option<&str>) -> (Encoding, &Bytes) {
        let enc = Encoding::negotiate(accept_encoding);
        (enc, self.bytes(enc))
    }

    /// True if an `If-None-Match` header value matches this body (weak comparison, `*` matches).
    pub fn matches_if_none_match(&self, header: &str) -> bool {
        header
            .split(',')
            .map(str::trim)
            .any(|t| t == "*" || t.strip_prefix("W/").unwrap_or(t) == self.etag)
    }
}

/// Hot bodies prebuilt per publish. `None` until the corresponding projection first exists.
#[derive(Debug, Clone, Default)]
pub struct PrebuiltBodies {
    /// `GET /api/v1/bootstrap` (`BootstrapDto`).
    pub bootstrap: Option<PrebuiltBody>,
    /// `GET /api/v1/nodes.bin`.
    pub nodes_bin: Option<PrebuiltBody>,
    /// `GET /api/v1/mesh.bin`.
    pub mesh_bin: Option<PrebuiltBody>,
    /// `GET /api/v1/apps` (`AppsIndexDto`).
    pub apps_index: Option<PrebuiltBody>,
}

#[cfg(test)]
mod tests {
    use std::io::Read;

    use super::*;

    #[test]
    fn negotiation() {
        assert_eq!(Encoding::negotiate(None), Encoding::Identity);
        assert_eq!(
            Encoding::negotiate(Some("gzip, deflate, br, zstd")),
            Encoding::Zstd
        );
        assert_eq!(Encoding::negotiate(Some("gzip, br")), Encoding::Brotli);
        assert_eq!(Encoding::negotiate(Some("gzip;q=0.8")), Encoding::Gzip);
        assert_eq!(
            Encoding::negotiate(Some("zstd;q=0, br;q=0 ,gzip")),
            Encoding::Gzip
        );
        assert_eq!(Encoding::negotiate(Some("identity")), Encoding::Identity);
        assert_eq!(Encoding::negotiate(Some("*")), Encoding::Zstd);
    }

    #[test]
    fn every_encoding_round_trips() {
        let raw: Vec<u8> = (0..20_000u32)
            .flat_map(|i| (i % 97).to_le_bytes())
            .collect();
        let b = PrebuiltBody::build("application/octet-stream", raw.clone()).unwrap();
        assert!(b.br.len() < raw.len() && b.gzip.len() < raw.len() && b.zstd.len() < raw.len());

        let mut out = Vec::new();
        brotli::Decompressor::new(&b.br[..], 4096)
            .read_to_end(&mut out)
            .unwrap();
        assert_eq!(out, raw);
        out.clear();
        flate2::read::GzDecoder::new(&b.gzip[..])
            .read_to_end(&mut out)
            .unwrap();
        assert_eq!(out, raw);
        assert_eq!(zstd::bulk::decompress(&b.zstd, raw.len()).unwrap(), raw);
    }

    #[test]
    fn etag_is_content_derived() {
        let a = PrebuiltBody::json(&serde_json::json!({"a": 1})).unwrap();
        let b = PrebuiltBody::json(&serde_json::json!({"a": 1})).unwrap();
        let c = PrebuiltBody::json(&serde_json::json!({"a": 2})).unwrap();
        assert_eq!(a.etag, b.etag);
        assert_ne!(a.etag, c.etag);
        assert_eq!(a.etag.len(), 34);
        assert!(a.matches_if_none_match(&a.etag));
        assert!(a.matches_if_none_match(&format!("W/{}, \"x\"", a.etag)));
        assert!(a.matches_if_none_match("*"));
        assert!(!a.matches_if_none_match(&c.etag));
    }
}
