import 'reflect-metadata';
import { WorkerNewStatusListerRepository } from '@core/repositories/worker/WorkerNewStatusLister.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('WorkerNewStatusListerRepository', () => {
  it('returns empty list when there are no workers in new status', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new WorkerNewStatusListerRepository(dbMock.db as never);

    await expect(repository.listWorkerNewStatus()).resolves.toEqual([]);
  });

  it('returns workers in new status', async () => {
    const rows = [
      {
        worker_id: 'w-1',
        server_id: 's-1',
        account_id: 'a-1',
        worker_status_id: 'new',
        number: null,
        connection_date: null,
      },
    ];
    const dbMock = createSelectDbMock(rows);
    const repository = new WorkerNewStatusListerRepository(dbMock.db as never);

    await expect(repository.listWorkerNewStatus()).resolves.toEqual(rows);
  });
});
