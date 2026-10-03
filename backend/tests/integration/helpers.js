// Shared setup for integration tests. They run against the real PostgreSQL
// from docker compose, using the separate `checkout_test` database.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';

import { createApp } from '../../src/app.js';
import { MIGRATIONS_DIR, runMigrations } from '../../src/db/migrate.js';
import { createPool } from '../../src/db/pool.js';
import { createInstanceMetadata } from '../../src/lib/instanceMetadata.js';
import { createMockPayment } from '../../src/payment/mockPayment.js';

const ROOT_ENV = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');

function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  try {
    process.loadEnvFile(ROOT_ENV); // reuse the docker compose credentials
  } catch {
    throw new Error('Set TEST_DATABASE_URL or create the root .env file (see .env.example)');
  }
  const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_PORT = '5433' } = process.env;
  return `postgres://${POSTGRES_USER}:${encodeURIComponent(POSTGRES_PASSWORD)}@localhost:${POSTGRES_PORT}/checkout_test`;
}

export const silentLogger = pino({ level: 'silent' });

export function createTestPool() {
  return createPool({ connectionString: testDatabaseUrl(), poolMax: 20 }, silentLogger);
}

export async function migrate(pool) {
  await runMigrations(pool, silentLogger);
}

/** Empty all tables and reload the seed catalogue (ids 1..12, original stock). */
export async function resetDb(pool) {
  await pool.query('TRUNCATE order_items, orders, products RESTART IDENTITY CASCADE');
  await pool.query(await fs.readFile(path.join(MIGRATIONS_DIR, '002_seed.sql'), 'utf8'));
}

export function buildApp(pool, { minLatencyMs = 0, maxLatencyMs = 0 } = {}) {
  return createApp({
    pool,
    logger: silentLogger,
    payment: createMockPayment({ minLatencyMs, maxLatencyMs }),
    instanceMetadata: createInstanceMetadata({ enabled: false, appVersion: 'test' }),
  });
}

export const VALID_CARD = '4242424242424242';
export const DECLINE_CARD = '4000000000000002';

export function orderBody(overrides = {}) {
  return {
    customer: { name: 'Asha Rao', email: 'asha@example.com' },
    items: [{ productId: 1, quantity: 2 }],
    payment: { cardNumber: VALID_CARD, expiry: '12/30', cvc: '123' },
    ...overrides,
  };
}

export async function stockOf(pool, productId) {
  const { rows } = await pool.query('SELECT stock FROM products WHERE id = $1', [productId]);
  return rows[0].stock;
}

export async function orderCount(pool) {
  const { rows } = await pool.query('SELECT count(*) AS n FROM orders');
  return rows[0].n;
}
