// Throwaway end-to-end smoke test: two players race a 3-round match over WS.
// Usage: node scripts/ws-smoke.mjs [baseUrl]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const countries = JSON.parse(
  readFileSync(resolve(__dirname, '../src/data/countries.json'), 'utf8'),
);
const idByAlpha2 = new Map(countries.map((c) => [c.alpha2, c.id]));

const BASE = process.argv[2] || 'http://localhost:8099';
const wsBase = BASE.replace(/^http/, 'ws');

const post = async (path, body, token) => {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
};

function player(name, roomToken, { isHost, pickCorrect }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/ws?token=${roomToken}`);
    let finalScore = null;
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'hello', roomToken })));
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'welcome' && isHost) {
        setTimeout(() => ws.send(JSON.stringify({ type: 'startMatch' })), 300);
      }
      if (msg.type === 'roundStart') {
        const correctId = idByAlpha2.get(msg.alpha2) ?? '0';
        const countryId = pickCorrect ? correctId : '0';
        // small stagger so we exercise the scoreboard updates
        setTimeout(
          () => ws.send(JSON.stringify({ type: 'submitAnswer', roundIndex: msg.index, countryId })),
          pickCorrect ? 200 : 400,
        );
      }
      if (msg.type === 'roundResult') {
        const mine = msg.results.find((r) => true && r);
        console.log(`[${name}] round ${msg.index} result target=${msg.target_id ?? msg.targetId}`);
      }
      if (msg.type === 'matchResult') {
        const me = msg.standings.find((s) => s.nickname === name);
        finalScore = me ? me.score : null;
        console.log(`[${name}] MATCH OVER score=${finalScore} winner=${msg.winnerId}`);
        ws.close();
        resolve(finalScore);
      }
      if (msg.type === 'error') console.log(`[${name}] ERROR`, msg);
    });
    ws.addEventListener('error', reject);
    setTimeout(() => reject(new Error(`${name} timed out`)), 30000);
  });
}

const token = (await post('/auth', {})).token;
const { code, roomToken: hostToken } = await post(
  '/rooms',
  {
    nickname: 'Alice',
    avatar: 'US',
    config: { rounds: 3, timeLimitSec: 10, attempts: 1, difficulty: { continents: [], size: 'all' } },
  },
  token,
);
console.log('room', code);
const { roomToken: bobToken } = await post(
  `/rooms/${code}/join`,
  { nickname: 'Bob', avatar: 'FR' },
  token,
);

const [alice, bob] = await Promise.all([
  player('Alice', hostToken, { isHost: true, pickCorrect: true }),
  player('Bob', bobToken, { isHost: false, pickCorrect: false }),
]);

console.log(`\nResult: Alice=${alice} Bob=${bob}`);
if (alice > bob && alice > 0 && bob === 0) {
  console.log('PASS ✓ authoritative scoring (correct beats wrong)');
} else {
  console.log('FAIL ✗ unexpected scores');
  process.exit(1);
}
