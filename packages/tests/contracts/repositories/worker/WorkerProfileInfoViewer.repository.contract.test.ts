import 'reflect-metadata';
import { WorkerProfileInfoViewerRepository } from '@core/repositories/worker/WorkerProfileInfoViewer.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('WorkerProfileInfoViewerRepository', () => {
  it('returns null when profile info is not found', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new WorkerProfileInfoViewerRepository(
      dbMock.db as never
    );

    await expect(
      repository.viewWorkerProfileInfoByWorkerId('w-1')
    ).resolves.toBe(null);
  });

  it('returns first profile info row when found', async () => {
    const row = {
      worker_profile_info_id: 'wpi-1',
      worker_id: 'w-1',
      name: 'Worker Name',
      message: 'Hello',
      photo: 'photo',
      created_at: '2026-04-21T10:00:00.000Z',
      updated_at: '2026-04-21T10:10:00.000Z',
    };
    const dbMock = createSelectDbMock([row]);
    const repository = new WorkerProfileInfoViewerRepository(
      dbMock.db as never
    );

    await expect(
      repository.viewWorkerProfileInfoByWorkerId('w-1')
    ).resolves.toEqual(row);
  });
});
