// Connect (gRPC-Web) transport + typed clients for the online server. The base
// URL is whatever the player typed in the Online tab (it may include a subpath,
// e.g. https://host/flaggame); Connect appends the gRPC route
// (/flaggeo.v1.<Service>/<Method>) to it. Identity travels as an `authorization:
// Bearer <token>` header on each call (see `auth`), replacing the old WS query
// token + REST Authorization header.
import { createClient, type Client } from '@connectrpc/connect';
import { createGrpcWebTransport } from '@connectrpc/connect-web';
import { AuthService, GameService, RoomService } from './gen/flaggeo/v1/flaggeo_pb';

/** Strip a trailing slash so the appended gRPC route never doubles up. */
export function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function transport(base: string) {
  return createGrpcWebTransport({ baseUrl: normalizeBase(base) });
}

export function authClient(base: string): Client<typeof AuthService> {
  return createClient(AuthService, transport(base));
}

export function roomClient(base: string): Client<typeof RoomService> {
  return createClient(RoomService, transport(base));
}

export function gameClient(base: string): Client<typeof GameService> {
  return createClient(GameService, transport(base));
}

/** Per-call options that carry the Bearer token in `authorization` metadata. */
export function auth(token: string): { headers: Headers } {
  const headers = new Headers();
  headers.set('authorization', `Bearer ${token}`);
  return { headers };
}
