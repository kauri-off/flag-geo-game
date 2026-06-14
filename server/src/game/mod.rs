//! Server-authoritative game data and selection logic. The country table and
//! flag-twin groups are generated from the client's data (`npm run
//! gen-server-data`) so the server's pool and correctness checks match the
//! client exactly.
pub mod countries;
pub mod flag_twins;
pub mod pool;

use std::collections::HashSet;
use std::sync::OnceLock;

pub use countries::{Country, COUNTRIES, MAP_IDS};

/// Lookup: numeric id -> the group of ids sharing an indistinguishable flag.
fn twin_index() -> &'static std::collections::HashMap<&'static str, &'static [&'static str]> {
    static INDEX: OnceLock<std::collections::HashMap<&'static str, &'static [&'static str]>> =
        OnceLock::new();
    INDEX.get_or_init(|| {
        let mut m = std::collections::HashMap::new();
        for group in flag_twins::TWIN_GROUPS {
            for id in *group {
                m.insert(*id, *group);
            }
        }
        m
    })
}

/// True when two countries share an indistinguishable flag (or are the same).
/// Mirrors `sameFlag` in src/game/flagTwins.ts.
pub fn same_flag(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    matches!(twin_index().get(a), Some(group) if group.contains(&b))
}

/// Numeric ids that are present and guessable on the map, as a fast set.
pub fn map_ids() -> &'static HashSet<&'static str> {
    static SET: OnceLock<HashSet<&'static str>> = OnceLock::new();
    SET.get_or_init(|| MAP_IDS.iter().copied().collect())
}

/// True when `id` is a valid avatar (a known country alpha-2, case-insensitive).
pub fn is_valid_avatar(alpha2: &str) -> bool {
    static SET: OnceLock<HashSet<String>> = OnceLock::new();
    SET.get_or_init(|| COUNTRIES.iter().map(|c| c.alpha2.to_ascii_uppercase()).collect())
        .contains(&alpha2.to_ascii_uppercase())
}
