// Module-level client for the browse view's push feed (`RoomService.WatchLobby`).
// While the player is in the browse view a single server-stream stays open and
// pushes a fresh room list / leaderboard whenever either changes server-side.
// Mirrors `eventStream.ts` (the per-room game stream) but authenticates with the
// *session* token, not the room token, and auto-reconnects with the same capped
// backoff.
import { auth, roomClient } from './transport';
import { toLeaderboardRow, toRoomSummary, type LeaderboardRow, type RoomSummary } from './protocol';

interface Handlers {
  onRooms: (rooms: RoomSummary[]) => void;
  onLeaderboard: (leaderboard: LeaderboardRow[]) => void;
}

// Same backoff envelope as eventStream: ~8 tries over roughly a minute before
// giving up. The lobby is non-critical, so on give-up we simply stop (the manual
// reconnect path is just reopening the browse view).
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

/** Sleep that resolves early if `lobbyClose` is called mid-backoff. */
function backoff(ms: number): Promise<void> {
  return new Promise((resolve) => {
    wakeReconnect = resolve;
    reconnectTimer = setTimeout(resolve, ms);
  });
}

async function run() {
  while (shouldRun) {
    abort = new AbortController();
    let opened = false;
    try {
      const stream = roomClient(base).watchLobby(
        {},
        { headers: auth(token).headers, signal: abort.signal },
      );
      for await (const event of stream) {
        if (!opened) {
          opened = true;
          attempts = 0;
        }
        const p = event.payload;
        if (p.case === 'rooms') handlers?.onRooms(p.value.rooms.map(toRoomSummary));
        else if (p.case === 'leaderboard') handlers?.onLeaderboard(p.value.top.map(toLeaderboardRow));
      }
    } catch {
      // Aborted by us, transport dropped, or the server closed the stream — all
      // fall through to the reconnect path below.
    }
    if (!shouldRun) return;

    attempts += 1;
    if (attempts > MAX_ATTEMPTS) {
      shouldRun = false;
      return;
    }
    const delay = Math.min(15_000, 500 * 2 ** Math.min(attempts, 5));
    await backoff(delay);
    clearReconnect();
  }
}

/** Open (or reopen) the browse-view lobby stream. Replaces any existing one. */
export function lobbyConnect(serverBase: string, sessionToken: string, h: Handlers) {
  lobbyClose();
  base = serverBase;
  token = sessionToken;
  handlers = h;
  shouldRun = true;
  attempts = 0;
  void run();
}

/** Close the stream and stop reconnecting. */
export function lobbyClose() {
  shouldRun = false;
  clearReconnect();
  wakeReconnect?.();
  if (abort) {
    abort.abort();
    abort = null;
  }
  handlers = null;
}
