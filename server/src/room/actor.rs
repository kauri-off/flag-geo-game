//! The per-room actor: lobby management plus the server-authoritative race loop.
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tokio::sync::{mpsc, RwLock};
use tokio::time::sleep;

use super::{Command, RoomManager, Sink, Snapshot};
use crate::config::Config;
use crate::db::Db;
use crate::game::{self, Country};
use crate::room::scoring::round_points;
use crate::validate;
use crate::protocol::{
    ClientMsg, FinalStanding, Player, RoomConfig, RoomInfo, RoundPlayerResult, ServerMsg, Standing,
};

#[derive(Clone, Copy, PartialEq)]
enum Phase {
    Lobby,
    Countdown,
    InRound,
    Intermission,
    Finished,
}

impl Phase {
    fn as_str(self) -> &'static str {
        match self {
            Phase::Lobby => "lobby",
            Phase::Countdown => "countdown",
            Phase::InRound => "inRound",
            Phase::Intermission => "intermission",
            Phase::Finished => "finished",
        }
    }
    fn is_running(self) -> bool {
        matches!(self, Phase::Countdown | Phase::InRound | Phase::Intermission)
    }
}

struct Slot {
    id: String,
    /// Account id for a logged-in player; `None` for a guest.
    uid: Option<i64>,
    nickname: String,
    avatar: String,
    score: i32,
    correct: u32,
    connected: bool,
    /// Id of the socket that currently owns this slot; `0` while unconnected. Used
    /// to ignore a `Disconnect` from a stale connection that a reconnect replaced.
    conn_id: u64,
    sink: Option<Sink>,
    /// This round's finalised answer (None until they submit).
    answer: Option<RoundPlayerResult>,
}

impl Slot {
    fn view(&self) -> Player {
        Player {
            id: self.id.clone(),
            nickname: self.nickname.clone(),
            avatar: self.avatar.clone(),
            score: self.score,
            connected: self.connected,
        }
    }
}

pub struct Room {
    code: String,
    config: RoomConfig,
    /// Held only so the actor owns its room's secret; join verification uses the
    /// copy on RoomHandle.
    #[allow(dead_code)]
    password_hash: Option<String>,
    cfg: Arc<Config>,
    db: Db,
    mgr: Weak<RoomManager>,
    snapshot: Arc<RwLock<Snapshot>>,
    /// A clone of this room's command channel, so the actor can schedule a
    /// delayed self-message (the post-disconnect grace cleanup).
    self_cmd: mpsc::Sender<Command>,

    players: Vec<Slot>,
    host_id: String,
    /// Account ids the host has kicked; rejected on rejoin for the room's life
    /// (only populated for registered-only rooms, where everyone has a `uid`).
    kicked_uids: std::collections::HashSet<i64>,
    phase: Phase,
    sequence: Vec<&'static Country>,
    round_index: usize,
    round_started: Instant,
    round_deadline_ms: i64,

    /// Absolute deadlines (epoch ms) for the current countdown / intermission,
    /// so a reconnecting socket can be told the correct remaining time.
    countdown_deadline_ms: i64,
    intermission_deadline_ms: i64,
    /// The last round's result and the final standings, retained so a socket that
    /// reconnects during the intermission / after the match can be shown them.
    last_round_result: Option<(u32, String, Vec<RoundPlayerResult>)>,
    last_match_result: Option<(Vec<FinalStanding>, Option<String>)>,

