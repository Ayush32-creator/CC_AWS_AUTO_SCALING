# 02 — API & Data Model

All endpoints are under `/api`. Responses are JSON. Errors use one shape:

```json
{ "error": { "code": "OUT_OF_STOCK", "message": "Only 2 left of 'Mechanical Keyboard'", "requestId": "..." } }
```

## Endpoints

| Method | Path | Purpose | Success | Notable errors |
|---|---|---|---|---|
| GET | `/api/health` | Liveness (ALB target health check). No DB call | 200 `{status:"ok"}` | — |
| GET | `/api/health/ready` | Readiness: checks DB connectivity | 200 | 503 `DB_UNAVAILABLE` |
| GET | `/api/instance` | Instance ID, AZ and version (via IMDSv2; returns `"local"` off-AWS) | 200 | — |
| GET | `/api/products?page=&limit=` | Paginated product list | 200 | 400 `VALIDATION_ERROR` |
| GET | `/api/products/:id` | Single product | 200 | 404 `NOT_FOUND` |
| POST | `/api/cart/quote` | Validate the cart, then return server-side prices, subtotal and stock warnings | 200 | 400, 404 |
| POST | `/api/orders` | **Checkout.** Header `Idempotency-Key: <uuid>` is required. The response header `Idempotent-Replayed: true/false` tells the client whether this is a replay | 201 new · 200 replay | 400, 402 `PAYMENT_DECLINED` (body also contains `order`; replaying a declined key returns 402 again), 404 unknown product, 409 `OUT_OF_STOCK` / `IN_PROGRESS`, 422 `IDEMPOTENCY_KEY_REUSED` |
| GET | `/api/orders/:id` | Order status and line items | 200 | 404 |

### `POST /api/orders` body
```json
{
  "customer": { "name": "Asha Rao", "email": "asha@example.com" },
  "items": [ { "productId": 3, "quantity": 2 } ],
  "payment": { "cardNumber": "4242424242424242", "expiry": "12/28", "cvc": "123" }
}
```
Validation rules (zod):
- 1–20 line items, quantity 1–10, no duplicate products.
- Email format is checked.
- The mock card must pass a Luhn check. `4000000000000002` always declines.

Card data is **never stored or logged**. Only the last 4 digits and a mock payment reference are kept.

## Schema (PostgreSQL)

```sql
CREATE TABLE products (
  id            SERIAL PRIMARY KEY,
  sku           TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  price_cents   INTEGER NOT NULL CHECK (price_cents > 0),
  stock         INTEGER NOT NULL CHECK (stock >= 0),
  image_url     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE order_status AS ENUM ('PENDING', 'PAID', 'PAYMENT_FAILED');

CREATE TABLE orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key  UUID UNIQUE NOT NULL,
  request_hash     TEXT NOT NULL,
  customer_name    TEXT NOT NULL,
  customer_email   TEXT NOT NULL,
  status           order_status NOT NULL DEFAULT 'PENDING',
  total_cents      INTEGER NOT NULL CHECK (total_cents >= 0),
  card_last4       CHAR(4),
  payment_ref      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  order_id          UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id        INTEGER REFERENCES products(id),
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents  INTEGER NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

CREATE INDEX orders_created_at_idx ON orders (created_at);
```

A seed of ~12 products is loaded by migration.

## Checkout algorithm

```
1. Validate the body and the Idempotency-Key.
2. TX1: INSERT order (PENDING) ON CONFLICT (idempotency_key) DO NOTHING
     ├─ conflict → load existing → compare request_hash → 200 / 409 / 422
     └─ inserted → for each item (ordered by product_id to avoid deadlocks):
            UPDATE products SET stock = stock - q WHERE id = ? AND stock >= q
            0 rows → ROLLBACK → 409 OUT_OF_STOCK
          INSERT order_items with DB prices; set total; COMMIT
3. Call mockPayment(total, card)   ← outside any transaction (no locks held during latency)
4. TX2: success → status = PAID, payment_ref
        failure → status = PAYMENT_FAILED, restore stock
5. Emit EMF metric; respond 201 (or 402 on decline)
```
