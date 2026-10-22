// One query() adapter over pg (RDS in production, DATABASE_URL) or PGlite (embedded Postgres for
// local dev and tests). Same pattern as lovepop-idea-lab's server/db.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The app creates its tables on boot, so it must never connect to someone else's database (a stray
// DATABASE_URL in a developer shell points at a shared prod server). Its own is always "ambassador".
const OWN_DATABASE = /^postgres(ql)?:\/\/[^/]+\/ambassador(\?|$)/;
let impl = null;
let mode = 'pglite';

export async function initDb() {
  if (impl) return impl;
  if (process.env.DATABASE_URL) {
    if (!OWN_DATABASE.test(process.env.DATABASE_URL)) throw new Error('DATABASE_URL must point at the "ambassador" database (unset it to use the embedded local one)');
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      // RDS needs TLS; a local server without it is addressed with ?sslmode=disable.
      ssl: /sslmode=disable|@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
      max: 8,
    });
    impl = { query: (sql, params) => pool.query(sql, params), exec: (sql) => pool.query(sql), close: () => pool.end() };
    mode = 'postgres';
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = process.env.PGLITE_DIR || path.join(process.cwd(), '.data', 'pglite');
    fs.mkdirSync(dir, { recursive: true });
    const db = new PGlite(dir);
    await db.waitReady;
    impl = { query: (sql, params) => db.query(sql, params), exec: (sql) => db.exec(sql), close: () => db.close() };
    mode = 'pglite';
  }
  await migrate();
  return impl;
}

export function dbMode() { return mode; }

export async function q(sql, params = []) {
  const result = await impl.query(sql, params);
  return result.rows;
}

export async function one(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0] || null;
}

export async function closeDb() {
  if (!impl) return;
  await impl.close();
  impl = null;
}

async function migrate() {
  await impl.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`);
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set((await q(`SELECT name FROM schema_migrations`)).map((r) => r.name));
  for (const file of files) {
    if (done.has(file)) continue;
    await impl.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
    await impl.query(`INSERT INTO schema_migrations(name) VALUES ($1)`, [file]);
    console.log(`[db] applied ${file}`);
  }
}
