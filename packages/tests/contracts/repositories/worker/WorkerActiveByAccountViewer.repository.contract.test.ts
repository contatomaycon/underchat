import 'reflect-metadata';
import { WorkerActiveByAccountViewerRepository } from '@core/repositories/worker/WorkerActiveByAccountViewer.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('WorkerActiveByAccountViewerRepository', () => {
  it('returns active workers payload from query', async () => {
    const rows = [
      { worker_id: 'w-1', server_id: 's-1', account_id: 'a-1' },
      { worker_id: 'w-2', server_id: 's-2', account_id: 'a-1' },
    ];
    const dbMock = createSelectDbMock(rows);
    const repository = new WorkerActiveByAccountViewerRepository(
      dbMock.db as never
    );

    await expect(repository.viewWorkerActiveByAccount('a-1')).resolves.toEqual(
      rows
    );
  });
});
