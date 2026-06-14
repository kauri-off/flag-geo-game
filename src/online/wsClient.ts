// Module-level WebSocket client for online play. A single live socket is kept
// here (not in a component) so navigating between tabs never drops the room
// connection. Incoming frames are validated and handed to the store; the socket
// auto-reconnects with backoff using the same room token (the server keeps the
// player's slot during a short grace window).
import type { ClientMsg, ServerMsg } from './protocol';

interface Handlers {
  onMessage: (msg: ServerMsg) => void;
  onStatus: (status: 'connecting' | 'open' | 'closed') => void;
  /** Called once we stop retrying after `maxAttempts` failed reconnects. */
  onGiveUp?: () => void;
}

// Cap reconnect attempts so a dead room/host doesn't loop forever. The backoff
// (capped at 15s) means ~8 tries spans roughly a minute — long enough to cover
// the server's reconnect grace window before we give up.
const MAX_ATTEMPTS = 8;

let socket: WebSocket | null = null;
let wsUrl = '';
let handlers: Handlers | null = null;
let shouldRun = false;
let attempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;

function clearTimers() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (heartbeat) clearInterval(heartbeat);
  reconnectTimer = undefined;
  heartbeat = undefined;
}

function open() {
  handlers?.onStatus('connecting');
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl);
  } catch {
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.addEventListener('open', () => {
    attempts = 0;
    handlers?.onStatus('open');
    heartbeat = setInterval(() => wsSend({ type: 'ping' }), 25_000);
  });

  ws.addEventListener('message', (ev) => {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
    } catch {
      return;
    }
    if (msg && typeof (msg as { type?: unknown }).type === 'string') {
      handlers?.onMessage(msg);
    }
  });

  ws.addEventListener('close', () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
    socket = null;
    handlers?.onStatus('closed');
    if (shouldRun) scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    // 'close' fires after 'error'; let it drive the reconnect.
    ws.close();
  });
}

function scheduleReconnect() {
  if (!shouldRun) return;
  attempts += 1;
  if (attempts > MAX_ATTEMPTS) {
    shouldRun = false;
    clearTimers();
    handlers?.onGiveUp?.();
    return;
  }
  const delay = Math.min(15_000, 500 * 2 ** Math.min(attempts, 5));
  reconnectTimer = setTimeout(open, delay);
}

/** Connect (or reconnect) to a room's WebSocket. Replaces any existing socket. */
export function wsConnect(url: string, h: Handlers) {
  wsClose();
  wsUrl = url;
  handlers = h;
  shouldRun = true;
  attempts = 0;
  open();
}

export function wsSend(msg: ClientMsg) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

/** Close the socket and stop reconnecting. */
export function wsClose() {
  shouldRun = false;
  clearTimers();
  if (socket) {
    try {
      socket.close();
    } catch {
      /* already closing */
    }
    socket = null;
  }
  handlers = null;
}
