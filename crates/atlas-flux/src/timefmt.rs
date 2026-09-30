//! Minimal RFC 3339 / ISO 8601 UTC timestamp parsing (`2026-09-30T18:55:16.430Z`), enough for
//! FluxOS `broadcastedAt` / `expireAt` / `runningSince` / `receivedAt` fields.

/// Days since 1970-01-01 for a proleptic Gregorian date.
const fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Parses `YYYY-MM-DDTHH:MM:SS[.fff][Z|+HH:MM|-HH:MM]` into unix milliseconds. Returns `None` for
/// anything else or for dates before 1970.
#[allow(clippy::many_single_char_names)]
pub fn parse_iso8601_ms(s: &str) -> Option<u64> {
    let s = s.trim();
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || !(b[10] == b'T' || b[10] == b' ') {
        return None;
    }
    let num = |r: std::ops::Range<usize>| s.get(r)?.parse::<u32>().ok();
    let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, mi, se) = (num(11..13)?, num(14..16)?, num(17..19)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || se > 60 {
        return None;
    }
    let mut rest = &s[19..];
    let mut millis: u64 = 0;
    if let Some(r) = rest.strip_prefix('.') {
        let digits: String = r.chars().take_while(char::is_ascii_digit).collect();
        if digits.is_empty() {
            return None;
        }
        let ms3: String = digits.chars().chain("000".chars()).take(3).collect();
        millis = ms3.parse().ok()?;
        rest = &r[digits.len()..];
    }
    let offset_s: i64 = match rest {
        "" | "Z" | "z" => 0,
        tz if tz.len() == 6 && (tz.starts_with('+') || tz.starts_with('-')) => {
            let oh: i64 = tz.get(1..3)?.parse().ok()?;
            let om: i64 = tz.get(4..6)?.parse().ok()?;
            let sign = if tz.starts_with('-') { -1 } else { 1 };
            sign * (oh * 3600 + om * 60)
        }
        _ => return None,
    };
    let days = days_from_civil(i64::from(y), mo, d);
    let secs = days * 86_400 + i64::from(h) * 3600 + i64::from(mi) * 60 + i64::from(se) - offset_s;
    u64::try_from(secs).ok().map(|s| s * 1000 + millis)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses() {
        assert_eq!(parse_iso8601_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(
            parse_iso8601_ms("2026-09-30T18:55:16.430Z"),
            Some(1_790_794_516_430)
        );
        assert_eq!(
            parse_iso8601_ms("2026-09-30T18:55:16Z"),
            Some(1_790_794_516_000)
        );
        assert_eq!(
            parse_iso8601_ms("2026-09-30T20:55:16.430+02:00"),
            Some(1_790_794_516_430)
        );
        assert_eq!(
            parse_iso8601_ms("2000-02-29T00:00:00.5Z"),
            Some(951_782_400_500)
        );
        assert_eq!(parse_iso8601_ms("garbage"), None);
        assert_eq!(parse_iso8601_ms("2026-13-01T00:00:00Z"), None);
        assert_eq!(parse_iso8601_ms("1969-12-31T23:59:59Z"), None);
    }
}
