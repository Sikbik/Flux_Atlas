//! Tolerant serde helpers for upstream JSON.
//!
//! Upstream quirks handled here: integers that arrive as strings (`outidx`, `activesince`,
//! `lastpaid`, v2/v3 ports), booleans as strings, `null` where arrays are expected, objects that
//! are sometimes the string `"0"` (stats placeholders), and zero placeholders that mean "unknown".
//! Every helper maps garbage to `None`/default instead of failing the whole document.

use std::fmt;
use std::marker::PhantomData;

use serde::de::{self, DeserializeOwned, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};

/// A number read from a JSON number or a numeric string.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Num {
    I(i64),
    U(u64),
    F(f64),
}

impl Num {
    fn as_f64(self) -> f64 {
        match self {
            Self::I(v) => v as f64,
            Self::U(v) => v as f64,
            Self::F(v) => v,
        }
    }

    fn as_i64(self) -> Option<i64> {
        match self {
            Self::I(v) => Some(v),
            Self::U(v) => i64::try_from(v).ok(),
            Self::F(v) if v.is_finite() && v.fract() == 0.0 && v.abs() < 9.0e18 => Some(v as i64),
            Self::F(_) => None,
        }
    }

    fn parse(s: &str) -> Option<Self> {
        let t = s.trim();
        if t.is_empty() {
            return None;
        }
        if let Ok(v) = t.parse::<i64>() {
            return Some(Self::I(v));
        }
        if let Ok(v) = t.parse::<u64>() {
            return Some(Self::U(v));
        }
        t.parse::<f64>().ok().filter(|v| v.is_finite()).map(Self::F)
    }
}

struct NumVisitor;

impl<'de> Visitor<'de> for NumVisitor {
    type Value = Option<Num>;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a number or numeric string")
    }
    fn visit_i64<E: de::Error>(self, v: i64) -> Result<Self::Value, E> {
        Ok(Some(Num::I(v)))
    }
    fn visit_u64<E: de::Error>(self, v: u64) -> Result<Self::Value, E> {
        Ok(Some(Num::U(v)))
    }
    fn visit_f64<E: de::Error>(self, v: f64) -> Result<Self::Value, E> {
        Ok(Some(Num::F(v)))
    }
    fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
        Ok(Num::parse(v))
    }
    fn visit_bool<E: de::Error>(self, v: bool) -> Result<Self::Value, E> {
        Ok(Some(Num::I(i64::from(v))))
    }
    fn visit_none<E: de::Error>(self) -> Result<Self::Value, E> {
        Ok(None)
    }
    fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
        Ok(None)
    }
    fn visit_some<D: Deserializer<'de>>(self, d: D) -> Result<Self::Value, D::Error> {
        d.deserialize_any(self)
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        while seq.next_element::<IgnoredAny>()?.is_some() {}
        Ok(None)
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
        Ok(None)
    }
}

fn num<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Num>, D::Error> {
    d.deserialize_any(NumVisitor)
}

/// `Option<i64>` from number or numeric string; anything else is `None`.
pub fn opt_i64<'de, D: Deserializer<'de>>(d: D) -> Result<Option<i64>, D::Error> {
    Ok(num(d)?.and_then(Num::as_i64))
}

/// `Option<u64>`; negative values are `None`.
pub fn opt_u64<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u64>, D::Error> {
    Ok(opt_i64(d)?.and_then(|v| u64::try_from(v).ok()))
}

/// `Option<u32>`; out-of-range values are `None`.
pub fn opt_u32<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u32>, D::Error> {
    Ok(opt_i64(d)?.and_then(|v| u32::try_from(v).ok()))
}

/// `Option<f64>` from number or numeric string.
pub fn opt_f64<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
    Ok(num(d)?.map(Num::as_f64).filter(|v| v.is_finite()))
}

/// `u64`, defaulting to 0.
pub fn u64_or_zero<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
    Ok(opt_u64(d)?.unwrap_or(0))
}

/// `u32`, defaulting to 0.
pub fn u32_or_zero<'de, D: Deserializer<'de>>(d: D) -> Result<u32, D::Error> {
    Ok(opt_u32(d)?.unwrap_or(0))
}

/// `i64`, defaulting to 0.
pub fn i64_or_zero<'de, D: Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
    Ok(opt_i64(d)?.unwrap_or(0))
}

/// `f64`, defaulting to 0.
pub fn f64_or_zero<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
    Ok(opt_f64(d)?.unwrap_or(0.0))
}

struct StrVisitor;

