import 'reflect-metadata';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { MiddlewareApiKeyRepository } from '@core/repositories/middleware/MiddlewareApiKey.repository';
import { PgDialect } from 'drizzle-orm/pg-core';

describe('MiddlewareApiKeyRepository', () => {
  it('returns empty list when query returns no rows', async () => {
    const execute = jest.fn(async (_query: unknown) => ({
      rowCount: 0,
      rows: [],
    }));
    const repository = new MiddlewareApiKeyRepository({ execute } as never);

    await expect(
      repository.find('key-123', 'chat', ERouteModule.web)
    ).resolves.toEqual([]);
    const statement = execute.mock.calls[0]?.[0];
    const compiled = new PgDialect().sqlToQuery(statement as never);
    expect(compiled.sql).toContain('ak.key = $3');
    expect(compiled.sql).toContain('ak.worker_id IS NOT NULL');
    expect(compiled.sql).not.toContain('key-123');
    expect(compiled.params).toContain('key-123');
  });

  it('admits inactive accounts so the entitlement source decides access', async () => {
    const execute = jest.fn(async (_query: unknown) => ({
      rowCount: 0,
      rows: [],
    }));
    const repository = new MiddlewareApiKeyRepository({ execute } as never);

    await repository.find('key-123', 'chat', ERouteModule.web);

    const statement = execute.mock.calls[0]?.[0];
    const compiled = new PgDialect().sqlToQuery(statement as never);
    expect(compiled.sql).toContain('ac.account_status_id <> $2');
    expect(compiled.params).toContain(EAccountStatus.blocked);
    expect(compiled.params).not.toContain(EAccountStatus.inactive);
  });

  it('returns rows from SQL execution', async () => {
    const rows = [
      {
        account_id: 'acc-1',
        api_key_id: 'api-1',
        api_key: 'key-123',
        name: 'My API Key',
        module_name: 'account',
      },
    ];
    const execute = jest.fn(async (_query: unknown) => ({ rowCount: 1, rows }));
    const repository = new MiddlewareApiKeyRepository({ execute } as never);

    await expect(
      repository.find('key-123', 'chat', ERouteModule.web)
    ).resolves.toEqual(rows);
  });
});
