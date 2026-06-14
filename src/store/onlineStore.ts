// Online multiplayer store. Owns the connection lifecycle (REST auth + room
// management, then a live WebSocket) and mirrors the server's room/match state
// for the UI. Round render-state is bridged into the existing game store
// (`useGame`) so the map/board are reused unchanged for the race.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { countries } from '../data/countries';
import { useGame } from './gameStore';
import {
  CLIENT_PROTOCOL,
  getInfo,
  getLeaderboard,
  getRooms,
  normalizeBase,
  postAuth,
  postCreateRoom,
  postJoin,
  wsBase,
  type ServerInfo,
} from '../online/rest';
import { wsClose, wsConnect, wsSend } from '../online/wsClient';
import type {
  FinalStanding,
  LeaderboardRow,
  Player,
  RoomConfig,
  RoomInfo,
  RoomSummary,
  RoundPlayerResult,
  ServerMsg,
  Standing,
} from '../online/protocol';

/** Reverse map: flag alpha-2 -> numeric country id (each flag is one country). */
const idByAlpha2 = new Map(countries.map((c) => [c.alpha2, c.id]));

export type OnlineView = 'connect' | 'browse' | 'room';
export type ConnStatus = 'idle' | 'busy' | 'connecting' | 'open' | 'closed';

export interface RoundResultView {
  index: number;
  targetId: string;
  results: RoundPlayerResult[];
}

export interface OnlineState {
  // --- persisted connection preferences ---
  serverUrl: string;
  nickname: string;
  avatar: string;
  token: string | null;

  // --- session ---
  view: OnlineView;
  status: ConnStatus;
  error: string | null;
  serverInfo: ServerInfo | null;
  rooms: RoomSummary[];
  leaderboard: LeaderboardRow[];

  // --- active room ---
  roomToken: string | null;
  selfId: string | null;
  room: RoomInfo | null;
  players: Player[];
  phase: string; // server room phase
  countdown: number | null;
  round: { index: number; total: number; alpha2: string; deadlineMs: number } | null;
  standings: Standing[];
  lastResult: RoundResultView | null;
  matchResult: { standings: FinalStanding[]; winnerId: string | null } | null;

  // --- actions ---
  setServerUrl: (v: string) => void;
  setNickname: (v: string) => void;
  setAvatar: (v: string) => void;
  connect: (password?: string) => Promise<void>;
  disconnect: () => void;
  refreshRooms: () => Promise<void>;
  refreshLeaderboard: () => Promise<void>;
  createRoom: (config: RoomConfig, roomPassword?: string) => Promise<void>;
  joinRoom: (code: string, roomPassword?: string) => Promise<void>;
  updateConfig: (config: RoomConfig) => void;
  transferHost: (playerId: string) => void;
  startMatch: () => void;
  submitAnswer: (roundIndex: number, countryId: string) => void;
  leaveRoom: () => void;
  backToLobby: () => void;
  handleServerMsg: (msg: ServerMsg) => void;
}

export const useOnline = create<OnlineState>()(
  persist(
    (set, get) => ({
      serverUrl: '',
      nickname: '',
      avatar: '', // a real country alpha-2, chosen on the connect screen
      token: null,

      view: 'connect',
      status: 'idle',
      error: null,
      serverInfo: null,
      rooms: [],
      leaderboard: [],

      roomToken: null,
      selfId: null,
      room: null,
      players: [],
      phase: 'lobby',
      countdown: null,
      round: null,
      standings: [],
      lastResult: null,
      matchResult: null,

      setServerUrl: (serverUrl) => set({ serverUrl }),
      setNickname: (nickname) => set({ nickname }),
      setAvatar: (avatar) => set({ avatar }),

      connect: async (password) => {
        const base = normalizeBase(get().serverUrl);
        if (!base) return set({ error: 'Enter a server URL' });
        if (!get().nickname.trim()) return set({ error: 'Enter a nickname' });
        set({ status: 'busy', error: null });
        try {
          const info = await getInfo(base);
          if (info.protocol !== CLIENT_PROTOCOL) {
            throw new Error(
              `Server protocol (${info.protocol}) doesn't match this client (${CLIENT_PROTOCOL}). Update one of them.`,
            );
          }
          set({ serverInfo: info });
          const { token } = await postAuth(base, password);
          set({ token, status: 'idle', view: 'browse' });
          await get().refreshRooms();
        } catch (e) {
          set({ status: 'idle', error: errMsg(e), serverInfo: null });
        }
      },

      disconnect: () => {
        wsClose();
        useGame.getState().setOnline(false);
        set({
          view: 'connect',
          token: null,
          serverInfo: null,
          rooms: [],
          ...clearedRoom(),
        });
      },

      refreshRooms: async () => {
        const { serverUrl, token } = get();
        if (!token) return;
        try {
          const { rooms } = await getRooms(normalizeBase(serverUrl), token);
          set({ rooms });
        } catch (e) {
          set({ error: errMsg(e) });
        }
      },

      refreshLeaderboard: async () => {
        try {
          const { top } = await getLeaderboard(normalizeBase(get().serverUrl));
          set({ leaderboard: top });
        } catch {
          /* leaderboard is non-critical */
        }
      },

      createRoom: async (config, roomPassword) => {
        const { serverUrl, token, nickname, avatar } = get();
        if (!token) return;
        set({ status: 'busy', error: null });
        try {
          const { roomToken, playerId } = await postCreateRoom(normalizeBase(serverUrl), token, {
            nickname: nickname.trim(),
            avatar,
            config,
            roomPassword: roomPassword || undefined,
          });
          enterRoom(set, get, roomToken, playerId);
        } catch (e) {
          set({ status: 'idle', error: errMsg(e) });
        }
      },

      joinRoom: async (code, roomPassword) => {
        const { serverUrl, token, nickname, avatar } = get();
        if (!token) return;
        set({ status: 'busy', error: null });
        try {
          const { roomToken, playerId } = await postJoin(
            normalizeBase(serverUrl),
            token,
            code.trim().toUpperCase(),
            { nickname: nickname.trim(), avatar, roomPassword: roomPassword || undefined },
          );
          enterRoom(set, get, roomToken, playerId);
        } catch (e) {
          set({ status: 'idle', error: errMsg(e) });
        }
      },

      updateConfig: (config) => wsSend({ type: 'updateConfig', config }),

      transferHost: (playerId) => wsSend({ type: 'transferHost', playerId }),

      startMatch: () => wsSend({ type: 'startMatch' }),

      submitAnswer: (roundIndex, countryId) =>
        wsSend({ type: 'submitAnswer', roundIndex, countryId }),

      leaveRoom: () => {
        wsSend({ type: 'leaveRoom' });
        wsClose();
        useGame.getState().setOnline(false);
        set({ view: 'browse', ...clearedRoom() });
        void get().refreshRooms();
      },

      // After a finished match the room stays alive; return to its lobby so the
      // host can start again (the server resets scores on the next start).
      backToLobby: () =>
        set({ phase: 'lobby', matchResult: null, round: null, lastResult: null, countdown: null }),

      handleServerMsg: (msg) => applyServerMsg(set, get, msg),
    }),
    {
      name: 'flag-geo-online',
      // Only persist connection preferences, never live session state.
      partialize: (s) => ({
        serverUrl: s.serverUrl,
        nickname: s.nickname,
        avatar: s.avatar,
      }),
    },
  ),
);