impl<'de> Visitor<'de> for StrVisitor {
    type Value = Option<String>;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a string")
    }
    fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
        Ok(Some(v.to_owned()))
    }
    fn visit_string<E: de::Error>(self, v: String) -> Result<Self::Value, E> {
        Ok(Some(v))
    }
    fn visit_i64<E: de::Error>(self, v: i64) -> Result<Self::Value, E> {
        Ok(Some(v.to_string()))
    }
    fn visit_u64<E: de::Error>(self, v: u64) -> Result<Self::Value, E> {
        Ok(Some(v.to_string()))
    }
    fn visit_f64<E: de::Error>(self, v: f64) -> Result<Self::Value, E> {
        Ok(Some(v.to_string()))
    }
    fn visit_bool<E: de::Error>(self, v: bool) -> Result<Self::Value, E> {
        Ok(Some(v.to_string()))
    }
    fn visit_none<E: de::Error>(self) -> Result<Self::Value, E> {
        Ok(None)
    }
    fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
        Ok(None)
    }
    fn visit_some<D: Deserializer<'de>>(self, d: D) -> Result<Self::Value, D::Error> {
        d.deserialize_any(self)
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        while seq.next_element::<IgnoredAny>()?.is_some() {}
        Ok(None)
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
        Ok(None)
    }
}

/// String from string, number or bool; `null`, arrays and objects become empty.
pub fn string<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    Ok(d.deserialize_any(StrVisitor)?.unwrap_or_default())
}

/// Non-empty trimmed string or `None`.
pub fn opt_string<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Ok(d.deserialize_any(StrVisitor)?
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty()))
}

struct BoolVisitor;

impl<'de> Visitor<'de> for BoolVisitor {
    type Value = Option<bool>;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a boolean")
    }
    fn visit_bool<E: de::Error>(self, v: bool) -> Result<Self::Value, E> {
        Ok(Some(v))
    }
    fn visit_i64<E: de::Error>(self, v: i64) -> Result<Self::Value, E> {
        Ok(Some(v != 0))
    }
    fn visit_u64<E: de::Error>(self, v: u64) -> Result<Self::Value, E> {
        Ok(Some(v != 0))
    }
    fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
        Ok(match v.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" => Some(true),
            "false" | "0" | "no" => Some(false),
            _ => None,
        })
    }
    fn visit_none<E: de::Error>(self) -> Result<Self::Value, E> {
        Ok(None)
    }
    fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
        Ok(None)
    }
    fn visit_some<D: Deserializer<'de>>(self, d: D) -> Result<Self::Value, D::Error> {
        d.deserialize_any(self)
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        while seq.next_element::<IgnoredAny>()?.is_some() {}
        Ok(None)
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
        Ok(None)
    }
}

/// `Option<bool>` from bool, 0/1, or `"true"`/`"false"`.
pub fn opt_bool<'de, D: Deserializer<'de>>(d: D) -> Result<Option<bool>, D::Error> {
    d.deserialize_any(BoolVisitor)
}

/// `bool`, defaulting to false.
pub fn bool_or_false<'de, D: Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    Ok(opt_bool(d)?.unwrap_or(false))
}

/// A value that is `T` when it parses, and `None` otherwise (for example the stats placeholder
/// string `"0"` where an object is expected). Never fails the enclosing document.
pub fn opt_lenient<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned,
{
    let v = serde_json::Value::deserialize(d)?;
    if v.is_null() {
        return Ok(None);
    }
    Ok(serde_json::from_value(v).ok())
}

/// A list where `null` or a non-array becomes empty, and elements that fail to parse are
/// skipped instead of failing the whole list.
pub fn vec_skip_bad<'de, D, T>(d: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    struct V<T>(PhantomData<T>);
    impl<'de, T: Deserialize<'de>> Visitor<'de> for V<T> {
        type Value = Vec<T>;
        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("a list")
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Vec<T>, A::Error> {
            let mut out = Vec::with_capacity(seq.size_hint().unwrap_or(0).min(4096));
            while let Some(item) = seq.next_element::<MaybeBad<T>>()? {
                if let MaybeBad::Good(v) = item {
                    out.push(v);
                }
            }
            Ok(out)
        }
        fn visit_none<E: de::Error>(self) -> Result<Vec<T>, E> {
            Ok(Vec::new())
        }
        fn visit_unit<E: de::Error>(self) -> Result<Vec<T>, E> {
            Ok(Vec::new())
        }
        fn visit_some<D: Deserializer<'de>>(self, d: D) -> Result<Vec<T>, D::Error> {
            d.deserialize_any(self)
        }
        fn visit_str<E: de::Error>(self, _: &str) -> Result<Vec<T>, E> {
            Ok(Vec::new())
        }
        fn visit_i64<E: de::Error>(self, _: i64) -> Result<Vec<T>, E> {
            Ok(Vec::new())
        }
        fn visit_u64<E: de::Error>(self, _: u64) -> Result<Vec<T>, E> {
            Ok(Vec::new())
        }
        fn visit_f64<E: de::Error>(self, _: f64) -> Result<Vec<T>, E> {
            Ok(Vec::new())
        }
        fn visit_bool<E: de::Error>(self, _: bool) -> Result<Vec<T>, E> {
            Ok(Vec::new())
        }
        fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Vec<T>, A::Error> {
            while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
            Ok(Vec::new())
        }
    }
    d.deserialize_any(V(PhantomData))
}

