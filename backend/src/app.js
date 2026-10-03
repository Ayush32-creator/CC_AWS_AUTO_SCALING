// Builds the Express application. Dependencies are injected so tests can use
// a test database and a zero-latency mock payment provider.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { apiNotFound, errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { ordersRouter } from './routes/orders.js';
import { productsRouter } from './routes/products.js';
import { createOrderService } from './services/orderService.js';
import { createProductService } from './services/productService.js';

export function createApp({ pool, payment, logger, instanceMetadata, publicDir }) {
  const app = express();
  app.disable('x-powered-by');
  // Behind the ALB: trust the first proxy hop for client IP / protocol.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // The site is served over plain HTTP in the dev environment (no
          // domain/ACM certificate), so don't force HTTPS upgrades.
          upgradeInsecureRequests: null,
        },
      },
      hsts: false,
    }),
  );

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = req.headers['x-request-id'] || randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      // Health checks hit every instance every few seconds; keep logs readable.
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : 'info'),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(express.json({ limit: '32kb' }));

  const productService = createProductService({ pool });
  const orderService = createOrderService({ pool, payment, logger });

  const api = express.Router();
  api.use(healthRouter({ pool, instanceMetadata }));
  api.use(productsRouter({ productService }));
  api.use(ordersRouter({ orderService }));
  api.use(apiNotFound);
  app.use('/api', api);

  // Serve the built React SPA (production image). Unknown non-API paths fall
  // back to index.html so client-side routes like /orders/:id work on refresh.
  if (publicDir && fs.existsSync(path.join(publicDir, 'index.html'))) {
    app.use(express.static(publicDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
