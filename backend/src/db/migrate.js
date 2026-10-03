// Minimal forward-only SQL migration runner.
//
// Several EC2 instances may boot at the same time and all try to migrate, so
// the whole run is guarded by a PostgreSQL advisory lock: one instance applies
// pending files, the others wait and then find nothing left to do.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');
const ADVISORY_LOCK_ID = 727274; // arbitrary constant shared by all instances

export async function runMigrations(pool, logger = console) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.version));
    const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger.info?.({ migration: file }, 'Applied migration');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`, { cause: err });
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]).catch(() => {});
    client.release();
  }
}

export { MIGRATIONS_DIR };

// Allow `npm run migrate` to be executed directly.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { loadConfig } = await import('../config.js');
  const { createPool } = await import('./pool.js');
  const pool = createPool(loadConfig().db, console);
  try {
    await runMigrations(pool);
    console.log('Migrations complete');
  } finally {
    await pool.end();
  }
}
