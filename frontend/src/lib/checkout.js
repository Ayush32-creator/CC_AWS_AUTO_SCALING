// Checkout submission with safe retries.
//
// The same Idempotency-Key is reused for every retry of ONE checkout attempt,
// so a timeout, a dropped connection or a double-click can never create two
// orders: the server returns the original order instead.

import { ApiError, apiRequest } from './api.js';

const RETRYABLE = (err) =>
  err instanceof ApiError && (err.status === 0 || err.status >= 500 || err.code === 'IN_PROGRESS');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function submitOrder(body, idempotencyKey, { fetchImpl = fetch, retries = 3, baseDelayMs = 500 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await apiRequest('/api/orders', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
        fetchImpl,
      });
    } catch (err) {
      if (attempt >= retries || !RETRYABLE(err)) throw err;
      await sleep(baseDelayMs * 2 ** attempt); // exponential backoff
    }
  }
}
