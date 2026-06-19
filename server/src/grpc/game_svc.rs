//! GameService: the live room/match loop.
//!
//! `PlayEvents` is the server->client stream: opening it registers a sink with
//! the room actor, and dropping it (client gone) sends `Disconnect`. The unary
//! RPCs are the client->server actions; each forwards a `Command::Msg` to the
//! actor and returns an empty `Ack`. Soft acks/errors still flow back over the
//! stream.
use std::pin::Pin;
use std::sync::Arc;

use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tokio_stream::Stream;
use tonic::{Request, Response, Status};

use crate::auth::RoomClaims;
use crate::error::AppError;
use crate::pb::game_service_server::{GameService, GameServiceServer};
use crate::pb::{
    Ack, KickPlayerRequest, LeaveRoomRequest, PlayEventsRequest, SendChatRequest, ServerEvent,
    SetProfileRequest, StartMatchRequest, SubmitAnswerRequest, TransferHostRequest,
    UpdateConfigRequest,
};
use crate::protocol::{ClientMsg, ServerMsg};
use crate::room::{next_conn_id, Command};
use crate::state::AppState;

use super::{rate_limit, room_claims};

const SINK_CAPACITY: usize = 256;

pub struct GameSvc {
    st: AppState,
}

pub fn game_server(st: AppState) -> GameServiceServer<GameSvc> {
    GameServiceServer::new(GameSvc { st })
}

/// Sends a `Disconnect` to the room actor when the event stream ends (the client
/// closed it or went away). Ignored by the actor unless it's still the player's
/// current connection, so a stale drop can't clobber a reconnect.
struct DisconnectGuard {
    cmd: mpsc::Sender<Command>,
    player_id: String,
    conn_id: u64,
}

impl Drop for DisconnectGuard {
    fn drop(&mut self) {
        let _ = self.cmd.try_send(Command::Disconnect {
            player_id: self.player_id.clone(),
            conn_id: self.conn_id,
        });
    }
}

type EventStream = Pin<Box<dyn Stream<Item = Result<ServerEvent, Status>> + Send + 'static>>;

#[tonic::async_trait]
impl GameService for GameSvc {
    type PlayEventsStream = EventStream;

    async fn play_events(
        &self,
        req: Request<PlayEventsRequest>,
    ) -> Result<Response<EventStream>, Status> {
        let claims = room_claims(&self.st, &req)?;
        let handle = self
            .st
            .rooms
            .get(&claims.room)
            .await
            .ok_or_else(|| AppError::NotFound("room not found".into()))?;

        let player_id = claims.pid.clone();
        let conn_id = next_conn_id();

        // The actor pushes `ServerMsg` into `sink_tx`; we translate and relay them
        // onto the gRPC response stream via `out_tx`.
        let (sink_tx, mut sink_rx) = mpsc::channel::<Arc<ServerMsg>>(SINK_CAPACITY);
        let (out_tx, out_rx) = mpsc::channel::<Result<ServerEvent, Status>>(SINK_CAPACITY);

        // Attach to the room (sends Welcome + any in-flight restore state).
        if handle
            .cmd
            .send(Command::Connect { player_id: player_id.clone(), conn_id, sink: sink_tx })
            .await
            .is_err()
        {
            return Err(AppError::NotFound("room is no longer available".into()).into());
        }

        let cmd = handle.cmd.clone();
        tokio::spawn(async move {
            // Dropped when this task ends (stream closed by client, or actor gone),
            // notifying the actor of the disconnect.
            let _guard = DisconnectGuard { cmd, player_id, conn_id };
            while let Some(msg) = sink_rx.recv().await {
                let event = ServerEvent::from((*msg).clone());
                if out_tx.send(Ok(event)).await.is_err() {
                    break; // client closed the stream
                }
            }
        });

        Ok(Response::new(Box::pin(ReceiverStream::new(out_rx))))
    }

    async fn set_profile(
        &self,
        req: Request<SetProfileRequest>,
    ) -> Result<Response<Ack>, Status> {
        rate_limit(&self.st, &req)?;
        let claims = room_claims(&self.st, &req)?;
        let b = req.into_inner();
        self.dispatch(claims, ClientMsg::SetProfile { nickname: b.nickname, avatar: b.avatar }).await
    }

    async fn update_config(
        &self,
        req: Request<UpdateConfigRequest>,
    ) -> Result<Response<Ack>, Status> {
        rate_limit(&self.st, &req)?;
        let claims = room_claims(&self.st, &req)?;
        let config = req.into_inner().config.unwrap_or_default().into();
        self.dispatch(claims, ClientMsg::UpdateConfig { config }).await
    }

    async fn transfer_host(
        &self,
        req: Request<TransferHostRequest>,
    ) -> Result<Response<Ack>, Status> {
        rate_limit(&self.st, &req)?;
        let claims = room_claims(&self.st, &req)?;
        let player_id = req.into_inner().player_id;
        self.dispatch(claims, ClientMsg::TransferHost { player_id }).await
    }

    async fn kick_player(
        &self,
        req: Request<KickPlayerRequest>,
    ) -> Result<Response<Ack>, Status> {
        rate_limit(&self.st, &req)?;
        let claims = room_claims(&self.st, &req)?;
        let player_id = req.into_inner().player_id;
        self.dispatch(claims, ClientMsg::KickPlayer { player_id }).await
    }

    async fn start_match(
        &self,
        req: Request<StartMatchRequest>,
    ) -> Result<Response<Ack>, Status> {
        rate_limit(&self.st, &req)?;
        let claims = room_claims(&self.st, &req)?;
        self.dispatch(claims, ClientMsg::StartMatch).await
    }

    async fn submit_answer(
        &self,
        req: Request<SubmitAnswerRequest>,
    ) -> Result<Response<Ack>, Status> {
        rate_limit(&self.st, &req)?;
        let claims = room_claims(&self.st, &req)?;
        let b = req.into_inner();
        self.dispatch(claims, ClientMsg::SubmitAnswer { round_index: b.round_index, country_id: b.country_id })
            .await
    }

    async fn send_chat(&self, req: Request<SendChatRequest>) -> Result<Response<Ack>, Status> {
        rate_limit(&self.st, &req)?;
        let claims = room_claims(&self.st, &req)?;
        let text = req.into_inner().text;
        self.dispatch(claims, ClientMsg::Chat { text }).await
    }

    async fn leave_room(
        &self,
        req: Request<LeaveRoomRequest>,
    ) -> Result<Response<Ack>, Status> {
        let claims = room_claims(&self.st, &req)?;
        self.dispatch(claims, ClientMsg::LeaveRoom).await
    }
}

impl GameSvc {
    /// Forward an action to the room actor addressed by the caller's room token.
    async fn dispatch(&self, claims: RoomClaims, msg: ClientMsg) -> Result<Response<Ack>, Status> {
        let handle = self
            .st
            .rooms
            .get(&claims.room)
            .await
            .ok_or_else(|| AppError::NotFound("room not found".into()))?;
        handle
            .cmd
            .send(Command::Msg { player_id: claims.pid, msg })
            .await
            .map_err(|_| AppError::NotFound("room is no longer available".into()))?;
        Ok(Response::new(Ack {}))
    }
}
