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
  postLogin,
  postRegister,
  type ServerInfo,
} from '../online/rest';
import { t } from '../i18n';
import { useSettings } from './settingsStore';
import {
  sendKickPlayer,
  sendLeaveRoom,
  sendStartMatch,
  sendSubmitAnswer,
  sendTransferHost,
  sendUpdateConfig,
  streamClose,
  streamConnect,
} from '../online/eventStream';
import { lobbyClose, lobbyConnect } from '../online/lobbyStream';
import {
  toFinalStanding,
  toPlayer,
  toRoomConfig,
  toRoomInfo,
  toRoundPlayerResult,
  toStanding,
  type FinalStanding,
  type LeaderboardRow,
  type Player,
  type RoomConfig,
  type RoomInfo,
  type RoomSummary,
  type RoundPlayerResult,
  type Standing,
} from '../online/protocol';
import type { ServerEvent } from '../online/gen/flaggeo/v1/flaggeo_pb';

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
  /** Set when logged in to an account; null for guests. */
  account: { username: string; avatar: string } | null;

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
  /** Epoch ms (local clock) at which the intermission ends, while in one. */
  intermissionUntil: number | null;
  matchResult: { standings: FinalStanding[]; winnerId: string | null } | null;

  // --- actions ---
  setServerUrl: (v: string) => void;
  setNickname: (v: string) => void;
  setAvatar: (v: string) => void;
  connect: (password?: string) => Promise<void>;
  register: (username: string, password: string, serverPassword?: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  /** Continue a persisted login (or guest token) without re-authenticating. */
  resume: () => void;
  /** Re-open the socket for a room we still hold a persisted token for (after a
   *  page reload), restoring full room/match state from the server's Welcome. */
  reconnectRoom: () => void;
  disconnect: () => void;
  refreshRooms: () => Promise<void>;
  refreshLeaderboard: () => Promise<void>;
  /** Open the browse-view push stream (live room list + leaderboard). */
  watchLobby: () => void;
  /** Close the browse-view push stream. */
  stopLobbyWatch: () => void;
  createRoom: (config: RoomConfig, roomPassword?: string) => Promise<void>;
  joinRoom: (code: string, roomPassword?: string) => Promise<void>;
  updateConfig: (config: RoomConfig) => void;
  transferHost: (playerId: string) => void;
  kickPlayer: (playerId: string) => void;
  startMatch: () => void;
  submitAnswer: (roundIndex: number, countryId: string) => void;
  leaveRoom: () => void;
  backToLobby: () => void;
  handleServerMsg: (event: ServerEvent) => void;
}

