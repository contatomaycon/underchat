import type { Pool, PoolConfig } from 'pg';

export interface WebhookDispatcherDatabasePoolRuntimeConfig {
  readonly databasePoolMin: number;
  readonly databasePoolMax: number;
  readonly databasePoolIdleTimeoutMs: number;
  readonly databasePoolAcquireTimeoutMs: number;
  readonly databaseQueryTimeoutMs: number;
}

export interface WebhookDispatcherDatabaseConnectionConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly ssl:
    | false
    | {
        readonly rejectUnauthorized: boolean;
      };
}

type InitializablePool = Pick<Pool, 'query' | 'end'>;

/**
 * Builds a PgBouncer transaction-pooling compatible node-postgres config.
 * Server-side GUCs must not be sent as startup parameters. In particular,
 * `statement_timeout` and `options=-c ...` are rejected or unsafe on common
 * pooler configurations. `query_timeout` is enforced by node-postgres and is
 * not included in the startup packet.
 */
export const buildWebhookDispatcherPoolConfig = (
  runtime: WebhookDispatcherDatabasePoolRuntimeConfig,
  connection: WebhookDispatcherDatabaseConnectionConfig
): PoolConfig => ({
  ...connection,
  min: runtime.databasePoolMin,
  max: runtime.databasePoolMax,
  idleTimeoutMillis: runtime.databasePoolIdleTimeoutMs,
  connectionTimeoutMillis: runtime.databasePoolAcquireTimeoutMs,
  query_timeout: runtime.databaseQueryTimeoutMs,
  application_name: 'underchat-webhook-dispatcher',
  keepAlive: true,
  keepAliveInitialDelayMillis: 5_000,
  allowExitOnIdle: true,
});

/**
 * Opens the lazy pool during startup so protocol/configuration errors fail fast.
 * A failed pool is closed here because Fastify has not installed its onClose
 * hook yet.
 */
export const verifyWebhookDispatcherDatabaseConnection = async (
  pool: InitializablePool
): Promise<void> => {
  try {
    await pool.query('SELECT 1 AS ready');
  } catch (error: unknown) {
    await pool.end().catch(() => undefined);
    throw error;
  }
};
