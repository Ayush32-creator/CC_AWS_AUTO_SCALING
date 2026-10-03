// Mock payment gateway. Simulates network latency and deterministic declines
// so checkout behaves realistically under load without any external service.

import { randomBytes } from 'node:crypto';

/** Test card that is always declined (passes Luhn, like Stripe's test card). */
export const DECLINE_CARD = '4000000000000002';

export function createMockPayment({ minLatencyMs = 100, maxLatencyMs = 300 } = {}) {
  const span = Math.max(0, maxLatencyMs - minLatencyMs);

  return {
    /**
     * @returns {Promise<{approved: true, reference: string} | {approved: false, reason: string}>}
     */
    async charge({ amountCents, cardNumber }) {
      const latency = minLatencyMs + Math.floor(Math.random() * (span + 1));
      if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));

      if (cardNumber === DECLINE_CARD) {
        return { approved: false, reason: 'Card declined by issuer (test card)' };
      }
      if (amountCents <= 0) {
        return { approved: false, reason: 'Invalid amount' };
      }
      return { approved: true, reference: `mock_${randomBytes(8).toString('hex')}` };
    },
  };
}
