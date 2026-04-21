import 'reflect-metadata';
import { WorkerProfileStatusViewerRepository } from '@core/repositories/worker/WorkerProfileStatusViewer.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('WorkerProfileStatusViewerRepository', () => {
  it('returns null when status is not found', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new WorkerProfileStatusViewerRepository(
      dbMock.db as never
    );

    await expect(
      repository.viewWorkerProfileStatusById('wps-1')
    ).resolves.toBeNull();
  });

  it('returns profile status payload when found', async () => {
    const row = {
      value: 'hello',
      worker_profile_status_type_id: 'type-1',
      external_id: 'ext-1',
      worker_id: 'w-1',
    };
    const dbMock = createSelectDbMock([row]);
    const repository = new WorkerProfileStatusViewerRepository(
      dbMock.db as never
    );

    await expect(
      repository.viewWorkerProfileStatusById('wps-1')
    ).resolves.toEqual(row);
  });
});
