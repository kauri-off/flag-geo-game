# Flag Geo — dedicated multiplayer server

A small, self-hostable Rust server that powers the **Online** tab of Flag Geo.
Players connect to it from the game client (they paste the server URL into the
Online tab), pick a nickname + flag avatar, and race the same flag sequence live
in rooms.

- **Connect / gRPC-Web** (one HTTP endpoint, protobuf) for everything:
  - `AuthService` — discovery, guest auth, account register/login.
  - `RoomService` — room create/list/join and the leaderboard.
  - `GameService` — live room play: a server-streaming `PlayEvents` (lobby,
    countdown, per-round flags, live scoreboard, results) plus unary action RPCs
    (submit answer, chat, host controls). Browsers can't do gRPC bidi streaming,
    so live play is a server-stream + unary split.
- **Server-authoritative**: the server owns the flag sequence, round timing,
  correctness (including flag twins) and scoring. Clients only render and submit
  a chosen country, so scores can't be forged.
- **SQLite** stores finished matches for an all-time leaderboard.

Built with tonic + tonic-web + tokio. No system dependencies: SQLite is bundled
and `protoc` is vendored (via `protoc-bin-vendored`) for the build.

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

Build from the **repo root** (the build compiles the shared `../proto` contract):

```sh
docker build -f server/Dockerfile -t flag-geo-server .
docker run -p 8080:8080 -v $PWD/data:/data \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  -e CORS_ORIGINS=https://yourgame.example \
  flag-geo-server
```

## TLS / reverse proxy (recommended)

The server speaks plain HTTP/1.1 (gRPC-Web); terminate TLS at your reverse proxy.
Browsers on an `https://` page require an `https://` server, so a proxy is
required for public play.

It runs happily under a **subpath** — Connect appends the gRPC route to whatever
base URL the client uses, so a global Caddy instance can host it next to other
apps. Caddy's `handle_path` strips the prefix before proxying:

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

The wire contract is the single source of truth in `../proto/flaggeo/v1/`.
`build.rs` compiles it into Rust (prost + tonic) on the server; `npm run
gen-protocol` (buf) compiles it into TypeScript for the client (`src/online/gen/`)
— run it after changing the proto. Internally the room actor uses plain domain
types (`src/protocol.rs`); `src/grpc/convert.rs` maps them to/from the generated
protobuf at the RPC boundary. The country table and flag-twin groups are
generated from the client data with `npm run gen-server-data`.

## Tests

```sh
cargo test
```

Covers scoring parity with the client and the protobuf/domain conversions.
For an end-to-end check, run the server then `node scripts/grpc-smoke.ts
http://localhost:8099` from the repo root.

## Services

`AuthService` (GetInfo, Auth, Register, Login), `RoomService`
(ListRooms, CreateRoom, JoinRoom, GetLeaderboard), `GameService` (PlayEvents
[server-stream], SetProfile, UpdateConfig, TransferHost, KickPlayer, StartMatch,
SubmitAnswer, SendChat, LeaveRoom). All served over Connect / gRPC-Web; the
`authorization: Bearer <token>` header carries the session token (Auth/Room) or
room token (Game).

## License

AGPL-3.0-only, the same as the rest of the project — see [`../LICENSE.md`](../LICENSE.md).
