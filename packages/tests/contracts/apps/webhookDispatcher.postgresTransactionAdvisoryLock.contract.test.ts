import { runWithPostgresTransactionAdvisoryLock } from '@core/services/webhookDispatcherTransactionAdvisoryLock';

const queryTexts = (query: jest.Mock): string[] =>
  query.mock.calls.map((call: unknown[]) => String(call[0]));

describe('webhook dispatcher transaction advisory lock contract', () => {
  it('pins one client, uses a transaction lock, commits and releases it', async () => {
    const query = jest.fn(async (text: string, _values?: unknown[]) => ({
      rows: text.includes('pg_try_advisory_xact_lock')
        ? [{ acquired: true }]
        : [],
    }));
    const release = jest.fn();
    const connect = jest.fn(async () => ({ query, release }));
    const run = jest.fn(async () => 'recovered');

    await expect(
      runWithPostgresTransactionAdvisoryLock({
        pool: { connect } as never,
        lockId: 123,
        queryTimeoutMs: 30_000,
        run,
      })
    ).resolves.toEqual({ acquired: true, value: 'recovered' });

    expect(queryTexts(query)).toEqual([
      'BEGIN',
      "SELECT set_config('statement_timeout', $1, true)",
      'SELECT pg_try_advisory_xact_lock($1) AS acquired',
      'COMMIT',
    ]);
    expect(queryTexts(query)).not.toContain('SELECT pg_advisory_unlock($1)');
    expect(query.mock.calls[1]?.[1]).toEqual(['30000']);
    expect(run).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(undefined);
  });

  it('commits and skips work when another replica owns the lock', async () => {
    const query = jest.fn(async (text: string) => ({
      rows: text.includes('pg_try_advisory_xact_lock')
        ? [{ acquired: false }]
        : [],
    }));
    const release = jest.fn();
    const run = jest.fn(async () => 'must-not-run');

    await expect(
      runWithPostgresTransactionAdvisoryLock({
        pool: {
          connect: jest.fn(async () => ({ query, release })),
        } as never,
        lockId: 123,
        queryTimeoutMs: 30_000,
        run,
      })
    ).resolves.toEqual({ acquired: false });

    expect(queryTexts(query).at(-1)).toBe('COMMIT');
    expect(run).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(undefined);
  });

  it('rolls back and safely releases the pinned client when work fails', async () => {
    const query = jest.fn(async (text: string) => ({
      rows: text.includes('pg_try_advisory_xact_lock')
        ? [{ acquired: true }]
        : [],
    }));
    const release = jest.fn();
    const workError = new Error('recovery failed');

    await expect(
      runWithPostgresTransactionAdvisoryLock({
        pool: {
          connect: jest.fn(async () => ({ query, release })),
        } as never,
        lockId: 123,
        queryTimeoutMs: 30_000,
        run: async () => Promise.reject(workError),
      })
    ).rejects.toBe(workError);

    expect(queryTexts(query).at(-1)).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledWith(undefined);
  });

  it('discards the client if rollback itself fails', async () => {
    const rollbackError = new Error('connection lost during rollback');
    const query = jest.fn(async (text: string) => {
      if (text === 'ROLLBACK') throw rollbackError;
      return {
        rows: text.includes('pg_try_advisory_xact_lock')
          ? [{ acquired: true }]
          : [],
      };
    });
    const release = jest.fn();

    await expect(
      runWithPostgresTransactionAdvisoryLock({
        pool: {
          connect: jest.fn(async () => ({ query, release })),
        } as never,
        lockId: 123,
        queryTimeoutMs: 30_000,
        run: async () => Promise.reject(new Error('work failed')),
      })
    ).rejects.toThrow('work failed');

    expect(release).toHaveBeenCalledWith(rollbackError);
  });

  it('discards the client when BEGIN fails before a transaction opens', async () => {
    const beginError = new Error('connection reset during begin');
    const query = jest.fn(async () => Promise.reject(beginError));
    const release = jest.fn();

    await expect(
      runWithPostgresTransactionAdvisoryLock({
        pool: {
          connect: jest.fn(async () => ({ query, release })),
        } as never,
        lockId: 123,
        queryTimeoutMs: 30_000,
        run: async () => undefined,
      })
    ).rejects.toBe(beginError);

    expect(query).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(beginError);
  });
});
