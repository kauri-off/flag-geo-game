//! Conversions between the actor's domain types (`crate::protocol`) and the
//! generated protobuf wire types (`crate::pb`). Domain -> pb is used when
//! streaming `ServerMsg` events out; pb -> domain when accepting action requests.
//! Keeping the mapping here lets `room/actor.rs` stay transport-agnostic.
use crate::db::LeaderboardRow;
use crate::pb;
use crate::protocol as dom;

// --- domain -> pb (outgoing) ----------------------------------------------

impl From<dom::DifficultyFilter> for pb::DifficultyFilter {
    fn from(d: dom::DifficultyFilter) -> Self {
        pb::DifficultyFilter { continents: d.continents, size: d.size, scope: d.scope }
    }
}

impl From<dom::RoomConfig> for pb::RoomConfig {
    fn from(c: dom::RoomConfig) -> Self {
        pb::RoomConfig {
            rounds: c.rounds,
            time_limit_sec: c.time_limit_sec,
            attempts: c.attempts,
            difficulty: Some(c.difficulty.into()),
            registered_only: c.registered_only,
        }
    }
}

impl From<dom::Player> for pb::Player {
    fn from(p: dom::Player) -> Self {
        pb::Player {
            id: p.id,
            nickname: p.nickname,
            avatar: p.avatar,
            score: p.score,
            connected: p.connected,
        }
    }
}

impl From<dom::RoomInfo> for pb::RoomInfo {
    fn from(r: dom::RoomInfo) -> Self {
        pb::RoomInfo { code: r.code, config: Some(r.config.into()), host_id: r.host_id }
    }
}

impl From<dom::Standing> for pb::Standing {
    fn from(s: dom::Standing) -> Self {
        pb::Standing { player_id: s.player_id, score: s.score, answered: s.answered }
    }
}

impl From<dom::RoundPlayerResult> for pb::RoundPlayerResult {
    fn from(r: dom::RoundPlayerResult) -> Self {
        pb::RoundPlayerResult {
            player_id: r.player_id,
            correct: r.correct,
            time_ms: r.time_ms,
            points: r.points,
            picked_id: r.picked_id,
        }
    }
}

impl From<dom::FinalStanding> for pb::FinalStanding {
    fn from(f: dom::FinalStanding) -> Self {
        pb::FinalStanding {
            player_id: f.player_id,
            nickname: f.nickname,
            avatar: f.avatar,
            score: f.score,
            correct: f.correct,
            rounds: f.rounds,
        }
    }
}

impl From<dom::RoomSummary> for pb::RoomSummary {
    fn from(s: dom::RoomSummary) -> Self {
        pb::RoomSummary {
            code: s.code,
            host: s.host,
            players: s.players,
            max_players: s.max_players,
            phase: s.phase,
            has_password: s.has_password,
        }
    }
}

impl From<LeaderboardRow> for pb::LeaderboardRow {
    fn from(r: LeaderboardRow) -> Self {
        pb::LeaderboardRow {
            nickname: r.nickname,
            avatar: r.avatar,
            score: r.score,
            correct: r.correct,
            rounds: r.rounds,
            games: r.games,
            played_at: r.played_at,
        }
    }
}

