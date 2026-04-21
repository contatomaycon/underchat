import 'reflect-metadata';
import { UserMasterViewerRepository } from '@core/repositories/user/UserMasterViewer.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('UserMasterViewerRepository', () => {
  it('returns null when no master user is found', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new UserMasterViewerRepository(dbMock.db as never);

    await expect(
      repository.findMasterUserByAccountId('account-1')
    ).resolves.toBe(null);
  });

  it('returns mapped master user payload when found', async () => {
    const dbMock = createSelectDbMock([
      {
        user_id: 'user-1',
        email: 'john@company.com',
        account_id: 'account-1',
        account_name: 'Acme',
      },
    ]);
    const repository = new UserMasterViewerRepository(dbMock.db as never);

    await expect(
      repository.findMasterUserByAccountId('account-1')
    ).resolves.toEqual({
      user_id: 'user-1',
      email: 'john@company.com',
      account_id: 'account-1',
      account_name: 'Acme',
    });
  });
});
