//! Flag Geo dedicated multiplayer server.
//!
//! REST for discovery/auth/room management, WebSocket for live room play. The
//! server is authoritative for the flag sequence, round timing, correctness and
//! scoring; clients only render and submit a chosen country.
mod auth;
mod config;
mod db;
mod error;
mod game;
mod http;
mod rate_limit;
mod room;
mod state;
mod validate;
mod ws;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::http::{header, HeaderValue, Method};
use axum::Router;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::config::Config;
use crate::db::Db;
use crate::rate_limit::KeyedLimiter;
use crate::room::RoomManager;
use crate::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    init_tracing();

    let config = Arc::new(Config::from_env());
    let db = Db::open(&config.db_path)?;
    let rooms = RoomManager::new(config.clone(), db.clone());
    rooms.clone().spawn_reaper();

    let state = AppState {
        config: config.clone(),
        rooms,
        db,
        // Generous per-IP REST budget: ~10 req/s sustained, burst of 60.
        rest_limiter: Arc::new(KeyedLimiter::new(60.0, 10.0)),
    };

    let app = Router::new()
        .merge(http::router())
        .merge(ws::router())
        .layer(build_cors(&config))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(
        "Flag Geo server listening on {addr} (auth_required={})",
        config.auth_required()
    );

    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

fn init_tracing() {
    use tracing_subscriber::{fmt, EnvFilter};
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    fmt().with_env_filter(filter).init();
}

fn build_cors(config: &Config) -> CorsLayer {
    let base = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);

    if config.cors_origins.iter().any(|o| o == "*") {
        return base.allow_origin(Any);
    }
    let origins: Vec<HeaderValue> =
        config.cors_origins.iter().filter_map(|o| o.parse().ok()).collect();
    base.allow_origin(AllowOrigin::list(origins))
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sig) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            sig.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutting down");
}
