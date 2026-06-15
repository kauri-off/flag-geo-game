//! Flag Geo dedicated multiplayer server.
//!
//! A single Connect / gRPC-Web endpoint (tonic + tonic-web over HTTP/1.1) serves
//! three services: AuthService (discovery/auth/accounts), RoomService (room
//! list/create/join + leaderboard) and GameService (the live room/match loop —
//! a server-streaming `PlayEvents` plus unary action RPCs). The server is
//! authoritative for the flag sequence, round timing, correctness and scoring;
//! clients only render and submit a chosen country.
mod auth;
mod config;
mod db;
mod error;
mod game;
mod grpc;
mod pb;
mod protocol;
mod rate_limit;
mod room;
mod state;
mod validate;

use std::net::SocketAddr;
use std::sync::Arc;

use http::header::{HeaderName, AUTHORIZATION, CONTENT_TYPE};
use http::{HeaderValue, Method};
use tonic::transport::Server;
use tonic_web::GrpcWebLayer;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};

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
        // Generous per-IP budget for unary calls: ~10 req/s sustained, burst of 60.
        rest_limiter: Arc::new(KeyedLimiter::new(60.0, 10.0)),
    };

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    tracing::info!(
        "Flag Geo server listening on {addr} (auth_required={})",
        config.auth_required()
    );

    Server::builder()
        .accept_http1(true)
        .layer(build_cors(&config))
        .layer(GrpcWebLayer::new())
        .add_service(grpc::auth_server(state.clone()))
        .add_service(grpc::room_server(state.clone()))
        .add_service(grpc::game_server(state.clone()))
        .serve_with_shutdown(addr, shutdown_signal())
        .await?;
    Ok(())
}

fn init_tracing() {
    use tracing_subscriber::{fmt, EnvFilter};
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    fmt().with_env_filter(filter).init();
}

/// CORS for browser gRPC-Web: allow the Connect/gRPC-Web request + preflight
/// headers and expose the gRPC trailers the client reads for status.
fn build_cors(config: &Config) -> CorsLayer {
    let base = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            CONTENT_TYPE,
            AUTHORIZATION,
            HeaderName::from_static("x-grpc-web"),
            HeaderName::from_static("x-user-agent"),
            HeaderName::from_static("grpc-timeout"),
            HeaderName::from_static("connect-protocol-version"),
            HeaderName::from_static("connect-timeout-ms"),
        ])
        .expose_headers([
            HeaderName::from_static("grpc-status"),
            HeaderName::from_static("grpc-message"),
            HeaderName::from_static("grpc-status-details-bin"),
        ]);

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
