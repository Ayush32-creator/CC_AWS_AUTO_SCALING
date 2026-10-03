import fs from 'node:fs';
import pg from 'pg';
import { createSecretPasswordProvider } from './secretPassword.js';

// Return BIGINT/NUMERIC counts as JS numbers (values here stay well below 2^53).
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number.parseInt(v, 10));

export function createPool(dbConfig, logger) {
  const ssl = dbConfig.ssl
    ? {
        rejectUnauthorized: true,
        ca: dbConfig.sslCaPath ? fs.readFileSync(dbConfig.sslCaPath, 'utf8') : undefined,
      }
    : false;

  const pool = new pg.Pool({
    connectionString: dbConfig.connectionString,
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.secretArn
      ? createSecretPasswordProvider({ secretArn: dbConfig.secretArn, region: dbConfig.awsRegion })
      : dbConfig.password,
    ssl,
    max: dbConfig.poolMax,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    // Fail fast instead of piling up requests behind a slow query.
    statement_timeout: 10000,
  });

  // An idle client erroring (e.g. DB restart) must not crash the process.
  pool.on('error', (err) => logger?.error({ err }, 'Unexpected idle PostgreSQL client error'));
  return pool;
}

/** Run `fn` inside a transaction, committing on success and rolling back on error. */
export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
