# Flag Geo — Guess the Country

A flag-and-geography quiz. You're shown a country's flag and have to find that
country on a world map. Single-player runs **fully offline** in the browser
(Vite + React) — the map, the flag SVGs and the country names are all bundled at
build time, so there are no runtime network requests. An optional **Online**
mode lets you race other players live against a self-hosted dedicated server.

## Gameplay

- A flag is shown; click the matching country on the interactive world map.
- Rounds are timed, and your accuracy and best/average times are tracked per
  session.
- Every round is logged to a persistent **History** screen.
- Indistinguishable flags are treated fairly: guessing Chad when shown Romania
  (or Indonesia/Monaco) counts as correct — see `src/game/flagTwins.ts`.

### Modes

- **Play** — endless free practice.
- **Challenge** — a finite, scored run; answer in 3s for full points, decaying
  the longer you take.
- **Online** — multiplayer rooms on a shared server (see below).
- **History** / **Settings**.

### Difficulty & options

Configured on the **Settings** screen and persisted to `localStorage`:

- **Continents** — restrict the pool to one or more regions.
- **Country size** — small (`< 50,000 km²`), medium, or large (`> 1,000,000 km²`).
- **Confirm mode** — click-to-confirm, or select then press space.
- **Country labels**, sound on/off, volume, answer time limit.
- **Language** — English or Russian.

## Online multiplayer

The **Online** tab connects to a dedicated server that you or a friend
self-host. In a room, everyone races the **same server-chosen flag sequence**
simultaneously; the server is authoritative for the sequence, round timing,
answer correctness and scoring, so results can't be forged.

Flow: open **Online** → enter the server URL (and a password if the server
requires one) → pick a nickname and a **flag avatar** → create or join a room by
code → the host starts the match → race, with a live scoreboard, then final
standings. Match results feed an all-time **leaderboard** stored on the server.

The server lives in [`server/`](server/) and is a small Rust (axum + tokio)
binary with bundled SQLite. See [`server/README.md`](server/README.md) for run,
Docker and reverse-proxy (subpath `wss`) instructions. Quick start:

```sh
cd server
cp .env.example .env      # set JWT_SECRET, optional SERVER_PASSWORD, CORS_ORIGINS
cargo run                 # listens on :8080
```

Then in the game's Online tab, enter `http://localhost:8080`.

## Tech stack

- **React 18** + **Zustand** for state (separate stores for game loop, settings,
  history, UI, and online).
- **d3-geo** + **topojson-client** for the map projection and rendering, using
  the `world-atlas` TopoJSON.
- **flag-icons** for flag SVGs; **world-countries** for ISO codes, areas,
  regions and localized names.
- **Vite** + **TypeScript** for the web app.
- **Rust** (axum, tokio, rusqlite) for the optional online server. The wire
  protocol is defined once in Rust and exported to TypeScript with **ts-rs**, so
  client and server types can't drift.

## Project layout

```
scripts/                Build-time codegen (data, server data, protocol)
src/
  components/           Map, flag, prompt, controls, stats, feedback
  screens/              Game, Challenge, Online, History, Settings
  store/                Zustand stores (game, settings, history, ui, online)
  game/                 Mode registry, country pool, flag twins, sound, stats
  online/               REST + WebSocket clients, generated protocol types, online UI
  data/                 Generated country metadata + loader
  i18n/                 Localized country names + UI strings (en, ru)
  map/                  World TopoJSON loading
  assets/               Bundled world TopoJSON
server/                 Dedicated multiplayer server (Rust)
  src/game/             Country table + flag twins, generated from the client data
  src/ws/protocol.rs    The wire contract (source of truth for the TS types)
```

The game loop (`src/store/gameStore.ts`) is renderer- and mode-agnostic. Online
play reuses the same map/board: the online store feeds round state through
`gameStore`, and `confirm()` submits to the server instead of scoring locally.

## Getting started

Requires Node.js. The online server additionally needs the
[Rust toolchain](https://www.rust-lang.org/tools/install).

```sh
npm install
npm run gen-data   # generate bundled country/map/locale data (one-time, or after dep bumps)
npm run dev        # start the Vite dev server (http://localhost:5173)
```

### Scripts

| Command                   | Description                                                                |
| ------------------------- | -------------------------------------------------------------------------- |
| `npm run gen-data`        | Regenerate bundled data into `src/data`, `src/i18n/locales`, `src/assets`. |
| `npm run gen-server-data` | Regenerate the server's country/flag-twin tables from the client data.     |
| `npm run gen-protocol`    | Re-export the WebSocket/REST types from Rust into `src/online/` (ts-rs).    |
| `npm run dev`             | Vite dev server with hot reload.                                           |
| `npm run build`           | Type-check and produce a production web build in `dist/`.                  |
| `npm run preview`         | Serve the production build locally.                                        |
| `npm run typecheck`       | Type-check without emitting.                                               |

For the server, see [`server/README.md`](server/README.md) (`cargo run`,
`cargo test`, Docker).

## Data generation

`npm run gen-data` runs at build time from local npm packages and produces, all
checked into the repo so the app is self-contained:

- `src/assets/countries-110m.json` — world map TopoJSON (from `world-atlas`).
- `src/data/countries.json` — per-country metadata (ISO codes, area, region).
- `src/i18n/locales/{en,ru}.json` — country names keyed by numeric ISO code.

Keys are normalized numeric ISO 3166-1 codes (no leading zeros) so the metadata,
locale names, and map ids always line up. To add a language, emit another locale
file in `gen-data.mjs` and register it in `src/i18n/index.ts`.

The server's copy of the country data (`server/src/game/`) is regenerated from
these files with `npm run gen-server-data`, and the online protocol types
(`src/online/bindings/`) from the Rust source with `npm run gen-protocol`.
