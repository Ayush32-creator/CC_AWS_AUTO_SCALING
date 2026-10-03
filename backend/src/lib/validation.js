// Request schemas (zod). Limits mirror docs/02-api-and-data-model.md.
import { z } from 'zod';
import { isValidLuhn } from './luhn.js';

export const MAX_LINE_ITEMS = 20;
export const MAX_QUANTITY = 10;

export const productIdParam = z.coerce.number().int().positive();
export const orderIdParam = z.uuid();
export const idempotencyKey = z.uuid({ message: 'Idempotency-Key header must be a UUID' });

export const listProductsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const lineItem = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
});

const lineItems = z
  .array(lineItem)
  .min(1, 'Cart must contain at least one item')
  .max(MAX_LINE_ITEMS)
  .refine((items) => new Set(items.map((i) => i.productId)).size === items.length, {
    message: 'Each product may appear only once',
  });

export const cartQuoteBody = z.object({ items: lineItems });

export const createOrderBody = z.object({
  customer: z.object({
    name: z.string().trim().min(1).max(100),
    email: z.email().max(254),
  }),
  items: lineItems,
  payment: z.object({
    cardNumber: z
      .string()
      .transform((s) => s.replace(/[\s-]/g, ''))
      .pipe(z.string().regex(/^\d{12,19}$/, 'Card number must be 12-19 digits'))
      .refine(isValidLuhn, 'Card number is invalid'),
    expiry: z
      .string()
      .regex(/^(0[1-9]|1[0-2])\/\d{2}$/, 'Expiry must be MM/YY')
      .refine(notExpired, 'Card has expired'),
    cvc: z.string().regex(/^\d{3,4}$/, 'CVC must be 3 or 4 digits'),
  }),
});

function notExpired(expiry, now = new Date()) {
  const [mm, yy] = expiry.split('/').map(Number);
  // A card is valid through the last day of its expiry month.
  const endOfMonth = new Date(Date.UTC(2000 + yy, mm, 1));
  return endOfMonth > now;
}
