//! `YYYY-MM` month names (UTC) for the monthly DB-IP files.

/// The UTC month of `unix_ms` as `YYYY-MM`.
pub fn month_of(unix_ms: u64) -> String {
    let days = (unix_ms / 86_400_000) as i64;
    let (y, m) = civil_from_days(days);
    format!("{y:04}-{m:02}")
}

/// The month before `month` (`YYYY-MM`). Returns `None` for a malformed name.
pub fn previous_month(month: &str) -> Option<String> {
    let (y, m) = month.split_once('-')?;
    let (y, m): (i32, u32) = (y.parse().ok()?, m.parse().ok()?);
    if !(1..=12).contains(&m) {
        return None;
    }
    Some(if m == 1 {
        format!("{:04}-12", y - 1)
    } else {
        format!("{y:04}-{:02}", m - 1)
    })
}

/// Year and month of a day count since 1970-01-01 (proleptic Gregorian calendar).
fn civil_from_days(z: i64) -> (i64, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn months() {
        assert_eq!(month_of(0), "1970-01");
        // 2026-09-30T23:59:59Z and 2026-10-01T00:00:00Z.
        assert_eq!(month_of(1_790_812_799_000), "2026-09");
        assert_eq!(month_of(1_790_812_800_000), "2026-10");
        // 2024-02-29 (leap day).
        assert_eq!(month_of(1_709_164_800_000), "2024-02");
        assert_eq!(previous_month("2026-10").as_deref(), Some("2026-09"));
        assert_eq!(previous_month("2026-01").as_deref(), Some("2025-12"));
        assert_eq!(previous_month("2026-13"), None);
        assert_eq!(previous_month("x"), None);
    }
}
