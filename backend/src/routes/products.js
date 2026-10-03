import { Router } from 'express';
import { cartQuoteBody, listProductsQuery, productIdParam } from '../lib/validation.js';

export function productsRouter({ productService }) {
  const router = Router();

  router.get('/products', async (req, res) => {
    res.json(await productService.list(listProductsQuery.parse(req.query)));
  });

  router.get('/products/:id', async (req, res) => {
    res.json(await productService.get(productIdParam.parse(req.params.id)));
  });

  router.post('/cart/quote', async (req, res) => {
    const { items } = cartQuoteBody.parse(req.body);
    res.json(await productService.quote(items));
  });

  return router;
}
