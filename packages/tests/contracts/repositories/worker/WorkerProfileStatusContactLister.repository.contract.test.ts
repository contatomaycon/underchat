import 'reflect-metadata';
import { WorkerProfileStatusContactListerRepository } from '@core/repositories/worker/WorkerProfileStatusContactLister.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('WorkerProfileStatusContactListerRepository', () => {
  it('returns normalized phone fields from query result', async () => {
    const dbMock = createSelectDbMock([
      { phone_ddi: '55', phone: '11999999999' },
      { phone_ddi: null, phone: null },
    ]);
    const repository = new WorkerProfileStatusContactListerRepository(
      dbMock.db as never
    );

    await expect(repository.listContactsByStatusId('wps-1')).resolves.toEqual([
      { phone_ddi: '55', phone: '11999999999' },
      { phone_ddi: null, phone: null },
    ]);
  });
});
