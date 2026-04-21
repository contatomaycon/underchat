import 'reflect-metadata';
import { WorkerBaileysActivitiesListerRepository } from '@core/repositories/worker/WorkerBaileysActivitiesLister.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('WorkerBaileysActivitiesListerRepository', () => {
  it('returns empty list when there are no matching workers', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new WorkerBaileysActivitiesListerRepository(
      dbMock.db as never
    );

    await expect(repository.listWorkerBaileysActivities()).resolves.toEqual([]);
  });

  it('returns activities list from query result', async () => {
    const rows = [
      {
        worker_id: 'w-1',
        server_id: 's-1',
        account_id: 'a-1',
        worker_status_id: 'online',
        number: '5511999999999',
        connection_date: '2026-04-21T10:00:00.000Z',
      },
    ];
    const dbMock = createSelectDbMock(rows);
    const repository = new WorkerBaileysActivitiesListerRepository(
      dbMock.db as never
    );

    await expect(repository.listWorkerBaileysActivities()).resolves.toEqual(
      rows
    );
  });
});
