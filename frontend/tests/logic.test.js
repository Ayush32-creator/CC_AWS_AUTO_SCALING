import { describe, expect, it, vi } from 'vitest';
import { MAX_QUANTITY, cartCount, cartReducer, cartSubtotal } from '../src/cart/cartReducer.js';
import { ApiError } from '../src/lib/api.js';
import { submitOrder } from '../src/lib/checkout.js';
import { formatMoney } from '../src/lib/money.js';
import { uuidv4 } from '../src/lib/uuid.js';

const keyboard = { id: 1, name: 'Keyboard', priceCents: 459900, stock: 3 };
const mouse = { id: 2, name: 'Mouse', priceCents: 129900, stock: 50 };

describe('cartReducer', () => {
  it('adds new products and increments existing ones', () => {
    let s = cartReducer([], { type: 'add', product: keyboard });
    s = cartReducer(s, { type: 'add', product: keyboard });
    s = cartReducer(s, { type: 'add', product: mouse });
    expect(s).toEqual([
      expect.objectContaining({ productId: 1, quantity: 2 }),
      expect.objectContaining({ productId: 2, quantity: 1 }),
    ]);
    expect(cartCount(s)).toBe(3);
    expect(cartSubtotal(s)).toBe(2 * 459900 + 129900);
  });

  it('never exceeds stock or the per-item maximum', () => {
    let s = [];
    for (let i = 0; i < 5; i += 1) s = cartReducer(s, { type: 'add', product: keyboard });
    expect(s[0].quantity).toBe(3); // stock limit
    s = cartReducer([], { type: 'add', product: mouse });
    s = cartReducer(s, { type: 'setQuantity', productId: 2, quantity: 99 });
    expect(s[0].quantity).toBe(MAX_QUANTITY);
  });

  it('ignores out-of-stock products', () => {
    expect(cartReducer([], { type: 'add', product: { ...mouse, stock: 0 } })).toEqual([]);
  });

  it('removes lines when quantity reaches 0, on remove, and on clear', () => {
    const s = cartReducer(cartReducer([], { type: 'add', product: keyboard }), { type: 'add', product: mouse });
    expect(cartReducer(s, { type: 'setQuantity', productId: 1, quantity: 0 })).toHaveLength(1);
    expect(cartReducer(s, { type: 'remove', productId: 2 })).toHaveLength(1);
    expect(cartReducer(s, { type: 'clear' })).toEqual([]);
  });
});

describe('uuidv4', () => {
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('falls back to getRandomValues when randomUUID is unavailable (plain HTTP)', () => {
    const insecure = { getRandomValues: (a) => globalThis.crypto.getRandomValues(a) };
    const ids = new Set(Array.from({ length: 100 }, () => uuidv4(insecure)));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(V4);
  });
});

describe('formatMoney', () => {
  it('formats paise as rupees', () => {
    expect(formatMoney(459900)).toBe('₹4,599.00');
  });
});

describe('submitOrder', () => {
  const ok = (body, status = 201) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  const fail = (status, code) => Promise.resolve(new Response(JSON.stringify({ error: { code, message: code } }), { status }));
  const opts = { baseDelayMs: 1 };

  it('retries network errors and 5xx with the SAME idempotency key', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')))
      .mockImplementationOnce(() => fail(503, 'HTTP_ERROR'))
      .mockImplementationOnce(() => fail(409, 'IN_PROGRESS'))
      .mockImplementationOnce(() => ok({ id: 'order-1' }, 200));

    const order = await submitOrder({ items: [] }, 'key-123', { ...opts, fetchImpl });

    expect(order).toEqual({ id: 'order-1' });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const keys = fetchImpl.mock.calls.map(([, init]) => init.headers['Idempotency-Key']);
    expect(new Set(keys)).toEqual(new Set(['key-123']));
  });

  it('does not retry client errors such as a declined card', async () => {
    const fetchImpl = vi.fn(() => fail(402, 'PAYMENT_DECLINED'));
    await expect(submitOrder({}, 'k', { ...opts, fetchImpl })).rejects.toMatchObject({
      status: 402,
      code: 'PAYMENT_DECLINED',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry budget', async () => {
    const fetchImpl = vi.fn(() => fail(500, 'INTERNAL_ERROR'));
    await expect(submitOrder({}, 'k', { ...opts, retries: 2, fetchImpl })).rejects.toBeInstanceOf(ApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
