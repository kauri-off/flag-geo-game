// Typed REST helpers for the online server. The base URL is whatever the player
// typed in the Online tab (may include a subpath, e.g. https://host/flaggame);
// all endpoints are appended to it.
import type { RoomConfig, RoomSummary, LeaderboardRow } from './protocol';

/** Protocol version this client speaks; must match the server's `/info`. */
export const CLIENT_PROTOCOL = 1;

export interface ServerInfo {
  name: string;
  authRequired: boolean;
  maxPlayers: number;
  protocol: number;
}

/** Strip a trailing slash so `${base}/info` never doubles up. */
export function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** ws(s):// base derived from the http(s):// server URL. */
export function wsBase(base: string): string {
  return normalizeBase(base).replace(/^http/i, (m) => (m.toLowerCase() === 'http' ? 'ws' : m)).replace(/^https/i, 'wss');
}

async function request<T>(
  base: string,
  path: string,
  init?: RequestInit & { token?: string },
): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (init?.body) headers['content-type'] = 'application/json';
  if (init?.token) headers['authorization'] = `Bearer ${init.token}`;

  let res: Response;
  try {
    res = await fetch(normalizeBase(base) + path, { ...init, headers });
  } catch {
    throw new Error('Could not reach the server. Check the URL and that it is running.');
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function getInfo(base: string): Promise<ServerInfo> {
  return request<ServerInfo>(base, '/info');
}

export function postAuth(base: string, password?: string): Promise<{ token: string }> {
  return request(base, '/auth', { method: 'POST', body: JSON.stringify({ password }) });
}

export function getRooms(base: string, token: string): Promise<{ rooms: RoomSummary[] }> {
  return request(base, '/rooms', { token });
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
  return request(base, '/rooms', { method: 'POST', token, body: JSON.stringify(body) });
}

export function postJoin(
  base: string,
  token: string,
  code: string,
  body: { nickname: string; avatar: string; roomPassword?: string },
): Promise<{ roomToken: string; playerId: string }> {
  return request(base, `/rooms/${encodeURIComponent(code)}/join`, {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });
}

export function getLeaderboard(base: string): Promise<{ top: LeaderboardRow[] }> {
  return request(base, '/leaderboard');
}
