import {
  buildWebhookDispatcherPoolConfig,
  type WebhookDispatcherDatabasePoolRuntimeConfig,
  verifyWebhookDispatcherDatabaseConnection,
} from '@core/services/webhookDispatcherPostgresPool';

const runtimeConfig = (): WebhookDispatcherDatabasePoolRuntimeConfig => ({
  databasePoolMin: 1,
  databasePoolMax: 20,
  databasePoolIdleTimeoutMs: 30_000,
  databasePoolAcquireTimeoutMs: 5_000,
  databaseQueryTimeoutMs: 30_000,
});

describe('webhook dispatcher PostgreSQL pool contract', () => {
  it('keeps timeout client-side and omits session GUC startup parameters', () => {
    const poolConfig = buildWebhookDispatcherPoolConfig(runtimeConfig(), {
      host: 'pg-pooler-rw.database.svc',
      port: 5432,
      user: 'dispatcher',
      password: 'secret-for-test-only',
      database: 'underchat',
      ssl: false,
    });

    expect(poolConfig).toEqual(
      expect.objectContaining({
        query_timeout: 30_000,
        application_name: 'underchat-webhook-dispatcher',
      })
    );
    expect(Object.hasOwn(poolConfig, 'statement_timeout')).toBe(false);
    expect(Object.hasOwn(poolConfig, 'options')).toBe(false);
    expect(Object.hasOwn(poolConfig, 'lock_timeout')).toBe(false);
    expect(
      Object.hasOwn(poolConfig, 'idle_in_transaction_session_timeout')
    ).toBe(false);
  });

  it('opens the lazy pool with an unnamed query during startup', async () => {
    const query = jest.fn(async () => ({ rows: [{ ready: 1 }] }));
    const end = jest.fn(async () => undefined);

    await expect(
      verifyWebhookDispatcherDatabaseConnection({ query, end } as never)
    ).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledWith('SELECT 1 AS ready');
    expect(end).not.toHaveBeenCalled();
  });

  it('fails startup and closes the pool after a protocol error', async () => {
    const startupError = new Error(
      'unsupported startup parameter: statement_timeout'
    );
    const query = jest.fn(async () => Promise.reject(startupError));
    const end = jest.fn(async () => undefined);

    await expect(
      verifyWebhookDispatcherDatabaseConnection({ query, end } as never)
    ).rejects.toBe(startupError);

    expect(end).toHaveBeenCalledTimes(1);
  });
});
