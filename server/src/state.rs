//! Shared application state handed to every gRPC service.
use std::sync::Arc;

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
