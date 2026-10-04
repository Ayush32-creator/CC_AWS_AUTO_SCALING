import fs from 'node:fs/promises';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from '../../src/db/migrate.js';
import { buildApp, createTestPool, migrate, resetDb, silentLogger } from './helpers.js';

let pool;
let app;

beforeAll(async () => {
  pool = createTestPool();
  await migrate(pool);
  app = buildApp(pool);
});
afterAll(() => pool.end());
beforeEach(() => resetDb(pool));

describe('health endpoints', () => {
  it('GET /api/health is OK without touching the DB', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /api/health/ready reports the DB as reachable', async () => {
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', database: 'ok' });
  });

  it('GET /api/health/ready returns 503 when the DB is unreachable', async () => {
    const brokenPool = { query: () => Promise.reject(new Error('connection refused')) };
    const res = await request(buildApp(brokenPool)).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DB_UNAVAILABLE');
  });

  it('GET /api/instance returns "local" off AWS', async () => {
    const res = await request(app).get('/api/instance');
    expect(res.body).toEqual({ instanceId: 'local', availabilityZone: 'local', version: 'test' });
  });

  it('unknown API routes return a JSON 404', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('products', () => {
  it('lists products with pagination', async () => {
    const res = await request(app).get('/api/products?page=2&limit=5');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 2, limit: 5, total: 12 });
    expect(res.body.items.map((p) => p.id)).toEqual([6, 7, 8, 9, 10]);
  });

  it('rejects an out-of-range limit', async () => {
    const res = await request(app).get('/api/products?limit=500');
    expect(res.status).toBe(400);
  });

  it('gets a single product, 404 if missing, 400 if malformed', async () => {
    const ok = await request(app).get('/api/products/1');
    expect(ok.body).toMatchObject({ id: 1, sku: 'KB-MECH-01', priceCents: 459900, stock: 40 });
    expect((await request(app).get('/api/products/999')).status).toBe(404);
    expect((await request(app).get('/api/products/abc')).status).toBe(400);
  });
});

describe('POST /api/cart/quote', () => {
  it('prices the cart from the DB and warns about insufficient stock', async () => {
    const res = await request(app)
      .post('/api/cart/quote')
      .send({ items: [{ productId: 2, quantity: 3 }, { productId: 12, quantity: 6 }] });

    expect(res.status).toBe(200);
    expect(res.body.subtotalCents).toBe(3 * 129900 + 6 * 189900);
    expect(res.body.items[1]).toMatchObject({ productId: 12, available: false, stock: 5 });
    expect(res.body.warnings).toEqual(["Only 5 left of 'LED Desk Lamp'"]);
  });

  it('returns 404 listing missing products', async () => {
    const res = await request(app).post('/api/cart/quote').send({ items: [{ productId: 404, quantity: 1 }] });
    expect(res.status).toBe(404);
    expect(res.body.error.details).toEqual({ missing: [404] });
  });
});

describe('migrations', () => {
  it('are idempotent and safe to run concurrently (advisory lock)', async () => {
    await Promise.all([runMigrations(pool, silentLogger), runMigrations(pool, silentLogger), runMigrations(pool, silentLogger)]);
    const { rows } = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
    const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    expect(files).toEqual(['001_init.sql', '002_seed.sql', '003_pending_order_expiry.sql']);
    expect(rows.map((r) => r.version)).toEqual(files); // each applied exactly once
  });
});
