//! RoomService: room list/create/join and the leaderboard. The session token
//! rides in `authorization` metadata.
use std::pin::Pin;
use std::time::Duration;

use tokio::sync::broadcast::error::RecvError;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tokio_stream::Stream;
use tonic::{Request, Response, Status};

use crate::auth::{self, SessionClaims};
use crate::error::AppError;
use crate::pb::room_service_server::{RoomService, RoomServiceServer};
use crate::pb::{
    CreateRoomRequest, CreateRoomResponse, GetLeaderboardRequest, GetLeaderboardResponse,
    JoinRoomRequest, JoinRoomResponse, ListRoomsRequest, ListRoomsResponse, LobbyEvent,
    RoomSummary, WatchLobbyRequest,
};
use crate::room::{next_player_id, Command};
use crate::state::AppState;
use crate::validate;

use super::{rate_limit, session_claims};

/// Coalesce a burst of change pings: wait a beat, then swallow any further ticks
/// queued meanwhile so one recompute covers the whole burst.
const LOBBY_DEBOUNCE: Duration = Duration::from_millis(250);

type LobbyStream = Pin<Box<dyn Stream<Item = Result<LobbyEvent, Status>> + Send + 'static>>;

/// The public room list as wire `RoomSummary`s (comparable for change dedupe).
async fn current_rooms(st: &AppState) -> Vec<RoomSummary> {
    st.rooms.list().await.into_iter().map(Into::into).collect()
}

fn rooms_event(rooms: Vec<RoomSummary>) -> LobbyEvent {
    use crate::pb::lobby_event::Payload;
    LobbyEvent { payload: Some(Payload::Rooms(ListRoomsResponse { rooms })) }
}

fn leaderboard_event(top: Vec<crate::pb::LeaderboardRow>) -> LobbyEvent {
    use crate::pb::lobby_event::Payload;
    LobbyEvent { payload: Some(Payload::Leaderboard(GetLeaderboardResponse { top })) }
}

pub struct RoomSvc {
    st: AppState,
}

pub fn room_server(st: AppState) -> RoomServiceServer<RoomSvc> {
    RoomServiceServer::new(RoomSvc { st })
}

