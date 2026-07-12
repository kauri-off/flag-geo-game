// Typed client helpers for the online server's unary RPCs (AuthService +
// RoomService). These keep the same function shapes the online store already
// calls, but now speak Connect/gRPC-Web (see ./transport) instead of REST+fetch,
// and convert protobuf responses into the app's plain types (see ./protocol).
import { Code, ConnectError } from '@connectrpc/connect';
import {
  toLeaderboardRow,
  toRoomSummary,
  type LeaderboardRow,
  type RoomConfig,
  type RoomSummary,
} from './protocol';
import { auth, authClient, normalizeBase, roomClient } from './transport';

export { normalizeBase };

export interface ServerInfo {
  name: string;
  authRequired: boolean;
  guestsAllowed: boolean;
  maxPlayers: number;
  registrationEnabled: boolean;
}

export interface AuthedAccount {
  token: string;
  username: string;
  avatar: string;
}

/** Thrown when the server rejects our token (expired/invalid). The store uses
 *  this to send the user back to the login screen instead of stranding them. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** True when an error came from `call()` as an authentication failure. */
export function isAuthError(e: unknown): e is AuthError {
  return e instanceof AuthError;
}

/** Run a client call, normalising Connect errors into plain Errors with a
 *  human message (the store surfaces `.message` to the user). */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const err = ConnectError.from(e);
    if (err.code === Code.Unavailable || err.code === Code.Unknown) {
      throw new Error('Could not reach the server. Check the URL and that it is running.', {
        cause: e,
      });
    }
    if (err.code === Code.Unauthenticated) {
      throw new AuthError(err.rawMessage || err.message);
    }
    throw new Error(err.rawMessage || err.message, { cause: e });
  }
}

export function getInfo(base: string): Promise<ServerInfo> {
  return call(async () => {
    const r = await authClient(base).getInfo({});
    return {
      name: r.name,
      authRequired: r.authRequired,
      guestsAllowed: r.guestsAllowed,
      maxPlayers: r.maxPlayers,
      registrationEnabled: r.registrationEnabled,
    };
  });
}

export function postAuth(
  base: string,
  password?: string,
  nickname?: string,
): Promise<{ token: string }> {
  return call(async () => {
    const r = await authClient(base).auth({ password, nickname });
    return { token: r.token };
  });
}

export function postRegister(
  base: string,
  body: { username: string; password: string; avatar: string; serverPassword?: string },
): Promise<AuthedAccount> {
  return call(async () => {
    const r = await authClient(base).register(body);
    return { token: r.token, username: r.username, avatar: r.avatar };
  });
}

export function postLogin(
  base: string,
  body: { username: string; password: string },
): Promise<AuthedAccount> {
  return call(async () => {
    const r = await authClient(base).login(body);
    return { token: r.token, username: r.username, avatar: r.avatar };
  });
}

export function getRooms(base: string, token: string): Promise<{ rooms: RoomSummary[] }> {
  return call(async () => {
    const r = await roomClient(base).listRooms({}, auth(token));
    return { rooms: r.rooms.map(toRoomSummary) };
  });
}

export interface CreateRoomReq {
  nickname: string;
  avatar: string;
  config: RoomConfig;
  roomPassword?: string;
}

export function postCreateRoom(
  base: string,
  token: string,
  body: CreateRoomReq,
): Promise<{ code: string; roomToken: string; playerId: string }> {
  return call(async () => {
    const r = await roomClient(base).createRoom(body, auth(token));
    return { code: r.code, roomToken: r.roomToken, playerId: r.playerId };
  });
}

export function postJoin(
  base: string,
  token: string,
  code: string,
  body: { nickname: string; avatar: string; roomPassword?: string },
): Promise<{ roomToken: string; playerId: string }> {
  return call(async () => {
    const r = await roomClient(base).joinRoom({ code, ...body }, auth(token));
    return { roomToken: r.roomToken, playerId: r.playerId };
  });
}

export function getLeaderboard(base: string): Promise<{ top: LeaderboardRow[] }> {
  return call(async () => {
    const r = await roomClient(base).getLeaderboard({});
    return { top: r.top.map(toLeaderboardRow) };
  });
}
