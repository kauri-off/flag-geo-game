//! Room registry and the per-room actor.
//!
//! Each room is owned by a single spawned task (`actor::Room`). Connections and
//! REST handlers talk to it only through an `mpsc` command channel, so all room
//! state is mutated on one thread with no locks on the hot path. A small
//! `Snapshot` behind an `RwLock` is kept in sync for the REST room list and join
//! checks without bothering the actor.
mod actor;
pub mod scoring;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Weak};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rand::Rng;
use tokio::sync::{mpsc, oneshot, RwLock};

use crate::config::Config;
use crate::db::Db;
use crate::error::AppError;
use crate::ws::protocol::{ClientMsg, RoomConfig, RoomSummary, ServerMsg};

/// Per-connection message sink owned by the actor.
pub type Sink = mpsc::Sender<Arc<ServerMsg>>;

/// Commands sent to a room actor.
pub enum Command {
    /// Reserve a slot (REST join). Replies Ok or a human-readable reason.
    Reserve {
        player_id: String,
        nickname: String,
        avatar: String,
        reply: oneshot::Sender<Result<(), AppError>>,
    },
    /// A websocket attached (or reattached) to a reserved player.
    Connect { player_id: String, sink: Sink },
    /// A websocket message from a player.
    Msg { player_id: String, msg: ClientMsg },
    /// A websocket closed.
    Disconnect { player_id: String },
}

#[derive(Clone, Default)]
pub struct Snapshot {
    pub host_id: String,
    pub phase: String,
    pub player_count: usize,
    pub connected_count: usize,
    pub max_players: usize,
    pub joinable: bool,
    pub last_activity_ms: i64,
}

#[derive(Clone)]
pub struct RoomHandle {
    pub code: String,
    /// The room's match config (kept for future REST detail endpoints).
    #[allow(dead_code)]
    pub config: RoomConfig,
    pub password_hash: Option<String>,
    pub cmd: mpsc::Sender<Command>,
    pub snapshot: Arc<RwLock<Snapshot>>,
}

impl RoomHandle {
    pub fn has_password(&self) -> bool {
        self.password_hash.is_some()
    }
}

pub struct RoomManager {
    rooms: RwLock<HashMap<String, RoomHandle>>,
    config: Arc<Config>,
    db: Db,
    weak_self: Weak<RoomManager>,
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

fn gen_code() -> String {
    let mut rng = rand::thread_rng();
    (0..6).map(|_| CODE_ALPHABET[rng.gen_range(0..CODE_ALPHABET.len())] as char).collect()
}

impl RoomManager {
    pub fn new(config: Arc<Config>, db: Db) -> Arc<Self> {
        Arc::new_cyclic(|weak| RoomManager {
            rooms: RwLock::new(HashMap::new()),
            config,
            db,
            weak_self: weak.clone(),
        })
    }

    /// Create a room with the creator already seated as host. Returns the code.
    pub async fn create_room(
        &self,
        config: RoomConfig,
        password_hash: Option<String>,
        host_id: String,
        host_nick: String,
        host_avatar: String,
    ) -> Result<String, AppError> {
        {
            let rooms = self.rooms.read().await;
            if rooms.len() >= self.config.max_rooms {
                return Err(AppError::Conflict("server is at room capacity".into()));
            }
        }

        // Find a free code (collisions are vanishingly rare; bounded retry anyway).
        let mut code = gen_code();
        {
            let rooms = self.rooms.read().await;
            let mut tries = 0;
            while rooms.contains_key(&code) && tries < 10 {
                code = gen_code();
                tries += 1;
            }
            if rooms.contains_key(&code) {
                return Err(AppError::Internal("could not allocate room code".into()));
            }
        }

        let (cmd_tx, cmd_rx) = mpsc::channel::<Command>(256);
        let snapshot = Arc::new(RwLock::new(Snapshot {
            host_id: host_id.clone(),
            phase: "lobby".into(),
            player_count: 1,
            connected_count: 0,
            max_players: self.config.max_players_per_room,
            joinable: true,
            last_activity_ms: now_ms(),
        }));

        let handle = RoomHandle {
            code: code.clone(),
            config: config.clone(),
            password_hash: password_hash.clone(),
            cmd: cmd_tx,
            snapshot: snapshot.clone(),
        };

        let room = actor::Room::new(
            code.clone(),
            config,
            password_hash,
            self.config.clone(),
            self.db.clone(),
            self.weak_self.clone(),
            snapshot,
            host_id,
            host_nick,
            host_avatar,
        );
        tokio::spawn(room.run(cmd_rx));

        self.rooms.write().await.insert(code.clone(), handle);
        Ok(code)
    }

    pub async fn get(&self, code: &str) -> Option<RoomHandle> {
        self.rooms.read().await.get(code).cloned()
    }

    pub async fn remove(&self, code: &str) {
        self.rooms.write().await.remove(code);
    }

    /// Public, joinable rooms for the lobby list.
    pub async fn list(&self) -> Vec<RoomSummary> {
        let rooms = self.rooms.read().await;
        let mut out = Vec::new();
        for h in rooms.values() {
            let snap = h.snapshot.read().await;
            if !snap.joinable {
                continue;
            }
            out.push(RoomSummary {
                code: h.code.clone(),
                host: snap.host_id.clone(),
                players: snap.player_count as u32,
                max_players: snap.max_players as u32,
                phase: snap.phase.clone(),
                has_password: h.has_password(),
            });
        }
        out.sort_by(|a, b| a.code.cmp(&b.code));
        out
    }

    /// Periodically drop rooms that have been empty/abandoned for a while.
    pub fn spawn_reaper(self: Arc<Self>) {
        tokio::spawn(async move {
            let idle_grace = Duration::from_secs(120);
            loop {
                tokio::time::sleep(Duration::from_secs(30)).await;
                let now = now_ms();
                let mut stale = Vec::new();
                {
                    let rooms = self.rooms.read().await;
                    for (code, h) in rooms.iter() {
                        let snap = h.snapshot.read().await;
                        let idle = (now - snap.last_activity_ms) as u128 > idle_grace.as_millis();
                        if snap.connected_count == 0 && idle {
                            stale.push(code.clone());
                        }
                    }
                }
                for code in stale {
                    self.rooms.write().await.remove(&code);
                    tracing::info!(room = %code, "reaped idle room");
                }
            }
        });
    }
}

// A small process-wide counter purely for observability/log correlation.
static PLAYER_SEQ: AtomicU64 = AtomicU64::new(1);
pub fn next_player_id() -> String {
    let n = PLAYER_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("p{}-{}", n, uuid::Uuid::new_v4().simple())
}
