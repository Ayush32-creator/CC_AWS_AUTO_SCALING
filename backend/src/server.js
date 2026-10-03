// Process entry point: load config, migrate, start HTTP server, and shut down
// gracefully on SIGTERM (sent by Docker during ASG scale-in / instance refresh).

import pino from 'pino';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { runMigrations } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { createInstanceMetadata } from './lib/instanceMetadata.js';
import { createMockPayment } from './payment/mockPayment.js';

const config = loadConfig();
const logger = pino({
  level: config.logLevel,
  base: { service: 'checkout-api', version: config.appVersion },
  redact: ['req.headers.authorization', 'payment.cardNumber', 'payment.cvc'],
});

const pool = createPool(config.db, logger);
if (config.migrateOnStart) await runMigrations(pool, logger);

const app = createApp({
  pool,
  logger,
  payment: createMockPayment(config.payment),
  instanceMetadata: createInstanceMetadata({
    enabled: config.instanceMetadata,
    appVersion: config.appVersion,
    logger,
  }),
  publicDir: config.publicDir,
});

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, 'Checkout API listening');
});
// Keep-alive must outlive the ALB idle timeout (60 s) to avoid sporadic 502s.
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down: draining in-flight requests');

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, config.shutdownTimeoutMs);
  forceExit.unref();

  server.close(async () => {
    await pool.end().catch(() => {});
    logger.info('Shutdown complete');
    process.exit(0);
  });
  server.closeIdleConnections();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
