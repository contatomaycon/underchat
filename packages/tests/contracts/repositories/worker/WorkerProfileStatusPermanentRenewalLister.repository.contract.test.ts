import 'reflect-metadata';
import { WorkerProfileStatusPermanentRenewalListerRepository } from '@core/repositories/worker/WorkerProfileStatusPermanentRenewalLister.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('WorkerProfileStatusPermanentRenewalListerRepository', () => {
  it('returns empty list when no permanent status needs renewal', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new WorkerProfileStatusPermanentRenewalListerRepository(
      dbMock.db as never
    );

    await expect(repository.listPermanentStatusToRenew()).resolves.toEqual([]);
  });

  it('returns statuses to renew from query result', async () => {
    const rows = [
      {
        worker_profile_status_id: 'wps-1',
        worker_id: 'w-1',
        account_id: 'a-1',
        worker_profile_status_type_id: 'type-1',
        value: 'hello',
        is_permanent: true,
      },
    ];
    const dbMock = createSelectDbMock(rows);
    const repository = new WorkerProfileStatusPermanentRenewalListerRepository(
      dbMock.db as never
    );

    await expect(repository.listPermanentStatusToRenew()).resolves.toEqual(
      rows
    );
  });
});
