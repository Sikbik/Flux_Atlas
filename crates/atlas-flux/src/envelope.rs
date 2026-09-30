//! FluxOS response envelope: `{"status":"success","data":...}` or
//! `{"status":"error","data":{code?,name?,message}}`, usually with HTTP 200 either way.

use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::value::RawValue;

use crate::error::{FluxError, Result};

#[derive(Deserialize)]
struct RawEnvelope<'a> {
    #[serde(default)]
    status: Option<&'a str>,
    #[serde(borrow, default)]
    data: Option<&'a RawValue>,
}

#[derive(Deserialize, Default)]
struct ErrorData {
    #[serde(default, deserialize_with = "crate::lenient::opt_i64")]
    code: Option<i64>,
    #[serde(default, deserialize_with = "crate::lenient::opt_string")]
    name: Option<String>,
    #[serde(default, deserialize_with = "crate::lenient::opt_string")]
    message: Option<String>,
}

/// Parses a FluxOS envelope and its `data` as `T`. An `error` status becomes
/// [`FluxError::Upstream`] regardless of the HTTP status code.
pub fn parse_envelope<T: DeserializeOwned>(what: &'static str, bytes: &[u8]) -> Result<T> {
    let env: RawEnvelope<'_> =
        serde_json::from_slice(bytes).map_err(|e| FluxError::parse(what, &e))?;
    match env.status {
        Some("success") => {
            let data = env.data.map_or("null", RawValue::get);
            serde_json::from_str(data).map_err(|e| FluxError::parse(what, &e))
        }
        Some("error" | "fail") => {
            let err = env
                .data
                .and_then(|d| {
                    // `data` may be an object or a bare string message.
                    serde_json::from_str::<ErrorData>(d.get()).ok().or_else(|| {
                        serde_json::from_str::<String>(d.get())
                            .ok()
                            .map(|m| ErrorData {
                                message: Some(m),
                                ..ErrorData::default()
                            })
                    })
                })
                .unwrap_or_default();
            Err(FluxError::Upstream {
                code: err.code,
                name: err.name,
                message: err
                    .message
                    .unwrap_or_else(|| "unspecified upstream error".to_owned()),
            })
        }
        other => Err(FluxError::Parse {
            what,
            message: format!("unexpected envelope status {other:?}"),
        }),
    }
}

/// Parses a plain JSON body (Insight, stats without envelope, CoinGecko).
pub fn parse_plain<T: DeserializeOwned>(what: &'static str, bytes: &[u8]) -> Result<T> {
    serde_json::from_slice(bytes).map_err(|e| FluxError::parse(what, &e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn success_and_errors() {
        let v: u32 = parse_envelope("t", br#"{"status":"success","data":2996915}"#).unwrap();
        assert_eq!(v, 2_996_915);
        let e = parse_envelope::<u32>(
            "t",
            br#"{"status":"error","data":{"code":-5,"name":"Error","message":"Block not found"}}"#,
        )
        .unwrap_err();
        assert!(e.is_not_found());
        assert!(matches!(e, FluxError::Upstream { code: Some(-5), .. }));
        let e = parse_envelope::<u32>("t", br#"{"status":"error","data":{"message":"x"}}"#)
            .unwrap_err();
        assert!(matches!(e, FluxError::Upstream { code: None, .. }));
        let e =
            parse_envelope::<u32>("t", br#"{"status":"error","data":"plain text"}"#).unwrap_err();
        assert!(matches!(e, FluxError::Upstream { ref message, .. } if message == "plain text"));
        assert!(parse_envelope::<u32>("t", b"not json").is_err());
        assert!(parse_envelope::<u32>("t", br#"{"status":"weird"}"#).is_err());
        let n: Option<u32> = parse_envelope("t", br#"{"status":"success","data":null}"#).unwrap();
        assert_eq!(n, None);
    }

    #[test]
    fn fixture_errors() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../docs/research/fixtures/");
        for f in [
            "explorer/fluxos_daemon_error_tx_not_found.json",
            "flux/apps_messagescount_error_no_owner.json",
            "flux/flux_eventstream_404.json",
            "flux/flux_peerhistory_unauthorized.json",
            "flux/daemon_getblockhash_out_of_range.json",
        ] {
            let bytes = std::fs::read(format!("{dir}{f}")).unwrap();
            let e = parse_envelope::<serde_json::Value>("t", &bytes).unwrap_err();
            assert!(matches!(e, FluxError::Upstream { .. }), "{f}: {e}");
        }
    }
}
