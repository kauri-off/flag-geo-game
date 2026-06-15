// The app's plain-data view of the wire protocol, plus converters from the
// generated protobuf messages (`./gen`). The UI and the online store treat these
// as ordinary objects (spread, persisted to localStorage, built by hand in
// RoomSettings), so we keep plain interfaces here rather than leaking the
// generated `Message` brand throughout the app. This mirrors the server's
// `grpc::convert` boundary: protobuf in/out at the edge, plain types within.
//
// Outgoing values (e.g. RoomConfig for createRoom) can be passed straight to the
// Connect client as message-init shapes, so only the pb -> plain direction needs
// explicit converters.
import * as pb from './gen/flaggeo/v1/flaggeo_pb';

export interface DifficultyFilter {
  continents: string[];
  size: string;
  scope?: string;
}

export interface RoomConfig {
  rounds: number;
  timeLimitSec: number;
  attempts: number;
  difficulty: DifficultyFilter;
  registeredOnly: boolean;
}

export interface Player {
  id: string;
  nickname: string;
  avatar: string;
  score: number;
  connected: boolean;
}

export interface RoomInfo {
  code: string;
  config: RoomConfig;
  hostId: string;
}

export interface Standing {
  playerId: string;
  score: number;
  answered: boolean;
}

export interface RoundPlayerResult {
  playerId: string;
  correct: boolean;
  timeMs: number;
  points: number;
  pickedId?: string | null;
}

export interface FinalStanding {
  playerId: string;
  nickname: string;
  avatar: string;
  score: number;
  correct: number;
  rounds: number;
}

export interface RoomSummary {
  code: string;
  host: string;
  players: number;
  maxPlayers: number;
  phase: string;
  hasPassword: boolean;
}

export interface LeaderboardRow {
  nickname: string;
  avatar: string;
  score: number;
  correct: number;
  rounds: number;
  games: number;
  playedAt: number;
}

// --- pb -> plain converters ------------------------------------------------

const EMPTY_DIFFICULTY: DifficultyFilter = { continents: [], size: 'all', scope: undefined };

export function toDifficulty(d?: pb.DifficultyFilter): DifficultyFilter {
  if (!d) return { ...EMPTY_DIFFICULTY };
  return { continents: d.continents, size: d.size || 'all', scope: d.scope };
}

export function toRoomConfig(c?: pb.RoomConfig): RoomConfig {
  if (!c) {
    return { rounds: 0, timeLimitSec: 0, attempts: 1, difficulty: { ...EMPTY_DIFFICULTY }, registeredOnly: false };
  }
  return {
    rounds: c.rounds,
    timeLimitSec: c.timeLimitSec,
    attempts: c.attempts,
    difficulty: toDifficulty(c.difficulty),
    registeredOnly: c.registeredOnly,
  };
}

export function toPlayer(p: pb.Player): Player {
  return { id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score, connected: p.connected };
}

export function toRoomInfo(r?: pb.RoomInfo): RoomInfo {
  return { code: r?.code ?? '', config: toRoomConfig(r?.config), hostId: r?.hostId ?? '' };
}

export function toStanding(s: pb.Standing): Standing {
  return { playerId: s.playerId, score: s.score, answered: s.answered };
}

export function toRoundPlayerResult(r: pb.RoundPlayerResult): RoundPlayerResult {
  return {
    playerId: r.playerId,
    correct: r.correct,
    timeMs: r.timeMs,
    points: r.points,
    pickedId: r.pickedId ?? null,
  };
}

export function toFinalStanding(f: pb.FinalStanding): FinalStanding {
  return {
    playerId: f.playerId,
    nickname: f.nickname,
    avatar: f.avatar,
    score: f.score,
    correct: f.correct,
    rounds: f.rounds,
  };
}

export function toRoomSummary(s: pb.RoomSummary): RoomSummary {
  return {
    code: s.code,
    host: s.host,
    players: s.players,
    maxPlayers: s.maxPlayers,
    phase: s.phase,
    hasPassword: s.hasPassword,
  };
}

export function toLeaderboardRow(r: pb.LeaderboardRow): LeaderboardRow {
  return {
    nickname: r.nickname,
    avatar: r.avatar,
    score: r.score,
    correct: r.correct,
    rounds: r.rounds,
    games: r.games,
    playedAt: r.playedAt,
  };
}
