import { Router } from 'express';

export function healthRouter({ pool, instanceMetadata }) {
  const router = Router();

  // Liveness: used by the ALB target-group health check. Deliberately does NOT
  // touch the database, so a brief RDS outage does not make every instance
  // "unhealthy" and trigger mass replacement by the Auto Scaling Group.
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });

  // Readiness: verifies the database is reachable (used by monitoring/alarms).
  router.get('/health/ready', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ready', database: 'ok' });
    } catch (err) {
      req.log?.warn({ err }, 'Readiness check failed');
      res.status(503).json({
        error: { code: 'DB_UNAVAILABLE', message: 'Database is not reachable', requestId: req.id },
      });
    }
  });

  router.get('/instance', async (_req, res) => {
    res.json(await instanceMetadata.get());
  });

  return router;
}
