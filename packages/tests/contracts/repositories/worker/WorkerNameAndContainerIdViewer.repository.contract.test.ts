import 'reflect-metadata';
import { WorkerNameAndContainerIdViewerRepository } from '@core/repositories/worker/WorkerNameAndContainerIdViewer.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('WorkerNameAndContainerIdViewerRepository', () => {
  it('returns null when worker is not found', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new WorkerNameAndContainerIdViewerRepository(
      dbMock.db as never
    );

    await expect(
      repository.viewWorkerNameAndContainerId('a-1', 'w-1')
    ).resolves.toBeNull();
  });

  it('returns container data when worker exists', async () => {
    const row = { worker_id: 'w-1', container_id: 'container-1' };
    const dbMock = createSelectDbMock([row]);
    const repository = new WorkerNameAndContainerIdViewerRepository(
      dbMock.db as never
    );

    await expect(
      repository.viewWorkerNameAndContainerId('a-1', 'w-1')
    ).resolves.toEqual(row);
  });
});
