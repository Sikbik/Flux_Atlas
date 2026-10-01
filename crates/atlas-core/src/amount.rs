//! Monetary amounts in base units (1e-8 FLUX).

use std::fmt;
use std::iter::Sum;
use std::ops::{Add, AddAssign, Neg, Sub, SubAssign};
use std::str::FromStr;

use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use ts_rs::TS;

/// Base units per FLUX.
pub const COIN: i64 = 100_000_000;

/// An amount in base units (1e-8 FLUX, "sat"/"zat").
///
/// JSON form is a FLUX decimal string with exactly 8 fractional digits (for example
/// `"1234.56789012"`), because JS numbers lose precision on supply-sized values. Deserializing
/// JSON also accepts a plain FLUX number, which is what upstream APIs send. Binary formats
/// (postcard) store the raw `i64`.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, TS)]
#[ts(as = "String")]
pub struct Amount(pub i64);

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AmountError {
    #[error("empty amount")]
    Empty,
    #[error("invalid amount syntax: {0}")]
    Syntax(String),
    #[error("more than 8 fractional digits: {0}")]
    TooPrecise(String),
    #[error("amount out of range")]
    Overflow,
}

impl Amount {
    pub const ZERO: Self = Self(0);

    pub const fn from_sat(sat: i64) -> Self {
        Self(sat)
    }

    /// Whole FLUX (no rounding).
    pub const fn from_flux(flux: i64) -> Self {
        Self(flux * COIN)
    }

    pub const fn sat(self) -> i64 {
        self.0
    }

    /// Converts an upstream floating-point FLUX value, rounding to the nearest base unit.
    /// Returns `None` for non-finite or out-of-range inputs.
    pub fn from_flux_f64(v: f64) -> Option<Self> {
        if !v.is_finite() {
            return None;
        }
        let sat = (v * COIN as f64).round();
        if sat.abs() > 9.0e18 {
            return None;
        }
        Some(Self(sat as i64))
    }

    /// Lossy conversion for analytics (`*_flux_f64` fields).
    pub fn to_flux_f64(self) -> f64 {
        self.0 as f64 / COIN as f64
    }

    pub fn checked_add(self, rhs: Self) -> Option<Self> {
        self.0.checked_add(rhs.0).map(Self)
    }

    pub fn checked_sub(self, rhs: Self) -> Option<Self> {
        self.0.checked_sub(rhs.0).map(Self)
    }

    pub fn saturating_add(self, rhs: Self) -> Self {
        Self(self.0.saturating_add(rhs.0))
    }

    pub const fn is_zero(self) -> bool {
        self.0 == 0
    }

    pub const fn is_negative(self) -> bool {
        self.0 < 0
    }

    pub const fn abs(self) -> Self {
        Self(self.0.abs())
    }
}

impl fmt::Display for Amount {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let neg = self.0 < 0;
        let v = self.0.unsigned_abs();
        let whole = v / COIN as u64;
        let frac = v % COIN as u64;
        if neg {
            f.write_str("-")?;
        }
        write!(f, "{whole}.{frac:08}")
    }
}

impl fmt::Debug for Amount {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Amount({self})")
    }
}

impl FromStr for Amount {
    type Err = AmountError;

