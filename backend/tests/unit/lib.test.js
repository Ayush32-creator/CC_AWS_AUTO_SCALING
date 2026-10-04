import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { isValidLuhn } from '../../src/lib/luhn.js';
import { hashCheckoutRequest } from '../../src/lib/requestHash.js';
import { cartQuoteBody, createOrderBody, listProductsQuery } from '../../src/lib/validation.js';
import { DECLINE_CARD, createMockPayment } from '../../src/payment/mockPayment.js';

const body = {
  customer: { name: 'Asha Rao', email: 'asha@example.com' },
  items: [{ productId: 2, quantity: 1 }, { productId: 1, quantity: 3 }],
  payment: { cardNumber: '4242 4242 4242 4242', expiry: '12/30', cvc: '123' },
};

describe('isValidLuhn', () => {
  it.each(['4242424242424242', '4000000000000002', '5555555555554444', '378282246310005'])('accepts %s', (n) =>
    expect(isValidLuhn(n)).toBe(true),
  );
  it.each(['4242424242424241', '1234567890123456', '', 'abcd'])('rejects %s', (n) =>
    expect(isValidLuhn(n)).toBe(false),
  );
});

describe('createOrderBody', () => {
  it('normalises spaces/dashes out of the card number', () => {
    expect(createOrderBody.parse(body).payment.cardNumber).toBe('4242424242424242');
  });

  it('rejects an expired card but accepts the current month', () => {
    const now = new Date();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const yy = String(now.getUTCFullYear() % 100).padStart(2, '0');
    expect(createOrderBody.safeParse({ ...body, payment: { ...body.payment, expiry: `${mm}/${yy}` } }).success).toBe(true);
    expect(createOrderBody.safeParse({ ...body, payment: { ...body.payment, expiry: '01/21' } }).success).toBe(false);
  });

  it('rejects more than 20 line items', () => {
    const items = Array.from({ length: 21 }, (_, i) => ({ productId: i + 1, quantity: 1 }));
    expect(cartQuoteBody.safeParse({ items }).success).toBe(false);
  });

  it('rejects non-integer quantities', () => {
    expect(cartQuoteBody.safeParse({ items: [{ productId: 1, quantity: 1.5 }] }).success).toBe(false);
  });
});

describe('listProductsQuery', () => {
  it('applies defaults and coerces strings', () => {
    expect(listProductsQuery.parse({})).toEqual({ page: 1, limit: 20 });
    expect(listProductsQuery.parse({ page: '3', limit: '10' })).toEqual({ page: 3, limit: 10 });
  });
});

describe('hashCheckoutRequest', () => {
  const parsed = createOrderBody.parse(body);

  it('ignores item order and email case', () => {
    const reordered = { ...parsed, items: [...parsed.items].reverse(), customer: { ...parsed.customer, email: 'ASHA@example.com' } };
    expect(hashCheckoutRequest(reordered)).toBe(hashCheckoutRequest(parsed));
  });

  it('changes when quantities change', () => {
    const changed = { ...parsed, items: [{ productId: 1, quantity: 4 }, { productId: 2, quantity: 1 }] };
    expect(hashCheckoutRequest(changed)).not.toBe(hashCheckoutRequest(parsed));
  });
});

describe('mock payment', () => {
  const payment = createMockPayment({ minLatencyMs: 0, maxLatencyMs: 0 });

  it('approves a normal card with a mock reference', async () => {
    const r = await payment.charge({ amountCents: 1000, cardNumber: '4242424242424242' });
    expect(r).toEqual({ approved: true, reference: expect.stringMatching(/^mock_[0-9a-f]{16}$/) });
  });

  it('declines the test decline card', async () => {
    const r = await payment.charge({ amountCents: 1000, cardNumber: DECLINE_CARD });
    expect(r.approved).toBe(false);
  });

  it('waits for the configured latency', async () => {
    const slow = createMockPayment({ minLatencyMs: 50, maxLatencyMs: 50 });
    const start = Date.now();
    await slow.charge({ amountCents: 1, cardNumber: '4242424242424242' });
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });
});

describe('loadConfig', () => {
  it('reads integers and booleans from the environment', () => {
    process.env.DB_POOL_MAX = '7';
    process.env.DB_SSL = 'true';
    const cfg = loadConfig();
    expect(cfg.db.poolMax).toBe(7);
    expect(cfg.db.ssl).toBe(true);
    delete process.env.DB_POOL_MAX;
    delete process.env.DB_SSL;
  });

  it('throws on a non-numeric integer variable', () => {
    process.env.PORT = 'abc';
    expect(() => loadConfig()).toThrow(/PORT/);
    delete process.env.PORT;
  });
});

describe('loadConfig: pending-order reaper', () => {
  const vars = [
    'PENDING_ORDER_REAPER_ENABLED',
    'PENDING_ORDER_TIMEOUT_SECONDS',
    'PENDING_ORDER_REAPER_INTERVAL_SECONDS',
    'PENDING_ORDER_REAPER_BATCH_SIZE',
  ];
  const clear = () => vars.forEach((v) => delete process.env[v]);

  it('defaults to enabled, 10-minute timeout, 60 s interval, batches of 100', () => {
    clear();
    expect(loadConfig().pendingOrderReaper).toEqual({ enabled: true, timeoutSeconds: 600, intervalSeconds: 60, batchSize: 100 });
  });

  it('is configurable from the environment', () => {
    process.env.PENDING_ORDER_REAPER_ENABLED = 'false';
    process.env.PENDING_ORDER_TIMEOUT_SECONDS = '900';
    process.env.PENDING_ORDER_REAPER_INTERVAL_SECONDS = '30';
    process.env.PENDING_ORDER_REAPER_BATCH_SIZE = '25';
    expect(loadConfig().pendingOrderReaper).toEqual({ enabled: false, timeoutSeconds: 900, intervalSeconds: 30, batchSize: 25 });
    clear();
  });

  it('refuses a timeout short enough to expire checkouts that are still running', () => {
    process.env.PENDING_ORDER_TIMEOUT_SECONDS = '30';
    expect(() => loadConfig()).toThrow(/at least 60/);
    clear();
  });

  it.each([
    ['PENDING_ORDER_REAPER_INTERVAL_SECONDS', '1'],
    ['PENDING_ORDER_REAPER_BATCH_SIZE', '0'],
    ['PENDING_ORDER_REAPER_BATCH_SIZE', '5000'],
  ])('rejects %s=%s', (name, value) => {
    process.env[name] = value;
    expect(() => loadConfig()).toThrow(new RegExp(name));
    clear();
  });
});
