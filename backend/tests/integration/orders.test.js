import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DECLINE_CARD,
  buildApp,
  createTestPool,
  migrate,
  orderBody,
  orderCount,
  resetDb,
  stockOf,
} from './helpers.js';

let pool;
let app;

beforeAll(async () => {
  pool = createTestPool();
  await migrate(pool);
  app = buildApp(pool);
});
afterAll(() => pool.end());
beforeEach(() => resetDb(pool));

const checkout = (body, key = randomUUID(), target = app) =>
  request(target).post('/api/orders').set('Idempotency-Key', key).send(body);

describe('POST /api/orders — happy path', () => {
  it('creates a PAID order, prices it from the DB and decrements stock', async () => {
    const res = await checkout(orderBody({ items: [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 1 }] }));

    expect(res.status).toBe(201);
    expect(res.headers['idempotent-replayed']).toBe('false');
    expect(res.body.status).toBe('PAID');
    expect(res.body.paymentRef).toMatch(/^mock_/);
    expect(res.body.cardLast4).toBe('4242');
    // 2 x 459900 + 1 x 129900 from the seed data
    expect(res.body.totalCents).toBe(2 * 459900 + 129900);
    expect(res.body.items).toHaveLength(2);
    expect(await stockOf(pool, 1)).toBe(38);
    expect(await stockOf(pool, 2)).toBe(59);
  });

  it('ignores any client-supplied price fields', async () => {
    const body = orderBody({ items: [{ productId: 1, quantity: 1, unitPriceCents: 1 }] });
    const res = await checkout(body);
    expect(res.status).toBe(201);
    expect(res.body.totalCents).toBe(459900);
  });

  it('can be fetched with GET /api/orders/:id', async () => {
    const created = await checkout(orderBody());
    const res = await request(app).get(`/api/orders/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.body.id, status: 'PAID', totalCents: created.body.totalCents });
  });

  it('never stores the full card number', async () => {
    await checkout(orderBody());
    const { rows } = await pool.query('SELECT row_to_json(o)::text AS j FROM orders o');
    expect(rows[0].j).not.toContain('4242424242424242');
  });
});

describe('POST /api/orders — idempotency', () => {
  it('replays the original order for a retried request with the same key', async () => {
    const key = randomUUID();
    const first = await checkout(orderBody(), key);
    const second = await checkout(orderBody(), key);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.id).toBe(first.body.id);
    expect(await orderCount(pool)).toBe(1);
    expect(await stockOf(pool, 1)).toBe(38); // stock taken only once
  });

  it('rejects the same key with a different payload (422)', async () => {
    const key = randomUUID();
    await checkout(orderBody(), key);
    const res = await checkout(orderBody({ items: [{ productId: 3, quantity: 1 }] }), key);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await orderCount(pool)).toBe(1);
  });

  it('creates exactly one order when 20 identical requests arrive concurrently', async () => {
    // Payment latency keeps the first request "in flight" while the rest arrive.
    const slowApp = buildApp(pool, { minLatencyMs: 150, maxLatencyMs: 150 });
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 20 }, () => checkout(orderBody(), key, slowApp)));
    const statuses = results.map((r) => r.status);

    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.every((s) => [201, 200, 409].includes(s))).toBe(true);
    for (const r of results.filter((x) => x.status === 409)) expect(r.body.error.code).toBe('IN_PROGRESS');
    expect(await orderCount(pool)).toBe(1);
    expect(await stockOf(pool, 1)).toBe(38);
  });

  it('requires a valid Idempotency-Key header', async () => {
    const missing = await request(app).post('/api/orders').send(orderBody());
    const invalid = await checkout(orderBody(), 'not-a-uuid');
    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
    expect(await orderCount(pool)).toBe(0);
  });
});

describe('POST /api/orders — stock', () => {
  it('returns 409 OUT_OF_STOCK and creates no order when stock is insufficient', async () => {
    // Product 12 (LED Desk Lamp) is seeded with stock 5.
    const res = await checkout(orderBody({ items: [{ productId: 1, quantity: 1 }, { productId: 12, quantity: 6 }] }));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OUT_OF_STOCK');
    expect(res.body.error.details).toEqual({ productId: 12, available: 5 });
    expect(await orderCount(pool)).toBe(0);
    expect(await stockOf(pool, 1)).toBe(40); // whole transaction rolled back
  });

  it('never oversells under concurrent checkouts of the last items', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => checkout(orderBody({ items: [{ productId: 12, quantity: 1 }] }))),
    );
    const ok = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 409);

    expect(ok).toHaveLength(5);
    expect(rejected).toHaveLength(7);
    expect(rejected.every((r) => r.body.error.code === 'OUT_OF_STOCK')).toBe(true);
    expect(await stockOf(pool, 12)).toBe(0);
    expect(await orderCount(pool)).toBe(5);
  });

  it('returns 404 for an unknown product', async () => {
    const res = await checkout(orderBody({ items: [{ productId: 999, quantity: 1 }] }));
    expect(res.status).toBe(404);
    expect(await orderCount(pool)).toBe(0);
  });
});

describe('POST /api/orders — payment', () => {
  it('records PAYMENT_FAILED, returns 402 and restores stock on decline', async () => {
    const body = orderBody({ payment: { cardNumber: DECLINE_CARD, expiry: '12/30', cvc: '123' } });
    const key = randomUUID();
    const res = await checkout(body, key);

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('PAYMENT_DECLINED');
    expect(res.body.order.status).toBe('PAYMENT_FAILED');
    expect(await stockOf(pool, 1)).toBe(40);

    // Retrying the same declined request replays the decline, not a new charge.
    const retry = await checkout(body, key);
    expect(retry.status).toBe(402);
    expect(retry.body.order.id).toBe(res.body.order.id);
    expect(await orderCount(pool)).toBe(1);
  });
});

describe('POST /api/orders — validation', () => {
  it.each([
    ['empty cart', { items: [] }],
    ['quantity above limit', { items: [{ productId: 1, quantity: 11 }] }],
    ['duplicate product lines', { items: [{ productId: 1, quantity: 1 }, { productId: 1, quantity: 2 }] }],
    ['bad email', { customer: { name: 'A', email: 'nope' } }],
    ['Luhn-invalid card', { payment: { cardNumber: '4242424242424241', expiry: '12/30', cvc: '123' } }],
    ['expired card', { payment: { cardNumber: '4242424242424242', expiry: '01/20', cvc: '123' } }],
  ])('rejects %s with 400', async (_label, override) => {
    const res = await checkout(orderBody(override));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('rejects malformed JSON', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json')
      .send('{"customer":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns 404 for an unknown order id and 400 for a malformed one', async () => {
    expect((await request(app).get(`/api/orders/${randomUUID()}`)).status).toBe(404);
    expect((await request(app).get('/api/orders/123')).status).toBe(400);
  });
});
