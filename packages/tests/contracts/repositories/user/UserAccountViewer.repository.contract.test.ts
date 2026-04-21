import 'reflect-metadata';
import { UserAccountViewerRepository } from '@core/repositories/user/UserAccountViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('UserAccountViewerRepository', () => {
  it('returns null when user is not found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new UserAccountViewerRepository(db as never);

    await expect(repository.getUserAccountId('user-1')).resolves.toBeNull();
  });

  it('returns account id when user is found', async () => {
    const { db } = createSelectDbMock([{ account_id: 'acc-1' }]);
    const repository = new UserAccountViewerRepository(db as never);

    await expect(repository.getUserAccountId('user-1')).resolves.toBe('acc-1');
  });
});
