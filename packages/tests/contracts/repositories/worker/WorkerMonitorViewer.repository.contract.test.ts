import 'reflect-metadata';
import { WorkerMonitorViewerRepository } from '@core/repositories/worker/WorkerMonitorViewer.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('WorkerMonitorViewerRepository', () => {
  it('listWorkers returns empty array when query has no rows', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new WorkerMonitorViewerRepository(dbMock.db as never);

    await expect(repository.listWorkers()).resolves.toEqual([]);
  });

  it('listWorkers returns monitor data when query has rows', async () => {
    const rows = [
      {
        worker_id: 'w-1',
        account_id: 'a-1',
        server_id: 's-1',
        worker_status_id: 'online',
        worker_type_id: 'baileys',
        created_at: '2026-04-21T10:00:00.000Z',
        updated_at: '2026-04-21T10:10:00.000Z',
        deleted_at: null,
        container_id: 'container-1',
        last_connection_check_at: '2026-04-21T10:11:00.000Z',
      },
    ];
    const dbMock = createSelectDbMock(rows);
    const repository = new WorkerMonitorViewerRepository(dbMock.db as never);

    await expect(repository.listWorkers()).resolves.toEqual(rows);
  });

  it('viewWorker returns null when worker is not found', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new WorkerMonitorViewerRepository(dbMock.db as never);

    await expect(repository.viewWorker('w-1')).resolves.toBeNull();
  });

  it('viewWorker returns first row when worker exists', async () => {
    const row = {
      worker_id: 'w-1',
      account_id: 'a-1',
      server_id: 's-1',
      worker_status_id: 'online',
      worker_type_id: 'baileys',
      created_at: '2026-04-21T10:00:00.000Z',
      updated_at: '2026-04-21T10:10:00.000Z',
      deleted_at: null,
      container_id: 'container-1',
      last_connection_check_at: '2026-04-21T10:11:00.000Z',
    };
    const dbMock = createSelectDbMock([row]);
    const repository = new WorkerMonitorViewerRepository(dbMock.db as never);

    await expect(repository.viewWorker('w-1')).resolves.toEqual(row);
  });
});