    /// Parses a decimal FLUX string such as `"12500.00"` or `"-0.5"`. Scientific notation is
    /// rejected here; use [`Amount::from_flux_f64`] for upstream float values.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let s = s.trim();
        if s.is_empty() {
            return Err(AmountError::Empty);
        }
        let (neg, body) = match s.as_bytes()[0] {
            b'-' => (true, &s[1..]),
            b'+' => (false, &s[1..]),
            _ => (false, s),
        };
        let (whole, frac) = body.split_once('.').unwrap_or((body, ""));
        if whole.is_empty() && frac.is_empty() {
            return Err(AmountError::Syntax(s.to_owned()));
        }
        if !whole.bytes().all(|b| b.is_ascii_digit()) || !frac.bytes().all(|b| b.is_ascii_digit()) {
            return Err(AmountError::Syntax(s.to_owned()));
        }
        if frac.len() > 8 {
            // Accept trailing zeros beyond 8 digits, reject real extra precision.
            if frac[8..].bytes().any(|b| b != b'0') {
                return Err(AmountError::TooPrecise(s.to_owned()));
            }
        }
        let whole_v: i64 = if whole.is_empty() {
            0
        } else {
            whole.parse().map_err(|_| AmountError::Overflow)?
        };
        let mut frac_v: i64 = 0;
        for (i, b) in frac.bytes().take(8).enumerate() {
            frac_v += i64::from(b - b'0') * 10_i64.pow(7 - i as u32);
        }
        let sat = whole_v
            .checked_mul(COIN)
            .and_then(|w| w.checked_add(frac_v))
            .ok_or(AmountError::Overflow)?;
        Ok(Self(if neg { -sat } else { sat }))
    }
}

impl Serialize for Amount {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        if serializer.is_human_readable() {
            serializer.collect_str(self)
        } else {
            serializer.serialize_i64(self.0)
        }
    }
}

impl<'de> Deserialize<'de> for Amount {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct V;
        impl Visitor<'_> for V {
            type Value = Amount;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a FLUX decimal string or number")
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<Amount, E> {
                v.parse::<Amount>().or_else(|_| {
                    v.trim()
                        .parse::<f64>()
                        .ok()
                        .and_then(Amount::from_flux_f64)
                        .ok_or_else(|| E::custom(format!("invalid amount {v:?}")))
                })
            }
            fn visit_f64<E: de::Error>(self, v: f64) -> Result<Amount, E> {
                Amount::from_flux_f64(v).ok_or_else(|| E::custom("amount out of range"))
            }
            fn visit_i64<E: de::Error>(self, v: i64) -> Result<Amount, E> {
                v.checked_mul(COIN)
                    .map(Amount)
                    .ok_or_else(|| E::custom("amount out of range"))
            }
            fn visit_u64<E: de::Error>(self, v: u64) -> Result<Amount, E> {
                i64::try_from(v)
                    .ok()
                    .and_then(|v| v.checked_mul(COIN))
                    .map(Amount)
                    .ok_or_else(|| E::custom("amount out of range"))
            }
        }
        if deserializer.is_human_readable() {
            deserializer.deserialize_any(V)
        } else {
            i64::deserialize(deserializer).map(Amount)
        }
    }
}

// Arithmetic saturates (L6): amounts are sums of upstream values, and a forged or corrupt
// value must not wrap around into a plausible (or negative) total in release builds. Real
// totals (the whole supply is under 1e18 base units) never come near the bounds.

impl Add for Amount {
    type Output = Self;
    fn add(self, rhs: Self) -> Self {
        Self(self.0.saturating_add(rhs.0))
    }
}

impl AddAssign for Amount {
    fn add_assign(&mut self, rhs: Self) {
        self.0 = self.0.saturating_add(rhs.0);
    }
}

impl Sub for Amount {
    type Output = Self;
    fn sub(self, rhs: Self) -> Self {
        Self(self.0.saturating_sub(rhs.0))
    }
}

impl SubAssign for Amount {
    fn sub_assign(&mut self, rhs: Self) {
        self.0 = self.0.saturating_sub(rhs.0);
    }
}

impl Neg for Amount {
    type Output = Self;
    fn neg(self) -> Self {
        Self(self.0.saturating_neg())
    }
}

impl Sum for Amount {
    fn sum<I: Iterator<Item = Self>>(iter: I) -> Self {
        iter.fold(Self::ZERO, Add::add)
    }
}