    /// Set by handlers to (re)arm the loop timer after the current step.
    pending_arm: Option<Duration>,
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

impl Room {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        code: String,
        config: RoomConfig,
        password_hash: Option<String>,
        cfg: Arc<Config>,
        db: Db,
        mgr: Weak<RoomManager>,
        snapshot: Arc<RwLock<Snapshot>>,
        self_cmd: mpsc::Sender<Command>,
        host_id: String,
        host_uid: Option<i64>,
        host_nick: String,
        host_avatar: String,
    ) -> Self {
        let host = Slot {
            id: host_id.clone(),
            uid: host_uid,
            nickname: host_nick,
            avatar: host_avatar,
            score: 0,
            correct: 0,
            connected: false,
            conn_id: 0,
            sink: None,
            answer: None,
        };
        Room {
            code,
            config,
            password_hash,
            cfg,
            db,
            mgr,
            snapshot,
            self_cmd,
            players: vec![host],
            host_id,
            kicked_uids: std::collections::HashSet::new(),
            phase: Phase::Lobby,
            sequence: Vec::new(),
            round_index: 0,
            round_started: Instant::now(),
            round_deadline_ms: 0,
            countdown_deadline_ms: 0,
            intermission_deadline_ms: 0,
            last_round_result: None,
            last_match_result: None,
            pending_arm: None,
        }
    }

    pub async fn run(mut self, mut cmd_rx: mpsc::Receiver<Command>) {
        let timer = sleep(Duration::from_secs(3600));
        tokio::pin!(timer);
        let mut armed = false;

        loop {
            tokio::select! {
                maybe = cmd_rx.recv() => {
                    match maybe {
                        Some(cmd) => self.handle(cmd).await,
                        None => break,
                    }
                }
                _ = &mut timer, if armed => {
                    armed = false;
                    self.on_deadline().await;
                }
            }

            if let Some(d) = self.pending_arm.take() {
                timer.as_mut().reset(tokio::time::Instant::now() + d);
                armed = true;
            }

            self.sync_snapshot().await;

            if self.players.is_empty() {
                break;
            }
        }

        if let Some(mgr) = self.mgr.upgrade() {
            mgr.remove(&self.code).await;
        }
    }

    // ---- command handling -------------------------------------------------

    async fn handle(&mut self, cmd: Command) {
        match cmd {
            Command::Reserve { player_id, uid, nickname, avatar, reply } => {
                let res = self.reserve(player_id, uid, nickname, avatar);
                let _ = reply.send(res);
            }
            Command::Connect { player_id, conn_id, sink } => self.connect(player_id, conn_id, sink),
            Command::Disconnect { player_id, conn_id } => self.disconnect(&player_id, conn_id),
            Command::DropStale { player_id, conn_id } => self.drop_stale(&player_id, conn_id),
            Command::Msg { player_id, msg } => self.on_msg(player_id, msg).await,
        }
    }

    fn reserve(
        &mut self,
        id: String,
        uid: Option<i64>,
        nickname: String,
        avatar: String,
    ) -> Result<(), crate::error::AppError> {
        use crate::error::AppError;
        if self.config.registered_only && uid.is_none() {
            return Err(AppError::Conflict("this room is for registered players only".into()));
        }
        if let Some(u) = uid {
            if self.kicked_uids.contains(&u) {
                return Err(AppError::Conflict("you were removed from this room".into()));
            }
        }
        if self.players.len() >= self.cfg.max_players_per_room {
            return Err(AppError::Conflict("room is full".into()));
        }
        if self.phase.is_running() {
            return Err(AppError::Conflict("match already in progress".into()));
        }
        if self.players.iter().any(|p| p.nickname.eq_ignore_ascii_case(&nickname)) {
            return Err(AppError::Conflict("nickname already taken in this room".into()));
        }
        self.players.push(Slot {
            id,
            uid,
            nickname,
            avatar,
            score: 0,
            correct: 0,
            connected: false,
            conn_id: 0,
            sink: None,
            answer: None,
        });
        Ok(())
    }

    fn connect(&mut self, id: String, conn_id: u64, sink: Sink) {
        let Some(idx) = self.players.iter().position(|p| p.id == id) else {
            let _ = sink.try_send(Arc::new(ServerMsg::error("BAD_TOKEN", "unknown player slot")));
            return;
        };
        self.players[idx].connected = true;
        self.players[idx].conn_id = conn_id;
        self.players[idx].sink = Some(sink.clone());

        // Welcome the (re)connecting socket with the full room state.
        let welcome = ServerMsg::Welcome {
            player_id: id.clone(),
            room: self.room_info(),
            players: self.players.iter().map(Slot::view).collect(),
            phase: self.phase.as_str().to_string(),
        };
        let _ = sink.try_send(Arc::new(welcome));

        // A socket that reconnects mid-match needs the in-flight round/result state
        // that `Welcome` (phase string only) doesn't carry.
        self.send_restore_state(&sink);

        // Tell everyone else (upsert by id on the client).
        let view = self.players[idx].view();
        self.broadcast_except(&id, ServerMsg::PlayerJoined { player: view });
    }

