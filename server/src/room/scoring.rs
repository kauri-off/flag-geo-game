//! Per-round scoring. A direct port of `roundPoints` in src/game/challenge.ts so
//! the server's authoritative score matches the number the client displays. The
//! parity is locked by tests/scoring.rs against a shared fixture.

/// Answer this fast (or faster) and you bank the full points.
pub const PERFECT_SEC: f64 = 3.0;
pub const MAX_POINTS: i32 = 1000;
/// A correct-but-slow answer never scores less than this.
pub const MIN_POINTS: i32 = 100;
/// Reference limit used to scale scoring when the run has no time limit.
const NO_LIMIT_REF_SEC: f64 = 15.0;

/// Full marks for a correct answer within PERFECT_SEC, decaying linearly to
/// MIN_POINTS at the time limit, 0 for a wrong/missed answer. The rounding
/// mirrors JS `Math.round` (half-up) so client and server never disagree.
pub fn round_points(correct: bool, time_ms: i64, time_limit_sec: u32) -> i32 {
    if !correct {
        return 0;
    }
    let seconds = time_ms as f64 / 1000.0;
    if seconds <= PERFECT_SEC {
        return MAX_POINTS;
    }
    let limit = if time_limit_sec > 0 {
        time_limit_sec as f64
    } else {
        NO_LIMIT_REF_SEC
    };
    if seconds >= limit {
        return MIN_POINTS;
    }
    let frac = (seconds - PERFECT_SEC) / (limit - PERFECT_SEC); // 0..1
    let raw = MAX_POINTS as f64 - frac * (MAX_POINTS - MIN_POINTS) as f64;
    (raw + 0.5).floor() as i32
}

#[cfg(test)]
mod tests {
    use super::round_points;

    // Parity fixture shared with the client's roundPoints (src/game/challenge.ts).
    // (correct, time_ms, time_limit_sec) -> expected points.
    const VECTORS: &[(bool, i64, u32, i32)] = &[
        (false, 0, 10, 0),
        (false, 1000, 10, 0),
        (true, 0, 10, 1000),
        (true, 3000, 10, 1000),
        (true, 10000, 10, 100),
        (true, 12000, 10, 100),
        (true, 6500, 10, 550),
        (true, 5000, 10, 743),
        (true, 9000, 0, 550), // no limit -> 15s reference
    ];

    #[test]
    fn matches_client_fixture() {
        for &(correct, t, limit, expected) in VECTORS {
            assert_eq!(round_points(correct, t, limit), expected, "case {correct} {t} {limit}");
        }
    }
}