// --- helpers ---------------------------------------------------------------

type Set = (partial: Partial<OnlineState>) => void;
type Get = () => OnlineState;

function clearedRoom(): Partial<OnlineState> {
  return {
    roomToken: null,
    selfId: null,
    room: null,
    players: [],
    phase: 'lobby',
    countdown: null,
    round: null,
    standings: [],
    lastResult: null,
    matchResult: null,
    status: 'idle',
  };
}

function enterRoom(set: Set, get: Get, roomToken: string, playerId: string) {
  set({ ...clearedRoom(), roomToken, selfId: playerId, view: 'room', status: 'connecting' });
  // Wire the board's confirm() to submit answers over this room's socket.
  useGame.getState().setOnline(true, (i, c) => get().submitAnswer(i, c));
  const url = `${wsBase(get().serverUrl)}/ws?token=${encodeURIComponent(roomToken)}`;
  wsConnect(url, {
    onMessage: (m) => get().handleServerMsg(m),
    onStatus: (status) =>
      set({
        status:
          status === 'open' ? 'open' : status === 'connecting' ? 'connecting' : 'closed',
      }),
  });
}

function applyServerMsg(set: Set, get: Get, msg: ServerMsg) {
  switch (msg.type) {
    case 'welcome': {
      set({
        selfId: msg.playerId,
        room: msg.room,
        players: msg.players,
        phase: msg.phase,
      });
      break;
    }
    case 'playerJoined': {
      const players = upsert(get().players, msg.player);
      set({ players });
      break;
    }
    case 'playerLeft': {
      set({ players: get().players.filter((p) => p.id !== msg.playerId) });
      break;
    }
    case 'profileUpdated': {
      set({
        players: get().players.map((p) =>
          p.id === msg.playerId ? { ...p, nickname: msg.nickname, avatar: msg.avatar } : p,
        ),
      });
      break;
    }
    case 'configUpdated': {
      const room = get().room;
      if (room) set({ room: { ...room, config: msg.config } });
      break;
    }
    case 'hostChanged': {
      const room = get().room;
      if (room) set({ room: { ...room, hostId: msg.hostId } });
      break;
    }
    case 'countdown': {
      set({ phase: 'countdown', countdown: msg.seconds, matchResult: null });
      break;
    }
    case 'roundStart': {
      set({
        phase: 'inRound',
        countdown: null,
        round: {
          index: msg.index,
          total: msg.total,
          alpha2: msg.alpha2,
          deadlineMs: msg.deadlineMs,
        },
        lastResult: null,
      });
      useGame.getState().setOnlineRound({
        index: msg.index,
        alpha2: msg.alpha2,
        targetId: idByAlpha2.get(msg.alpha2) ?? '',
        timeLimitSec: get().room?.config.timeLimitSec ?? 0,
      });
      break;
    }
    case 'scoreboard': {
      set({ standings: msg.standings });
      break;
    }
    case 'roundResult': {
      set({
        phase: 'intermission',
        lastResult: { index: msg.index, targetId: msg.targetId, results: msg.results },
      });
      const mine = get().selfId
        ? msg.results.find((r) => r.playerId === get().selfId)
        : undefined;
      useGame.getState().applyOnlineResult({
        targetId: msg.targetId,
        correct: mine?.correct ?? false,
        timeMs: mine?.timeMs ?? 0,
        timedOut: mine ? mine.pickedId == null : true,
      });
      break;
    }
    case 'matchResult': {
      set({
        phase: 'finished',
        matchResult: { standings: msg.standings, winnerId: msg.winnerId ?? null },
        round: null,
      });
      void get().refreshLeaderboard();
      break;
    }
    case 'error': {
      set({ error: `${msg.message}` });
      break;
    }
    case 'pong':
    case 'answerAck':
    case 'chat':
      break;
  }
}

function upsert(players: Player[], p: Player): Player[] {
  const i = players.findIndex((x) => x.id === p.id);
  if (i === -1) return [...players, p];
  const copy = players.slice();
  copy[i] = p;
  return copy;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong';
}
