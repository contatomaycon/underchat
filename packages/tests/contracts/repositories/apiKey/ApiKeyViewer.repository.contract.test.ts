import 'reflect-metadata';
import { ApiKeyViewerRepository } from '@core/repositories/apiKey/ApiKeyViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ApiKeyViewerRepository', () => {
  it('viewApiKeyByAccountId returns first row when found', async () => {
    const { db } = createSelectDbMock([
      {
        api_key_id: 'api-1',
        key: 'secret',
        name: 'Integration A',
        status: 'active',
      },
    ]);
    const repository = new ApiKeyViewerRepository(db as never);

    await expect(repository.viewApiKeyByAccountId('acc-1')).resolves.toEqual({
      api_key_id: 'api-1',
      key: 'secret',
      name: 'Integration A',
      status: 'active',
    });
  });

  it('viewApiKeyByAccountId returns null when no rows exist', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ApiKeyViewerRepository(db as never);

    await expect(repository.viewApiKeyByAccountId('acc-1')).resolves.toBeNull();
  });

  it('viewApiKeyById returns first row when found', async () => {
    const { db } = createSelectDbMock([
      {
        api_key_id: 'api-2',
        account_id: 'acc-2',
        worker_id: 'worker-1',
        key: 'secret-2',
        name: 'Integration B',
        status: 'inactive',
      },
    ]);
    const repository = new ApiKeyViewerRepository(db as never);

    await expect(repository.viewApiKeyById('api-2')).resolves.toEqual({
      api_key_id: 'api-2',
      account_id: 'acc-2',
      worker_id: 'worker-1',
      key: 'secret-2',
      name: 'Integration B',
      status: 'inactive',
    });
  });

  it('viewApiKeyById returns null when no rows exist', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ApiKeyViewerRepository(db as never);

    await expect(repository.viewApiKeyById('api-2')).resolves.toBeNull();
  });
});
