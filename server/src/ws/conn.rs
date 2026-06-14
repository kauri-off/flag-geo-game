//! Per-connection read/write loop. Translates socket frames into room commands
//! and forwards the actor's outgoing messages to the socket, with an app-level
//! heartbeat, an idle timeout, and a per-connection message rate limit.
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;

use crate::auth::RoomClaims;
use crate::rate_limit::TokenBucket;
use crate::room::Command;
use crate::state::AppState;
use crate::ws::protocol::{ClientMsg, ServerMsg};

const SINK_CAPACITY: usize = 256;
const IDLE_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_TEXT_LEN: usize = 8 * 1024;

pub async fn handle(st: AppState, claims: RoomClaims, socket: WebSocket) {
    let Some(handle) = st.rooms.get(&claims.room).await else {
        return; // room gone between join and connect; just drop the socket
    };
    let player_id = claims.pid.clone();

    let (mut ws_tx, mut ws_rx) = socket.split();
    let (sink_tx, mut sink_rx) = mpsc::channel::<Arc<ServerMsg>>(SINK_CAPACITY);

    // Writer task: actor messages -> socket.
    let writer = tokio::spawn(async move {
        while let Some(msg) = sink_rx.recv().await {
            let json = match serde_json::to_string(&*msg) {
                Ok(j) => j,
                Err(_) => continue,
            };
            if ws_tx.send(Message::Text(json.into())).await.is_err() {
                break;
            }
        }
        let _ = ws_tx.close().await;
    });

    // Attach to the room.
    if handle
        .cmd
        .send(Command::Connect { player_id: player_id.clone(), sink: sink_tx })
        .await
        .is_err()
    {
        writer.abort();
        return;
    }

    // Reader loop: socket -> room commands, with idle timeout + rate limit.
    let mut bucket = TokenBucket::new(40.0, 20.0);
    loop {
        let next = tokio::time::timeout(IDLE_TIMEOUT, ws_rx.next()).await;
        let frame = match next {
            Err(_) => break,             // idle timeout
            Ok(None) => break,           // stream closed
            Ok(Some(Err(_))) => break,   // transport error
            Ok(Some(Ok(frame))) => frame,
        };

        match frame {
            Message::Text(text) => {
                if text.len() > MAX_TEXT_LEN || !bucket.try_take(1.0) {
                    continue; // oversized or over rate budget: silently drop
                }
                let Ok(msg) = serde_json::from_str::<ClientMsg>(&text) else {
                    continue;
                };
                if matches!(msg, ClientMsg::LeaveRoom) {
                    let _ = handle
                        .cmd
                        .send(Command::Msg { player_id: player_id.clone(), msg })
                        .await;
                    break;
                }
                if handle
                    .cmd
                    .send(Command::Msg { player_id: player_id.clone(), msg })
                    .await
                    .is_err()
                {
                    break;
                }
            }
            Message::Close(_) => break,
            Message::Ping(_) | Message::Pong(_) => {} // axum auto-handles control pings
            Message::Binary(_) => {}                  // protocol is text/JSON only
        }
    }

    let _ = handle.cmd.send(Command::Disconnect { player_id }).await;
    writer.abort();
}
