# Flag Geo — dedicated multiplayer server

A small, self-hostable Rust server that powers the **Online** tab of Flag Geo.
Players connect to it from the game client (they paste the server URL into the
Online tab), pick a nickname + flag avatar, and race the same flag sequence live
in rooms.

- **REST** for discovery, auth and room create/list/join.
- **WebSocket** for live room play (lobby, countdown, per-round flags, answers,
  live scoreboard, results).
- **Server-authoritative**: the server owns the flag sequence, round timing,
  correctness (including flag twins) and scoring. Clients only render and submit
  a chosen country, so scores can't be forged.
- **SQLite** stores finished matches for an all-time leaderboard.

Built with axum + tokio. No system dependencies (SQLite is bundled).

## Run

```sh
cp .env.example .env      # then edit
cargo run                 # dev
cargo build --release     # -> target/release/flag-geo-server
```

Key environment variables (see `.env.example` for all):

| Var | Meaning |
| --- | --- |
| `PORT` | listen port (default 8080) |
| `SERVER_PASSWORD` | optional; if set, clients must enter it to connect |
| `JWT_SECRET` | **set in production** — signs session/room tokens |
| `CORS_ORIGINS` | comma-separated allowed browser origins |
| `DB_PATH` | SQLite file (default `flag-geo.db`) |
| `MAX_ROOMS`, `MAX_PLAYERS_PER_ROOM` | capacity caps |

## Docker

```sh
docker build -t flag-geo-server .
docker run -p 8080:8080 -v $PWD/data:/data \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  -e CORS_ORIGINS=https://yourgame.example \
  flag-geo-server
```

## TLS / reverse proxy (recommended)

The server speaks plain HTTP/WS; terminate TLS at your reverse proxy. Browsers
on an `https://` page require `wss://`, so a proxy is required for public play.

It runs happily under a **subpath** — all routes are relative, so a global Caddy
instance can host it next to other apps. Caddy's `handle_path` strips the prefix
before proxying, and it upgrades the WebSocket automatically:

```caddy
yourhost.example {
    handle_path /flaggame/* {
        reverse_proxy localhost:8080
    }
}
```

Players then enter `https://yourhost.example/flaggame` in the Online tab. Set
`CORS_ORIGINS` to the origin the game client is served from.

## Protocol

The wire types live in `src/ws/protocol.rs` and are the single source of truth.
`#[derive(TS)]` exports matching TypeScript into the client (`src/online/`); run
`npm run gen-protocol` from the repo root after changing them. The country table
and flag-twin groups are generated from the client data with
`npm run gen-server-data`.

## Tests

```sh
cargo test
```

Covers scoring parity with the client, protocol (de)serialization, and the
ts-rs exports.

## Endpoints

REST: `GET /healthz`, `GET /version`, `GET /info`, `POST /auth`,
`POST /rooms`, `GET /rooms`, `POST /rooms/{code}/join`, `GET /leaderboard`.
WebSocket: `GET /ws?token=<roomToken>`.

## License

AGPL-3.0-only, the same as the rest of the project — see [`../LICENSE.md`](../LICENSE.md).
