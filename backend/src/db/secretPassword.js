// Supplies the database password from AWS Secrets Manager.
//
// On AWS the RDS master password is generated and stored by RDS itself
// (manage_master_user_password) and is ROTATED automatically (every 7 days
// by default). node-postgres accepts an async function as `password`, called
// for every NEW connection, so caching the secret for a short TTL means a
// rotation is picked up within one TTL without restarting the app.
// Credentials come from the EC2 instance role; nothing is stored on disk.

import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

export function createSecretPasswordProvider({
  secretArn,
  region,
  ttlMs = 60_000,
  client = new SecretsManagerClient({ region }),
  now = Date.now,
}) {
  let cached;
  let expiresAt = 0;
  let inflight;

  async function fetchPassword() {
    const res = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
    const parsed = JSON.parse(res.SecretString ?? '{}');
    if (typeof parsed.password !== 'string' || parsed.password === '') {
      throw new Error('Database secret does not contain a "password" field');
    }
    cached = parsed.password;
    expiresAt = now() + ttlMs;
    return cached;
  }

  return function getPassword() {
    if (cached && now() < expiresAt) return Promise.resolve(cached);
    // Share one in-flight request when many connections open at once.
    inflight ??= fetchPassword().finally(() => {
      inflight = undefined;
    });
    return inflight;
  };
}
