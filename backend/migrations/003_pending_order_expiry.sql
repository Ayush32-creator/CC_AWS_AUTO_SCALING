-- Phase 5: recover orders stuck in PENDING (docs/02-api-and-data-model.md,
-- "Stale PENDING orders"). If an instance dies between reserving stock (TX1)
-- and recording the payment result (TX2), the order would stay PENDING with
-- its stock reserved forever. The pending-order reaper moves such orders to
-- EXPIRED and releases the stock.
--
-- EXPIRED, not PAYMENT_FAILED: after a crash the payment outcome is unknown,
-- and PAYMENT_FAILED tells the customer that no money was taken.
--
-- ADD VALUE inside the migration transaction is allowed on PostgreSQL >= 12
-- as long as the new value is not used in the same transaction.
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'EXPIRED';

-- Why an order reached its final state when the reason is not obvious
-- (currently only set by the reaper). Never contains payment data.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status_reason TEXT;

-- The reaper scans only PENDING orders by age; a partial index keeps that
-- scan tiny no matter how many completed orders exist.
CREATE INDEX IF NOT EXISTS orders_pending_created_at_idx ON orders (created_at) WHERE status = 'PENDING';
