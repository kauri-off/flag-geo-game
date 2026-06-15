// Module-level client for online play over Connect/gRPC-Web. The server->client
// event stream (`GameService.PlayEvents`) replaces the old WebSocket receive
// side; client->server actions are individual unary RPCs (the `send*` helpers
// below) replacing the old `wsSend` frames. A single live stream is kept here
// (not in a component) so navigating between tabs never drops the room
// connection. The stream auto-reconnects with backoff using the same room token
// (the server keeps the player's slot during a short grace window).
import { auth, gameClient } from './transport';
import type { RoomConfig } from './protocol';
import type { ServerEvent } from './gen/flaggeo/v1/flaggeo_pb';

interface Handlers {
  onEvent: (event: ServerEvent) => void;
  onStatus: (status: 'connecting' | 'open' | 'closed') => void;
  /** Called once we stop retrying after `MAX_ATTEMPTS` failed reconnects. */
  onGiveUp?: () => void;
}

// Cap reconnect attempts so a dead room/host doesn't loop forever. The backoff
// (capped at 15s) means ~8 tries spans roughly a minute — long enough to cover
// the server's reconnect grace window before we give up.
const MAX_ATTEMPTS = 8;

let base = '';
let token = '';
let handlers: Handlers | null = null;
let shouldRun = false;
let attempts = 0;
let abort: AbortController | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let wakeReconnect: (() => void) | undefined;

function clearReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  wakeReconnect = undefined;
}

/** Sleep that resolves early if `streamClose` is called mid-backoff. */
function backoff(ms: number): Promise<void> {
  return new Promise((resolve) => {
    wakeReconnect = resolve;
    reconnectTimer = setTimeout(resolve, ms);
  });
}

async function run() {
  while (shouldRun) {
    handlers?.onStatus('connecting');
    abort = new AbortController();
    let opened = false;
    try {
      const stream = gameClient(base).playEvents({}, { headers: auth(token).headers, signal: abort.signal });
      for await (const event of stream) {
        if (!opened) {
          opened = true;
          attempts = 0;
          handlers?.onStatus('open');
        }
        handlers?.onEvent(event);
      }
    } catch {
      // Aborted by us, transport dropped, or the server closed the stream — all
      // fall through to the reconnect path below.
    }
    if (!shouldRun) return;

    handlers?.onStatus('closed');
    attempts += 1;
    if (attempts > MAX_ATTEMPTS) {
      shouldRun = false;
      const giveUp = handlers?.onGiveUp;
      giveUp?.();
      return;
    }
    const delay = Math.min(15_000, 500 * 2 ** Math.min(attempts, 5));
    await backoff(delay);
    clearReconnect();
  }
}

/** Open (or reopen) a room's event stream. Replaces any existing stream. */
export function streamConnect(serverBase: string, roomToken: string, h: Handlers) {
  streamClose();
  base = serverBase;
  token = roomToken;
  handlers = h;
  shouldRun = true;
  attempts = 0;
  void run();
}

/** Close the stream and stop reconnecting. */
export function streamClose() {
  shouldRun = false;
  clearReconnect();
  wakeReconnect?.();
  if (abort) {
    abort.abort();
    abort = null;
  }
  handlers = null;
}

// --- client -> server actions (fire-and-forget unary calls) ----------------
// These mirror the old `wsSend` semantics: best-effort, errors swallowed (hard
// failures such as a lost seat surface via the event stream / reconnect path).

function send(p: Promise<unknown>) {
  void p.catch(() => {});
}

export function sendSetProfile(nickname: string, avatar: string) {
  if (token) send(gameClient(base).setProfile({ nickname, avatar }, auth(token)));
}

export function sendUpdateConfig(config: RoomConfig) {
  if (token) send(gameClient(base).updateConfig({ config }, auth(token)));
}

export function sendTransferHost(playerId: string) {
  if (token) send(gameClient(base).transferHost({ playerId }, auth(token)));
}

export function sendKickPlayer(playerId: string) {
  if (token) send(gameClient(base).kickPlayer({ playerId }, auth(token)));
}

export function sendStartMatch() {
  if (token) send(gameClient(base).startMatch({}, auth(token)));
}

export function sendSubmitAnswer(roundIndex: number, countryId: string) {
  if (token) send(gameClient(base).submitAnswer({ roundIndex, countryId }, auth(token)));
}

export function sendChat(text: string) {
  if (token) send(gameClient(base).sendChat({ text }, auth(token)));
}

export function sendLeaveRoom() {
  if (token) send(gameClient(base).leaveRoom({}, auth(token)));
}
