import { Router } from 'express';
import { createOrderBody, idempotencyKey, orderIdParam } from '../lib/validation.js';

export function ordersRouter({ orderService }) {
  const router = Router();

  router.post('/orders', async (req, res) => {
    const key = idempotencyKey.parse(req.get('Idempotency-Key'));
    const body = createOrderBody.parse(req.body);

    const result = await orderService.placeOrder({ idempotencyKey: key, body });
    res.set('Idempotent-Replayed', String(result.replayed));

    if (result.httpStatus === 402) {
      return res.status(402).json({
        error: {
          code: 'PAYMENT_DECLINED',
          message: result.declineReason ?? 'Payment was declined',
          requestId: req.id,
        },
        order: result.order,
      });
    }
    return res.status(result.httpStatus).json(result.order);
  });

  router.get('/orders/:id', async (req, res) => {
    res.json(await orderService.getOrder(orderIdParam.parse(req.params.id)));
  });

  return router;
}