impl<'a> Sum<&'a Amount> for Amount {
    fn sum<I: Iterator<Item = &'a Self>>(iter: I) -> Self {
        iter.fold(Self::ZERO, |a, b| a + *b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arithmetic_saturates() {
        let max = Amount(i64::MAX);
        assert_eq!(max + Amount(1), max);
        assert_eq!([max, max, Amount(5)].iter().sum::<Amount>(), max);
        assert_eq!(Amount(i64::MIN) - Amount(1), Amount(i64::MIN));
        assert_eq!(-Amount(i64::MIN), Amount(i64::MAX));
        let mut a = max;
        a += Amount(7);
        assert_eq!(a, max);
    }

    #[test]
    fn display() {
        assert_eq!(Amount(0).to_string(), "0.00000000");
        assert_eq!(Amount(50_000_000).to_string(), "0.50000000");
        assert_eq!(Amount(123_456_789_012).to_string(), "1234.56789012");
        assert_eq!(Amount(-30).to_string(), "-0.00000030");
        assert_eq!(Amount::from_flux(14).to_string(), "14.00000000");
    }

    #[test]
    fn parse() {
        assert_eq!(
            "12500.00".parse::<Amount>().unwrap(),
            Amount::from_flux(12_500)
        );
        assert_eq!("0.5".parse::<Amount>().unwrap(), Amount(50_000_000));
        assert_eq!(".5".parse::<Amount>().unwrap(), Amount(50_000_000));
        assert_eq!(
            "-1.00000001".parse::<Amount>().unwrap(),
            Amount(-100_000_001)
        );
        assert_eq!(
            "430655620.5".parse::<Amount>().unwrap(),
            Amount(43_065_562_050_000_000)
        );
        assert_eq!("1.000000000".parse::<Amount>().unwrap(), Amount(COIN));
        assert!("1.000000001".parse::<Amount>().is_err());
        assert!("".parse::<Amount>().is_err());
        assert!("1e5".parse::<Amount>().is_err());
        assert!("abc".parse::<Amount>().is_err());
        assert!(".".parse::<Amount>().is_err());
    }

    #[test]
    fn roundtrip_many() {
        for sat in [0, 1, 7, 99_999_999, 100_000_000, 4_303_557_127_480_000, -5] {
            let a = Amount(sat);
            assert_eq!(a.to_string().parse::<Amount>().unwrap(), a);
        }
    }

    #[test]
    fn from_f64_rounds() {
        assert_eq!(
            Amount::from_flux_f64(0.500_000_3).unwrap(),
            Amount(50_000_030)
        );
        assert_eq!(
            Amount::from_flux_f64(58.710_867_26).unwrap(),
            Amount(5_871_086_726)
        );
        assert_eq!(Amount::from_flux_f64(3e-7).unwrap(), Amount(30));
        assert!(Amount::from_flux_f64(f64::NAN).is_none());
    }

    #[test]
    fn serde_json_and_postcard() {
        let a = Amount(123_456_789_012);
        assert_eq!(serde_json::to_string(&a).unwrap(), "\"1234.56789012\"");
        assert_eq!(
            serde_json::from_str::<Amount>("\"1234.56789012\"").unwrap(),
            a
        );
        assert_eq!(serde_json::from_str::<Amount>("1234.56789012").unwrap(), a);
        assert_eq!(
            serde_json::from_str::<Amount>("14").unwrap(),
            Amount::from_flux(14)
        );
        assert_eq!(
            serde_json::from_str::<Amount>("\"3e-7\"").unwrap(),
            Amount(30)
        );
        let bin = postcard::to_allocvec(&a).unwrap();
        assert_eq!(postcard::from_bytes::<Amount>(&bin).unwrap(), a);
    }

    #[test]
    fn arithmetic() {
        let v = [Amount(1), Amount(2), Amount(3)];
        assert_eq!(v.iter().sum::<Amount>(), Amount(6));
        assert_eq!(Amount(5) - Amount(7), Amount(-2));
        assert_eq!(Amount(i64::MAX).checked_add(Amount(1)), None);
    }
}
