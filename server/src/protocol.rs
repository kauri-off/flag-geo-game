//! Internal *domain* types for the room actor and game loop. These mirror the
//! protobuf messages in `../proto/flaggeo/v1/flaggeo.proto` (the wire contract),
//! but are kept as plain Rust enums/structs so the authoritative game logic in
//! `room/actor.rs` stays transport-agnostic. The gRPC layer (`crate::grpc`)
//! converts between these and the generated `crate::pb` types at the RPC
//! boundary (see `grpc::convert`).
//!
//! `ClientMsg`/`ServerMsg` are the actor's command/event vocabulary.

#[derive(Debug, Clone)]
pub struct DifficultyFilter {
    /// Allowed continents; empty = all.
    pub continents: Vec<String>,
    /// "all" | "small" | "medium" | "large".
    pub size: String,
    /// "un" | "all"; absent treated as "all".
    pub scope: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RoomConfig {
    pub rounds: u32,
    /// Seconds per answer; 0 = no limit (a server cap still applies).
    pub time_limit_sec: u32,
    /// Guesses allowed per round before it locks; 1 = single guess.
    pub attempts: u32,
    pub difficulty: DifficultyFilter,
    /// When true, only logged-in (registered) players may join, and kicks become
    /// a ban for the room's lifetime (guests have no stable identity to ban).
    pub registered_only: bool,
}

#[derive(Debug, Clone)]
pub struct Player {
    pub id: String,
    pub nickname: String,
    /// ISO alpha-2 of the flag used as the avatar.
    pub avatar: String,
    pub score: i32,
    pub connected: bool,
}

#[derive(Debug, Clone)]
pub struct RoomInfo {
    pub code: String,
    pub config: RoomConfig,
    pub host_id: String,
}

#[derive(Debug, Clone)]
pub struct Standing {
    pub player_id: String,
    pub score: i32,
    pub answered: bool,
}

#[derive(Debug, Clone)]
pub struct RoundPlayerResult {
    pub player_id: String,
    pub correct: bool,
    pub time_ms: i32,
    pub points: i32,
    pub picked_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct FinalStanding {
    pub player_id: String,
    /// Account id for a registered player; `None` for a guest. Used to attribute
    /// the result to an account on the all-time leaderboard (guests are excluded).
    pub uid: Option<i64>,
    pub nickname: String,
    pub avatar: String,
    pub score: i32,
    pub correct: u32,
    pub rounds: u32,
}

/// One row of the public room list returned by `RoomService.ListRooms`.
#[derive(Debug, Clone)]
pub struct RoomSummary {
    pub code: String,
    pub host: String,
    pub players: u32,
    pub max_players: u32,
    pub phase: String,
    pub has_password: bool,
}

/// Client -> server messages (actor command vocabulary). Each variant is now
/// carried by a unary `GameService` RPC.
#[derive(Debug, Clone)]
pub enum ClientMsg {
    SetProfile { nickname: String, avatar: String },
    /// Host only: change the room's match settings (lobby only).
    UpdateConfig { config: RoomConfig },
    /// Host only: hand the host role to another player in the room.
    TransferHost { player_id: String },
    /// Host only: remove a player from the room (a ban in registered-only rooms).
    KickPlayer { player_id: String },
    /// Host only: begin the match.
    StartMatch,
    SubmitAnswer { round_index: u32, country_id: String },
    Chat { text: String },
    LeaveRoom,
}

/// Server -> client messages (actor event vocabulary). Each variant is now a
/// `oneof` arm of the `ServerEvent` streamed by `GameService.PlayEvents`.
#[derive(Debug, Clone)]
pub enum ServerMsg {
    /// Full room snapshot, sent to a single connection on (re)join.
    Welcome {
        player_id: String,
        room: RoomInfo,
        players: Vec<Player>,
        phase: String,
    },
    PlayerJoined { player: Player },
    PlayerLeft { player_id: String },
    /// Sent to a player who was removed by the host; their client leaves the room.
    Kicked,
    ProfileUpdated { player_id: String, nickname: String, avatar: String },
    /// The room's match settings changed (host edited them in the lobby).
    ConfigUpdated { config: RoomConfig },
    HostChanged { host_id: String },
    Countdown { seconds: u32 },
    RoundStart { index: u32, total: u32, alpha2: String, deadline_ms: f64 },
    AnswerAck { round_index: u32, accepted: bool },
    Scoreboard { standings: Vec<Standing> },
    RoundResult {
        index: u32,
        target_id: String,
        results: Vec<RoundPlayerResult>,
        /// Pause before the next round (or final results) begins, in ms.
        intermission_ms: u32,
    },
    MatchResult { standings: Vec<FinalStanding>, winner_id: Option<String> },
    /// The match was stopped before finishing because too few players remained;
    /// clients return to the lobby. No result is recorded.
    MatchAborted,
    Chat { player_id: String, nickname: String, text: String },
    Error { code: String, message: String },
}

impl ServerMsg {
    pub fn error(code: &str, message: impl Into<String>) -> Self {
        ServerMsg::Error { code: code.to_string(), message: message.into() }
    }
}
