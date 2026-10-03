// Duplicate-safe checkout. See "Checkout algorithm" in docs/02-api-and-data-model.md.
//
//  TX1  insert PENDING order (ON CONFLICT on idempotency_key) + reserve stock
//  ---  call the payment provider with NO transaction open (no locks held)
//  TX2  mark PAID, or PAYMENT_FAILED and give the reserved stock back
//
// Every guarantee lives in PostgreSQL (UNIQUE key, conditional UPDATE, CHECK
// constraint), so it holds no matter how many app instances are running.

import { withTransaction } from '../db/pool.js';
import { AppError, notFound } from '../lib/errors.js';
import { hashCheckoutRequest } from '../lib/requestHash.js';

function toOrder(row, items) {
  return {
    id: row.id,
    status: row.status,
    totalCents: row.total_cents,
    customer: { name: row.customer_name, email: row.customer_email },
    cardLast4: row.card_last4,
    paymentRef: row.payment_ref,
    items: items.map((i) => ({
      productId: i.product_id,
      name: i.name,
      quantity: i.quantity,
      unitPriceCents: i.unit_price_cents,
      lineTotalCents: i.unit_price_cents * i.quantity,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const httpStatusFor = (status) => (status === 'PAYMENT_FAILED' ? 402 : 200);

export function createOrderService({ pool, payment, logger }) {
  async function loadOrder(whereColumn, value) {
    const { rows } = await pool.query(`SELECT * FROM orders WHERE ${whereColumn} = $1`, [value]);
    if (rows.length === 0) return null;
    const items = await pool.query(
      `SELECT oi.*, p.name FROM order_items oi
         JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = $1 ORDER BY oi.product_id`,
      [rows[0].id],
    );
    return { row: rows[0], order: toOrder(rows[0], items.rows) };
  }

  /** TX1: create the PENDING order and reserve stock, or report a duplicate key. */
  async function reserve(idempotencyKey, requestHash, body) {
    return withTransaction(pool, async (client) => {
      // If another request with the same key is mid-transaction, this INSERT
      // waits for it; once it commits we fall into the duplicate branch.
      const inserted = await client.query(
        `INSERT INTO orders (idempotency_key, request_hash, customer_name, customer_email, total_cents, card_last4)
         VALUES ($1, $2, $3, $4, 0, $5)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [idempotencyKey, requestHash, body.customer.name, body.customer.email, body.payment.cardNumber.slice(-4)],
      );
      if (inserted.rowCount === 0) return { duplicate: true };

      const orderId = inserted.rows[0].id;
      let totalCents = 0;
      // Lock rows in a consistent order (by id) to avoid deadlocks between
      // concurrent checkouts containing the same products.
      const items = [...body.items].sort((a, b) => a.productId - b.productId);

      for (const { productId, quantity } of items) {
        // Atomic check-and-decrement: never lets stock go below zero.
        const updated = await client.query(
          `UPDATE products SET stock = stock - $2
            WHERE id = $1 AND stock >= $2
        RETURNING price_cents`,
          [productId, quantity],
        );
        if (updated.rowCount === 0) {
          const { rows } = await client.query('SELECT name, stock FROM products WHERE id = $1', [productId]);
          if (rows.length === 0) throw notFound(`Product ${productId}`);
          throw new AppError(409, 'OUT_OF_STOCK', `Only ${rows[0].stock} left of '${rows[0].name}'`, {
            productId,
            available: rows[0].stock,
          });
        }
        const unitPriceCents = updated.rows[0].price_cents; // server-side price, never the client's
        totalCents += unitPriceCents * quantity;
        await client.query(
          'INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES ($1, $2, $3, $4)',
          [orderId, productId, quantity, unitPriceCents],
        );
      }

      await client.query('UPDATE orders SET total_cents = $2 WHERE id = $1', [orderId, totalCents]);
      return { duplicate: false, orderId, totalCents };
    });
  }

  /** TX2: record the payment outcome; on failure release the reserved stock. */
  async function finalize(orderId, result) {
    await withTransaction(pool, async (client) => {
      if (result.approved) {
        await client.query(
          `UPDATE orders SET status = 'PAID', payment_ref = $2, updated_at = now()
            WHERE id = $1 AND status = 'PENDING'`,
          [orderId, result.reference],
        );
        return;
      }
      const failed = await client.query(
        `UPDATE orders SET status = 'PAYMENT_FAILED', updated_at = now()
          WHERE id = $1 AND status = 'PENDING' RETURNING id`,
        [orderId],
      );
      if (failed.rowCount === 1) {
        await client.query(
          `UPDATE products p SET stock = p.stock + oi.quantity
             FROM order_items oi
            WHERE oi.order_id = $1 AND p.id = oi.product_id`,
          [orderId],
        );
      }
    });
  }

  /** Answer a request whose Idempotency-Key was already used. */
  async function replay(idempotencyKey, requestHash) {
    const existing = await loadOrder('idempotency_key', idempotencyKey);
    if (existing.row.request_hash !== requestHash) {
      throw new AppError(
        422,
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used for a different checkout request',
      );
    }
    if (existing.row.status === 'PENDING') {
      throw new AppError(409, 'IN_PROGRESS', 'This checkout is already being processed', {
        orderId: existing.order.id,
      });
    }
    return { httpStatus: httpStatusFor(existing.row.status), order: existing.order, replayed: true };
  }

  return {
    async placeOrder({ idempotencyKey, body }) {
      const startedAt = Date.now();
      const requestHash = hashCheckoutRequest(body);

      const reservation = await reserve(idempotencyKey, requestHash, body);
      if (reservation.duplicate) {
        const result = await replay(idempotencyKey, requestHash);
        logger.info({ event: 'checkout', outcome: 'replayed', orderId: result.order.id }, 'Checkout replayed');
        return result;
      }

      let paymentResult;
      try {
        paymentResult = await payment.charge({
          amountCents: reservation.totalCents,
          cardNumber: body.payment.cardNumber,
        });
      } catch (err) {
        logger.error({ err, orderId: reservation.orderId }, 'Payment provider error');
        paymentResult = { approved: false, reason: 'Payment provider unavailable' };
      }

      await finalize(reservation.orderId, paymentResult);
      const { order } = await loadOrder('id', reservation.orderId);

      // Structured event consumed by CloudWatch metric filters in Phase 5.
      logger.info(
        {
          event: 'checkout',
          outcome: paymentResult.approved ? 'paid' : 'declined',
          orderId: order.id,
          totalCents: order.totalCents,
          latencyMs: Date.now() - startedAt,
        },
        'Checkout completed',
      );

      return {
        httpStatus: paymentResult.approved ? 201 : 402,
        order,
        replayed: false,
        declineReason: paymentResult.approved ? undefined : paymentResult.reason,
      };
    },

    async getOrder(id) {
      const found = await loadOrder('id', id);
      if (!found) throw notFound(`Order ${id}`);
      return found.order;
    },
  };
}
