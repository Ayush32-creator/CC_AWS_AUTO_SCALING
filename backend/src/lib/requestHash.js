import { createHash } from 'node:crypto';

/**
 * Fingerprint of a checkout request, stored with the order so a reused
 * Idempotency-Key can be told apart from a genuine retry. Items are sorted so
 * that ordering differences do not count as a different request. Only the
 * card's last four digits are included; the full number is never hashed or stored.
 */
export function hashCheckoutRequest({ customer, items, payment }) {
  const canonical = {
    name: customer.name,
    email: customer.email.toLowerCase(),
    items: [...items]
      .sort((a, b) => a.productId - b.productId)
      .map((i) => [i.productId, i.quantity]),
    cardLast4: payment.cardNumber.slice(-4),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
