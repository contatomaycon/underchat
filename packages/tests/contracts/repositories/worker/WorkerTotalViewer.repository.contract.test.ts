import 'reflect-metadata';
import { WorkerTotalViewerRepository } from '@core/repositories/worker/WorkerTotalViewer.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('WorkerTotalViewerRepository', () => {
  it('returns 0 when no rows are returned', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new WorkerTotalViewerRepository(dbMock.db as never);

    await expect(repository.totalWorkerByAccountId('a-1')).resolves.toBe(0);
  });

  it('returns total from first row', async () => {
    const dbMock = createSelectDbMock([{ total: 7 }]);
    const repository = new WorkerTotalViewerRepository(dbMock.db as never);

    await expect(repository.totalWorkerByAccountId('a-1')).resolves.toBe(7);
  });
});
