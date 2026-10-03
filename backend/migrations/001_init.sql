-- Core schema: products, orders, order_items (see docs/02-api-and-data-model.md)

CREATE TABLE products (
  id            SERIAL PRIMARY KEY,
  sku           TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  price_cents   INTEGER NOT NULL CHECK (price_cents > 0),
  -- The CHECK is the last line of defence against overselling.
  stock         INTEGER NOT NULL CHECK (stock >= 0),
  image_url     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE order_status AS ENUM ('PENDING', 'PAID', 'PAYMENT_FAILED');

CREATE TABLE orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE makes duplicate checkout prevention work across every instance.
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
