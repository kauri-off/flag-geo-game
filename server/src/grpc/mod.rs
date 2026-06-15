//! The gRPC / Connect (gRPC-Web) service layer. Three tonic services replace the
//! old REST + WebSocket stack:
//!   - `auth_svc`: discovery, guest auth, account register/login
//!   - `room_svc`: room list/create/join, leaderboard
//!   - `game_svc`: the live room/match loop (PlayEvents server-stream + actions)
//!
//! Identity travels as an `authorization: Bearer <token>` metadata header on
//! every call (session token for auth/room, room token for game), replacing the
//! WebSocket's `Hello{roomToken}` handshake.
mod auth_svc;
mod convert;
mod game_svc;
mod room_svc;

use tonic::Request;

use crate::auth::{self, RoomClaims, SessionClaims};
use crate::error::AppError;
use crate::state::AppState;

pub use auth_svc::auth_server;
pub use game_svc::game_server;
pub use room_svc::room_server;

/// Pull the `Bearer` token out of the request's `authorization` metadata.
fn bearer<T>(req: &Request<T>) -> Option<String> {
    let raw = req.metadata().get("authorization")?.to_str().ok()?;
    raw.strip_prefix("Bearer ").map(|s| s.trim().to_string())
}

/// Verify the session token (issued by Auth/Register/Login) and return its claims.
fn session_claims<T>(st: &AppState, req: &Request<T>) -> Result<SessionClaims, AppError> {
    let token = bearer(req).ok_or(AppError::Unauthorized)?;
    auth::verify_session_token(&st.config, &token)
}

/// Verify the room token (issued by Create/Join) and return its claims.
fn room_claims<T>(st: &AppState, req: &Request<T>) -> Result<RoomClaims, AppError> {
    let token = bearer(req).ok_or(AppError::Unauthorized)?;
    auth::verify_room_token(&st.config, &token)
}

/// Best-effort client IP: trust `x-forwarded-for` (set by the reverse proxy) when
/// present, otherwise the socket peer.
fn client_ip<T>(req: &Request<T>) -> String {
    if let Some(xff) = req.metadata().get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = xff.split(',').next() {
            let ip = first.trim();
            if !ip.is_empty() {
                return ip.to_string();
            }
        }
    }
    req.remote_addr().map(|a| a.ip().to_string()).unwrap_or_default()
}

/// Per-IP REST-style rate limit for the unary mutating RPCs.
fn rate_limit<T>(st: &AppState, req: &Request<T>) -> Result<(), AppError> {
    if st.rest_limiter.check(&client_ip(req)) {
        Ok(())
    } else {
        Err(AppError::RateLimited)
    }
}