    /// Replay the current match state to a single (re)connecting socket, reusing the
    /// same messages a live client already handles. No-op in the lobby (`Welcome`
    /// already covers it).
    fn send_restore_state(&self, sink: &Sink) {
        let send = |msg: ServerMsg| {
            let _ = sink.try_send(Arc::new(msg));
        };
        match self.phase {
            Phase::Countdown => {
                let remaining = (self.countdown_deadline_ms - now_ms()).max(0);
                send(ServerMsg::Countdown { seconds: (remaining as f64 / 1000.0).ceil() as u32 });
            }
            Phase::InRound => {
                if let Some(target) = self.sequence.get(self.round_index).copied() {
                    send(ServerMsg::RoundStart {
                        index: self.round_index as u32,
                        total: self.config.rounds,
                        alpha2: target.alpha2.to_string(),
                        deadline_ms: self.round_deadline_ms as f64,
                    });
                    send(self.scoreboard_msg());
                }
            }
            Phase::Intermission => {
                if let Some((index, target_id, results)) = &self.last_round_result {
                    let remaining = (self.intermission_deadline_ms - now_ms()).max(0);
                    send(ServerMsg::RoundResult {
                        index: *index,
                        target_id: target_id.clone(),
                        results: results.clone(),
                        intermission_ms: remaining as u32,
                    });
                    send(self.scoreboard_msg());
                }
            }
            Phase::Finished => {
                if let Some((standings, winner_id)) = &self.last_match_result {
                    send(ServerMsg::MatchResult {
                        standings: standings.clone(),
                        winner_id: winner_id.clone(),
                    });
                }
            }
            Phase::Lobby => {}
        }
    }

    /// A socket closed. Ignored unless it's the player's *current* connection, so a
    /// stale close that races a reconnect can't drop the freshly attached socket.
    ///
    /// A close is treated as a *temporary* disconnect in every phase: the slot is
    /// kept (marked offline) so the player can reconnect with their room token and
    /// pick up where they left off. A delayed `DropStale` removes the slot only if
    /// they never come back within the grace window.
    fn disconnect(&mut self, id: &str, conn_id: u64) {
        let Some(idx) = self.players.iter().position(|p| p.id == id) else {
            return; // already gone (e.g. an explicit leave removed the slot)
        };
        if self.players[idx].conn_id != conn_id {
            return; // superseded by a newer connection; this close is stale
        }
        self.players[idx].connected = false;
        self.players[idx].sink = None;
        let view = self.players[idx].view();
        self.broadcast(ServerMsg::PlayerJoined { player: view });
        // The round may have been waiting only on the player who just dropped.
        self.maybe_end_round();

        // Schedule cleanup: if this exact connection is still offline after the
        // grace window (no reconnect bumped its conn_id), drop the slot.
        let tx = self.self_cmd.clone();
        let player_id = id.to_string();
        let grace = Duration::from_secs(self.cfg.disconnect_grace_sec);
        tokio::spawn(async move {
            sleep(grace).await;
            let _ = tx.send(Command::DropStale { player_id, conn_id }).await;
        });
    }

    /// The grace timer for a `disconnect` fired. Drop the slot only if it's still
    /// the same offline connection (a reconnect would have set `connected` and a
    /// fresh `conn_id`); then settle host/match like any other departure.
    fn drop_stale(&mut self, id: &str, conn_id: u64) {
        let Some(slot) = self.players.iter().find(|p| p.id == id) else {
            return; // already removed (explicit leave / kick)
        };
        if slot.connected || slot.conn_id != conn_id {
            return; // reconnected (or replaced) within the grace window
        }
        self.players.retain(|p| p.id != id);
        self.broadcast(ServerMsg::PlayerLeft { player_id: id.to_string() });
        self.reassign_host_if_needed();
        if self.abort_if_too_few() {
            return;
        }
        self.maybe_end_round();
    }

