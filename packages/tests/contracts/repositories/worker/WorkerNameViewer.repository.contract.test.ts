import 'reflect-metadata';
import { WorkerNameViewerRepository } from '@core/repositories/worker/WorkerNameViewer.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('WorkerNameViewerRepository', () => {
  it('returns null when worker is not found', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new WorkerNameViewerRepository(dbMock.db as never);

    await expect(repository.findWorkerNameById('w-1')).resolves.toBeNull();
  });

  it('returns worker name when found', async () => {
    const dbMock = createSelectDbMock([{ name: 'Worker 1' }]);
    const repository = new WorkerNameViewerRepository(dbMock.db as never);

    await expect(repository.findWorkerNameById('w-1')).resolves.toBe(
      'Worker 1'
    );
  });
});
