//! Tokens and password verification.
//!
//! Two token kinds, both HS256 JWTs signed with `JWT_SECRET`:
//!   - **session**: issued by `/auth`; required for every REST/WS action.
//!   - **room**: issued by `/rooms/{code}/join`; binds a connection to a
//!     reserved player slot in a specific room (also used for reconnect).
use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

use crate::config::Config;
use crate::error::AppError;

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionClaims {
    pub scope: String, // "session"
    pub exp: usize,
    /// Account id for a logged-in session; null for anonymous guests.
    #[serde(default)]
    pub uid: Option<i64>,
    /// Account username for a logged-in session; null for guests.
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RoomClaims {
    pub scope: String, // "room"
    pub room: String,
    pub pid: String,
    pub nick: String,
    pub avatar: String,
    pub exp: usize,
}

fn now() -> usize {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as usize).unwrap_or(0)
}

fn enc_key(cfg: &Config) -> EncodingKey {
    EncodingKey::from_secret(cfg.jwt_secret.as_bytes())
}
fn dec_key(cfg: &Config) -> DecodingKey {
    DecodingKey::from_secret(cfg.jwt_secret.as_bytes())
}

pub fn issue_session_token(cfg: &Config) -> Result<String, AppError> {
    let claims = SessionClaims {
        scope: "session".into(),
        exp: now() + cfg.token_ttl_sec as usize,
        uid: None,
        name: None,
    };
    encode(&Header::default(), &claims, &enc_key(cfg)).map_err(|e| AppError::Internal(e.to_string()))
}

/// A session token bound to a logged-in account.
pub fn issue_session_token_for_user(cfg: &Config, uid: i64, name: &str) -> Result<String, AppError> {
    let claims = SessionClaims {
        scope: "session".into(),
        exp: now() + cfg.token_ttl_sec as usize,
        uid: Some(uid),
        name: Some(name.to_string()),
    };
    encode(&Header::default(), &claims, &enc_key(cfg)).map_err(|e| AppError::Internal(e.to_string()))
}

pub fn verify_session_token(cfg: &Config, token: &str) -> Result<SessionClaims, AppError> {
    let data = decode::<SessionClaims>(token, &dec_key(cfg), &Validation::default())
        .map_err(|_| AppError::Unauthorized)?;
    if data.claims.scope != "session" {
        return Err(AppError::Unauthorized);
    }
    Ok(data.claims)
}

pub fn issue_room_token(
    cfg: &Config,
    room: &str,
    pid: &str,
    nick: &str,
    avatar: &str,
) -> Result<String, AppError> {
    let claims = RoomClaims {
        scope: "room".into(),
        room: room.to_string(),
        pid: pid.to_string(),
        nick: nick.to_string(),
        avatar: avatar.to_string(),
        exp: now() + cfg.token_ttl_sec as usize,
    };
    encode(&Header::default(), &claims, &enc_key(cfg)).map_err(|e| AppError::Internal(e.to_string()))
}

pub fn verify_room_token(cfg: &Config, token: &str) -> Result<RoomClaims, AppError> {
    let data = decode::<RoomClaims>(token, &dec_key(cfg), &Validation::default())
        .map_err(|_| AppError::Unauthorized)?;
    if data.claims.scope != "room" {
        return Err(AppError::Unauthorized);
    }
    Ok(data.claims)
}

/// Verify the Bearer session token from an `Authorization` header.
pub fn require_session(cfg: &Config, headers: &axum::http::HeaderMap) -> Result<(), AppError> {
    session_claims(cfg, headers).map(|_| ())
}

/// Verify the Bearer session token and return its claims (incl. `uid`/`name`).
pub fn session_claims(
    cfg: &Config,
    headers: &axum::http::HeaderMap,
) -> Result<SessionClaims, AppError> {
    let token = bearer(headers).ok_or(AppError::Unauthorized)?;
    verify_session_token(cfg, &token)
}

pub fn bearer(headers: &axum::http::HeaderMap) -> Option<String> {
    let h = headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
    h.strip_prefix("Bearer ").map(|s| s.trim().to_string())
}

/// Constant-time comparison for the (plaintext) server password.
pub fn server_password_matches(expected: &str, supplied: &str) -> bool {
    let a = expected.as_bytes();
    let b = supplied.as_bytes();
    let mut diff = (a.len() ^ b.len()) as u8;
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        diff |= x ^ y;
    }
    diff == 0
}

/// Hash a room password (argon2 PHC string) for storage.
pub fn hash_password(pw: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(pw.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::Internal(e.to_string()))
}

/// Verify a room password against a stored argon2 hash (constant-time inside).
pub fn verify_password(hash: &str, pw: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default().verify_password(pw.as_bytes(), &parsed).is_ok(),
        Err(_) => false,
    }
}