    /// An explicit `LeaveRoom`: a deliberate departure, so the slot is removed in
    /// every phase (unlike a transient `disconnect`, which keeps it for reconnect).
    fn leave(&mut self, id: &str) {
        if !self.players.iter().any(|p| p.id == id) {
            return;
        }
        self.players.retain(|p| p.id != id);
        self.broadcast(ServerMsg::PlayerLeft { player_id: id.to_string() });
        self.reassign_host_if_needed();
        // A 1-on-1 match can't continue once someone leaves; otherwise settle the
        // round if the leaver was the last player it was waiting on.
        if self.abort_if_too_few() {
            return;
        }
        self.maybe_end_round();
    }

    /// Abort a running match when fewer than two players remain — a multiplayer
    /// match is meaningless solo. Counts slots (not connected sockets): a briefly
    /// offline player keeps their slot for reconnect and is only removed once their
    /// grace window expires, so a transient drop never aborts. Returns true if it
    /// aborted.
    fn abort_if_too_few(&mut self) -> bool {
        if self.phase.is_running() && self.players.len() < 2 {
            self.abort_match();
            true
        } else {
            false
        }
    }

    fn abort_match(&mut self) {
        self.phase = Phase::Lobby;
        self.sequence.clear();
        self.round_index = 0;
        self.pending_arm = None; // a still-armed deadline timer no-ops in Lobby
        for p in &mut self.players {
            p.score = 0;
            p.correct = 0;
            p.answer = None;
        }
        self.broadcast(ServerMsg::MatchAborted);
        self.broadcast_scoreboard();
    }

    /// End the current round early once every connected player has answered. Safe to
    /// call from any path that removes a player or records an answer.
    fn maybe_end_round(&mut self) {
        if self.phase == Phase::InRound
            && !self.players.is_empty()
            && !self.players.iter().any(|p| p.connected && p.answer.is_none())
        {
            self.end_round();
        }
    }

    async fn on_msg(&mut self, id: String, msg: ClientMsg) {
        match msg {
            ClientMsg::LeaveRoom => self.leave(&id),
            ClientMsg::SetProfile { nickname, avatar } => self.set_profile(&id, nickname, avatar),
            ClientMsg::UpdateConfig { config } => self.update_config(&id, config),
            ClientMsg::TransferHost { player_id } => self.transfer_host(&id, &player_id),
            ClientMsg::KickPlayer { player_id } => self.kick_player(&id, &player_id),
            ClientMsg::Chat { text } => self.on_chat(&id, text),
            ClientMsg::StartMatch => self.start_match(&id),
            ClientMsg::SubmitAnswer { round_index, country_id } => {
                self.submit_answer(&id, round_index, &country_id)
            }
        }
    }

    fn set_profile(&mut self, id: &str, nickname: String, avatar: String) {
        if self.phase.is_running() {
            self.send_to(id, ServerMsg::error("BAD_STATE", "can't change profile mid-match"));
            return;
        }
        let nick = match validate::nickname(&nickname) {
            Ok(n) => n,
            Err(e) => return self.send_to(id, ServerMsg::error("INVALID_NICK", e.to_string())),
        };
        let av = match validate::avatar(&avatar) {
            Ok(a) => a,
            Err(e) => return self.send_to(id, ServerMsg::error("INVALID_AVATAR", e.to_string())),
        };
        if self.players.iter().any(|p| p.id != id && p.nickname.eq_ignore_ascii_case(&nick)) {
            return self.send_to(id, ServerMsg::error("NAME_TAKEN", "nickname already taken"));
        }
        if let Some(p) = self.players.iter_mut().find(|p| p.id == id) {
            p.nickname = nick.clone();
            p.avatar = av.clone();
        }
        self.broadcast(ServerMsg::ProfileUpdated { player_id: id.to_string(), nickname: nick, avatar: av });
    }

