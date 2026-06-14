//! Minimal token-bucket rate limiting. Two uses:
//!   - `TokenBucket`: per-connection WS message rate (no shared state).
//!   - `KeyedLimiter`: per-IP REST request rate (shared, behind a mutex).
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

/// A refilling token bucket. `try_take` returns false when the caller is over
/// budget.
#[derive(Debug)]
pub struct TokenBucket {
    capacity: f64,
    tokens: f64,
    refill_per_sec: f64,
    last: Instant,
}

impl TokenBucket {
    pub fn new(capacity: f64, refill_per_sec: f64) -> Self {
        TokenBucket { capacity, tokens: capacity, refill_per_sec, last: Instant::now() }
    }

    pub fn try_take(&mut self, cost: f64) -> bool {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last).as_secs_f64();
        self.last = now;
        self.tokens = (self.tokens + elapsed * self.refill_per_sec).min(self.capacity);
        if self.tokens >= cost {
            self.tokens -= cost;
            true
        } else {
            false
        }
    }
}

/// Per-key (e.g. per-IP) limiter. Old buckets are reaped lazily on access.
pub struct KeyedLimiter {
    capacity: f64,
    refill_per_sec: f64,
    buckets: Mutex<HashMap<String, TokenBucket>>,
}

impl KeyedLimiter {
    pub fn new(capacity: f64, refill_per_sec: f64) -> Self {
        KeyedLimiter { capacity, refill_per_sec, buckets: Mutex::new(HashMap::new()) }
    }

    pub fn check(&self, key: &str) -> bool {
        let mut map = self.buckets.lock().expect("limiter mutex poisoned");
        if map.len() > 10_000 {
            // Cheap safety valve against unbounded growth under a key flood.
            map.clear();
        }
        let bucket = map
            .entry(key.to_string())
            .or_insert_with(|| TokenBucket::new(self.capacity, self.refill_per_sec));
        bucket.try_take(1.0)
    }
}
