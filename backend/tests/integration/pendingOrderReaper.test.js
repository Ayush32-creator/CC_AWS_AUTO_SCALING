import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { hashCheckoutRequest } from '../../src/lib/requestHash.js';
import { createInstanceMetadata } from '../../src/lib/instanceMetadata.js';
import { EXPIRY_REASON, createPendingOrderReaper } from '../../src/services/pendingOrderReaper.js';
import { buildApp, createTestPool, migrate, orderBody, orderCount, resetDb, silentLogger, stockOf } from './helpers.js';

const TIMEOUT = 600; // seconds, the production default

let pool;
let app;
let reaper;

beforeAll(async () => {
  pool = createTestPool();
  await migrate(pool);
  app = buildApp(pool);
  reaper = createPendingOrderReaper({ pool, logger: silentLogger, timeoutSeconds: TIMEOUT, batchSize: 100 });
});
afterAll(() => pool.end());
beforeEach(() => resetDb(pool));

/**
 * Reproduce exactly what checkout TX1 leaves behind when the instance dies
 * before TX2: a PENDING order whose stock is already reserved.
 */
async function createPendingOrder({ ageSeconds, body = orderBody(), key = randomUUID() }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO orders (idempotency_key, request_hash, customer_name, customer_email, total_cents, card_last4, created_at)
       VALUES ($1, $2, $3, $4, 0, $5, now() - make_interval(secs => $6)) RETURNING id`,
      [key, hashCheckoutRequest(body), body.customer.name, body.customer.email, '4242', ageSeconds],
    );
    let total = 0;
    for (const { productId, quantity } of [...body.items].sort((a, b) => a.productId - b.productId)) {
      const p = await client.query(
        'UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2 RETURNING price_cents',
        [productId, quantity],
      );
      total += p.rows[0].price_cents * quantity;
      await client.query(
        'INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES ($1, $2, $3, $4)',
        [rows[0].id, productId, quantity, p.rows[0].price_cents],
      );
    }
    await client.query('UPDATE orders SET total_cents = $2 WHERE id = $1', [rows[0].id, total]);
    await client.query('COMMIT');
    return { id: rows[0].id, key, body };
  } finally {
    client.release();
  }
}

async function orderRow(id) {
  const { rows } = await pool.query('SELECT status, status_reason, updated_at FROM orders WHERE id = $1', [id]);
  return rows[0];
}

describe('pending-order reaper: which orders it touches', () => {
  it('leaves a fresh PENDING order alone', async () => {
    const fresh = await createPendingOrder({ ageSeconds: 5 });
    expect(await stockOf(pool, 1)).toBe(38);

    const expired = await reaper.expireStaleOrders();

    expect(expired).toEqual([]);
    expect((await orderRow(fresh.id)).status).toBe('PENDING');
    expect(await stockOf(pool, 1)).toBe(38);
  });

  it('leaves a PENDING order just inside the timeout alone', async () => {
    const almost = await createPendingOrder({ ageSeconds: TIMEOUT - 30 });
    expect(await reaper.expireStaleOrders()).toEqual([]);
    expect((await orderRow(almost.id)).status).toBe('PENDING');
  });

  it('expires a stale PENDING order with a reason', async () => {
    const stale = await createPendingOrder({ ageSeconds: TIMEOUT + 60 });

    const expired = await reaper.expireStaleOrders();

    expect(expired).toHaveLength(1);
    expect(expired[0].id).toBe(stale.id);
    expect(expired[0].ageSeconds).toBeGreaterThanOrEqual(TIMEOUT + 60);
    const row = await orderRow(stale.id);
    expect(row.status).toBe('EXPIRED');
    expect(row.status_reason).toBe(EXPIRY_REASON);
  });

  it('never modifies PAID or PAYMENT_FAILED orders, however old', async () => {
    const paid = await request(app).post('/api/orders').set('Idempotency-Key', randomUUID()).send(orderBody());
    const declined = await request(app)
      .post('/api/orders')
      .set('Idempotency-Key', randomUUID())
      .send(orderBody({ items: [{ productId: 2, quantity: 1 }], payment: { cardNumber: '4000000000000002', expiry: '12/30', cvc: '123' } }));
    expect(paid.body.status).toBe('PAID');
    expect(declined.body.order.status).toBe('PAYMENT_FAILED');
    await pool.query("UPDATE orders SET created_at = now() - interval '1 day'");
    const before = await pool.query('SELECT id, status, updated_at FROM orders ORDER BY id');
    const stockBefore = [await stockOf(pool, 1), await stockOf(pool, 2)];

    expect(await reaper.expireStaleOrders()).toEqual([]);

    const after = await pool.query('SELECT id, status, updated_at FROM orders ORDER BY id');
    expect(after.rows).toEqual(before.rows);
    expect([await stockOf(pool, 1), await stockOf(pool, 2)]).toEqual(stockBefore);
  });
});

describe('pending-order reaper: stock restoration', () => {
  it('restores the reserved stock of every item', async () => {
    await createPendingOrder({
      ageSeconds: TIMEOUT + 60,
      body: orderBody({ items: [{ productId: 1, quantity: 3 }, { productId: 2, quantity: 2 }] }),
    });
    expect(await stockOf(pool, 1)).toBe(37);
    expect(await stockOf(pool, 2)).toBe(58);

    await reaper.expireStaleOrders();

    expect(await stockOf(pool, 1)).toBe(40);
    expect(await stockOf(pool, 2)).toBe(60);
  });

  it('restores stock correctly when several stale orders share a product', async () => {
    await createPendingOrder({ ageSeconds: TIMEOUT + 60, body: orderBody({ items: [{ productId: 1, quantity: 2 }] }) });
    await createPendingOrder({ ageSeconds: TIMEOUT + 90, body: orderBody({ items: [{ productId: 1, quantity: 5 }] }) });
    const fresh = await createPendingOrder({ ageSeconds: 1, body: orderBody({ items: [{ productId: 1, quantity: 1 }] }) });
    expect(await stockOf(pool, 1)).toBe(32);

    const expired = await reaper.expireStaleOrders();

    expect(expired).toHaveLength(2);
    expect(await stockOf(pool, 1)).toBe(39); // the fresh order keeps its 1 unit
    expect((await orderRow(fresh.id)).status).toBe('PENDING');
  });

  it('is idempotent: running it again restores nothing a second time', async () => {
    const stale = await createPendingOrder({ ageSeconds: TIMEOUT + 60 });
    expect(await reaper.expireStaleOrders()).toHaveLength(1);
    const firstUpdate = (await orderRow(stale.id)).updated_at;

    expect(await reaper.expireStaleOrders()).toEqual([]);
    expect(await reaper.expireStaleOrders()).toEqual([]);

    expect(await stockOf(pool, 1)).toBe(40);
    expect((await orderRow(stale.id)).updated_at).toEqual(firstUpdate);
  });
});

describe('pending-order reaper: concurrency', () => {
  it('concurrent reapers process each stale order exactly once', async () => {
    // 20 stale orders, 1 unit of product 3 each (seed stock 25).
    const startStock = await stockOf(pool, 3);
    const stale = [];
    for (let i = 0; i < 20; i += 1) {
      stale.push(await createPendingOrder({ ageSeconds: TIMEOUT + 60 + i, body: orderBody({ items: [{ productId: 3, quantity: 1 }] }) }));
    }
    expect(await stockOf(pool, 3)).toBe(startStock - 20);

    // 8 "instances" with small batches race for the same orders.
    const reapers = Array.from({ length: 8 }, () =>
      createPendingOrderReaper({ pool, logger: silentLogger, timeoutSeconds: TIMEOUT, batchSize: 3 }),
    );
    const results = await Promise.all(reapers.flatMap((r) => [r.expireStaleOrders(), r.expireStaleOrders()]));
    // Whatever is left after the race (if any batch was skipped) is picked up by later runs.
    while ((await reaper.expireStaleOrders()).length > 0);

    const claimed = results.flat().map((o) => o.id);
    expect(new Set(claimed).size).toBe(claimed.length); // no order claimed twice
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM orders WHERE status = 'EXPIRED'");
    expect(rows[0].n).toBe(20);
    expect(await stockOf(pool, 3)).toBe(startStock); // restored exactly once per order
  });

  it('skips an order whose checkout is finishing right now (row locked)', async () => {
    const stale = await createPendingOrder({ ageSeconds: TIMEOUT + 60 });
    const tx2 = await pool.connect();
    try {
      // Simulate checkout TX2 holding the order row.
      await tx2.query('BEGIN');
      await tx2.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [stale.id]);

      expect(await reaper.expireStaleOrders()).toEqual([]); // skipped, not blocked

      await tx2.query("UPDATE orders SET status = 'PAID', payment_ref = 'mock_x' WHERE id = $1", [stale.id]);
      await tx2.query('COMMIT');
    } finally {
      tx2.release();
    }
    expect(await reaper.expireStaleOrders()).toEqual([]);
    expect((await orderRow(stale.id)).status).toBe('PAID');
    expect(await stockOf(pool, 1)).toBe(38); // the sale stands
  });

  it('runOnce never overlaps itself on one instance', async () => {
    await createPendingOrder({ ageSeconds: TIMEOUT + 60 });
    const [a, b] = [reaper.runOnce(), reaper.runOnce()];
    expect(a).toBe(b);
    await a;
    expect(await stockOf(pool, 1)).toBe(40);
  });
});

describe('checkout behaviour with the reaper in place', () => {
  it('normal checkout still works while the reaper runs', async () => {
    const stale = await createPendingOrder({ ageSeconds: TIMEOUT + 60, body: orderBody({ items: [{ productId: 2, quantity: 1 }] }) });
    const [res] = await Promise.all([
      request(app).post('/api/orders').set('Idempotency-Key', randomUUID()).send(orderBody()),
      reaper.runOnce(),
    ]);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PAID');
    expect(res.body.statusReason).toBeNull();
    expect(await stockOf(pool, 1)).toBe(38);
    expect(await stockOf(pool, 2)).toBe(60); // stale order's unit released
    expect((await orderRow(stale.id)).status).toBe('EXPIRED');
  });

  it('existing idempotent replay of a PAID order is unchanged', async () => {
    const key = randomUUID();
    const first = await request(app).post('/api/orders').set('Idempotency-Key', key).send(orderBody());
    await reaper.expireStaleOrders();
    const second = await request(app).post('/api/orders').set('Idempotency-Key', key).send(orderBody());

    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.id).toBe(first.body.id);
    expect(await stockOf(pool, 1)).toBe(38);
  });

  it('a PENDING checkout replayed before the timeout still gets 409 IN_PROGRESS', async () => {
    const pending = await createPendingOrder({ ageSeconds: 5 });
    await reaper.expireStaleOrders();

    const res = await request(app).post('/api/orders').set('Idempotency-Key', pending.key).send(pending.body);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IN_PROGRESS');
  });

  it('replaying the key of an expired checkout returns 409 CHECKOUT_EXPIRED and creates nothing', async () => {
    const stale = await createPendingOrder({ ageSeconds: TIMEOUT + 60 });
    await reaper.expireStaleOrders();
    const ordersBefore = await orderCount(pool);

    const res = await request(app).post('/api/orders').set('Idempotency-Key', stale.key).send(stale.body);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CHECKOUT_EXPIRED');
    expect(res.body.error.details.orderId).toBe(stale.id);
    expect(await orderCount(pool)).toBe(ordersBefore);
    expect(await stockOf(pool, 1)).toBe(40); // nothing reserved again
  });

  it('GET /api/orders/:id shows EXPIRED with its reason and no payment data', async () => {
    const stale = await createPendingOrder({ ageSeconds: TIMEOUT + 60 });
    await reaper.expireStaleOrders();

    const res = await request(app).get(`/api/orders/${stale.id}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('EXPIRED');
    expect(res.body.statusReason).toBe(EXPIRY_REASON);
    expect(JSON.stringify(res.body)).not.toContain('4242424242424242');
  });

  it('if the order expires while payment is in flight, the checkout fails cleanly and stock is released once', async () => {
    const key = randomUUID();
    // A payment provider that is "slow": while it runs, the order ages past
    // the timeout and a reaper on another instance expires it.
    const slowPayment = {
      async charge() {
        await pool.query("UPDATE orders SET created_at = now() - interval '1 hour' WHERE idempotency_key = $1", [key]);
        await reaper.expireStaleOrders();
        return { approved: true, reference: 'mock_late' };
      },
    };
    const slowApp = createApp({
      pool,
      logger: silentLogger,
      payment: slowPayment,
      instanceMetadata: createInstanceMetadata({ enabled: false, appVersion: 'test' }),
    });

    const res = await request(slowApp).post('/api/orders').set('Idempotency-Key', key).send(orderBody());

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CHECKOUT_EXPIRED');
    const { rows } = await pool.query('SELECT status, payment_ref FROM orders WHERE idempotency_key = $1', [key]);
    expect(rows[0]).toEqual({ status: 'EXPIRED', payment_ref: null }); // TX2 did not overwrite EXPIRED
    expect(await stockOf(pool, 1)).toBe(40); // released exactly once
  });
});