    fn update_config(&mut self, id: &str, config: RoomConfig) {
        if id != self.host_id {
            return self.send_to(id, ServerMsg::error("NOT_HOST", "only the host can change settings"));
        }
        if self.phase.is_running() {
            return self.send_to(id, ServerMsg::error("BAD_STATE", "can't change settings mid-match"));
        }
        let config = match validate::room_config(config) {
            Ok(c) => c,
            Err(e) => return self.send_to(id, ServerMsg::error("INVALID_CONFIG", e.to_string())),
        };
        self.config = config.clone();
        self.broadcast(ServerMsg::ConfigUpdated { config });
    }

    fn transfer_host(&mut self, id: &str, target: &str) {
        if id != self.host_id {
            return self.send_to(id, ServerMsg::error("NOT_HOST", "only the host can transfer ownership"));
        }
        if target == self.host_id {
            return;
        }
        if !self.players.iter().any(|p| p.id == target) {
            return self.send_to(id, ServerMsg::error("NO_PLAYER", "that player is not in the room"));
        }
        self.host_id = target.to_string();
        let host_id = self.host_id.clone();
        self.broadcast(ServerMsg::HostChanged { host_id });
    }

    fn kick_player(&mut self, id: &str, target: &str) {
        if id != self.host_id {
            return self.send_to(id, ServerMsg::error("NOT_HOST", "only the host can kick"));
        }
        if target == id {
            return; // the host can't kick themselves
        }
        let Some(slot) = self.players.iter().find(|p| p.id == target) else {
            return self.send_to(id, ServerMsg::error("NO_PLAYER", "that player is not in the room"));
        };
        // In registered-only rooms, remember the account so they can't rejoin.
        if self.config.registered_only {
            if let Some(u) = slot.uid {
                self.kicked_uids.insert(u);
            }
        }
        // Tell the kicked socket first (while its sink still exists), then drop the
        // slot: that releases the only remaining sink sender, so the writer task
        // flushes this message and closes the socket.
        self.send_to(target, ServerMsg::Kicked);
        self.players.retain(|p| p.id != target);
        self.broadcast(ServerMsg::PlayerLeft { player_id: target.to_string() });
        self.reassign_host_if_needed();

        // Abort if too few players are left; otherwise settle the round if it was
        // only waiting on the kicked player.
        if self.abort_if_too_few() {
            return;
        }
        self.maybe_end_round();
    }

    fn on_chat(&mut self, id: &str, text: String) {
        let text = match validate::chat(&text) {
            Ok(t) => t,
            Err(_) => return,
        };
        let nickname = self
            .players
            .iter()
            .find(|p| p.id == id)
            .map(|p| p.nickname.clone())
            .unwrap_or_default();
        self.broadcast(ServerMsg::Chat { player_id: id.to_string(), nickname, text });
    }

    // ---- match flow -------------------------------------------------------

    fn start_match(&mut self, id: &str) {
        if id != self.host_id {
            return self.send_to(id, ServerMsg::error("NOT_HOST", "only the host can start"));
        }
        if self.phase.is_running() {
            return;
        }
        let pool = game::pool::build_pool(&self.config.difficulty);
        if pool.is_empty() {
            return self.send_to(id, ServerMsg::error("EMPTY_POOL", "no countries match the filters"));
        }
        let mut rng = rand::rng();
        self.sequence = game::pool::make_sequence(&pool, self.config.rounds as usize, &mut rng);
        for p in &mut self.players {
            p.score = 0;
            p.correct = 0;
            p.answer = None;
        }
        self.round_index = 0;
        self.last_round_result = None;
        self.last_match_result = None;
        self.phase = Phase::Countdown;
        self.countdown_deadline_ms = now_ms() + 3000;
        self.broadcast(ServerMsg::Countdown { seconds: 3 });
        self.pending_arm = Some(Duration::from_secs(3));
    }

