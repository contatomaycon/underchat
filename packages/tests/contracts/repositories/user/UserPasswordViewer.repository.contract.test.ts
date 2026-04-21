import 'reflect-metadata';
import { UserPasswordViewerRepository } from '@core/repositories/user/UserPasswordViewer.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('UserPasswordViewerRepository', () => {
  it('returns null when query has no rows', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new UserPasswordViewerRepository(dbMock.db as never);

    await expect(
      repository.viewUserPasswordById('user-1', 'account-1')
    ).resolves.toBeNull();
  });

  it('returns null when row password is empty', async () => {
    const dbMock = createSelectDbMock([{ password: null }]);
    const repository = new UserPasswordViewerRepository(dbMock.db as never);

    await expect(
      repository.viewUserPasswordById('user-1', 'account-1')
    ).resolves.toBeNull();
  });

  it('returns password when row has value', async () => {
    const dbMock = createSelectDbMock([{ password: 'hash-123' }]);
    const repository = new UserPasswordViewerRepository(dbMock.db as never);

    await expect(
      repository.viewUserPasswordById('user-1', 'account-1')
    ).resolves.toBe('hash-123');
  });
});
