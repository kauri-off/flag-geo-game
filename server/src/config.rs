//! Runtime configuration, read from the environment (and an optional `.env`).
use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub server_name: String,
    /// If set, clients must supply this password to `/auth` before doing anything.
    pub server_password: Option<String>,
    /// HMAC secret for session/room tokens. Generated per-process if unset.
    pub jwt_secret: String,
    /// Allowed CORS origins; a single "*" disables the allowlist (dev only).
    pub cors_origins: Vec<String>,
    /// SQLite database path.
    pub db_path: String,
    pub max_rooms: usize,
    pub max_players_per_room: usize,
    pub round_intermission_ms: u64,
    /// Hard cap on a round's duration when a room sets no time limit (seconds).
    pub no_limit_round_cap_sec: u64,
    /// Session/room token lifetime (seconds).
    pub token_ttl_sec: u64,
}

fn var(key: &str) -> Option<String> {
    env::var(key).ok().filter(|v| !v.trim().is_empty())
}

fn parse<T: std::str::FromStr>(key: &str, default: T) -> T {
    var(key).and_then(|v| v.parse().ok()).unwrap_or(default)
}

impl Config {
    pub fn from_env() -> Self {
        let jwt_secret = var("JWT_SECRET").unwrap_or_else(|| {
            tracing::warn!(
                "JWT_SECRET not set — generating an ephemeral secret; tokens won't survive a restart"
            );
            uuid::Uuid::new_v4().to_string() + &uuid::Uuid::new_v4().to_string()
        });

        let cors_origins = var("CORS_ORIGINS")
            .map(|s| s.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect())
            .unwrap_or_else(|| {
                vec![
                    "http://localhost:5173".to_string(),
                    "http://localhost:4173".to_string(),
                ]
            });

        Config {
            port: parse("PORT", 8080),
            server_name: var("SERVER_NAME").unwrap_or_else(|| "Flag Geo Server".to_string()),
            server_password: var("SERVER_PASSWORD"),
            jwt_secret,
            cors_origins,
            db_path: var("DB_PATH").unwrap_or_else(|| "flag-geo.db".to_string()),
            max_rooms: parse("MAX_ROOMS", 200),
            max_players_per_room: parse("MAX_PLAYERS_PER_ROOM", 16),
            round_intermission_ms: parse("ROUND_INTERMISSION_MS", 2500),
            no_limit_round_cap_sec: parse("NO_LIMIT_ROUND_CAP_SEC", 60),
            token_ttl_sec: parse("TOKEN_TTL_SEC", 6 * 3600),
        }
    }

    pub fn auth_required(&self) -> bool {
        self.server_password.is_some()
    }
}