    async fn on_deadline(&mut self) {
        match self.phase {
            Phase::Countdown => self.start_round(0),
            Phase::InRound => self.end_round(),
            Phase::Intermission => {
                if self.round_index + 1 < self.config.rounds as usize {
                    let next = self.round_index + 1;
                    self.start_round(next);
                } else {
                    self.finish_match().await;
                }
            }
            _ => {}
        }
    }

    fn round_duration(&self) -> Duration {
        let secs = if self.config.time_limit_sec > 0 {
            self.config.time_limit_sec as u64
        } else {
            self.cfg.no_limit_round_cap_sec
        };
        Duration::from_secs(secs)
    }

    fn start_round(&mut self, index: usize) {
        let Some(target) = self.sequence.get(index).copied() else {
            // Shouldn't happen, but never panic — just end the match.
            self.pending_arm = Some(Duration::from_millis(0));
            self.phase = Phase::Intermission;
            self.round_index = self.config.rounds as usize; // force finish next tick
            return;
        };
        self.round_index = index;
        self.phase = Phase::InRound;
        self.round_started = Instant::now();
        for p in &mut self.players {
            p.answer = None;
        }
        let dur = self.round_duration();
        self.round_deadline_ms = now_ms() + dur.as_millis() as i64;
        self.broadcast(ServerMsg::RoundStart {
            index: index as u32,
            total: self.config.rounds,
            alpha2: target.alpha2.to_string(),
            deadline_ms: self.round_deadline_ms as f64,
        });
        self.broadcast_scoreboard();
        self.pending_arm = Some(dur);
    }

    fn submit_answer(&mut self, id: &str, round_index: u32, country_id: &str) {
        if self.phase != Phase::InRound || round_index as usize != self.round_index {
            return self.send_to(id, ServerMsg::AnswerAck { round_index, accepted: false });
        }
        let Some(target) = self.sequence.get(self.round_index).copied() else { return };
        let already = self.players.iter().any(|p| p.id == id && p.answer.is_some());
        if already {
            return self.send_to(id, ServerMsg::AnswerAck { round_index, accepted: false });
        }
        let limit_ms = self.round_duration().as_millis() as i64;
        let elapsed = (self.round_started.elapsed().as_millis() as i64).clamp(0, limit_ms);
        let correct = game::same_flag(country_id, target.id);
        let points = round_points(correct, elapsed, self.config.time_limit_sec);
        if let Some(p) = self.players.iter_mut().find(|p| p.id == id) {
            p.answer = Some(RoundPlayerResult {
                player_id: id.to_string(),
                correct,
                time_ms: elapsed as i32,
                points,
                picked_id: Some(country_id.to_string()),
            });
        }
        self.send_to(id, ServerMsg::AnswerAck { round_index, accepted: true });
        self.broadcast_scoreboard();

        // End early once every connected player has answered.
        self.maybe_end_round();
    }

    fn end_round(&mut self) {
        let target_id = self
            .sequence
            .get(self.round_index)
            .map(|c| c.id.to_string())
            .unwrap_or_default();

        let mut results = Vec::with_capacity(self.players.len());
        let limit_ms = self.round_duration().as_millis() as i64;
        for p in &mut self.players {
            let r = p.answer.take().unwrap_or(RoundPlayerResult {
                player_id: p.id.clone(),
                correct: false,
                time_ms: limit_ms as i32,
                points: 0,
                picked_id: None,
            });
            p.score += r.points;
            if r.correct {
                p.correct += 1;
            }
            results.push(r);
        }

        // Retain the result so a socket reconnecting during the intermission can
        // be shown it (and the correct remaining cooldown).
        self.last_round_result = Some((self.round_index as u32, target_id.clone(), results.clone()));
        self.intermission_deadline_ms = now_ms() + self.cfg.round_intermission_ms as i64;
        self.broadcast(ServerMsg::RoundResult {
            index: self.round_index as u32,
            target_id,
            results,
            intermission_ms: self.cfg.round_intermission_ms as u32,
        });
        // Push the new cumulative totals so the scoreboard updates with the
        // round result instead of jumping silently at the next round start.
        self.broadcast_scoreboard();
        self.phase = Phase::Intermission;
        self.pending_arm = Some(Duration::from_millis(self.cfg.round_intermission_ms));
    }

