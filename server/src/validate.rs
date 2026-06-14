//! Input validation for user-supplied strings. All checks run server-side; the
//! client UI mirrors them but is never trusted.
use crate::error::AppError;
use crate::game;

pub const NICK_MAX: usize = 20;
pub const CHAT_MAX: usize = 300;
pub const ROOM_PW_MAX: usize = 64;

/// A tiny, deliberately conservative block list. Not a real moderation system —
/// just enough to keep the most obvious slurs out of public room lists.
const BLOCKED: &[&str] = &["nigger", "faggot", "retard"];

fn has_blocked(s: &str) -> bool {
    let norm: String = s.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect();
    BLOCKED.iter().any(|b| norm.contains(b))
}

/// Trim, length-check and reject control characters / blocked words. Returns the
/// cleaned nickname.
pub fn nickname(raw: &str) -> Result<String, AppError> {
    let n = raw.trim().to_string();
    let len = n.chars().count();
    if len == 0 || len > NICK_MAX {
        return Err(AppError::BadRequest(format!("nickname must be 1–{NICK_MAX} characters")));
    }
    if n.chars().any(|c| c.is_control()) {
        return Err(AppError::BadRequest("nickname contains invalid characters".into()));
    }
    if has_blocked(&n) {
        return Err(AppError::BadRequest("nickname is not allowed".into()));
    }
    Ok(n)
}

/// Normalise to upper-case alpha-2 and confirm it's a real country flag.
pub fn avatar(raw: &str) -> Result<String, AppError> {
    let a = raw.trim().to_ascii_uppercase();
    if !game::is_valid_avatar(&a) {
        return Err(AppError::BadRequest("invalid avatar".into()));
    }
    Ok(a)
}

pub fn chat(raw: &str) -> Result<String, AppError> {
    let t = raw.trim();
    if t.is_empty() || t.chars().count() > CHAT_MAX {
        return Err(AppError::BadRequest("invalid chat message".into()));
    }
    Ok(t.chars().filter(|c| !c.is_control()).collect())
}

pub fn room_password(raw: &str) -> Result<String, AppError> {
    if raw.is_empty() || raw.len() > ROOM_PW_MAX {
        return Err(AppError::BadRequest("invalid room password".into()));
    }
    Ok(raw.to_string())
}

/// Clamp a room config to safe bounds. Returns a sanitised copy.
pub fn room_config(
    mut cfg: crate::ws::protocol::RoomConfig,
) -> Result<crate::ws::protocol::RoomConfig, AppError> {
    cfg.rounds = cfg.rounds.clamp(1, 100);
    cfg.time_limit_sec = cfg.time_limit_sec.min(60);
    cfg.attempts = cfg.attempts.clamp(1, 5);
    match cfg.difficulty.size.as_str() {
        "all" | "small" | "medium" | "large" => {}
        _ => return Err(AppError::BadRequest("invalid size filter".into())),
    }
    if let Some(scope) = &cfg.difficulty.scope {
        if scope != "un" && scope != "all" {
            return Err(AppError::BadRequest("invalid scope filter".into()));
        }
    }
    Ok(cfg)
}
