//! REST endpoints: discovery, auth, room create/list/join, leaderboard.
use std::net::SocketAddr;

use axum::extract::{ConnectInfo, Path, State};
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth;
use crate::error::{AppError, AppResult};
use crate::room::next_player_id;
use crate::state::{client_ip, AppState};
use crate::validate;
use crate::ws::protocol::{RoomConfig, PROTOCOL_VERSION};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/version", get(version))
        .route("/info", get(info))
        .route("/auth", post(auth_handler))
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/rooms", get(list_rooms).post(create_room))
        .route("/rooms/{code}/join", post(join_room))
        .route("/leaderboard", get(leaderboard))
}

async fn healthz() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

async fn version() -> Json<Value> {
    Json(json!({ "version": env!("CARGO_PKG_VERSION"), "protocol": PROTOCOL_VERSION }))
}

async fn info(State(st): State<AppState>) -> Json<Value> {
    Json(json!({
        "name": st.config.server_name,
        "authRequired": st.config.auth_required(),
        "maxPlayers": st.config.max_players_per_room,
        "protocol": PROTOCOL_VERSION,
        "registrationEnabled": true,
    }))
}

#[derive(Deserialize)]
struct AuthReq {
    password: Option<String>,
}

async fn auth_handler(
    State(st): State<AppState>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<AuthReq>,
) -> AppResult<Json<Value>> {
    rate_limit(&st, &headers, addr)?;
    if let Some(expected) = &st.config.server_password {
        let supplied = body.password.unwrap_or_default();
        if !auth::server_password_matches(expected, &supplied) {
            return Err(AppError::Unauthorized);
        }
    }
    let token = auth::issue_session_token(&st.config)?;
    Ok(Json(json!({ "token": token })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterReq {
    username: String,
    password: String,
    avatar: String,
    #[serde(default)]
    server_password: Option<String>,
}

async fn register(
    State(st): State<AppState>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<RegisterReq>,
) -> AppResult<Json<Value>> {
    rate_limit(&st, &headers, addr)?;
    if let Some(expected) = &st.config.server_password {
        let supplied = body.server_password.unwrap_or_default();
        if !auth::server_password_matches(expected, &supplied) {
            return Err(AppError::Unauthorized);
        }
    }
    let username = validate::username(&body.username)?;
    validate::password(&body.password)?;
    let avatar = validate::avatar(&body.avatar)?;
    let password_hash = auth::hash_password(&body.password)?;
    let uid = st.db.create_user(username.clone(), password_hash, avatar.clone()).await?;
    let token = auth::issue_session_token_for_user(&st.config, uid, &username)?;
    Ok(Json(json!({ "token": token, "username": username, "avatar": avatar })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginReq {
    username: String,
    password: String,
}

async fn login(
    State(st): State<AppState>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<LoginReq>,
) -> AppResult<Json<Value>> {
    rate_limit(&st, &headers, addr)?;
    let user = st
        .db
        .find_user(body.username.trim().to_string())
        .await?
        .ok_or(AppError::Unauthorized)?;
    if !auth::verify_password(&user.password_hash, &body.password) {
        return Err(AppError::Unauthorized);
    }
    let token = auth::issue_session_token_for_user(&st.config, user.id, &user.username)?;
    Ok(Json(json!({ "token": token, "username": user.username, "avatar": user.avatar })))
}

/// Resolve a seat's identity. A logged-in player always uses their account's
/// current username + avatar; a guest uses the (validated) fields they supplied.
async fn seat_identity(
    st: &AppState,
    claims: &auth::SessionClaims,
    guest_nick: &str,
    guest_avatar: &str,
) -> AppResult<(Option<i64>, String, String)> {
    if let Some(uid) = claims.uid {
        let user = st.db.get_user(uid).await?.ok_or(AppError::Unauthorized)?;
        Ok((Some(uid), user.username, user.avatar))
    } else {
        let nickname = validate::nickname(guest_nick)?;
        let avatar = validate::avatar(guest_avatar)?;
        // Guests may not impersonate a registered account by reusing its name.
        if st.db.find_user(nickname.clone()).await?.is_some() {
            return Err(AppError::Conflict("this name belongs to a registered account".into()));
        }
        Ok((None, nickname, avatar))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateReq {
    nickname: String,
    avatar: String,
    config: RoomConfig,
    #[serde(default)]
    room_password: Option<String>,
}

async fn create_room(
    State(st): State<AppState>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<CreateReq>,
) -> AppResult<Json<Value>> {
    rate_limit(&st, &headers, addr)?;
    let claims = auth::session_claims(&st.config, &headers)?;

    let config = validate::room_config(body.config)?;
    if config.registered_only && claims.uid.is_none() {
        return Err(AppError::Conflict("this room is for registered players only".into()));
    }
    let password_hash = match body.room_password.as_deref() {
        Some(pw) if !pw.is_empty() => Some(auth::hash_password(&validate::room_password(pw)?)?),
        _ => None,
    };
    let (uid, nickname, avatar) = seat_identity(&st, &claims, &body.nickname, &body.avatar).await?;

    let player_id = next_player_id();
    let code = st
        .rooms
        .create_room(
            config,
            password_hash,
            player_id.clone(),
            uid,
            nickname.clone(),
            avatar.clone(),
        )
        .await?;
    let room_token = auth::issue_room_token(&st.config, &code, &player_id, &nickname, &avatar)?;

    Ok(Json(json!({ "code": code, "roomToken": room_token, "playerId": player_id })))
}

async fn list_rooms(
    State(st): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    auth::require_session(&st.config, &headers)?;
    Ok(Json(json!({ "rooms": st.rooms.list().await })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JoinReq {
    nickname: String,
    avatar: String,
    #[serde(default)]
    room_password: Option<String>,
}

async fn join_room(
    State(st): State<AppState>,
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Path(code): Path<String>,
    Json(body): Json<JoinReq>,
) -> AppResult<Json<Value>> {
    rate_limit(&st, &headers, addr)?;
    let claims = auth::session_claims(&st.config, &headers)?;

    let code = code.to_ascii_uppercase();
    let (uid, nickname, avatar) = seat_identity(&st, &claims, &body.nickname, &body.avatar).await?;

    let handle = st.rooms.get(&code).await.ok_or_else(|| AppError::NotFound("room not found".into()))?;
    if let Some(hash) = &handle.password_hash {
        let pw = body.room_password.unwrap_or_default();
        if !auth::verify_password(hash, &pw) {
            return Err(AppError::Unauthorized);
        }
    }

    let player_id = next_player_id();
    let (tx, rx) = tokio::sync::oneshot::channel();
    handle
        .cmd
        .send(crate::room::Command::Reserve {
            player_id: player_id.clone(),
            uid,
            nickname: nickname.clone(),
            avatar: avatar.clone(),
            reply: tx,
        })
        .await
        .map_err(|_| AppError::NotFound("room is no longer available".into()))?;
    rx.await.map_err(|_| AppError::Internal("room did not respond".into()))??;

    let room_token = auth::issue_room_token(&st.config, &code, &player_id, &nickname, &avatar)?;
    Ok(Json(json!({ "roomToken": room_token, "playerId": player_id })))
}

async fn leaderboard(State(st): State<AppState>) -> AppResult<Json<Value>> {
    let top = st.db.top_leaderboard(50).await?;
    Ok(Json(json!({ "top": top })))
}

fn rate_limit(st: &AppState, headers: &HeaderMap, addr: SocketAddr) -> AppResult<()> {
    let ip = client_ip(headers, addr);
    if st.rest_limiter.check(&ip) {
        Ok(())
    } else {
        Err(AppError::RateLimited)
    }
}
