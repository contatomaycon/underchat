import 'reflect-metadata';
import { WorkerAllListerRepository } from '@core/repositories/worker/WorkerAllLister.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('WorkerAllListerRepository', () => {
  it('returns empty list when no online workers are found', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new WorkerAllListerRepository(dbMock.db as never);

    await expect(repository.listAllWorkers('account-1')).resolves.toEqual([]);
  });

  it('returns workers list from query result', async () => {
    const rows = [
      {
        id: 'w-1',
        name: 'Worker 1',
        number: '5511999999999',
        status: { id: 'online' },
      },
    ];
    const dbMock = createSelectDbMock(rows);
    const repository = new WorkerAllListerRepository(dbMock.db as never);

    await expect(repository.listAllWorkers('account-1')).resolves.toEqual(rows);
  });
});
