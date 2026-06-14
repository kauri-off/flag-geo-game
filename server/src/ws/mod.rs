//! WebSocket entry point. The room token (issued by `/rooms/.../join`) is passed
//! as a query parameter and verified before the upgrade; the live connection is
//! then driven by `conn`.
pub mod protocol;
mod conn;

use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use serde::Deserialize;

use crate::auth;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/ws", get(ws_upgrade))
}

#[derive(Deserialize)]
struct WsQuery {
    token: String,
}

async fn ws_upgrade(
    State(st): State<AppState>,
    Query(q): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    match auth::verify_room_token(&st.config, &q.token) {
        Ok(claims) => ws
            .max_message_size(16 * 1024)
            .on_upgrade(move |socket| conn::handle(st, claims, socket)),
        Err(_) => (StatusCode::UNAUTHORIZED, "invalid room token").into_response(),
    }
}
