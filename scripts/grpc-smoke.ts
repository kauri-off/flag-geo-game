// Throwaway end-to-end smoke test over Connect/gRPC-Web: two guests race a short
// match. Exercises AuthService, RoomService and the GameService stream + actions.
// Usage: node scripts/grpc-smoke.ts [baseUrl]   (Node 23+ runs TS directly)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@connectrpc/connect';
import { createGrpcWebTransport } from '@connectrpc/connect-web';
import {
  AuthService,
  GameService,
  RoomService,
} from '../src/online/gen/flaggeo/v1/flaggeo_pb.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const countries: { id: string; alpha2: string }[] = JSON.parse(
  readFileSync(resolve(__dirname, '../src/data/countries.json'), 'utf8'),
);
const idByAlpha2 = new Map(countries.map((c) => [c.alpha2, c.id]));

const BASE = process.argv[2] || 'http://localhost:8099';
const transport = createGrpcWebTransport({ baseUrl: BASE });
const authc = createClient(AuthService, transport);
const roomc = createClient(RoomService, transport);
const gamec = createClient(GameService, transport);
const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

async function play(token: string, label: string): Promise<boolean> {
  let sawRound = false;
  for await (const ev of gamec.playEvents({}, bearer(token))) {
    const p = ev.payload;
    if (p.case === 'welcome') console.log(`[${label}] welcome as ${p.value.playerId}`);
    else if (p.case === 'roundStart') {
      sawRound = true;
      const countryId = idByAlpha2.get(p.value.alpha2) ?? '';
      await gamec.submitAnswer({ roundIndex: p.value.index, countryId }, bearer(token));
    } else if (p.case === 'matchResult') {
      console.log(`[${label}] matchResult: winner=${p.value.winnerId}`);
      return sawRound;
    } else if (p.case === 'error') {
      console.log(`[${label}] error: ${p.value.code} ${p.value.message}`);
    }
  }
  return sawRound;
}

async function main() {
  const info = await authc.getInfo({});
  console.log(`server="${info.name}" guests=${info.guestsAllowed}`);

  const a = (await authc.auth({})).token;
  const b = (await authc.auth({})).token;

  const created = await roomc.createRoom(
    {
      nickname: 'Alice',
      avatar: 'US',
      config: {
        rounds: 3,
        timeLimitSec: 5,
        attempts: 1,
        difficulty: { continents: [], size: 'all', scope: 'all' },
        registeredOnly: false,
      },
    },
    bearer(a),
  );
  console.log(`created room ${created.code}`);

  const joined = await roomc.joinRoom({ code: created.code, nickname: 'Bob', avatar: 'FR' }, bearer(b));

  const pa = play(created.roomToken, 'A');
  const pb = play(joined.roomToken, 'B');
  await new Promise((r) => setTimeout(r, 500)); // let both streams attach
  await gamec.startMatch({}, bearer(created.roomToken));

  const guard = setTimeout(() => {
    console.error('TIMEOUT: match did not finish');
    process.exit(1);
  }, 30_000);
  const [ra, rb] = await Promise.all([pa, pb]);
  clearTimeout(guard);

  if (ra && rb) {
    console.log('SMOKE OK');
    process.exit(0);
  }
  console.error('SMOKE FAILED: a player never saw a round');
  process.exit(1);
}

main().catch((e) => {
  console.error('SMOKE ERROR:', e);
  process.exit(1);
});