/// Map a domain `ServerMsg` onto a wire `ServerEvent` (the streamed envelope).
impl From<dom::ServerMsg> for pb::ServerEvent {
    fn from(msg: dom::ServerMsg) -> Self {
        use pb::server_event::Payload;
        let payload = match msg {
            dom::ServerMsg::Welcome { player_id, room, players, phase } => Payload::Welcome(pb::Welcome {
                player_id,
                room: Some(room.into()),
                players: players.into_iter().map(Into::into).collect(),
                phase,
            }),
            dom::ServerMsg::PlayerJoined { player } => {
                Payload::PlayerJoined(pb::PlayerJoined { player: Some(player.into()) })
            }
            dom::ServerMsg::PlayerLeft { player_id } => {
                Payload::PlayerLeft(pb::PlayerLeft { player_id })
            }
            dom::ServerMsg::Kicked => Payload::Kicked(pb::Kicked {}),
            dom::ServerMsg::ProfileUpdated { player_id, nickname, avatar } => {
                Payload::ProfileUpdated(pb::ProfileUpdated { player_id, nickname, avatar })
            }
            dom::ServerMsg::ConfigUpdated { config } => {
                Payload::ConfigUpdated(pb::ConfigUpdated { config: Some(config.into()) })
            }
            dom::ServerMsg::HostChanged { host_id } => {
                Payload::HostChanged(pb::HostChanged { host_id })
            }
            dom::ServerMsg::Countdown { seconds } => Payload::Countdown(pb::Countdown { seconds }),
            dom::ServerMsg::RoundStart { index, total, alpha2, deadline_ms } => {
                Payload::RoundStart(pb::RoundStart { index, total, alpha2, deadline_ms })
            }
            dom::ServerMsg::AnswerAck { round_index, accepted } => {
                Payload::AnswerAck(pb::AnswerAck { round_index, accepted })
            }
            dom::ServerMsg::Scoreboard { standings } => Payload::Scoreboard(pb::Scoreboard {
                standings: standings.into_iter().map(Into::into).collect(),
            }),
            dom::ServerMsg::RoundResult { index, target_id, results, intermission_ms } => {
                Payload::RoundResult(pb::RoundResult {
                    index,
                    target_id,
                    results: results.into_iter().map(Into::into).collect(),
                    intermission_ms,
                })
            }
            dom::ServerMsg::MatchResult { standings, winner_id } => {
                Payload::MatchResult(pb::MatchResult {
                    standings: standings.into_iter().map(Into::into).collect(),
                    winner_id,
                })
            }
            dom::ServerMsg::MatchAborted => Payload::MatchAborted(pb::MatchAborted {}),
            dom::ServerMsg::Chat { player_id, nickname, text } => {
                Payload::Chat(pb::Chat { player_id, nickname, text })
            }
            dom::ServerMsg::Error { code, message } => {
                Payload::Error(pb::ErrorEvent { code, message })
            }
        };
        pb::ServerEvent { payload: Some(payload) }
    }
}

// --- pb -> domain (incoming) ----------------------------------------------

impl From<pb::DifficultyFilter> for dom::DifficultyFilter {
    fn from(d: pb::DifficultyFilter) -> Self {
        dom::DifficultyFilter {
            continents: d.continents,
            size: if d.size.is_empty() { "all".to_string() } else { d.size },
            scope: d.scope,
        }
    }
}

impl From<pb::RoomConfig> for dom::RoomConfig {
    fn from(c: pb::RoomConfig) -> Self {
        dom::RoomConfig {
            rounds: c.rounds,
            time_limit_sec: c.time_limit_sec,
            attempts: c.attempts,
            difficulty: c.difficulty.map(Into::into).unwrap_or(dom::DifficultyFilter {
                continents: Vec::new(),
                size: "all".to_string(),
                scope: None,
            }),
            registered_only: c.registered_only,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use prost::Message;

    #[test]
    fn round_start_maps_to_oneof_arm() {
        let msg = dom::ServerMsg::RoundStart {
            index: 4,
            total: 10,
            alpha2: "US".into(),
            deadline_ms: 1234.5,
        };
        let event: pb::ServerEvent = msg.into();
        match event.payload {
            Some(pb::server_event::Payload::RoundStart(rs)) => {
                assert_eq!(rs.index, 4);
                assert_eq!(rs.alpha2, "US");
                assert_eq!(rs.deadline_ms, 1234.5);
            }
            other => panic!("expected RoundStart, got {other:?}"),
        }
    }

    #[test]
    fn server_event_encodes_and_decodes() {
        let event: pb::ServerEvent = dom::ServerMsg::PlayerLeft { player_id: "p1".into() }.into();
        let bytes = event.encode_to_vec();
        let back = pb::ServerEvent::decode(bytes.as_slice()).unwrap();
        assert!(matches!(
            back.payload,
            Some(pb::server_event::Payload::PlayerLeft(pb::PlayerLeft { player_id })) if player_id == "p1"
        ));
    }

    #[test]
    fn room_config_round_trips_through_proto() {
        let wire = pb::RoomConfig {
            rounds: 12,
            time_limit_sec: 20,
            attempts: 3,
            difficulty: Some(pb::DifficultyFilter {
                continents: vec!["EU".into(), "AS".into()],
                size: "small".into(),
                scope: Some("un".into()),
            }),
            registered_only: true,
        };
        let dom: dom::RoomConfig = wire.clone().into();
        let back: pb::RoomConfig = dom.into();
        assert_eq!(back.rounds, 12);
        assert_eq!(back.attempts, 3);
        assert!(back.registered_only);
        let diff = back.difficulty.unwrap();
        assert_eq!(diff.size, "small");
        assert_eq!(diff.scope.as_deref(), Some("un"));
        assert_eq!(diff.continents, vec!["EU".to_string(), "AS".to_string()]);
    }
}
