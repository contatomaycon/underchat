import 'reflect-metadata';
import { WorkerTypeViewerRepository } from '@core/repositories/worker/WorkerTypeViewer.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('WorkerTypeViewerRepository', () => {
  it('returns null when worker type is not found', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new WorkerTypeViewerRepository(dbMock.db as never);

    await expect(repository.viewWorkerType('a-1', 'w-1')).resolves.toBeNull();
  });

  it('returns worker type payload when found', async () => {
    const row = { worker_id: 'w-1', worker_type_id: 'type-1' };
    const dbMock = createSelectDbMock([row]);
    const repository = new WorkerTypeViewerRepository(dbMock.db as never);

    await expect(repository.viewWorkerType('a-1', 'w-1')).resolves.toEqual(row);
  });
});
