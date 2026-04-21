import 'reflect-metadata';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { MiddlewareApiKeyRepository } from '@core/repositories/middleware/MiddlewareApiKey.repository';

describe('MiddlewareApiKeyRepository', () => {
  it('returns empty list when query returns no rows', async () => {
    const execute = jest.fn(async () => ({ rowCount: 0, rows: [] }));
    const repository = new MiddlewareApiKeyRepository({ execute } as never);

    await expect(
      repository.find('key-123', 'chat', ERouteModule.web)
    ).resolves.toEqual([]);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("'key-123'"));
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
    const execute = jest.fn(async () => ({ rowCount: 1, rows }));
    const repository = new MiddlewareApiKeyRepository({ execute } as never);

    await expect(
      repository.find('key-123', 'chat', ERouteModule.web)
    ).resolves.toEqual(rows);
  });
});
