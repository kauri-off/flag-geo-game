//! The wire contract between client and server. This Rust module is the single
//! source of truth: `#[derive(TS)]` exports matching TypeScript into
//! `server/bindings/`, which `npm run gen-protocol` then syncs into
//! `src/online/bindings/`, so the two sides cannot drift. JSON is camelCase;
//! enums are internally tagged on a `type` field to map 1:1 onto TypeScript
//! discriminated unions.
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Bumped on any breaking protocol change; surfaced via `/version` + `/info` so a
/// mismatched client can refuse to connect.
pub const PROTOCOL_VERSION: u32 = 4;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
#[serde(rename_all = "camelCase")]
pub struct DifficultyFilter {
    /// Allowed continents; empty = all.
    pub continents: Vec<String>,
    /// "all" | "small" | "medium" | "large".
    pub size: String,
    /// "un" | "all"; absent treated as "all".
    #[serde(default)]
    #[ts(optional = nullable)]
    pub scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
#[serde(rename_all = "camelCase")]
pub struct RoomConfig {
    pub rounds: u32,
    /// Seconds per answer; 0 = no limit (a server cap still applies).
    pub time_limit_sec: u32,
    /// Guesses allowed per round before it locks; 1 = single guess.
    pub attempts: u32,
    pub difficulty: DifficultyFilter,
    /// When true, only logged-in (registered) players may join, and kicks become
    /// a ban for the room's lifetime (guests have no stable identity to ban).
    #[serde(default)]
    pub registered_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub id: String,
    pub nickname: String,
    /// ISO alpha-2 of the flag used as the avatar.
    pub avatar: String,
    pub score: i32,
    pub connected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
#[serde(rename_all = "camelCase")]
pub struct RoomInfo {
    pub code: String,
    pub config: RoomConfig,
    pub host_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
#[serde(rename_all = "camelCase")]
pub struct Standing {
    pub player_id: String,
    pub score: i32,
    pub answered: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
#[serde(rename_all = "camelCase")]
pub struct RoundPlayerResult {
    pub player_id: String,
    pub correct: bool,
    pub time_ms: i32,
    pub points: i32,
    pub picked_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
#[serde(rename_all = "camelCase")]
pub struct FinalStanding {
    pub player_id: String,
    pub nickname: String,
    pub avatar: String,
    pub score: i32,
    pub correct: u32,
    pub rounds: u32,
}

/// One row of the public room list returned by `GET /rooms`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
#[serde(rename_all = "camelCase")]
pub struct RoomSummary {
    pub code: String,
    pub host: String,
    pub players: u32,
    pub max_players: u32,
    pub phase: String,
    pub has_password: bool,
}

/// Client -> server messages over the WebSocket.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ClientMsg {
    /// First frame after connect; binds the socket to the reserved slot.
    Hello { room_token: String },
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
    Ping,
}

/// Server -> client messages over the WebSocket.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
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
        /// Pause before the next round (or final results) begins, in ms; the
        /// client counts it down so players see the cooldown.
        intermission_ms: u32,
    },
    MatchResult { standings: Vec<FinalStanding>, winner_id: Option<String> },
    /// The match was stopped before finishing because too few players remained;
    /// clients return to the lobby. No result is recorded.
    MatchAborted,
    Chat { player_id: String, nickname: String, text: String },
    Error { code: String, message: String },
    Pong,
}

impl ServerMsg {
    pub fn error(code: &str, message: impl Into<String>) -> Self {
        ServerMsg::Error { code: code.to_string(), message: message.into() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_msg_is_tagged_camelcase() {
        let msg = ClientMsg::SubmitAnswer { round_index: 4, country_id: "840".into() };
        let v: serde_json::Value = serde_json::to_value(&msg).unwrap();
        assert_eq!(v["type"], "submitAnswer");
        assert_eq!(v["roundIndex"], 4);
        assert_eq!(v["countryId"], "840");
        // Round-trips back to the same variant.
        let back: ClientMsg = serde_json::from_value(v).unwrap();
        assert!(matches!(back, ClientMsg::SubmitAnswer { round_index: 4, .. }));
    }

    #[test]
    fn server_msg_fields_are_camelcase() {
        let msg = ServerMsg::RoundStart {
            index: 0,
            total: 10,
            alpha2: "US".into(),
            deadline_ms: 1234.0,
        };
        let v: serde_json::Value = serde_json::to_value(&msg).unwrap();
        assert_eq!(v["type"], "roundStart");
        assert_eq!(v["deadlineMs"], 1234.0);
        assert!(v.get("deadline_ms").is_none());
    }

    #[test]
    fn unit_variant_serializes_to_type_only() {
        let v = serde_json::to_value(ClientMsg::StartMatch).unwrap();
        assert_eq!(v, serde_json::json!({ "type": "startMatch" }));
    }
}
