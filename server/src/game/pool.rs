//! Builds the eligible country pool from a difficulty filter and produces the
//! flag sequence for a match. The server owns the sequence so every client in a
//! room races the identical flags. Mirrors src/game/pool.rs.
use rand::seq::SliceRandom;
use rand::Rng;

use super::{map_ids, Country, COUNTRIES};
use crate::protocol::DifficultyFilter;

/// Area thresholds (km²) for the "by size" filter — must match
/// src/data/countries.ts SIZE_THRESHOLDS.
const SMALL_MAX: f64 = 50_000.0;
const LARGE_MIN: f64 = 1_000_000.0;

fn size_bucket(area: f64) -> &'static str {
    if area < SMALL_MAX {
        "small"
    } else if area > LARGE_MIN {
        "large"
    } else {
        "medium"
    }
}

/// Countries eligible under the filter: on the map, in an allowed continent and
/// size bucket, and within the recognition scope. Mirrors `buildPool`.
pub fn build_pool(filter: &DifficultyFilter) -> Vec<&'static Country> {
    let ids = map_ids();
    let scope_un = filter.scope.as_deref() == Some("un");
    COUNTRIES
        .iter()
        .filter(|c| {
            if !ids.contains(c.id) {
                return false;
            }
            if !filter.continents.is_empty() && !filter.continents.iter().any(|x| x == c.continent)
            {
                return false;
            }
            if filter.size != "all" && size_bucket(c.area) != filter.size {
                return false;
            }
            if scope_un && !c.un_member {
                return false;
            }
            true
        })
        .collect()
}

/// Produce `n` targets using a shuffle bag: shuffle the pool and draw without
/// replacement (refilling when exhausted) so every country appears once before
/// any repeat, and never twice in a row across a refill. Mirrors `nextFromBag`.
pub fn make_sequence<R: Rng>(pool: &[&'static Country], n: usize, rng: &mut R) -> Vec<&'static Country> {
    let mut seq: Vec<&'static Country> = Vec::with_capacity(n);
    if pool.is_empty() {
        return seq;
    }
    if pool.len() == 1 {
        return vec![pool[0]; n];
    }
    let mut bag: Vec<&'static Country> = Vec::new();
    while seq.len() < n {
        if bag.is_empty() {
            bag = pool.to_vec();
            bag.shuffle(rng);
            // Avoid an immediate repeat across the refill boundary.
            if let (Some(last), Some(&next)) = (seq.last(), bag.last()) {
                if last.id == next.id {
                    let len = bag.len();
                    bag.swap(len - 1, 0);
                }
            }
        }
        seq.push(bag.pop().unwrap());
    }
    seq
}
