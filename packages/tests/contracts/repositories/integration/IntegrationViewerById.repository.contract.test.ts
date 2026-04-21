import 'reflect-metadata';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';
import { IntegrationViewerByIdRepository } from '@core/repositories/integration/IntegrationViewerById.repository';

describe('IntegrationViewerByIdRepository', () => {
  it('returns mapped integration when found', async () => {
    const { db } = createSelectDbMock([
      {
        api_key_id: 'api-key-1',
        key: 'secret',
        name: 'Integration A',
        status: 'active',
        worker_id: 'worker-1',
        worker_name: 'Worker A',
      },
    ]);
    const repository = new IntegrationViewerByIdRepository(db as never);

    await expect(
      repository.viewIntegrationById('acc-1', 'api-key-1')
    ).resolves.toEqual({
      api_key_id: 'api-key-1',
      key: 'secret',
      name: 'Integration A',
      status: 'active',
      worker_id: 'worker-1',
      worker_name: 'Worker A',
    });
  });

  it('returns null when integration is not found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new IntegrationViewerByIdRepository(db as never);

    await expect(
      repository.viewIntegrationById('acc-1', 'api-key-1')
    ).resolves.toBeNull();
  });
});
