import 'reflect-metadata';
import { WorkerPhoneConnectionDateViewerRepository } from '@core/repositories/worker/WorkerPhoneConnectionDateViewer.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('WorkerPhoneConnectionDateViewerRepository', () => {
  it('returns null when no connection date is found', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new WorkerPhoneConnectionDateViewerRepository(
      dbMock.db as never
    );

    await expect(repository.viewWorkerPhoneConnectionDate('w-1')).resolves.toBe(
      null
    );
  });

  it('returns connection date payload when found', async () => {
    const row = {
      id: 'w-1',
      number: '5511999999999',
      connection_date: '2026-04-21',
    };
    const dbMock = createSelectDbMock([row]);
    const repository = new WorkerPhoneConnectionDateViewerRepository(
      dbMock.db as never
    );

    await expect(
      repository.viewWorkerPhoneConnectionDate('w-1')
    ).resolves.toEqual(row);
  });
});
