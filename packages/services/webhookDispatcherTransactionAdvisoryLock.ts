import type { Pool, PoolClient } from 'pg';

interface AdvisoryLockRow {
  readonly acquired: boolean;
}

type TransactionPool = Pick<Pool, 'connect'>;
type TransactionClient = Pick<PoolClient, 'query' | 'release'>;

type TransactionAdvisoryLockResult<TResult> =
  | { readonly acquired: false }
  | { readonly acquired: true; readonly value: TResult };

const normalizeTimeoutMs = (value: number): number =>
  Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

/**
 * Runs work while holding a transaction-scoped advisory lock on one pinned
 * PgBouncer backend. Session advisory locks are unsafe with transaction pooling
 * because lock and unlock can reach different PostgreSQL sessions.
 */
export const runWithPostgresTransactionAdvisoryLock = async <TResult>(input: {
  readonly pool: TransactionPool;
  readonly lockId: number;
  readonly queryTimeoutMs: number;
  readonly run: () => Promise<TResult>;
}): Promise<TransactionAdvisoryLockResult<TResult>> => {
  const client = (await input.pool.connect()) as TransactionClient;
  const queryTimeoutMs = normalizeTimeoutMs(input.queryTimeoutMs);
  let isTransactionOpen = false;
  let releaseError: Error | undefined;

  try {
    await client.query('BEGIN');
    isTransactionOpen = true;
    await client.query("SELECT set_config('statement_timeout', $1, true)", [
      String(queryTimeoutMs),
    ]);
    const lock = await client.query<AdvisoryLockRow>(
      'SELECT pg_try_advisory_xact_lock($1) AS acquired',
      [input.lockId]
    );

    if (lock.rows[0]?.acquired !== true) {
      await client.query('COMMIT');
      isTransactionOpen = false;
      return { acquired: false };
    }

    const value = await input.run();
    await client.query('COMMIT');
    isTransactionOpen = false;
    return { acquired: true, value };
  } catch (error: unknown) {
    if (isTransactionOpen) {
      try {
        await client.query('ROLLBACK');
        isTransactionOpen = false;
      } catch (rollbackError: unknown) {
        releaseError = asError(rollbackError);
      }
    } else {
      releaseError = asError(error);
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
};