export const useOnline = create<OnlineState>()(
  persist(
    (set, get) => ({
      serverUrl: '',
      nickname: '',
      avatar: '', // a real country alpha-2, chosen on the connect screen
      token: null,
      account: null,

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
      intermissionUntil: null,
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
          const info = await checkServer(base);
          set({ serverInfo: info });
          const { token } = await postAuth(base, password);
          set({ token, account: null, status: 'idle', view: 'browse' });
          await get().refreshRooms();
        } catch (e) {
          set({ status: 'idle', error: errMsg(e), serverInfo: null });
        }
      },

      register: async (username, password, serverPassword) => {
        const base = normalizeBase(get().serverUrl);
        if (!base) return set({ error: 'Enter a server URL' });
        if (!get().avatar) return set({ error: 'Pick an avatar' });
        set({ status: 'busy', error: null });
        try {
          const info = await checkServer(base);
          set({ serverInfo: info });
          const acc = await postRegister(base, {
            username: username.trim(),
            password,
            avatar: get().avatar,
            serverPassword: serverPassword || undefined,
          });
          set({
            token: acc.token,
            account: { username: acc.username, avatar: acc.avatar },
            avatar: acc.avatar,
            status: 'idle',
            view: 'browse',
          });
          await get().refreshRooms();
        } catch (e) {
          set({ status: 'idle', error: errMsg(e), serverInfo: null });
        }
      },

      login: async (username, password) => {
        const base = normalizeBase(get().serverUrl);
        if (!base) return set({ error: 'Enter a server URL' });
        set({ status: 'busy', error: null });
        try {
          const info = await checkServer(base);
          set({ serverInfo: info });
          const acc = await postLogin(base, { username: username.trim(), password });
          set({
            token: acc.token,
            account: { username: acc.username, avatar: acc.avatar },
            avatar: acc.avatar,
            status: 'idle',
            view: 'browse',
          });
          await get().refreshRooms();
        } catch (e) {
          set({ status: 'idle', error: errMsg(e), serverInfo: null });
        }
      },

      logout: () => {
        streamClose();
        useGame.getState().setOnline(false);
        set({
          view: 'connect',
          token: null,
          account: null,
          serverInfo: null,
          rooms: [],
          ...clearedRoom(),
        });
      },

      resume: () => {
        if (!get().token) return;
        set({ view: 'browse', error: null, status: 'idle' });
        void get().refreshRooms();
      },

      reconnectRoom: () => {
        const { roomToken, selfId } = get();
        if (!roomToken) return;
        enterRoom(set, get, roomToken, selfId ?? '');
      },

      disconnect: () => {
        streamClose();
        useGame.getState().setOnline(false);
        set({
          view: 'connect',
          token: null,
          account: null,
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

      watchLobby: () => {
        const { serverUrl, token } = get();
        if (!token) return;
        lobbyConnect(normalizeBase(serverUrl), token, {
          onRooms: (rooms) => set({ rooms }),
          onLeaderboard: (leaderboard) => set({ leaderboard }),
        });
      },

      stopLobbyWatch: () => lobbyClose(),

      createRoom: async (config, roomPassword) => {
        const { serverUrl, token } = get();
        if (!token) return;
        const { nickname, avatar } = identity(get);
        set({ status: 'busy', error: null });
        try {
          const { roomToken, playerId } = await postCreateRoom(normalizeBase(serverUrl), token, {
            nickname,
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
        const { serverUrl, token } = get();
        if (!token) return;
        const { nickname, avatar } = identity(get);
        set({ status: 'busy', error: null });
        try {
          const { roomToken, playerId } = await postJoin(
            normalizeBase(serverUrl),
            token,
            code.trim().toUpperCase(),
            { nickname, avatar, roomPassword: roomPassword || undefined },
          );
          enterRoom(set, get, roomToken, playerId);
        } catch (e) {
          set({ status: 'idle', error: errMsg(e) });
        }
      },

      updateConfig: (config) => sendUpdateConfig(config),

      transferHost: (playerId) => sendTransferHost(playerId),

      kickPlayer: (playerId) => sendKickPlayer(playerId),

      startMatch: () => sendStartMatch(),

      submitAnswer: (roundIndex, countryId) => sendSubmitAnswer(roundIndex, countryId),

      leaveRoom: () => {
        sendLeaveRoom();
        streamClose();
        useGame.getState().setOnline(false);
        set({ view: 'browse', ...clearedRoom() });
        void get().refreshRooms();
      },

      // After a finished match the room stays alive; return to its lobby so the
      // host can start again (the server resets scores on the next start).
      backToLobby: () =>
        set({
          phase: 'lobby',
          matchResult: null,
          round: null,
          lastResult: null,
          intermissionUntil: null,
          countdown: null,
        }),

      handleServerMsg: (msg) => applyServerMsg(set, get, msg),
    }),
    {
      name: 'flag-geo-online',
      // Persist connection preferences plus the account session (so a returning
      // user stays logged in). Also keep the active room token + self id so a page
      // reload can reconnect into the same seat; the rest of the live room/match
      // state is re-derived from the server's Welcome on reconnect.
      partialize: (s) => ({
        serverUrl: s.serverUrl,
        nickname: s.nickname,
        avatar: s.avatar,
        token: s.token,
        account: s.account,
        roomToken: s.roomToken,
        selfId: s.selfId,
      }),
    },
  ),
);

// --- helpers ---------------------------------------------------------------

type Set = (partial: Partial<OnlineState>) => void;
type Get = () => OnlineState;

/** Fetch `/info` and refuse to proceed if the server's protocol differs. */
async function checkServer(base: string): Promise<ServerInfo> {
  const info = await getInfo(base);
  if (info.protocol !== CLIENT_PROTOCOL) {
    throw new Error(
      `Server protocol (${info.protocol}) doesn't match this client (${CLIENT_PROTOCOL}). Update one of them.`,
    );
  }
  return info;
}

/** The nickname + avatar to seat with: the account's when logged in, else the
 *  guest fields. (The server is authoritative for logged-in players regardless.) */
function identity(get: Get): { nickname: string; avatar: string } {
  const s = get();
  return s.account
    ? { nickname: s.account.username, avatar: s.account.avatar }
    : { nickname: s.nickname.trim(), avatar: s.avatar };
}

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
    intermissionUntil: null,
    matchResult: null,
    status: 'idle',
  };
}

function enterRoom(set: Set, get: Get, roomToken: string, playerId: string) {
  set({ ...clearedRoom(), roomToken, selfId: playerId, view: 'room', status: 'connecting' });
  // Wire the board's confirm() to submit answers over this room's stream.
  useGame.getState().setOnline(true, (i, c) => get().submitAnswer(i, c));
  // Tracks whether this room ever handshaked. A close before any Welcome means the
  // token/room is stale (gone or expired) — bail to the browser instead of looping.
  let gotWelcome = false;
  streamConnect(normalizeBase(get().serverUrl), roomToken, {
    onEvent: (event) => {
      if (event.payload.case === 'welcome') gotWelcome = true;
      get().handleServerMsg(event);
    },
    onStatus: (status) => {
      if (status === 'closed' && !gotWelcome) {
        bailToBrowse(set, get, t('connectionLost', useSettings.getState().language));
        return;
      }
      set({ status: status === 'open' ? 'open' : status === 'connecting' ? 'connecting' : 'closed' });
    },
    onGiveUp: () => bailToBrowse(set, get, t('connectionLost', useSettings.getState().language)),
  });
}

/** Tear down the stream and drop the (now stale) room, returning to the browser. */
function bailToBrowse(set: Set, get: Get, error: string | null) {
  streamClose();
  useGame.getState().setOnline(false);
  set({ view: 'browse', error, ...clearedRoom() });
  void get().refreshRooms();
}

function applyServerMsg(set: Set, get: Get, event: ServerEvent) {
  const p = event.payload;
  switch (p.case) {
    case 'welcome': {
      set({
        selfId: p.value.playerId,
        room: toRoomInfo(p.value.room),
        players: p.value.players.map(toPlayer),
        phase: p.value.phase,
      });
      break;
    }
    case 'playerJoined': {
      if (!p.value.player) break;
      const players = upsert(get().players, toPlayer(p.value.player));
      set({ players });
      break;
    }
    case 'playerLeft': {
      const playerId = p.value.playerId;
      set({ players: get().players.filter((pl) => pl.id !== playerId) });
      break;
    }
    case 'kicked': {
      streamClose();
      useGame.getState().setOnline(false);
      set({
        view: 'browse',
        error: t('youWereKicked', useSettings.getState().language),
        ...clearedRoom(),
      });
      void get().refreshRooms();
      break;
    }
    case 'profileUpdated': {
      const { playerId, nickname, avatar } = p.value;
      set({
        players: get().players.map((pl) =>
          pl.id === playerId ? { ...pl, nickname, avatar } : pl,
        ),
      });
      break;
    }
    case 'configUpdated': {
      const room = get().room;
      if (room) set({ room: { ...room, config: toRoomConfig(p.value.config) } });
      break;
    }
    case 'hostChanged': {
      const room = get().room;
      if (room) set({ room: { ...room, hostId: p.value.hostId } });
      break;
    }
    case 'countdown': {
      set({ phase: 'countdown', countdown: p.value.seconds, matchResult: null });
      break;
    }
    case 'roundStart': {
      const { index, total, alpha2, deadlineMs } = p.value;
      set({
        phase: 'inRound',
        countdown: null,
        round: { index, total, alpha2, deadlineMs },
        lastResult: null,
        intermissionUntil: null,
      });
      useGame.getState().setOnlineRound({
        index,
        alpha2,
        targetId: idByAlpha2.get(alpha2) ?? '',
        timeLimitSec: get().room?.config.timeLimitSec ?? 0,
      });
      break;
    }
    case 'scoreboard': {
      set({ standings: p.value.standings.map(toStanding) });
      break;
    }
    case 'roundResult': {
      const results = p.value.results.map(toRoundPlayerResult);
      set({
        phase: 'intermission',
        lastResult: { index: p.value.index, targetId: p.value.targetId, results },
        intermissionUntil: Date.now() + p.value.intermissionMs,
      });
      const selfId = get().selfId;
      const mine = selfId ? results.find((r) => r.playerId === selfId) : undefined;
      useGame.getState().applyOnlineResult({
        targetId: p.value.targetId,
        correct: mine?.correct ?? false,
        timeMs: mine?.timeMs ?? 0,
        timedOut: mine ? mine.pickedId == null : true,
      });
      break;
    }
    case 'matchResult': {
      set({
        phase: 'finished',
        matchResult: {
          standings: p.value.standings.map(toFinalStanding),
          winnerId: p.value.winnerId ?? null,
        },
        round: null,
        intermissionUntil: null,
      });
      // The leaderboard refreshes itself: the server pushes the new standings to
      // every browse-view watcher over the lobby stream once the match is recorded.
      break;
    }
    case 'matchAborted': {
      set({
        phase: 'lobby',
        matchResult: null,
        round: null,
        lastResult: null,
        intermissionUntil: null,
        countdown: null,
        standings: [],
        error: t('matchAborted', useSettings.getState().language),
      });
      break;
    }
    case 'error': {
      // The server rejected our room token (e.g. the slot was dropped after the
      // reconnect grace expired). The seat is gone — return to the browser.
      if (p.value.code === 'BAD_TOKEN') {
        bailToBrowse(set, get, t('connectionLost', useSettings.getState().language));
        break;
      }
      set({ error: `${p.value.message}` });
      break;
    }
    case 'answerAck':
    case 'chat':
    case undefined:
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
