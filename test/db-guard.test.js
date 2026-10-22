// The server creates its tables on boot, so it must refuse any database that is not its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../server/db.js';

test('a DATABASE_URL for another database is refused before connecting', async () => {
  // Port 9 is the discard port: if the guard let it through, this would fail with a connection error instead.
  process.env.DATABASE_URL = 'postgresql://someone:pw@127.0.0.1:9/railway';
  await assert.rejects(initDb(), /must point at the "ambassador" database/);
  delete process.env.DATABASE_URL;
});