    async fn finish_match(&mut self) {
        self.phase = Phase::Finished;
        let mut standings: Vec<FinalStanding> = self
            .players
            .iter()
            .map(|p| FinalStanding {
                player_id: p.id.clone(),
                nickname: p.nickname.clone(),
                avatar: p.avatar.clone(),
                score: p.score,
                correct: p.correct,
                rounds: self.config.rounds,
            })
            .collect();
        standings.sort_by(|a, b| b.score.cmp(&a.score));
        let winner_id = standings.first().map(|s| s.player_id.clone());

        // Retain so a socket reconnecting after the match still sees the results.
        self.last_match_result = Some((standings.clone(), winner_id.clone()));
        self.broadcast(ServerMsg::MatchResult { standings: standings.clone(), winner_id });

        // Persist (fire-and-forget; never blocks the actor on errors).
        self.db.record_match(self.code.clone(), self.config.rounds, standings).await;
        // The all-time leaderboard just changed; push it to browse-view watchers.
        if let Some(mgr) = self.mgr.upgrade() {
            mgr.notify_leaderboard_dirty();
        }
    }

    // ---- helpers ----------------------------------------------------------

    fn room_info(&self) -> RoomInfo {
        RoomInfo {
            code: self.code.clone(),
            config: self.config.clone(),
            host_id: self.host_id.clone(),
        }
    }

    fn reassign_host_if_needed(&mut self) {
        if self.players.iter().any(|p| p.id == self.host_id) {
            return;
        }
        if let Some(first) = self.players.first() {
            self.host_id = first.id.clone();
            let host_id = self.host_id.clone();
            self.broadcast(ServerMsg::HostChanged { host_id });
        }
    }

    fn scoreboard_msg(&self) -> ServerMsg {
        let standings = self
            .players
            .iter()
            .map(|p| Standing { player_id: p.id.clone(), score: p.score, answered: p.answer.is_some() })
            .collect();
        ServerMsg::Scoreboard { standings }
    }

    fn broadcast_scoreboard(&self) {
        self.broadcast(self.scoreboard_msg());
    }

    fn broadcast(&self, msg: ServerMsg) {
        let arc = Arc::new(msg);
        for p in &self.players {
            if let Some(sink) = &p.sink {
                let _ = sink.try_send(arc.clone());
            }
        }
    }

    fn broadcast_except(&self, except: &str, msg: ServerMsg) {
        let arc = Arc::new(msg);
        for p in &self.players {
            if p.id == except {
                continue;
            }
            if let Some(sink) = &p.sink {
                let _ = sink.try_send(arc.clone());
            }
        }
    }

    fn send_to(&self, id: &str, msg: ServerMsg) {
        if let Some(p) = self.players.iter().find(|p| p.id == id) {
            if let Some(sink) = &p.sink {
                let _ = sink.try_send(Arc::new(msg));
            }
        }
    }

    async fn sync_snapshot(&self) {
        {
            let mut snap = self.snapshot.write().await;
            snap.host_id = self.host_id.clone();
            snap.phase = self.phase.as_str().to_string();
            snap.player_count = self.players.len();
            snap.connected_count = self.players.iter().filter(|p| p.connected).count();
            snap.max_players = self.cfg.max_players_per_room;
            snap.joinable =
                !self.phase.is_running() && self.players.len() < self.cfg.max_players_per_room;
            snap.last_activity_ms = now_ms();
        }
        // The room list this room appears in just (potentially) changed; ping the
        // browse-view watchers. They re-read and dedupe, so an unchanged snapshot
        // costs nothing downstream.
        if let Some(mgr) = self.mgr.upgrade() {
            mgr.notify_lobby_dirty();
        }
    }
}
