//! SQLite persistence for completed matches and the all-time leaderboard.
//! rusqlite is synchronous, so every call hops onto a blocking thread; writes
//! are infrequent (once per finished match) so a single shared connection is
//! plenty.
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::error::AppError;
use crate::ws::protocol::FinalStanding;

#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "bindings/")]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardRow {
    pub nickname: String,
    pub avatar: String,
    pub score: i32,
    pub correct: i32,
    pub rounds: i32,
    /// Epoch millis; f64 so it maps to a JS `number` (out of i32 range).
    pub played_at: f64,
}

impl Db {
    pub fn open(path: &str) -> Result<Self, AppError> {
        let conn = Connection::open(path).map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS matches (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 room TEXT NOT NULL,
                 played_at INTEGER NOT NULL,
                 rounds INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS results (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 match_id INTEGER NOT NULL,
                 nickname TEXT NOT NULL,
                 avatar TEXT NOT NULL,
                 score INTEGER NOT NULL,
                 correct INTEGER NOT NULL,
                 rounds INTEGER NOT NULL,
                 played_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_results_score ON results(score DESC);",
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(Db { conn: Arc::new(Mutex::new(conn)) })
    }

    /// Record a finished match and its per-player standings.
    pub async fn record_match(&self, room: String, rounds: u32, standings: Vec<FinalStanding>) {
        let conn = self.conn.clone();
        let res = tokio::task::spawn_blocking(move || -> rusqlite::Result<()> {
            let played_at = chrono_now();
            let mut c = conn.lock().expect("db mutex poisoned");
            let tx = c.transaction()?;
            tx.execute(
                "INSERT INTO matches (room, played_at, rounds) VALUES (?1, ?2, ?3)",
                rusqlite::params![room, played_at, rounds],
            )?;
            let match_id = tx.last_insert_rowid();
            for s in &standings {
                tx.execute(
                    "INSERT INTO results (match_id, nickname, avatar, score, correct, rounds, played_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    rusqlite::params![match_id, s.nickname, s.avatar, s.score, s.correct, s.rounds, played_at],
                )?;
            }
            tx.commit()
        })
        .await;
        match res {
            Ok(Ok(())) => {}
            Ok(Err(e)) => tracing::error!("record_match failed: {e}"),
            Err(e) => tracing::error!("record_match task panicked: {e}"),
        }
    }

    /// Each player's best single-match score, highest first (one row per name).
    pub async fn top_leaderboard(&self, limit: u32) -> Result<Vec<LeaderboardRow>, AppError> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || -> rusqlite::Result<Vec<LeaderboardRow>> {
            let c = conn.lock().expect("db mutex poisoned");
            // Group by name (case-insensitive); with exactly one MAX(score) the
            // other bare columns are taken from that best-scoring row.
            let mut stmt = c.prepare(
                "SELECT nickname, avatar, MAX(score) AS score, correct, rounds, played_at
                 FROM results
                 GROUP BY nickname COLLATE NOCASE
                 ORDER BY score DESC, played_at ASC LIMIT ?1",
            )?;
            let rows = stmt
                .query_map([limit], |r| {
                    Ok(LeaderboardRow {
                        nickname: r.get(0)?,
                        avatar: r.get(1)?,
                        score: r.get(2)?,
                        correct: r.get(3)?,
                        rounds: r.get(4)?,
                        played_at: r.get::<_, i64>(5)? as f64,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .map_err(|e| AppError::Internal(e.to_string()))
    }
}

fn chrono_now() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}
