// Centralised runtime configuration. Every value comes from environment
// variables so the same image runs locally (docker compose) and on AWS
// (values injected by EC2 user-data / Secrets Manager in later phases).

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) throw new Error(`Environment variable ${name} must be an integer`);
  return value;
}

function boolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes'].includes(raw.toLowerCase());
}

export function loadConfig() {
  return {
    env: process.env.NODE_ENV ?? 'development',
    port: intEnv('PORT', 3000),
    appVersion: process.env.APP_VERSION ?? 'dev',
    logLevel: process.env.LOG_LEVEL ?? 'info',
    // Directory containing the built React app; served when present.
    publicDir: process.env.PUBLIC_DIR ?? '',
    migrateOnStart: boolEnv('MIGRATE_ON_START', true),
    db: {
      // Either a full connection string or discrete parts (used on AWS, where
      // the password is fetched from Secrets Manager rather than a URL).
      connectionString: process.env.DATABASE_URL || undefined,
      host: process.env.DB_HOST,
      port: intEnv('DB_PORT', 5432),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      // On AWS: ARN of the RDS-managed secret; takes precedence over DB_PASSWORD.
      secretArn: process.env.DB_SECRET_ARN || undefined,
      awsRegion: process.env.AWS_REGION || undefined,
      ssl: boolEnv('DB_SSL', false),
      sslCaPath: process.env.DB_SSL_CA_PATH || undefined,
      poolMax: intEnv('DB_POOL_MAX', 10),
    },
    payment: {
      minLatencyMs: intEnv('PAYMENT_MIN_LATENCY_MS', 100),
      maxLatencyMs: intEnv('PAYMENT_MAX_LATENCY_MS', 300),
    },
    // Disable EC2 metadata lookups when not running on AWS (tests, local).
    instanceMetadata: boolEnv('INSTANCE_METADATA_ENABLED', false),
    shutdownTimeoutMs: intEnv('SHUTDOWN_TIMEOUT_MS', 25000),
    pendingOrderReaper: reaperConfig(),
  };
}

// A healthy checkout is PENDING for well under a second, and no request can
// outlive the ALB idle timeout (60 s). The default timeout (10 min) is far
// beyond that; anything below 60 s is refused so live checkouts are never
// expired by a misconfiguration.
export const MIN_PENDING_TIMEOUT_SECONDS = 60;

function reaperConfig() {
  const cfg = {
    enabled: boolEnv('PENDING_ORDER_REAPER_ENABLED', true),
    timeoutSeconds: intEnv('PENDING_ORDER_TIMEOUT_SECONDS', 600),
    intervalSeconds: intEnv('PENDING_ORDER_REAPER_INTERVAL_SECONDS', 60),
    batchSize: intEnv('PENDING_ORDER_REAPER_BATCH_SIZE', 100),
  };
  if (cfg.timeoutSeconds < MIN_PENDING_TIMEOUT_SECONDS) {
    throw new Error(`PENDING_ORDER_TIMEOUT_SECONDS must be at least ${MIN_PENDING_TIMEOUT_SECONDS}`);
  }
  if (cfg.intervalSeconds < 5) throw new Error('PENDING_ORDER_REAPER_INTERVAL_SECONDS must be at least 5');
  if (cfg.batchSize < 1 || cfg.batchSize > 1000) {
    throw new Error('PENDING_ORDER_REAPER_BATCH_SIZE must be between 1 and 1000');
  }
  return cfg;
}
