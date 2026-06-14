//! Shared application state handed to every handler.
use std::net::SocketAddr;
use std::sync::Arc;

use axum::http::HeaderMap;

use crate::config::Config;
use crate::db::Db;
use crate::rate_limit::KeyedLimiter;
use crate::room::RoomManager;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub rooms: Arc<RoomManager>,
    pub db: Db,
    pub rest_limiter: Arc<KeyedLimiter>,
}

/// Best-effort client IP: trust `X-Forwarded-For` (set by the reverse proxy)
/// when present, otherwise the socket peer.
pub fn client_ip(headers: &HeaderMap, addr: SocketAddr) -> String {
    if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = xff.split(',').next() {
            let ip = first.trim();
            if !ip.is_empty() {
                return ip.to_string();
            }
        }
    }
    addr.ip().to_string()
}
