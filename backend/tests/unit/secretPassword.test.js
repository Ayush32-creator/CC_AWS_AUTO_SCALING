import { describe, expect, it, vi } from 'vitest';
import { createSecretPasswordProvider } from '../../src/db/secretPassword.js';

function fakeClient(...passwords) {
  let i = 0;
  return {
    send: vi.fn(async (command) => {
      expect(command.input).toEqual({ SecretId: 'arn:secret' });
      const password = passwords[Math.min(i, passwords.length - 1)];
      i += 1;
      return { SecretString: JSON.stringify({ username: 'checkout', password }) };
    }),
  };
}

describe('createSecretPasswordProvider', () => {
  it('fetches once and caches within the TTL', async () => {
    const client = fakeClient('p1');
    const get = createSecretPasswordProvider({ secretArn: 'arn:secret', client, ttlMs: 1000, now: () => 0 });
    expect(await get()).toBe('p1');
    expect(await get()).toBe('p1');
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('picks up a rotated password after the TTL expires', async () => {
    let t = 0;
    const client = fakeClient('old', 'rotated');
    const get = createSecretPasswordProvider({ secretArn: 'arn:secret', client, ttlMs: 1000, now: () => t });
    expect(await get()).toBe('old');
    t = 1001;
    expect(await get()).toBe('rotated');
  });

  it('shares one request between concurrent callers', async () => {
    const client = fakeClient('p1');
    const get = createSecretPasswordProvider({ secretArn: 'arn:secret', client, now: () => 0 });
    expect(await Promise.all([get(), get(), get()])).toEqual(['p1', 'p1', 'p1']);
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('rejects a secret without a password and retries on the next call', async () => {
    const client = { send: vi.fn().mockResolvedValueOnce({ SecretString: '{}' }) };
    const get = createSecretPasswordProvider({ secretArn: 'arn:secret', client });
    await expect(get()).rejects.toThrow(/password/);
    client.send.mockResolvedValueOnce({ SecretString: '{"password":"ok"}' });
    expect(await get()).toBe('ok');
  });
});
