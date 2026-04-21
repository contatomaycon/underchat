import 'reflect-metadata';
import { UserTotalViewerRepository } from '@core/repositories/user/UserTotalViewer.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('UserTotalViewerRepository', () => {
  it('returns 0 when query has no rows', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new UserTotalViewerRepository(dbMock.db as never);

    await expect(repository.totalUserByAccount('account-1')).resolves.toBe(0);
  });

  it('returns total from first row', async () => {
    const dbMock = createSelectDbMock([{ total: 5 }]);
    const repository = new UserTotalViewerRepository(dbMock.db as never);

    await expect(repository.totalUserByAccount('account-1')).resolves.toBe(5);
  });
});
