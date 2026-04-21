import 'reflect-metadata';
import { WorkerNameAndIdViewerRepository } from '@core/repositories/worker/WorkerNameAndIdViewer.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('WorkerNameAndIdViewerRepository', () => {
  it('returns null when query has no rows', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new WorkerNameAndIdViewerRepository(dbMock.db as never);

    await expect(
      repository.viewWorkerNameAndId('a-1', 'w-1')
    ).resolves.toBeNull();
  });

  it('returns first worker id and name when found', async () => {
    const row = { id: 'w-1', name: 'Worker 1' };
    const dbMock = createSelectDbMock([row]);
    const repository = new WorkerNameAndIdViewerRepository(dbMock.db as never);

    await expect(repository.viewWorkerNameAndId('a-1', 'w-1')).resolves.toEqual(
      row
    );
  });
});