/// Element wrapper that swallows per-element parse errors.
enum MaybeBad<T> {
    Good(T),
    Bad,
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for MaybeBad<T> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        // Buffer the element so a failure does not poison the outer sequence.
        let content = serde_json::Value::deserialize(d)?;
        Ok(T::deserialize(content).map_or(MaybeBad::Bad, MaybeBad::Good))
    }
}

/// The length of a list without keeping its elements; `None` for `null` or a non-array.
pub fn opt_array_len<'de, D: Deserializer<'de>>(d: D) -> Result<Option<usize>, D::Error> {
    struct V;
    impl<'de> Visitor<'de> for V {
        type Value = Option<usize>;
        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("a list")
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
            let mut n = 0usize;
            while seq.next_element::<IgnoredAny>()?.is_some() {
                n += 1;
            }
            Ok(Some(n))
        }
        fn visit_none<E: de::Error>(self) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_some<D: Deserializer<'de>>(self, d: D) -> Result<Self::Value, D::Error> {
            d.deserialize_any(self)
        }
        fn visit_str<E: de::Error>(self, _: &str) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_i64<E: de::Error>(self, _: i64) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_u64<E: de::Error>(self, _: u64) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_f64<E: de::Error>(self, _: f64) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_bool<E: de::Error>(self, _: bool) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
            while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
            Ok(None)
        }
    }
    d.deserialize_any(V)
}

/// A list of strings where numbers are stringified and non-strings dropped.
pub fn string_vec<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<String>, D::Error> {
    let v: Vec<LenientString> = vec_skip_bad(d)?;
    Ok(v.into_iter().filter_map(|s| s.0).collect())
}

/// A list of numbers (numbers or numeric strings); unparsable entries dropped.
pub fn f64_vec<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<f64>, D::Error> {
    let v: Vec<LenientF64> = vec_skip_bad(d)?;
    Ok(v.into_iter().filter_map(|n| n.0).collect())
}

/// String newtype with lenient deserialization.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LenientString(pub Option<String>);

impl<'de> Deserialize<'de> for LenientString {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(Self(d.deserialize_any(StrVisitor)?))
    }
}

/// f64 newtype with lenient deserialization.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct LenientF64(pub Option<f64>);

impl<'de> Deserialize<'de> for LenientF64 {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(Self(opt_f64(d)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize, Default)]
    #[serde(default)]
    struct T {
        #[serde(deserialize_with = "opt_u32")]
        a: Option<u32>,
        #[serde(deserialize_with = "u64_or_zero")]
        b: u64,
        #[serde(deserialize_with = "opt_f64")]
        c: Option<f64>,
        #[serde(deserialize_with = "string")]
        d: String,
        #[serde(deserialize_with = "opt_bool")]
        e: Option<bool>,
        #[serde(deserialize_with = "string_vec")]
        f: Vec<String>,
        #[serde(deserialize_with = "f64_vec")]
        g: Vec<f64>,
        #[serde(deserialize_with = "opt_lenient")]
        h: Option<Inner>,
    }

    #[derive(Deserialize, Debug, PartialEq)]
    struct Inner {
        x: u8,
    }

    #[test]
    fn quirks() {
        let t: T = serde_json::from_str(
            r#"{"a":"159","b":"1790697724","c":"3.5","d":7,"e":"true","f":["x",2,null],"g":["80",443,"bad"],"h":"0"}"#,
        )
        .unwrap();
        assert_eq!(t.a, Some(159));
        assert_eq!(t.b, 1_790_697_724);
        assert_eq!(t.c, Some(3.5));
        assert_eq!(t.d, "7");
        assert_eq!(t.e, Some(true));
        assert_eq!(t.f, vec!["x".to_owned(), "2".to_owned()]);
        assert_eq!(t.g, vec![80.0, 443.0]);
        assert_eq!(t.h, None);

        let t: T =
            serde_json::from_str(r#"{"a":-1,"b":null,"c":"","d":null,"f":null,"h":{"x":3}}"#)
                .unwrap();
        assert_eq!(t.a, None);
        assert_eq!(t.b, 0);
        assert_eq!(t.c, None);
        assert_eq!(t.d, "");
        assert!(t.f.is_empty());
        assert_eq!(t.h, Some(Inner { x: 3 }));
        let t: T = serde_json::from_str(r#"{"a":1.0,"g":{"k":1}}"#).unwrap();
        assert_eq!(t.a, Some(1));
        assert!(t.g.is_empty());
    }

    #[test]
    fn skip_bad_elements() {
        #[derive(Deserialize)]
        struct L {
            #[serde(deserialize_with = "vec_skip_bad")]
            v: Vec<Inner>,
        }
        let l: L = serde_json::from_str(r#"{"v":[{"x":1},{"x":"no"},{"x":2}]}"#).unwrap();
        assert_eq!(l.v, vec![Inner { x: 1 }, Inner { x: 2 }]);
    }
}
