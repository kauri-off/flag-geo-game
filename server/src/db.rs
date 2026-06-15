//! SQLite persistence for completed matches and the all-time leaderboard.
//! rusqlite is synchronous, so every call hops onto a blocking thread; writes
//! are infrequent (once per finished match) so a single shared connection is
//! plenty.
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::error::AppError;
use crate::protocol::FinalStanding;

#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
}

#[derive(Debug, Clone)]
pub struct LeaderboardRow {
    pub nickname: String,
    pub avatar: String,
    /// Cumulative score across every match this name has played.
    pub score: i32,
    pub correct: i32,
    pub rounds: i32,
    /// Number of matches this name has finished.
    pub games: i32,
    /// Epoch millis of the most recent match; f64 so it maps to a JS `number`.
    pub played_at: f64,
}

/// A stored account row.
#[derive(Debug, Clone)]
pub struct UserRow {
    pub id: i64,
    pub username: String,
    pub password_hash: String,
    pub avatar: String,
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
             CREATE INDEX IF NOT EXISTS idx_results_score ON results(score DESC);
             CREATE TABLE IF NOT EXISTS users (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 username TEXT NOT NULL,
                 username_lower TEXT NOT NULL UNIQUE,
                 password_hash TEXT NOT NULL,
                 avatar TEXT NOT NULL,
                 created_at INTEGER NOT NULL
             );",
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

    /// Create an account. Returns the new user id, or `Conflict` if the username
    /// (case-insensitive) is already taken.
    pub async fn create_user(
        &self,
        username: String,
        password_hash: String,
        avatar: String,
    ) -> Result<i64, AppError> {
        let conn = self.conn.clone();
        let username_lower = username.to_lowercase();
        let created_at = chrono_now();
        tokio::task::spawn_blocking(move || -> Result<i64, AppError> {
            let c = conn.lock().expect("db mutex poisoned");
            let res = c.execute(
                "INSERT INTO users (username, username_lower, password_hash, avatar, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![username, username_lower, password_hash, avatar, created_at],
            );
            match res {
                Ok(_) => Ok(c.last_insert_rowid()),
                Err(rusqlite::Error::SqliteFailure(e, _))
                    if e.code == rusqlite::ErrorCode::ConstraintViolation =>
                {
                    Err(AppError::Conflict("username already taken".into()))
                }
                Err(e) => Err(AppError::Internal(e.to_string())),
            }
        })
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
    }

    /// Look up an account by username (case-insensitive) for login.
    pub async fn find_user(&self, username: String) -> Result<Option<UserRow>, AppError> {
        let conn = self.conn.clone();
        let username_lower = username.to_lowercase();
        tokio::task::spawn_blocking(move || -> rusqlite::Result<Option<UserRow>> {
            let c = conn.lock().expect("db mutex poisoned");
            let mut stmt = c.prepare(
                "SELECT id, username, password_hash, avatar FROM users WHERE username_lower = ?1",
            )?;
            let mut rows = stmt.query_map([username_lower], |r| {
                Ok(UserRow {
                    id: r.get(0)?,
                    username: r.get(1)?,
                    password_hash: r.get(2)?,
                    avatar: r.get(3)?,
                })
            })?;
            rows.next().transpose()
        })
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .map_err(|e| AppError::Internal(e.to_string()))
    }

    /// Read an account by id (used to seat a logged-in player with their current
    /// username + avatar).
    pub async fn get_user(&self, uid: i64) -> Result<Option<UserRow>, AppError> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || -> rusqlite::Result<Option<UserRow>> {
            let c = conn.lock().expect("db mutex poisoned");
            let mut stmt =
                c.prepare("SELECT id, username, password_hash, avatar FROM users WHERE id = ?1")?;
            let mut rows = stmt.query_map([uid], |r| {
                Ok(UserRow {
                    id: r.get(0)?,
                    username: r.get(1)?,
                    password_hash: r.get(2)?,
                    avatar: r.get(3)?,
                })
            })?;
            rows.next().transpose()
        })
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .map_err(|e| AppError::Internal(e.to_string()))
    }

    /// Each player's cumulative all-time score, highest first (one row per name).
    pub async fn top_leaderboard(&self, limit: u32) -> Result<Vec<LeaderboardRow>, AppError> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || -> rusqlite::Result<Vec<LeaderboardRow>> {
            let c = conn.lock().expect("db mutex poisoned");
            // Sum every match for a name (case-insensitive). The avatar is taken
            // from that name's most recent match so it tracks their latest flag.
            let mut stmt = c.prepare(
                "SELECT r.nickname,
                        (SELECT avatar FROM results r2
                           WHERE r2.nickname = r.nickname COLLATE NOCASE
                           ORDER BY r2.played_at DESC LIMIT 1) AS avatar,
                        SUM(r.score) AS score,
                        SUM(r.correct) AS correct,
                        SUM(r.rounds) AS rounds,
                        COUNT(*) AS games,
                        MAX(r.played_at) AS played_at
                 FROM results r
                 GROUP BY r.nickname COLLATE NOCASE
                 ORDER BY score DESC, played_at DESC LIMIT ?1",
            )?;
            let rows = stmt
                .query_map([limit], |r| {
                    Ok(LeaderboardRow {
                        nickname: r.get(0)?,
                        avatar: r.get(1)?,
                        score: r.get(2)?,
                        correct: r.get(3)?,
                        rounds: r.get(4)?,
                        games: r.get(5)?,
                        played_at: r.get::<_, i64>(6)? as f64,
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