/// Resolve a seat's identity. A logged-in player always uses their account's
/// current username + avatar; a guest uses the (validated) fields they supplied.
async fn seat_identity(
    st: &AppState,
    claims: &SessionClaims,
    guest_nick: &str,
    guest_avatar: &str,
) -> Result<(Option<i64>, String, String), AppError> {
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

#[tonic::async_trait]
impl RoomService for RoomSvc {
    type WatchLobbyStream = LobbyStream;

    async fn list_rooms(
        &self,
        req: Request<ListRoomsRequest>,
    ) -> Result<Response<ListRoomsResponse>, Status> {
        session_claims(&self.st, &req)?; // any valid session
        let rooms = self.st.rooms.list().await.into_iter().map(Into::into).collect();
        Ok(Response::new(ListRoomsResponse { rooms }))
    }

    async fn create_room(
        &self,
        req: Request<CreateRoomRequest>,
    ) -> Result<Response<CreateRoomResponse>, Status> {
        rate_limit(&self.st, &req)?;
        let claims = session_claims(&self.st, &req)?;
        let body = req.into_inner();

        let config = validate::room_config(body.config.unwrap_or_default().into()).map_err(Status::from)?;
        if config.registered_only && claims.uid.is_none() {
            return Err(AppError::Conflict("this room is for registered players only".into()).into());
        }
        let password_hash = match body.room_password.as_deref() {
            Some(pw) if !pw.is_empty() => {
                Some(auth::hash_password(&validate::room_password(pw).map_err(Status::from)?).map_err(Status::from)?)
            }
            _ => None,
        };
        let (uid, nickname, avatar) =
            seat_identity(&self.st, &claims, &body.nickname, &body.avatar).await.map_err(Status::from)?;

        let player_id = next_player_id();
        let code = self
            .st
            .rooms
            .create_room(config, password_hash, player_id.clone(), uid, nickname.clone(), avatar.clone())
            .await
            .map_err(Status::from)?;
        let room_token = auth::issue_room_token(&self.st.config, &code, &player_id, &nickname, &avatar)
            .map_err(Status::from)?;

        Ok(Response::new(CreateRoomResponse { code, room_token, player_id }))
    }

    async fn join_room(
        &self,
        req: Request<JoinRoomRequest>,
    ) -> Result<Response<JoinRoomResponse>, Status> {
        rate_limit(&self.st, &req)?;
        let claims = session_claims(&self.st, &req)?;
        let body = req.into_inner();

        let code = body.code.to_ascii_uppercase();
        let (uid, nickname, avatar) =
            seat_identity(&self.st, &claims, &body.nickname, &body.avatar).await.map_err(Status::from)?;

        let handle =
            self.st.rooms.get(&code).await.ok_or_else(|| AppError::NotFound("room not found".into()))?;
        if let Some(hash) = &handle.password_hash {
            let pw = body.room_password.unwrap_or_default();
            if !auth::verify_password(hash, &pw) {
                return Err(AppError::Unauthorized.into());
            }
        }

        let player_id = next_player_id();
        let (tx, rx) = tokio::sync::oneshot::channel();
        handle
            .cmd
            .send(Command::Reserve {
                player_id: player_id.clone(),
                uid,
                nickname: nickname.clone(),
                avatar: avatar.clone(),
                reply: tx,
            })
            .await
            .map_err(|_| AppError::NotFound("room is no longer available".into()))?;
        rx.await.map_err(|_| AppError::Internal("room did not respond".into())).map_err(Status::from)??;

        let room_token = auth::issue_room_token(&self.st.config, &code, &player_id, &nickname, &avatar)
            .map_err(Status::from)?;
        Ok(Response::new(JoinRoomResponse { room_token, player_id }))
    }

    async fn get_leaderboard(
        &self,
        _req: Request<GetLeaderboardRequest>,
    ) -> Result<Response<GetLeaderboardResponse>, Status> {
        let top = self.st.db.top_leaderboard(50).await.map_err(Status::from)?;
        Ok(Response::new(GetLeaderboardResponse {
            top: top.into_iter().map(Into::into).collect(),
        }))
    }

    /// Browse-view push stream: an initial rooms + leaderboard snapshot, then a
    /// fresh feed whenever either changes. Replaces the client's ListRooms poll.
    async fn watch_lobby(
        &self,
        req: Request<WatchLobbyRequest>,
    ) -> Result<Response<LobbyStream>, Status> {
        session_claims(&self.st, &req)?; // any valid session

        let st = self.st.clone();
        // Subscribe *before* the initial snapshot so a change landing between the
        // two can't be missed (it just produces a redundant ping we dedupe away).
        let mut lobby_rx = st.rooms.subscribe_lobby();
        let mut leaderboard_rx = st.rooms.subscribe_leaderboard();

        let (out_tx, out_rx) = mpsc::channel::<Result<LobbyEvent, Status>>(16);

        tokio::spawn(async move {
            // Initial snapshot of both feeds.
            let mut last_rooms = current_rooms(&st).await;
            if out_tx.send(Ok(rooms_event(last_rooms.clone()))).await.is_err() {
                return;
            }
            let mut last_top: Vec<crate::pb::LeaderboardRow> = match st.db.top_leaderboard(50).await {
                Ok(rows) => rows.into_iter().map(Into::into).collect(),
                Err(e) => {
                    tracing::warn!("watch_lobby initial leaderboard failed: {e}");
                    Vec::new()
                }
            };
            if out_tx.send(Ok(leaderboard_event(last_top.clone()))).await.is_err() {
                return;
            }

            loop {
                tokio::select! {
                    r = lobby_rx.recv() => match r {
                        Ok(()) | Err(RecvError::Lagged(_)) => {
                            tokio::time::sleep(LOBBY_DEBOUNCE).await;
                            while lobby_rx.try_recv().is_ok() {} // drain the burst
                            let rooms = current_rooms(&st).await;
                            if rooms != last_rooms {
                                last_rooms = rooms.clone();
                                if out_tx.send(Ok(rooms_event(rooms))).await.is_err() {
                                    break;
                                }
                            }
                        }
                        Err(RecvError::Closed) => break,
                    },
                    r = leaderboard_rx.recv() => match r {
                        Ok(()) | Err(RecvError::Lagged(_)) => {
                            while leaderboard_rx.try_recv().is_ok() {}
                            match st.db.top_leaderboard(50).await {
                                Ok(rows) => {
                                    let top: Vec<crate::pb::LeaderboardRow> =
                                        rows.into_iter().map(Into::into).collect();
                                    if top != last_top {
                                        last_top = top.clone();
                                        if out_tx.send(Ok(leaderboard_event(top))).await.is_err() {
                                            break;
                                        }
                                    }
                                }
                                Err(e) => tracing::warn!("watch_lobby leaderboard refresh failed: {e}"),
                            }
                        }
                        Err(RecvError::Closed) => break,
                    },
                }
            }
        });

        Ok(Response::new(Box::pin(ReceiverStream::new(out_rx))))
    }
}
