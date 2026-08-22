import type { PoolClient } from 'pg';
import { installWorkerPostgresQueryProtocol } from '@core/services/workerPostgresPool';

describe('workerPostgresPool PgBouncer query protocol', () => {
  function clientHarness() {
    const query = jest.fn(
      async (..._args: unknown[]): Promise<{ rows: never[] }> => ({ rows: [] })
    );
    const client = { query } as unknown as PoolClient;
    installWorkerPostgresQueryProtocol(client);
    const invoke = client.query as unknown as (
      ...args: unknown[]
    ) => Promise<unknown>;
    return { client, invoke, query };
  }

  it('names parameterized string queries deterministically without using values', async () => {
    const first = clientHarness();
    const second = clientHarness();
    const sql = 'SELECT $1::text AS value';

    await first.invoke(sql, ['secret-one']);
    await second.invoke(sql, ['secret-two']);

    const firstConfig = first.query.mock.calls[0]?.[0] as {
      name: string;
      text: string;
    };
    const secondConfig = second.query.mock.calls[0]?.[0] as {
      name: string;
      text: string;
    };
    expect(firstConfig).toMatchObject({ text: sql });
    expect(firstConfig.name).toMatch(/^underchat_worker_[0-9a-f]{40}$/u);
    expect(secondConfig.name).toBe(firstConfig.name);
    expect(firstConfig.name).not.toContain('secret');
    expect(first.query.mock.calls[0]?.[1]).toEqual(['secret-one']);
    expect(second.query.mock.calls[0]?.[1]).toEqual(['secret-two']);
  });

  it('names parameterized query configs while preserving their options', async () => {
    const { invoke, query } = clientHarness();
    const config = {
      rowMode: 'array',
      text: 'SELECT $1::integer',
      values: [42],
    };

    await invoke(config);

    expect(query).toHaveBeenCalledWith({
      ...config,
      name: expect.stringMatching(/^underchat_worker_[0-9a-f]{40}$/u),
    });
  });

  it.each([
    ['a simple query', ['SELECT 1']],
    [
      'an explicitly simple protocol query',
      [{ queryMode: 'simple', text: 'SELECT $1', values: [1] }],
    ],
    [
      'an explicitly named query',
      [{ name: 'caller_owned_name', text: 'SELECT $1', values: [1] }],
    ],
  ])('does not rewrite %s', async (_label, args) => {
    const { invoke, query } = clientHarness();

    await invoke(...args);

    expect(query).toHaveBeenCalledWith(...args);
  });

  it('preserves the callback argument for the node-postgres overload', () => {
    const query = jest.fn((_config, _values, callback) => {
      callback(null, { rows: [] });
    });
    const client = { query } as unknown as PoolClient;
    installWorkerPostgresQueryProtocol(client);
    const callback = jest.fn();
    const invoke = client.query as unknown as (...args: unknown[]) => unknown;

    invoke('SELECT $1::integer', [7], callback);

    expect(query.mock.calls[0]?.[2]).toBe(callback);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
