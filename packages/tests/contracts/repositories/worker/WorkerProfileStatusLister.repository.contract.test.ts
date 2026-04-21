import 'reflect-metadata';
import { WorkerProfileStatusListerRepository } from '@core/repositories/worker/WorkerProfileStatusLister.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('WorkerProfileStatusListerRepository', () => {
  it('returns empty list when worker has no profile status', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new WorkerProfileStatusListerRepository(
      dbMock.db as never
    );

    await expect(repository.listWorkerProfileStatus('w-1')).resolves.toEqual(
      []
    );
  });

  it('returns profile statuses list from query', async () => {
    const rows = [
      {
        worker_profile_status_id: 'wps-1',
        worker_id: 'w-1',
        worker_profile_status_type_id: 'type-1',
        value: 'hello',
        is_permanent: false,
        mimetype: null,
        duration: null,
        width: null,
        height: null,
        created_at: '2026-04-21T10:00:00.000Z',
      },
    ];
    const dbMock = createSelectDbMock(rows);
    const repository = new WorkerProfileStatusListerRepository(
      dbMock.db as never
    );

    await expect(repository.listWorkerProfileStatus('w-1')).resolves.toEqual(
      rows
    );
  });
});
