import 'reflect-metadata';
import { UserViewerExistsRepository } from '@core/repositories/user/UserViewerExists.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('UserViewerExistsRepository', () => {
  it('returns false when query returns empty array', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new UserViewerExistsRepository(dbMock.db as never);

    await expect(
      repository.existsUserById('user-1', 'account-1')
    ).resolves.toBe(false);
  });

  it('returns false when total is zero', async () => {
    const dbMock = createSelectDbMock([{ total: 0 }]);
    const repository = new UserViewerExistsRepository(dbMock.db as never);

    await expect(
      repository.existsUserById('user-1', 'account-1')
    ).resolves.toBe(false);
  });

  it('returns true when total is greater than zero', async () => {
    const dbMock = createSelectDbMock([{ total: 2 }]);
    const repository = new UserViewerExistsRepository(dbMock.db as never);

    await expect(
      repository.existsUserById('user-1', 'account-1')
    ).resolves.toBe(true);
  });
});
