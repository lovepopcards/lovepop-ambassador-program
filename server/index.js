import { createApp } from './app.js';
import { authConfigProblems, authModeOf } from './auth.js';
import { dbMode, initDb } from './db.js';
import { mediaStoreFromEnv } from './mediaStore.js';

const PORT = Number(process.env.PORT || 3001);

const authProblems = authConfigProblems();
if (authProblems.length) {
  console.error(`[auth] refusing to start: ${authProblems.join('; ')}`);
  process.exit(1);
}

await initDb();
const mediaStore = mediaStoreFromEnv();
createApp({ env: process.env, mediaStore }).listen(PORT, () => {
  console.log(`[ambassador] listening on :${PORT} db=${dbMode()} uploads=${mediaStore.kind} auth=${authModeOf(process.env)} commit=${process.env.APP_COMMIT || 'dev'}`);
});
