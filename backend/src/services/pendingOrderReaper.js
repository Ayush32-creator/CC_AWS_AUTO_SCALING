// Pending-order reaper: releases stock held by orders stuck in PENDING.
//
// An order is PENDING only between TX1 (reserve stock) and TX2 (record the
// payment result) of a checkout, normally well under a second. If the
// instance dies in between, nothing else would ever finish the order. Every
// app instance runs this reaper on an interval; it moves PENDING orders older
// than `timeoutSeconds` to EXPIRED and gives their stock back.
//
// Safety:
//  * Age is measured with the database clock (now()), never the instance
//    clock, so clock drift between instances cannot expire a fresh order.
//  * Candidate rows are locked with FOR UPDATE SKIP LOCKED: concurrent
//    reapers on different instances always claim disjoint sets of orders,
//    and an order whose TX2 is running right now is skipped.
//  * The status change is conditional (WHERE status = 'PENDING') and stock is
//    restored only for the rows that change, in the same transaction, so
//    stock is restored exactly once however often the reaper runs.
//  * Product rows are locked in id order, the same order checkout uses, so
//    the reaper cannot deadlock with concurrent checkouts.

import { withTransaction } from '../db/pool.js';

export const EXPIRY_REASON = 'Checkout did not complete within the pending-order timeout; reserved stock was released';

export function createPendingOrderReaper({ pool, logger, timeoutSeconds, batchSize = 100, intervalMs = 60000 }) {
  /**
   * Expire up to `batchSize` stale PENDING orders in one transaction.
   * Returns the expired orders as [{ id, ageSeconds }].
   */
  async function expireStaleOrders({ olderThanSeconds = timeoutSeconds, limit = batchSize } = {}) {
    const expired = await withTransaction(pool, async (client) => {
      const candidates = await client.query(
        `SELECT id FROM orders
          WHERE status = 'PENDING' AND created_at < now() - make_interval(secs => $1)
          ORDER BY created_at
          LIMIT $2
          FOR UPDATE SKIP LOCKED`,
        [olderThanSeconds, limit],
      );
      if (candidates.rowCount === 0) return [];

      const updated = await client.query(
        `UPDATE orders
            SET status = 'EXPIRED', status_reason = $2, updated_at = now()
          WHERE id = ANY($1::uuid[]) AND status = 'PENDING'
      RETURNING id, floor(extract(epoch FROM now() - created_at))::int AS age_seconds`,
        [candidates.rows.map((r) => r.id), EXPIRY_REASON],
      );
      if (updated.rowCount === 0) return [];
      const ids = updated.rows.map((r) => r.id);

      const items = await client.query(
        `SELECT product_id, sum(quantity)::int AS quantity
           FROM order_items WHERE order_id = ANY($1::uuid[])
          GROUP BY product_id ORDER BY product_id`,
        [ids],
      );
      if (items.rowCount > 0) {
        const productIds = items.rows.map((r) => r.product_id);
        await client.query('SELECT id FROM products WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [productIds]);
        await client.query(
          `UPDATE products p SET stock = p.stock + r.quantity
             FROM unnest($1::int[], $2::int[]) AS r(product_id, quantity)
            WHERE p.id = r.product_id`,
          [productIds, items.rows.map((r) => r.quantity)],
        );
      }
      return updated.rows.map((r) => ({ id: r.id, ageSeconds: r.age_seconds }));
    });

    for (const order of expired) {
      // Structured event; no customer or payment data.
      logger.warn(
        { event: 'pending_order_expired', orderId: order.id, ageSeconds: order.ageSeconds },
        'Expired stale PENDING order and released its stock',
      );
    }
    return expired;
  }

  let timer = null;
  let running = null;

  function runOnce() {
    if (running) return running; // never overlap runs on the same instance
    running = (async () => {
      try {
        // Drain a backlog in batches, but stop after a bounded amount of work.
        for (let i = 0; i < 10; i += 1) {
          const batch = await expireStaleOrders();
          if (batch.length < batchSize) break;
        }
      } catch (err) {
        logger.error({ err }, 'Pending-order reaper run failed; will retry on the next interval');
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    expireStaleOrders,
    runOnce,
    start() {
      if (timer) return;
      // Random first delay spreads instances that boot together.
      const first = setTimeout(() => {
        runOnce();
        timer = setInterval(runOnce, intervalMs);
        timer.unref();
      }, Math.floor(Math.random() * intervalMs));
      first.unref();
      timer = first;
      logger.info({ timeoutSeconds, intervalMs, batchSize }, 'Pending-order reaper started');
    },
    /** Stop scheduling and wait for an in-progress run to finish. */
    async stop() {
      clearTimeout(timer);
      clearInterval(timer);
      timer = null;
      await running;
    },
  };
}
